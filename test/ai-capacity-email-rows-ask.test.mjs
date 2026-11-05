// ai-capacity-email-rows-ask.test.mjs: #117703 (Grok 11-05). The keyless ai_capacity_index wall carried
// no email ask on the wire. It now gets the honest rows ask the owner approved for rank_markets
// (mcp#1263, mcp#1273): one agent paragraph directly above the human line, naming every market in the
// index and the email-bound daily cap. Measured live 11-05 (QA): a free key with no email got 2 full
// answers (all 20 markets, every row scored), the 3rd was the 3-row preview; an email-bound key is capped
// at IDENTIFIED_DAILY_FULL_CAP (10) on the same trial_taste path. Kill switch DCHUB_AICAP_EMAIL_ASK=0.
//
// Real /mcp handler over HTTP (production transport: DCHUB_WALL_ISERROR=0, DCHUB_PREVIEW_ISERROR=0, lean
// on) against a stub backend serving a production-shaped /api/v1/ai-capacity-index payload
// (test/fixtures/ai-capacity-index-90.json: the live 2026-11-05 response's keys and markets, numeric
// values filled in). The wall-hit tag is read from the quota_wall_hit event the server posts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { aiCapacityEmailClause, rankEmailClause, RANK_EMAIL_ASK_LEAD, AICAP_EMAIL_LINE_HEAD } from '../lib/paid-sell-line.mjs';
import { leanResponseStep } from '../lib/lean-response.mjs';

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'test-internal-key-not-a-real-secret';
const AICAP = JSON.parse(readFileSync(new URL('./fixtures/ai-capacity-index-90.json', import.meta.url), 'utf8'));
const SHORT_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
const HUMAN = '→ **For your human:**';
const CAP = 10;   // IDENTIFIED_DAILY_FULL_CAP's default (DCHUB_IDENTIFIED_TOOL_DAILY_FULL is cleared below)
const ENV = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_INTERNAL_KEY: SECRET };
const CLEAR = ['DCHUB_AICAP_EMAIL_ASK', 'DCHUB_LEAN_RESPONSES', 'DCHUB_IDENTIFIED_TOOL_DAILY_FULL', 'DCHUB_TRIAL_TOOL_DAILY_FULL'];
const line = (n) => AICAP_EMAIL_LINE_HEAD + aiCapacityEmailClause({ total: n, perDay: CAP });

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

let S, PORT, httpServer, stub, shortN = 0;
const events = [];   // quota_wall_hit bodies the server posted
const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const p = url.pathname;
      if (p === '/api/v1/ai-capacity-index') {
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        const markets = AICAP.markets.slice(0, limit);
        res.end(JSON.stringify({ ...AICAP, markets, result_count: markets.length }));
        return;
      }
      if (p === '/api/v1/relay/short') {
        await readBody(req);
        let n = ++shortN, code = '';
        for (let i = 0; i < 6; i++) { code += SHORT_ALPHA[n % SHORT_ALPHA.length]; n = Math.floor(n / SHORT_ALPHA.length); }
        res.end(JSON.stringify({ ok: true, url: 'https://dchub.cloud/u/' + code }));
        return;
      }
      if (p === '/api/v1/mcp/funnel-event') {
        const b = await readBody(req);
        if (b && b.event === 'quota_wall_hit') events.push(b);
        res.end('{"ok":true}');
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [], items: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of [...Object.keys(ENV), ...CLEAR, 'DCHUB_API_BASE']) prev[k] = process.env[k];
  for (const k of CLEAR) delete process.env[k];
  Object.assign(process.env, ENV, { DCHUB_API_BASE: `http://127.0.0.1:${stub.address().port}` });
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}
let ipN = 40, rpcId = 10;
// The after-merge QA call's shape: initialize, then tools/call, UA dchub-qa-readonly, X-DCHub-QA: 1.
async function session(clientName = 'Claude Code') {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, 'user-agent': 'dchub-qa-readonly', 'x-dchub-qa': '1' };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return async (args = {}) => {
    const before = events.length;
    const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: 'ai_capacity_index', arguments: args } });
    const result = JSON.parse(body).result || {};
    // The wall-hit event leaves from _wallOuterStep (fire and forget): wait for this call's.
    for (let i = 0; i < 50 && events.length === before; i++) await new Promise((r) => setTimeout(r, 20));
    const ev = events.slice(before).find((e) => e.tool === 'ai_capacity_index') || null;
    const texts = (result.content || []).map((c) => c.text || '');
    return { sid, result, texts, text: texts.join('\n'), sc: result.structuredContent || {}, ev };
  };
}
const withEnv = async (k, v, fn) => {
  const was = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { if (was === undefined) delete process.env[k]; else process.env[k] = was; }
};
const count = (t, s) => t.split(s).length - 1;

