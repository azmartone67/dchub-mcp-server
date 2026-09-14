// starter-links-through-go-c.test.mjs — r-starter-go-c (2026-09-14)
//
// ★THE DEFECT. Two tools/call envelopes handed out the $9 Starter checkout as a DIRECT
// buy.stripe.com link while the Developer and Pro links beside it went through the signed
// /go/c tracker, so a human's click on Starter never reached mcp_checkout_clicks
// (routes/checkout_click_tracker.py stamps the row, then 302s to Stripe):
//   * the anonymous trim of an allowed free tool (`_upgrade.tier: 'anonymous'`)
//   * the trial-cap wall (`_upgrade.tier: 'trial'`), where a keyed caller's Starter link
//     also bound the SESSION while Developer and Pro bound k-<sha256(key)>
// Both ride content[0].text, which the agent reads and relays, and the structuredContent
// that _stampEntityCb mirrors from it.
//
// ★WHY REAL HTTP. The links are built inline in the tools/call handler and no exported
// function returns them, so a unit test of _subCheckoutUrl passes on the broken build.
//
// ★THE PROMO. A /go/c token is plan|ref[|sid] and the tracker 302s to STRIPE_LINKS[plan]
// plus client_reference_id, so a prefilled_promo_code cannot survive the hop. Both sites
// still evaluate promoParam() per request, so the fail-open direct link (no
// DCHUB_INTERNAL_KEY, or DCHUB_GO_LINKS=0) carries it as before. The promo ended
// 2026-07-01; one test moves the clock back inside the window to prove that.
//
// Qualifies for the hard gate: the only sockets are a 127.0.0.1 backend stub and the real
// express app listening on 127.0.0.1.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

const SECRET = 'test-internal-key-not-a-real-secret';
const STARTER = 'https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g';
const GO = 'https://dchub.cloud/go/c/';
const K_LIVE = 'dch_live_startergoc_key00001';
const K_TRIAL = 'dch_trial_startergoc_key0001';
const FACILITIES = { query: 'Ashburn', limit: 25 };
const sha = (k) => createHash('sha256').update(k).digest('hex');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ROWS = Array.from({ length: 6 }, (_, i) => ({
  id: 100 + i, name: `Site ${i}`, slug: `site-${i}`, provider: 'P', city: 'Ashburn',
  state: 'VA', country: 'US', region: 'PJM', score: 60 + i, power_mw: 10 * (i + 1),
}));

