// invalid-key-anon.test.mjs — r-invalid-key-anon (2026-08-28)
//
// ★THE DEFECT. /mcp treated the PRESENCE of a credential as authentication.
// The tier was resolved correctly (validateKey → 'free'), but the raw,
// unvalidated string was written into ctx anyway — and every gating decision in
// server.mjs asks `!!c.api_key`, not "is that key real?". So any non-empty junk
// string took the keyed branches of applyTierGate (KEYED_FACILITY_MASK /
// KEYED_FREE_BONUS / trial_taste) and skipped the anonymous trim.
//
// Measured against PRODUCTION 2026-08-28, search_facilities {query:"Ashburn"}:
//
//   limit=25   no credential      ->   3 rows,  4,459 chars, withheld_fields=['data']
//              ?apiKey=<junk>     ->  25 rows, 12,302 chars, withheld_fields=[]
//              ?api_key=<junk>    ->  25 rows   (identical)
//              ?key=<junk>        ->  25 rows   (identical)
//              X-API-Key: <junk>  ->  25 rows   (identical)  <- NOT query-only
//              inline arg api_key ->  25 rows   (identical)
//              ?apiKey= (empty)   ->   3 rows   (falsy, never reached the gate)
//   limit=100  no credential      ->   3 rows
//              ?apiKey=<junk>     -> 100 rows, 41,958 chars
//
// Only the Bearer channel was safe, and only because r-invalid-bearer-401
// validates it on a separate path and 401s.
//
// ★WHY THIS FILE DRIVES REAL HTTP. The bug lived in the gap between two levels:
// validateKey() was already correct in isolation, and applyTierGate() was
// already correct in isolation. What was wrong was the value the handler put
// into ctx BETWEEN them. A unit test on either function passes on the broken
// build — this must be driven through the real POST /mcp handler or it proves
// nothing (the same lesson as capacity-context.test.mjs / Stage 0a).
//
// ★WHY THE VALID-KEY CASE IS IN HERE TOO. "Reject every key" would satisfy the
// equality assertions perfectly. The keyed-caller test is what makes those
// assertions mean "junk is anonymous" rather than "nothing authenticates".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub, STUB_PORT;
let validateHits = 0;
let facilitiesHits = 0;

const JUNK = 'totally_made_up_zzz';
const GOOD = 'dchub_live_test_goodkey';