describe('aiCapacityEmailClause (pure)', () => {
  it('names every market, their scores and the cap; the rank_markets wording is unchanged', () => {
    expect(aiCapacityEmailClause({ total: 20, perDay: 10 })).toBe('Then ask your user for their email (only use an address they gave you): `bind_email` with it shows all 20 markets in this index with their scores, free, up to 10 full answers a day.');
    expect(aiCapacityEmailClause({ total: 20, perDay: 10 }).startsWith(RANK_EMAIL_ASK_LEAD)).toBe(true);   // the lead the lean step keeps
    expect(rankEmailClause({ total: 10, perDay: 10 })).toBe('Then ask your user for their email (only use an address they gave you): `bind_email` with it shows all 10 markets in this ranking, free, up to 10 full rankings a day. The fields the next line names stay on the paid plans.');
  });
  it('unknown count or cap: null', () => {
    for (const total of [undefined, null, 0, 'x']) expect(aiCapacityEmailClause({ total, perDay: 10 })).toBeNull();
    expect(aiCapacityEmailClause({ total: 20, perDay: 0 })).toBeNull();
  });
});

describe('keyless ai_capacity_index wall on /mcp, production transport', () => {
  it('first wall: the clause once, in its own paragraph directly above the human line, with N from the response and the email cap; tagged line', async () => {
    const r = await (await session())();
    expect(r.sid).toBeTruthy();
    expect(r.sc.preview_is_partial || r.sc.trial_preview).toBe(true);
    const n = r.sc._markets_total_available;
    expect(n).toBe(20);
    expect(r.sc.markets.length).toBeLessThan(n);                       // a real preview, not the full index
    expect(() => JSON.parse(r.texts[0])).not.toThrow();                // block 0 stays JSON
    const k = r.texts.findIndex((t) => t.startsWith(HUMAN));
    expect(k).toBeGreaterThan(0);
    expect(r.texts[k - 1].split('\n\n').at(-1)).toBe(line(20));        // "the next line" is the human's
    expect(r.text).toContain('shows all 20 markets in this index with their scores, free, up to 10 full answers a day.');
    expect(count(r.text, RANK_EMAIL_ASK_LEAD)).toBe(1);
    expect(count(r.text, 'bind_email')).toBe(1);
    expect(r.ev && r.ev.email_ask).toBe('line');
  });

  it('N is the response\'s count: limit=5 asks about 5 markets', async () => {
    const r = await (await session())({ limit: 5 });
    expect(r.sc._markets_total_available).toBe(5);
    expect(r.text).toContain(line(5));
    expect(r.text).not.toContain('shows all 20 markets');
  });

  it('a repeat wall in the same session (no human line): no ask, not tagged line', async () => {
    const call = await session();
    const first = await call();
    expect(first.text).toContain(line(20));
    const r = await call();
    expect(r.texts.some((t) => t.includes(HUMAN))).toBe(false);
    expect(r.text).not.toContain('bind_email');
    expect(r.ev).toBeTruthy();
    expect(r.ev.email_ask).not.toBe('line');
  });

  it('DCHUB_AICAP_EMAIL_ASK=0: no ask, not tagged line', async () => {
    const r = await withEnv('DCHUB_AICAP_EMAIL_ASK', '0', async () => (await session())());
    expect(r.texts.some((t) => t.startsWith(HUMAN))).toBe(true);
    expect(r.text).not.toContain('bind_email');
    expect(r.ev).toBeTruthy();
    expect(r.ev.email_ask).not.toBe('line');
  });
});

