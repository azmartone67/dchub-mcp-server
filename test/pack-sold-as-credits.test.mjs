// pack-sold-as-credits.test.mjs — 2026-09-21 (frontend#1534, pricing accuracy audit)
//
// Owner decision: keep the 5-credit heavy tools (CREDIT_HEAVY) and sell the $10 pack as
// CREDITS everywhere. "1,000 API calls" was false for 13 tools that cost 5.
//
// This file pins, on the real express app behind a loopback backend stub:
//  * no user-facing string says "1,000 API calls" / "1,000 calls" / "1,000-call";
//  * the credit rule an agent reads before buying (initialize instructions, the
//    unlock_more_data description) is the rule the code charges, read off CREDIT_HEAVY;
//  * a heavy tool's wall names that tool's own cost, and a light tool's does not;
//  * a KEYED pack holder's search_facilities rows are not masked to the free field set
//    (the keyless path already honoured the pack; this path never checked it);
//  * a Developer blocked on a Pro-only tool is told it is on Developer, not "free tier".
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
const K_PACK = 'dch_live_packcredits_key0001';
const K_FREE = 'dch_live_freenopack_key00001';
const K_DEV = 'dch_live_developer_key000001';
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
        if (key === K_PACK || key === K_FREE) out = { valid: true, tier: 'free', developer_id: 'dev_t', email: 'a@b.c' };
        if (key === K_DEV) out = { valid: true, tier: 'developer', developer_id: 'dev_d', email: 'd@b.c' };
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
      if (p === '/api/v1/mcp/credits/balance') {
        const pack = url.searchParams.get('key') === K_PACK;
        res.end(JSON.stringify({ credits: pack ? 50 : 0, had_pack: pack }));
        return;
      }
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
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pack-credits-test', version: '1.0' } },
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


/** The first array of facility-shaped rows anywhere in a parsed payload. */
function facilityRows(obj) {
  const stack = [obj];
  while (stack.length) {
    const o = stack.pop();
    if (Array.isArray(o)) {
      if (o.length && o.every((r) => r && typeof r === 'object' && 'slug' in r)) return o;
      stack.push(...o);
    } else if (o && typeof o === 'object') stack.push(...Object.values(o));
  }
  return null;
}
const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const code = SRC.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/.*$/, '')));

describe('the pack is sold as credits', () => {
  it('no user-facing string calls the pack 1,000 calls', () => {
    const hits = code.filter((l) => /1,000[- ](?:full-depth )?(?:API )?calls?\b|1,000-call\b/.test(l));
    expect(hits.map((l) => l.trim().slice(0, 120))).toEqual([]);
  });

  it('the rule in words is the rule the code charges', () => {
    const set = SRC.match(/const CREDIT_HEAVY = new Set\(\[([\s\S]*?)\]\);/);
    expect(set, 'CREDIT_HEAVY literal not found').toBeTruthy();
    const names = set[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join(' ').match(/'[a-z_]+'/g);
    const m = S._creditRuleText().match(/^1 credit per paid-tool call; the (\d+) heavy analysis tools use (\d+) each$/);
    expect(m, S._creditRuleText()).toBeTruthy();
    expect(Number(m[1])).toBe(names.length);
    expect(Number(m[2])).toBe(5);
  });

  it('a heavy tool names its own cost on its wall; a light tool does not', () => {
    expect(S._rungsText('analyze_site', 'free', 'sid-t')).toContain('`analyze_site` uses 5 credits per call');
    expect(S._rungsText('get_pipeline', 'free', 'sid-t')).not.toMatch(/uses \d+ credits per call/);
    expect(S._rungsText('get_pipeline', 'free', 'sid-t')).toContain('**$10 one-time = 1,000 API credits**');
  });

  it('initialize and the unlock_more_data description state the rule', async () => {
    const { json } = await post({}, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pack-credits-test', version: '1.0' } },
    });
    const instructions = JSON.parse(json).result?.instructions || '';
    expect(instructions).toContain('1,000 API credits — ' + S._creditRuleText());
    const s = await openSession({});
    const list = await post({ 'mcp-session-id': s.sid }, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const um = (JSON.parse(list.json).result?.tools || []).find((t) => t.name === 'unlock_more_data');
    expect(um.description).toContain('1,000 API credits (' + S._creditRuleText() + '; no subscription)');
  });
});

describe('a keyed pack holder gets the rows it paid for', () => {
  it('control: a keyed free caller with no pack gets the free field set (no MW)', async () => {
    const s = await openSession({ 'x-api-key': K_FREE });
    const r = await s.call('search_facilities', FACILITIES);
    const rows = facilityRows(leadingJson(textOf(r)) || {});
    expect(rows, textOf(r).slice(0, 300)).toBeTruthy();
    expect(rows.some((row) => 'power_mw' in row)).toBe(false);
  });

  it('a keyed free caller holding pack credits keeps power_mw and is not told exact data is Developer', async () => {
    const s = await openSession({ 'x-api-key': K_PACK });
    const r = await s.call('search_facilities', FACILITIES);
    const rows = facilityRows(leadingJson(textOf(r)) || {});
    expect(rows, textOf(r).slice(0, 300)).toBeTruthy();
    expect(rows.every((row) => typeof row.power_mw === 'number')).toBe(true);
    expect(textOf(r)).not.toContain('exact coordinates + deep specs are Developer');
  });
});

describe('a Developer blocked on a Pro-only tool', () => {
  it('is told it is on Developer and what opens the tool, never "free tier"', async () => {
    const s = await openSession({ 'x-api-key': K_DEV });
    // 2026-09-22: analyze_site became Land & Power, which answers Developer with
    // its own preview (test/lp-pro-only.test.mjs). get_dchub_recommendation is
    // the same class of tool (Pro-only, heavy) outside Land & Power.
    const t = textOf(await s.call('get_dchub_recommendation', { context: '100 MW AI training campus in Texas' }));
    expect(t).toContain("You're on **Developer**");
    expect(t).toContain('is one of the Pro-only tools, so it opens on Pro');
    expect(t).not.toContain('free tier');
    expect(t).toContain('`get_dchub_recommendation` uses 5 credits per call');
  });

});