// 5 rows — more than TRIAL_PREVIEW_ROWS (3), so an anonymous trim is visible as
// a row-count difference rather than a no-op.
const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: 1000 + i,
  name: `Facility ${i}`,
  provider: 'Test Provider',
  city: 'Ashburn',
  state: 'VA',
  country: 'US',
  slug: `test-facility-${i}`,
  power_mw: 10 * (i + 1),
}));

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');

      if (url.pathname === '/api/v1/keys/validate') {
        validateHits += 1;
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          let key = '';
          try { key = (JSON.parse(body || '{}').api_key) || ''; } catch (_) {}
          // 200 + valid:false is the AUTHORITATIVE rejection the fix keys on.
          // (A 5xx here would be INDETERMINATE and must NOT drop the key — see
          // the indeterminate test below, which drives that separately.)
          res.end(JSON.stringify(key === GOOD
            ? { valid: true, tier: 'free', developer_id: 'dev_test', email: 'test@example.com' }
            : { valid: false }));
        });
        return;
      }
      if (url.pathname === '/api/v1/facilities') {
        facilitiesHits += 1;
        res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  STUB_PORT = stub.address().port;

  // API_BASE is captured ONCE at module evaluation, so this must be set BEFORE
  // the import and restored right after — vitest shares a worker's process.env
  // and leaving it set points sibling live-network tests at this stub.
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${STUB_PORT}`;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;

  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
});

function decode(raw) {
  return raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
}

// The tool text is a JSON object OFTEN FOLLOWED by an appended human-relay
// markdown block, so JSON.parse over the whole string throws. Walk to the
// balanced close instead. (Parsing the whole string is exactly how the original
// report mis-read anonymous limit=100 as "0 rows" — it returns 3.)
function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

async function post(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, raw: await res.text() };
}

/** One stateless tools/call (no initialize) — the branch the Smithery gateway takes. */
async function callStateless(path, headers, args = { query: 'Ashburn', limit: 25 }) {
  const { raw } = await post(path, headers, {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'search_facilities', arguments: args },
  });
  const r = JSON.parse(decode(raw)).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('');
  return shape(leadingJson(text), text);
}

/** initialize -> tools/call on a real session — the sessionMeta path. */
async function callSessioned(path, headers, args = { query: 'Ashburn', limit: 25 }) {
  const init = await post(path, headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {},
              clientInfo: { name: 'invalid-key-anon-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { raw } = await post(path, h, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'search_facilities', arguments: args },
  });
  const r = JSON.parse(decode(raw)).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('');
  return shape(leadingJson(text), text);
}

function shape(payload, text) {
  const prov = (payload && payload.provenance) || {};
  return {
    rows: Array.isArray(payload && payload.data) ? payload.data.length : null,
    withheld: prov.preview ? prov.preview.withheld_fields : undefined,
    completeness: prov.completeness,
    preview_warning: prov.preview_warning,
    chars: text.length,
    payload,
  };
}

describe('r-invalid-key-anon — an unresolvable credential must not buy depth', () => {
  it('THE REPRO: ?apiKey=<junk> serves EXACTLY what no credential serves', async () => {
    const vBefore = validateHits;
    const anon = await callStateless('/mcp', {});
    const junk = await callStateless(`/mcp?apiKey=${JUNK}`, {});

    // A guard that cannot run must FAIL, never quietly pass: if the stub was
    // never asked to validate, DCHUB_API_BASE did not take and this asserted
    // nothing. Do NOT relax this into a pass.
    expect(validateHits,
      'the stub /api/v1/keys/validate was never called — the junk key never '
      + 'reached validation, so this guard exercised nothing').toBeGreaterThan(vBefore);
    expect(anon.rows, 'anonymous baseline did not return a trimmed row set')
      .toBeGreaterThan(0);
    expect(anon.rows).toBeLessThan(ROWS.length);   // the trim is actually visible

    expect(junk.rows).toBe(anon.rows);
    expect(junk.withheld).toEqual(anon.withheld);
    expect(junk.completeness).toBe(anon.completeness);
  });

  it('every query-param alias is anonymous: ?apiKey= / ?api_key= / ?key=', async () => {
    const anon = await callStateless('/mcp', {});
    for (const p of ['apiKey', 'api_key', 'key']) {
      const got = await callStateless(`/mcp?${p}=${JUNK}`, {});
      expect(got.rows, `?${p}= granted depth`).toBe(anon.rows);
      expect(got.withheld, `?${p}= changed withheld_fields`).toEqual(anon.withheld);
    }
  });

  it('the header channel is anonymous too — X-API-Key: <junk>', async () => {
    // The original report scoped this to the query string. It was never
    // query-specific: the bypass was in what the handler put into ctx, so the
    // plain header carried it identically (verified live 2026-08-28).
    const anon = await callStateless('/mcp', {});
    const junk = await callStateless('/mcp', { 'x-api-key': JUNK });
    expect(junk.rows).toBe(anon.rows);
    expect(junk.withheld).toEqual(anon.withheld);
  });

  it('the inline tool-argument channel is anonymous too', async () => {
    const anon = await callStateless('/mcp', {});
    const junk = await callStateless('/mcp', {},
      { query: 'Ashburn', limit: 25, api_key: 'dch_totally_made_up' });
    expect(junk.rows).toBe(anon.rows);
    expect(junk.withheld).toEqual(anon.withheld);
  });

  it('a raised limit cannot buy rows either (the limit=100 leg)', async () => {
    const args = { query: 'Ashburn', limit: 100 };
    const anon = await callStateless('/mcp', {}, args);
    const junk = await callStateless(`/mcp?apiKey=${JUNK}`, {}, args);
    expect(junk.rows).toBe(anon.rows);
  });

  it('the SESSIONED path (initialize -> tools/call) is closed as well', async () => {
    // Distinct code path: initialize writes api_key into sessionMeta, and every
    // later call in that session reuses it without re-validating.
    const anon = await callSessioned('/mcp', {});
    const junk = await callSessioned(`/mcp?apiKey=${JUNK}`, {});
    expect(junk.rows).toBe(anon.rows);
    expect(junk.withheld).toEqual(anon.withheld);
  });

  it('★ a VALID key still gets keyed depth — this is not "reject everything"', async () => {
    // Without this, "always return null" from _effectiveCallerKey would pass
    // every assertion above while destroying authentication entirely.
    const anon = await callStateless('/mcp', {});
    const good = await callStateless('/mcp', { 'x-api-key': GOOD });
    expect(good.rows).toBeGreaterThan(anon.rows);
    expect(good.rows).toBe(ROWS.length);
  });
});

describe('_effectiveCallerKey — the decision, in isolation', () => {
  const f = (k, v, o) => S._effectiveCallerKey(k, v, o);

  it('no credential presented → null', () => {
    expect(f(null, { valid: false, key_rejected: false })).toBeNull();
    expect(f('', { valid: false, key_rejected: false })).toBeNull();
  });

  it('backend says valid → the key rides', () => {
    expect(f(GOOD, { valid: true, tier: 'paid' })).toBe(GOOD);
  });

  it('backend AUTHORITATIVELY rejected it (200 + valid:false) → null, anonymous', () => {
    expect(f(JUNK, { valid: false, key_rejected: true })).toBeNull();
  });

  it('★ INDETERMINATE (backend 5xx / timeout) → the key rides — fail-soft', () => {
    // valid:false alone must NEVER strip identity: a backend blip returns
    // exactly that, and dropping the key there would knock a PAYING customer
    // to fully anonymous for the duration of the outage. That is the
    // regression the 2026-06-07 "never cache a downgrade" rule exists to stop.
    expect(f(GOOD, { valid: false, tier: 'free', key_rejected: false, indeterminate: true }))
      .toBe(GOOD);
    expect(f(GOOD, { valid: false, tier: 'free' })).toBe(GOOD);   // flag absent → indeterminate
    expect(f(GOOD, null)).toBe(GOOD);
    expect(f(GOOD, undefined)).toBe(GOOD);
  });

  it('kill switch restores the pre-fix behavior', () => {
    expect(f(JUNK, { valid: false, key_rejected: true }, { disabled: true })).toBe(JUNK);
  });
});

describe('_lateKeyResolve — a rejected key may not adopt onto an anon session', () => {
  it('rejected header key on an anonymous session → no adoption', () => {
    expect(S._lateKeyResolve({}, JUNK, { valid: false, key_rejected: true })).toBeNull();
  });

  it('INDETERMINATE header key on an anonymous session → adopts, unchanged', () => {
    const r = S._lateKeyResolve({}, GOOD, { valid: false, key_rejected: false });
    expect(r).not.toBeNull();
    expect(r.persist).toBe(false);
    expect(r.meta.api_key).toBe(GOOD);
  });

  it('a VALID key still binds and persists', () => {
    const r = S._lateKeyResolve({}, GOOD, { valid: true, tier: 'paid' });
    expect(r.persist).toBe(true);
    expect(r.meta.api_key).toBe(GOOD);
    expect(r.meta.tier).toBe('paid');
  });
});
