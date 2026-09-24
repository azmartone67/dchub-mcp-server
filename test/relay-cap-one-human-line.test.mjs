// relay-cap-one-human-line.test.mjs — r-relay-cap (2026-09-21, frontend#1534)
//
// ★THE DEFECT, measured live 2026-09-21 on ONE anonymous session (client
// dchub-verify-agent), five calls:
//   1 get_grid_intelligence  ✅ "Free trial unlocked … call it again — 1 more full
//                               answer today" + 👤 "Tell your human: $10 → /go/c"
//   2 get_grid_intelligence  💡 "Full data delivered. To own it long-term — $10 → /go/c"
//   3 get_grid_intelligence  📊 "You've used your 2 full answers today … $10 → /go/c"
//   4 get_fiber_intel        📦 "Depth-limited preview … $10 → /go/c"
// Four human-directed payment lines in five calls, and an agent relays each one.
// Owner decision 2026-09-21: one human line per session after the first unlock. A
// later result that is still GATED keeps its single wall pointer; a later result
// that delivered full data carries none.
//
// ★WHY REAL HTTP. The cap is session state written by one emitter
// (buildAutoMintBlock) and read by another (the keyed full-data path). Only the
// handler, driven call after call on one session, shows whether the second emitter
// sees what the first recorded.
//
// ★CONTROLS.
//   - A NEW session on the same server still gets its own human line, so the cap
//     is per session, not a switch that silences everyone.
//   - A gated result later in a capped session still carries exactly one checkout
//     pointer, so the cap never removes the gate's own ask.
//   - The capped full-data call is asserted to BE a full-data answer, so "no
//     payment line" cannot pass on an error or an empty response.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

// ★HARD GATE, NO NETWORK (automint-trial-rungs pattern): every socket connect to a
// host other than loopback is refused and recorded; the last test fails on one.
const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'test-internal-key-not-a-real-secret';
const TRIAL = 'dch_trial_relaycaptest00000001';
// A second key for the keyed-caller case: the daily full-answer cap is counted per
// key, and the anonymous sessions above are bound to TRIAL and spend it.
const TRIAL_KEYED = 'dch_trial_relaycaptest00000002';
const MINT = {
  ok: true, api_key: TRIAL, tier: 'IDENTIFIED', expires_at: null, daily_calls: 15,
  daily_calls_when_email_bound: 50, trial_days: 7, days_remaining: 7,
};
const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: 100 + i, name: `Site ${i}`, region_id: 'ERCOT', iso: 'ERCOT', score: 50 + i,
  lat: 32 + i / 10, lon: -97 - i / 10, city: 'Dallas', state: 'TX', country: 'US',
}));

let stub;
const servers = [];
const prevEnv = {};

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

