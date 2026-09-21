// list-transactions-free-values.test.mjs — r-teaser-parity (2026-09-21)
//
// ★THE DEFECT. /api/v1/deals gives a caller it does not trust as paid each deal
// with value, value_display and mw nulled ("Free: deal $ values + MW are Pro").
// It trusts the MCP server's own X-Internal-Key, so the payload behind every
// list_transactions call carried them, and the free preview (3 rows) kept all
// three. Measured through this file's harness before the fix: the keyless
// preview returned value 7100.25, value_display "$7.10B-deal0" and mw 655.
//
// ★Paid tiers are pinned unchanged: starter, developer and pro get the backend
// payload's rows exactly, and so does an identified key holding a live $10 pack
// balance (a pack does not change the key's tier, so the balance is read).
//
// HARD gate: deterministic, and its only network is two 127.0.0.1 listeners
// (a stub backend and the real express app).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const K_FREE = 'dch_live_dealsfree_free0001';
const K_IDENT = 'dch_live_dealsfree_ident001';
const K_TRIAL = 'dch_live_dealsfree_trial001';
const K_PACK = 'dch_live_dealsfree_packs001';    // identified key holding a live $10 pack balance
const K_STARTER = 'dch_live_dealsfree_start001';
const K_DEV = 'dch_live_dealsfree_devel001';
const K_PRO = 'dch_live_dealsfree_propro01';
const KEY_TIER = { [K_FREE]: 'free', [K_IDENT]: 'identified', [K_TRIAL]: 'trial', [K_PACK]: 'identified',
  [K_STARTER]: 'starter', [K_DEV]: 'developer', [K_PRO]: 'pro' };
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};

// What the backend returns to a caller it trusts: every deal with its value and
// capacity, plus the portfolio total.
const DEALS = Array.from({ length: 12 }, (_, i) => ({
  id: `deal${i}`, date: `2026-${String(12 - (i % 9)).padStart(2, '0')}-01`, buyer: `Buyer ${i} Holdings`,
  seller: `Seller ${i} Partners`, type: 'acquisition', region: 'us',
  value: 7100.25 + i, value_display: `$7.1${i}B-deal${i}`, value_confirmed: true, mw: 655 + i,
}));
const EXACT_NEEDLES = DEALS.slice(0, 3).flatMap((d) => [String(d.value), d.value_display, `"mw":${d.mw}`]);

let S, PORT, httpServer, stub;
const creditHits = new Map();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(KEY_TIER[key]
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_dealsfree', email: null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (url.pathname === '/api/v1/mcp/credits/balance') {
        const key = url.searchParams.get('key') || '';
        bump(creditHits, key || 'keyless');
        res.end(JSON.stringify({ credits: key === K_PACK ? 900 : 0, had_pack: key === K_PACK }));
        return;
      }
      if (url.pathname === '/api/v1/deals') {
        const region = url.searchParams.get('region');
        if (region === 'upstream-error') {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'deals store unavailable' }));
          return;
        }
        // `data` normally repeats `transactions` and the tool drops it; a copy that
        // differs is kept, so it has to be masked too.
        const data = region === 'mismatch' ? DEALS.slice(1) : DEALS;
        res.end(JSON.stringify({ success: true, transactions: DEALS, data, count: DEALS.length,
          total_count: 2200, total_value: 987654.3, total_value_unit: 'usd_millions', tier: 'paid' }));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, json };
}

/** The JSON object the tool leads its text with (prose may follow it). */
function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

/** One list_transactions call on a fresh session, with the per-IP anonymous counters cleared. */
async function listTransactions(key, args = {}) {
  for (const m of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) m.clear();
  const headers = key ? { 'x-api-key': key } : {};
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'deals-free-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { json } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'list_transactions', arguments: args } });
  const r = JSON.parse(json).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('');
  return { text, sc: r.structuredContent || null, lead: leadingJson(text) || {} };
}

function bodies(out) {
  const list = [['text', out.lead]];
  if (out.sc && Array.isArray(out.sc.transactions)) list.push(['structuredContent', out.sc]);
  return list;
}