let S, PORT, httpServer, stub;
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_TRIAL_TOOL_DAILY_FULL', 'DCHUB_GO_LINKS'];
const prevEnv = {};
const validated = new Set();

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
      const p = url.pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        validated.add(key);
        let out = { valid: false };
        if (key === K_LIVE) out = { valid: true, tier: 'free', developer_id: 'dev_t', email: null };
        if (key === K_TRIAL) out = { valid: true, tier: 'free', developer_id: null, email: null, source: 'auto_trial' };
        res.end(JSON.stringify(out));
        return;
      }
      if (p === '/api/v1/mcp/monthly-usage') {
        const tier = url.searchParams.get('tier') || 'free';
        res.end(JSON.stringify({ allowed: true, blocked: false, enforce: false, reason: 'enforcement_off',
          used: 1, quota: 300, remaining: 299, tier, quota_tier: tier }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: true, prior_calls: 1 })); return; }
      if (p === '/api/v1/keys/auto-mint') { res.end(JSON.stringify({ ok: false })); return; }
      if (p === '/api/v1/mcp/credits/balance') { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      const tool = p.startsWith('/api/v1/mcp/tools/');
      if ((p.startsWith('/api/v1/mcp/') && !tool) || p.startsWith('/api/v1/sources/')) { res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS, results: ROWS }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  // Held for the whole file: _goUrl reads it per call, and without it every link is direct.
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  // Read at import: one full answer per tool per day, then the trial-cap wall.
  process.env.DCHUB_TRIAL_TOOL_DAILY_FULL = '1';
  delete process.env.DCHUB_GO_LINKS;
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

/** One tools/call with no initialize: no session, the branch the Smithery gateway takes. */
async function callStateless(name, args) {
  const { json } = await post({}, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return JSON.parse(json).result || {};
}

async function openSession(headers) {
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'starter-go-c-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 1;
  return {
    sid,
    async call(name, args) {
      id += 1;
      const { json } = await post(h, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
      return JSON.parse(json).result || {};
    },
  };
}

/** The JSON object a data tool leads its text with (a markdown block may follow it). */
function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc_ = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc_) esc_ = false; else if (ch === '\\') esc_ = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}
const upgradeOf = (result) => (leadingJson(result.content?.[0]?.text) || {})._upgrade || {};

/** Split a signed dchub.cloud/<path>/<payload>.<sig> link the way the backend verifies it. */
function fields(url, prefix) {
  expect(String(url).startsWith(prefix), `not a signed ${prefix} link: ${url}`).toBe(true);
  const token = url.slice(prefix.length);
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
  expect(token.slice(i + 1)).toBe(sig);
  return { payload, parts: Buffer.from(payload, 'base64url').toString().split('|') };
}

describe('the anonymous trim of an allowed free tool (_upgrade.tier anonymous)', () => {
  it('stateless: Starter is a signed /go/c starter link on the same a- ref as the pack link', async () => {
    const up = upgradeOf(await callStateless('search_facilities', FACILITIES));
    expect(up.tier, JSON.stringify(up).slice(0, 300)).toBe('anonymous');
    const { parts } = fields(up.starter_url, GO);
    expect(parts[0]).toBe('starter');
    expect(parts[1]).toMatch(/^a-[0-9a-f]{32}$/);
    expect(parts).toHaveLength(2);
    expect(fields(up.credits_url, GO).parts[1], 'the Starter link carries a different anon id').toBe(parts[1]);
  });

  it('sessioned: the ref is the session, two fields, the same as the Developer link beside it', async () => {
    const s = await openSession({});
    const up = upgradeOf(await s.call('search_facilities', FACILITIES));
    expect(up.tier, JSON.stringify(up).slice(0, 300)).toBe('anonymous');
    expect(fields(up.starter_url, GO).parts).toEqual(['starter', s.sid]);
    expect(fields(up.developer_url, GO).parts).toEqual(['developer', s.sid]);
  });

  it('structuredContent carries the same link, and the envelope hands out no direct Stripe link', async () => {
    const r = await callStateless('search_facilities', FACILITIES);
    const starter = upgradeOf(r).starter_url;
    expect(fields(starter, GO).parts[0]).toBe('starter');
    expect(r.structuredContent?._upgrade?.starter_url).toBe(starter);
    expect(JSON.stringify(r).match(/https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+/g)).toBeNull();
  });
});

describe('the trial-cap wall (_upgrade.tier trial)', () => {
  // The day counter is per client IP and tool, and every call here comes from 127.0.0.1, so a
  // later test may be walled on its first call. Call until the wall, never count calls.
  async function wall(s, tool, args) {
    for (let i = 0; i < 4; i += 1) {
      const r = await s.call(tool, args);
      if (upgradeOf(r).tier === 'trial') return r;
    }
    throw new Error(`${tool} never reached the trial-cap wall`);
  }

  it('a live key: Starter binds k-<sha256(key)> with the session beside it, like Developer and Pro', async () => {
    const s = await openSession({ 'x-api-key': K_LIVE });
    const r = await wall(s, 'rank_markets', { limit: 5 });
    expect(validated.has(K_LIVE), 'the key never reached validation').toBe(true);
    const up = upgradeOf(r);
    const identity = ['k-' + sha(K_LIVE), s.sid];
    expect(fields(up.starter_url, GO).parts).toEqual(['starter', ...identity]);
    expect(fields(up.developer_url, GO).parts).toEqual(['developer', ...identity]);
    expect(fields(up.pro_url, GO).parts).toEqual(['pro', ...identity]);
    expect(r.structuredContent?._upgrade?.starter_url).toBe(up.starter_url);
  });

  it('a trial key: Starter binds the session (a k- ref has no mcp_dev_keys row to land on)', async () => {
    const s = await openSession({ 'x-api-key': K_TRIAL });
    const up = upgradeOf(await wall(s, 'rank_markets', { limit: 5 }));
    expect(validated.has(K_TRIAL), 'the key never reached validation').toBe(true);
    expect(fields(up.starter_url, GO).parts).toEqual(['starter', s.sid]);
  });
});

describe('fail-open, and the promo query the tracker cannot carry', () => {
  afterEach(() => {
    delete process.env.DCHUB_GO_LINKS;
    vi.useRealTimers();
  });

  it('DCHUB_GO_LINKS=0: the direct Starter link keeps its client_reference_id', async () => {
    process.env.DCHUB_GO_LINKS = '0';
    const up = upgradeOf(await callStateless('search_facilities', FACILITIES));
    expect(up.starter_url).toMatch(new RegExp('^' + esc(STARTER) + '\\?client_reference_id=a-[0-9a-f]{32}$'));
  });

  it('inside a promo window the code rides the direct link, and the /go/c token has no field for it', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-30T12:00:00Z') });
    const measured = upgradeOf(await callStateless('search_facilities', FACILITIES)).starter_url;
    const { parts } = fields(measured, GO);
    expect(parts[0]).toBe('starter');
    expect(parts.join('|')).not.toContain('promo');

    process.env.DCHUB_GO_LINKS = '0';
    const direct = upgradeOf(await callStateless('search_facilities', FACILITIES)).starter_url;
    expect(direct).toMatch(new RegExp('^' + esc(STARTER)
      + '\\?prefilled_promo_code=DCMCP50_LAUNCH&client_reference_id=a-[0-9a-f]{32}$'));
  });
});

describe('source floor: server.mjs builds no Starter checkout outside the measured helpers', () => {
  // Comments are blanked first, so a note that quotes the link can neither satisfy nor trip this.
  const code = SRC.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/.*$/, '')));

  it('the raw link is spelled only where the two base constants are defined', () => {
    const raw = code.filter((l) => l.includes('buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g')).map((l) => l.trim());
    expect(raw).toEqual([
      "const _STARTER_URL_RAW = 'https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g' + promoParam();",
      "const STARTER_LINK = 'https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g';",
    ]);
  });

  it('every starter_url a response carries is built by _subCheckoutUrl', () => {
    const sites = code.filter((l) => /\bstarter_url\s*:/.test(l)).map((l) => l.trim());
    expect(sites.length, 'the scan found fewer starter_url sites than server.mjs has').toBeGreaterThanOrEqual(4);
    for (const l of sites) expect(l).toMatch(/\bstarter_url\s*:\s*(_subCheckoutUrl\(|STARTER_URL_LOCAL,)/);
  });
});