// One import of server.mjs per config: ANON_INLINE_FULL is read once, at import.
async function boot(inlineFull) {
  vi.resetModules();
  if (inlineFull === undefined) delete process.env.DCHUB_ANON_INLINE_FULL;
  else process.env.DCHUB_ANON_INLINE_FULL = inlineFull;
  const S = await import('../server.mjs');
  const srv = await new Promise((resolve) => { const s = S.app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(srv);
  return srv.address().port;
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/auto-mint') { res.end(JSON.stringify({ ...MINT, reused: false })); return; }
      if (url.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(key === TRIAL || key === TRIAL_KEYED
          ? { valid: true, tier: 'free', developer_id: null, email: null, source: 'auto_trial' }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (url.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{"error":"not found"}'); return; }
      // demand_mw + generation_mix: get_grid_intelligence needs real telemetry to be
      // an ANSWER. Without them every grid call here was a "region not covered"
      // error — and these assertions were reading the upsell riding that error,
      // which r-nodata-no-sell (2026-09-24) removes. Other tools ignore the keys.
      res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS, results: ROWS,
                               demand_mw: 18000, generation_mix: { NG: { mw: 9000 } } }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_ANON_INLINE_FULL']) prevEnv[k] = process.env[k];
  // API_BASE is captured at import; restoreSessionKey reads it per call, so it stays set.
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;     // _goUrl signs /go/c links with it
});

afterAll(async () => {
  for (const s of servers) await new Promise((resolve) => s.close(resolve));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  net.Socket.prototype.connect = realConnect;
});

async function post(port, headers, body) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const out = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, body: out };
}

async function session(port, ip, extra = {}) {
  const headers = { 'x-dc-client-ip': ip, ...extra };
  const init = await post(port, headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'relay-cap-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(port, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 10;
  return async (name, args) => {
    const { body } = await post(port, h, { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } });
    const result = JSON.parse(body).result || {};
    // One content item per line: the prose items are appended as separate items.
    return { result, text: (result.content || []).map((c) => c.text || '').join('\n') };
  };
}

const TELL = '**Tell your human:**';
const ACK_BOUND = 'Free trial unlocked on THIS session';
const ACK_MANUAL = 'Free trial key — works instantly';
const count = (t, s) => t.split(s).length - 1;
/** Prose lines that hand the human a payment link: what an agent relays. The JSON
 *  payload line is data (a trimmed row set can carry its own upgrade_url field). */
const payLines = (t) => t.split('\n').filter((l) => !/^\s*[[{]/.test(l)
  && /https:\/\/dchub\.cloud\/(go\/c|upgrade\/h)\//.test(l));

// grid's region lookup fails against this stub, so it is only used where a preview is
// the point; fiber returns the stub's rows, so it carries the full-data assertions.
const GRID = ['get_grid_intelligence', { region_id: 'ERCOT' }];
const FIBER = ['get_fiber_intel', { region_id: 'ERCOT' }];
// 2026-09-22: compare_sites became Land & Power, which answers a key below Pro
// with its own preview (test/lp-pro-only.test.mjs), not the Pro wall these
// mechanisms ride on. get_dchub_recommendation is the same class of tool
// (Pro-only, heavy, previewed for anonymous callers) outside Land & Power.
const COMPARE = ['get_dchub_recommendation', { context: '100 MW AI training campus in Texas' }];

describe('r-relay-cap — production config (inline full on): one human line per session', () => {
  let port;
  beforeAll(async () => { port = await boot(undefined); }, 60000);

  it('the ACK and its 👤 line go out once; later full-data results carry no payment line; later gated results keep one pointer', async () => {
    const call = await session(port, '198.51.100.31');

    const r1 = await call(...FIBER);                      // the first unlock: full taste inline
    expect(r1.text).toContain(ACK_BOUND);
    expect(count(r1.text, TELL)).toBe(1);
    expect(payLines(r1.text).length).toBe(1);

    const r2 = await call(...FIBER);                      // full data again, nothing gated
    expect(r2.result.isError, 'call 2 must be a full-data answer, or "no payment line" proves nothing').toBeFalsy();
    expect(r2.text).toContain('Site 0');
    expect(r2.text).not.toContain('To own it long-term');
    expect(payLines(r2.text), 'a full-data result re-sent the payment link').toEqual([]);

    // Control: a NEW session still gets its own human line.
    const other = await session(port, '198.51.100.32');
    const o1 = await other(...FIBER);
    expect(o1.text).toContain(ACK_BOUND);
    expect(count(o1.text, TELL)).toBe(1);

    const r3 = await call(...FIBER);                      // today's full answers used: gated
    expect(r3.text).toContain('full `get_fiber_intel` answers today');
    expect(payLines(r3.text).length, 'a still-gated result keeps exactly one pointer').toBe(1);
    expect(r3.text).not.toContain(ACK_BOUND);

    const r4 = await call(...COMPARE);                    // Pro wall: gated
    expect(r4.text).toContain('Pro decision tool');     // the gate still says why
    expect(payLines(r4.text).length).toBe(1);
    expect(r4.text).not.toContain(TELL);
  }, 60000);

  it('a keyed caller whose first human line is the full-data ask gets that ask once', async () => {
    const call = await session(port, '198.51.100.33', { 'x-api-key': TRIAL_KEYED });
    const r1 = await call(...FIBER);
    expect(r1.text).toContain('Site 0');
    expect(r1.text, 'the session\'s one human line').toContain('To own it long-term');
    const r2 = await call(...FIBER);
    expect(r2.result.isError).toBeFalsy();
    expect(r2.text).toContain('Site 0');
    expect(payLines(r2.text)).toEqual([]);
  }, 60000);
});

describe('r-relay-cap — unbound trial (inline full off): the "call again" ACK is not repeated', () => {
  let port;
  beforeAll(async () => { port = await boot('off'); }, 60000);

  it('call 2 on the same session drops the ACK and the /upgrade/h re-relay, keeps the wall pointer; a new session gets both', async () => {
    const call = await session(port, '198.51.100.41');
    const r1 = await call(...GRID);
    expect(r1.text).toContain(ACK_MANUAL);
    expect(r1.text).toContain(TRIAL);                    // the key the ACK hands over
    expect(r1.text).toContain('dchub.cloud/upgrade/h/'); // first response: unchanged

    const r2 = await call(...GRID);
    expect(r2.text, 'the unlock ACK was repeated: the call-it-again loop').not.toContain(ACK_MANUAL);
    expect(r2.text, 'the /upgrade/h relay was re-sent beside the wall pointer').not.toContain('dchub.cloud/upgrade/h/');
    expect(payLines(r2.text).length, 'the gated wall lost its pointer').toBe(1);
    expect(payLines(r2.text)[0]).toContain('dchub.cloud/go/c/');

    const o1 = await (await session(port, '198.51.100.42'))(...GRID);
    expect(o1.text).toContain(ACK_MANUAL);
    expect(o1.text).toContain('dchub.cloud/upgrade/h/');
  }, 60000);

  it('made no connection outside loopback', () => {
    expect(foreign).toEqual([]);
  });
});