function expectFreePreview(out, label) {
  for (const [where, body] of bodies(out)) {
    const rows = body.transactions || [];
    expect(rows.length, `${label} ${where}: the preview rows are missing — the checks below would be vacuous`).toBe(3);
    rows.forEach((row, i) => {
      expect(row.value, `${label} ${where} #${i} value`).toBeNull();
      expect(row.value_display, `${label} ${where} #${i} value_display`).toBeNull();
      expect(row.mw, `${label} ${where} #${i} mw`).toBeNull();
      expect(row.value_confirmed, `${label} ${where} #${i} value_confirmed`).toBe(false);
      // The deal itself stays: who bought what, when.
      expect(row.buyer, `${label} ${where} #${i} buyer`).toBe(DEALS[i].buyer);
      expect(row.seller, `${label} ${where} #${i} seller`).toBe(DEALS[i].seller);
      expect(row.date, `${label} ${where} #${i} date`).toBe(DEALS[i].date);
    });
    expect(body.tier, `${label} ${where}: a free preview still says tier "paid"`).toBe('free');
    expect(body._locked_fields, `${label} ${where}: _locked_fields`).toEqual(['value', 'value_display', 'mw']);
    expect(String(body._upgrade_cta || ''), `${label} ${where}: _upgrade_cta`).toContain('deal $ values and MW are withheld');
  }
  for (const needle of EXACT_NEEDLES) {
    expect(out.text.includes(needle), `${label}: "${needle}" reached the text`).toBe(false);
    expect(JSON.stringify(out.sc || {}).includes(needle), `${label}: "${needle}" reached structuredContent`).toBe(false);
  }
}

function expectUnchanged(out, label) {
  const list = bodies(out);
  expect(list.length, `${label}: no body carried transactions`).toBeGreaterThan(0);
  for (const [where, body] of list) {
    expect(body.transactions, `${label} ${where}: rows differ from the backend payload`).toEqual(DEALS);
    expect(body._upgrade_cta, `${label} ${where}: a paid answer carries the free-preview line`).toBeUndefined();
  }
}

describe('r-teaser-parity — list_transactions keeps deal $ values and MW paid', () => {
  it('THE REPRO: a keyless preview shows the three newest deals without value or MW', async () => {
    expectFreePreview(await listTransactions(null), 'keyless');
  });

  for (const [key, label] of [[K_FREE, 'free'], [K_IDENT, 'identified']]) {
    it(`a ${label} key gets the same preview`, async () => {
      expectFreePreview(await listTransactions(key), label);
    });
  }

  it('a trial key with no bound email is walled before any row, and the wall carries no deal value', async () => {
    const out = await listTransactions(K_TRIAL);
    expect(out.text, 'trial: expected the bound-email wall').toContain('needs a bound email');
    for (const needle of EXACT_NEEDLES) {
      expect(out.text.includes(needle) || JSON.stringify(out.sc || {}).includes(needle), `trial: "${needle}" reached the wall`).toBe(false);
    }
  });

  for (const [key, label] of [[K_STARTER, 'starter'], [K_DEV, 'developer'], [K_PRO, 'pro']]) {
    it(`${label}: unchanged — every deal with its value and MW, as the backend sent them`, async () => {
      expectUnchanged(await listTransactions(key), label);
      expect(creditHits.get(key) || 0, `${label}: a paid tier should not need the pack-balance lookup`).toBe(0);
    });
  }

  it('a `data` array that differs from `transactions` survives the dedup, and is masked too', async () => {
    const out = await listTransactions(null, { region: 'mismatch' });
    expectFreePreview(out, 'keyless (mismatched data)');
    for (const [where, body] of bodies(out)) {
      const rows = body.data || [];
      expect(rows.length, `${where}: the kept data rows are missing — the checks below would be vacuous`).toBe(3);
      rows.forEach((row, i) => {
        for (const f of ['value', 'value_display', 'mw']) expect(row[f], `${where} data #${i} ${f}`).toBeNull();
      });
    }
  });

  it('an upstream error body passes through without the free-preview decoration', async () => {
    const out = await listTransactions(null, { region: 'upstream-error' });
    const blob = out.text + JSON.stringify(out.sc || {});
    expect(blob, 'the error never reached the answer — this case would be vacuous').toContain('503');
    expect(blob).not.toContain('deal $ values and MW are withheld');
    expect(blob).not.toContain('_locked_fields');
  });

  // Keyless callers on POST /mcp carry tier 'free'. A blank or 'anonymous' tier
  // from another transport must still read as unpaid, never as paid.
  it('the unpaid predicate: blank / anonymous / free / identified / trial are unpaid; paid tiers are not', async () => {
    for (const tier of ['', 'anonymous', 'anon', 'free', 'identified', 'trial', undefined]) {
      expect(await S._isUnpaidRead({ tier }), `tier ${JSON.stringify(tier)}`).toBe(true);
    }
    for (const tier of ['starter', 'developer', 'pro', 'paid', 'enterprise', 'founding']) {
      expect(await S._isUnpaidRead({ tier }), `tier ${tier}`).toBe(false);
    }
  });

  it('an identified key holding a live $10 pack balance: unchanged (the pack is a paid read)', async () => {
    expectUnchanged(await listTransactions(K_PACK), 'identified + pack');
    expect(creditHits.get(K_PACK), 'the pack balance was never read').toBeGreaterThan(0);
  });
});
