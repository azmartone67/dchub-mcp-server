// no-starter-offer.test.mjs — 2026-09-21 (frontend#1534). Was starter-links-through-go-c.
//
// ★THE RULE. Owner, 2026-09-21: never offer Starter $9. Agents buy the $10 pack or
// Developer; Pro is for a human screening sites. Starter is grandfathered for existing
// subscribers and is absent from /pricing. This server still offered it in seven places:
// starter_url on the upgrade block and on both trim walls, the key-bound "upgrade THIS
// key" pitch and message, the credits-depleted message ("go unlimited from $9/mo"), the
// get_market_intel and monitor-for-you prose, the unlock_more_data description, and the
// instructions every client receives at initialize.
//
// ★WHAT IT REPLACES. r-starter-go-c (2026-09-14) routed the Starter link through the
// measured /go/c tracker. The link is now gone, so this file proves its absence on the
// same real-HTTP paths, keeps the Developer/Pro binding pins that test carried, and keeps
// the source floor: the Starter link id may appear only in the click-attribution map,
// which still has to name old links in the wild.
//
// ★WHY REAL HTTP. The links are built inline in the tools/call handler and no exported
// function returns them.
//
// Qualifies for the hard gate: the only sockets are a 127.0.0.1 backend stub and the real
// express app listening on 127.0.0.1.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

const SECRET = 'test-internal-key-not-a-real-secret';
const GO = 'https://dchub.cloud/go/c/';
const K_LIVE = 'dch_live_startergoc_key00001';
const K_TRIAL = 'dch_trial_startergoc_key0001';
const FACILITIES = { query: 'Ashburn', limit: 25 };
const sha = (k) => createHash('sha256').update(k).digest('hex');

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
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'no-starter-test', version: '1.0' } },
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

const STARTER_ID = '8x2dRa5sS0x75uteGuaZi0g';

/** Every way a response could offer Starter. Empty means none. */
function starterOffers(result) {
  const text = JSON.stringify(result);
  const found = [];
  if (text.includes(STARTER_ID)) found.push('the raw Starter link');
  if (/"starter_url"|"starter":\s*"http/.test(text)) found.push('a starter link field');
  if (/\$9\/mo|\bStarter\b\s*(\$|=|·|→)|\bor Starter\b/.test(text)) found.push('Starter priced in prose');
  for (const m of text.matchAll(/https:\/\/dchub\.cloud\/go\/c\/([A-Za-z0-9_-]+)\.[0-9a-f]{32}/g)) {
    if (Buffer.from(m[1], 'base64url').toString().split('|')[0] === 'starter') found.push('a /go/c starter token');
  }
  return found;
}

describe('the anonymous trim of an allowed free tool (_upgrade.tier anonymous)', () => {
  it('stateless: no Starter; Developer is a signed /go/c link on the same a- ref as the pack link', async () => {
    const r = await callStateless('search_facilities', FACILITIES);
    const up = upgradeOf(r);
    expect(up.tier, JSON.stringify(up).slice(0, 300)).toBe('anonymous');
    const { parts } = fields(up.developer_url, GO);
    expect(parts[0]).toBe('developer');
    expect(parts[1]).toMatch(/^a-[0-9a-f]{32}$/);
    expect(fields(up.credits_url, GO).parts[1]).toBe(parts[1]);
    expect(starterOffers(r)).toEqual([]);
  });

  it('sessioned: no Starter, and the Developer link binds the session', async () => {
    const s = await openSession({});
    const r = await s.call('search_facilities', FACILITIES);
    const up = upgradeOf(r);
    expect(up.tier, JSON.stringify(up).slice(0, 300)).toBe('anonymous');
    expect(fields(up.developer_url, GO).parts).toEqual(['developer', s.sid]);
    expect(starterOffers(r)).toEqual([]);
  });

  it('structuredContent mirrors the envelope, which hands out no direct Stripe link', async () => {
    const r = await callStateless('search_facilities', FACILITIES);
    expect(r.structuredContent?._upgrade?.developer_url).toBe(upgradeOf(r).developer_url);
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

  it('a live key: no Starter; Developer and Pro bind k-<sha256(key)> with the session beside it', async () => {
    const s = await openSession({ 'x-api-key': K_LIVE });
    const r = await wall(s, 'rank_markets', { limit: 5 });
    expect(validated.has(K_LIVE), 'the key never reached validation').toBe(true);
    const up = upgradeOf(r);
    const identity = ['k-' + sha(K_LIVE), s.sid];
    expect(fields(up.developer_url, GO).parts).toEqual(['developer', ...identity]);
    expect(fields(up.pro_url, GO).parts).toEqual(['pro', ...identity]);
    expect(starterOffers(r)).toEqual([]);
  });

  it('a trial key: no Starter, and Developer binds the session (a k- ref has no row to land on)', async () => {
    const s = await openSession({ 'x-api-key': K_TRIAL });
    const r = await wall(s, 'rank_markets', { limit: 5 });
    expect(validated.has(K_TRIAL), 'the key never reached validation').toBe(true);
    expect(fields(upgradeOf(r).developer_url, GO).parts).toEqual(['developer', s.sid]);
    expect(starterOffers(r)).toEqual([]);
  });
});

describe('what every client reads before it calls anything', () => {
  it('the initialize instructions offer no Starter', async () => {
    const { json } = await post({}, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'no-starter-test', version: '1.0' } },
    });
    const instructions = JSON.parse(json).result?.instructions || '';
    expect(instructions.length, 'initialize returned no instructions to scan').toBeGreaterThan(500);
    expect(instructions).toContain('unlock_more_data');
    expect(starterOffers({ instructions })).toEqual([]);
  });

  it('the unlock_more_data description offers no Starter', async () => {
    const s = await openSession({});
    const { json } = await post({ 'mcp-session-id': s.sid }, { jsonrpc: '2.0', id: 9, method: 'tools/list' });
    const tool = (JSON.parse(json).result?.tools || []).find((t) => t.name === 'unlock_more_data');
    expect(tool, 'tools/list has no unlock_more_data').toBeTruthy();
    expect(tool.description).toContain('Developer');
    expect(starterOffers(tool)).toEqual([]);
  });
});

describe('fail-open: DCHUB_GO_LINKS=0 hands out direct links', () => {
  afterEach(() => { delete process.env.DCHUB_GO_LINKS; });

  it('the direct links still include no Starter checkout', async () => {
    process.env.DCHUB_GO_LINKS = '0';
    const r = await callStateless('search_facilities', FACILITIES);
    expect(upgradeOf(r).developer_url).toMatch(/^https:\/\/buy\.stripe\.com\//);
    expect(starterOffers(r)).toEqual([]);
  });
});

describe('source floor: server.mjs builds no Starter offer', () => {
  // Comments are blanked first, so a note that quotes the link can neither satisfy nor trip this.
  const code = SRC.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/.*$/, '')));

  it('the Starter link id is spelled only in the click-attribution map', () => {
    const raw = code.filter((l) => l.includes(STARTER_ID)).map((l) => l.trim());
    expect(raw).toEqual(["'8x2dRa5sS0x75uteGuaZi0g': 'starter',"]);
  });

  it('no response field or prose names a Starter price or link', () => {
    const hits = code.filter((l) => /\bstarter_url\b|\$9\/mo|_priceLabel\('starter'\)|_keyBoundSubUrl\(STARTER|STARTER_(URL|LINK)\b/.test(l));
    expect(hits.map((l) => l.trim().slice(0, 120))).toEqual([]);
  });
});