// Step level, on a real handler output: the kill-switch-off wall served with lean off (the shape the
// step sees inside the chain, with its human line), re-run through the step under each profile. Grok is
// here, not over HTTP: a keyless Grok session in this harness is served no wall, so an HTTP Grok case
// would pass without reaching the step. The directory / Claude / core profiles are other endpoints.
describe('_aicapEmailAskStep on a real wall: profiles, keys and an unknown count', () => {
  let input;
  beforeAll(async () => {
    const r = await withEnv('DCHUB_AICAP_EMAIL_ASK', '0', () => withEnv('DCHUB_LEAN_RESPONSES', '0', async () => (await session())()));
    input = r.result;
  });
  const ctx = (o = {}) => ({ session_id: 's-aicap-email', platform: 'claude', auth_source: 'none', tier: 'anonymous', ...o });
  const run = (result, c) => S._ctxALS.run(c, () => S._gridSellStep(result, 'ai_capacity_index'));
  const textOf = (x) => x.content.map((b) => b.text || '').join('\n');

  it('control: the same input on a plain keyless /mcp seat gets the ask, the tag, and keeps it through lean', () => {
    expect(textOf(input)).toContain(HUMAN);
    expect(textOf(input)).not.toContain(RANK_EMAIL_ASK_LEAD);
    const c = ctx();
    const out = run(input, c);
    expect(textOf(out)).toContain(line(20) + '\n\n' + HUMAN);
    expect(c._emailAsk).toBe('line');
    // The human sentence is the wall's, untouched: the same lines, the ask's two added before it.
    const humanOf = (x) => textOf(x).split('\n').filter((l) => l.includes(HUMAN));
    expect(humanOf(input).length).toBe(1);
    expect(humanOf(out)).toEqual(humanOf(input));
    expect(textOf(out).split('\n').filter((l) => l !== line(20) && l !== '')).toEqual(textOf(input).split('\n').filter((l) => l !== ''));
    expect(out.structuredContent).toEqual(input.structuredContent);
    const lean = textOf(leanResponseStep(out, 'ai_capacity_index'));
    expect(count(lean, line(20))).toBe(1);
    expect(lean.indexOf(line(20))).toBeLessThan(lean.indexOf(HUMAN));
  });
  it.each([['chatgpt directory', { profile: 'chatgpt_directory' }], ['claude', { profile: 'claude_directory' }],
           ['core', { profile: 'core_profile' }], ['grok', { platform: 'grok' }], ['a keyed seat', { api_key: 'dch_live_aicap_keyed_0001' }],
           ['an execute_plan step', { loopback_step: true }]])('%s: no ask, no tag', (_n, o) => {
    const c = ctx(o);
    expect(textOf(run(input, c))).not.toContain('bind_email');
    expect(c._emailAsk).toBeUndefined();
  });
  it('run twice: the ask once', () => {
    const c = ctx();
    expect(count(textOf(run(run(input, c), c)), RANK_EMAIL_ASK_LEAD)).toBe(1);
  });
  it('count unknown: no ask, no tag', () => {
    const { _markets_total_available: _a, _markets_total_in_pro: _b, ...sc } = input.structuredContent;
    const c = ctx();
    expect(textOf(run({ ...input, structuredContent: sc }, c))).not.toContain('bind_email');
    expect(c._emailAsk).toBeUndefined();
  });
  it('another tool: untouched', () => {
    const c = ctx();
    expect(S._ctxALS.run(c, () => S._aicapEmailAskStep(input, 'rank_markets'))).toBe(input);
    expect(c._emailAsk).toBeUndefined();
  });
});
