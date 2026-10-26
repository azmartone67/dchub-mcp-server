// claim-handoff-keyless-walls.test.mjs — one-step key handoff (owner growth push, approved 2026-10-14).
//
// MEASURED the day it shipped (production transport DCHUB_PREVIEW_ISERROR=0, one keyless call per fresh
// session, every one of the 94 tools, stub backend on loopback):
//   tools/list      claim_free_key sat at index 85 of 94 on /mcp (a client that lists the first 40 never
//                   shows it);
//   anon_daily_cap  58 of 58 answers named claim_free_key only inside block 0's JSON; the prose blocks a
//                   reader acts on said "Next: execute_plan", straight back into the limit;
//   trial_used      15 of 17 named it in prose as the LAST clause, after the payer's pack and plan links.
//
// WHAT THIS PINS
//   * tools/list: claim_free_key is first on the full catalog, every other tool keeps its relative order,
//     the count is unchanged, a profile or pack that does not list it is untouched, DCHUB_CLAIM_KEY_FIRST=0
//     restores registration order;
//   * a keyless limit (anon_daily_cap) and a keyless preview wall (trial_used) carry ONE prose block that
//     names `claim_free_key` and says how to use what it returns, right after the JSON block and ahead of
//     the payer's ask, with no link, no plan name and no price in it;
//   * both counters the owner's metric needs are emitted for the same calls: the limit hit as the call's
//     status on POST /api/v1/mcp/track, and the claim as a claim_free_key row on the same endpoint;
//   * what it must NOT do: nothing for a caller holding a key; nothing on the decision tools (their wall
//     says a free key does not deepen them); nothing on the owner-approved single-ask walls while their
//     switch is on; nothing when the response already hands out a key; DCHUB_CLAIM_HANDOFF=0 restores the
//     earlier response.
//
// Qualifies for the hard gate: real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend, every
// off-loopback connect refused and recorded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import * as L from '../lib/claim-handoff.mjs';
// This file pins the copy the inner wall/retention steps build; the lean step (lib/lean-response.mjs,
// agent QA A 2026-10-20) trims it to one ask on /mcp. Off here so these guards keep testing the inner
// steps; test/lean-response.test.mjs guards the default.
process.env.DCHUB_LEAN_RESPONSES = '0';

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
const KEY = 'dch_live_claimhandofftest0000001';          // fixture, not a credential
const CAPPED_IP = '203.0.113.200';                         // the stub answers count 40 (over the cap of 30)
const PLAN_WORD = /\b(Developer|Pro|Starter|Enterprise|Founding)\b/;
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_PREVIEW_ISERROR',
  'DCHUB_CLAIM_HANDOFF', 'DCHUB_CLAIM_KEY_FIRST', 'DCHUB_PAID_SELL_LINE', 'DCHUB_GRID_SELL_LINE'];
const prev = {};
let S, PORT, httpServer, stub;
const tracks = [];

const isJson = (t) => { try { const v = JSON.parse(t); return !!v && typeof v === 'object'; } catch (_) { return false; } };

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const u = new URL(req.url, 'http://_');
        let body = {}; try { body = JSON.parse(b || '{}'); } catch (_) { body = {}; }
        res.setHeader('content-type', 'application/json');
        const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
        if (u.pathname === '/api/v1/mcp/track') { tracks.push(body); return send({ ok: true }); }
        if (u.pathname === '/api/v1/mcp/anon-usage') return send({ ok: true, count: u.searchParams.get('ip') === CAPPED_IP ? 40 : 0 });
        if (u.pathname === '/api/v1/keys/validate') {
          return send(body.api_key === KEY ? { valid: true, tier: 'free', developer_id: 'd_claim', email: null } : { valid: false, tier: 'free' });
        }
        if (u.pathname === '/api/v1/keys/claim') return send({ ok: true, success: true, api_key: KEY, tier: 'free', reused: false });
        if (u.pathname === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
        if (u.pathname === '/api/v1/mcp/session-key') return send({ error: 'not found' }, 404);
        return send({ success: true, ok: true, data: [], results: [], facilities: [], markets: [] });
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  process.env.DCHUB_ANON_DAILY_CAP = '30';        // read once at import
  process.env.DCHUB_PREVIEW_ISERROR = '0';        // the production transport: a preview is not an error
  for (const k of ['DCHUB_CLAIM_HANDOFF', 'DCHUB_CLAIM_KEY_FIRST', 'DCHUB_PAID_SELL_LINE', 'DCHUB_GRID_SELL_LINE']) delete process.env[k];
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body, path = '/mcp') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json: b ? JSON.parse(b) : null };
}

let ipN = 1;
let rpcId = 100;
async function open({ ip, key = null, path = '/mcp' } = {}) {
  const h0 = { 'x-forwarded-for': ip || `198.51.100.${ipN++ % 200 + 1}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claim-handoff-test', version: '1.0' } } }, path);
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  const h = { ...h0, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' }, path);
  return { h, path, sid };
}
async function call(seat, name, args) {
  const before = tracks.length;
  const r = await post(seat.h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }, seat.path);
  // the track POST is fire-and-forget: give the loopback a beat
  for (let i = 0; i < 40 && !tracks.slice(before).some((t) => t.tool === name); i++) await new Promise((x) => setTimeout(x, 25));
  const result = (r.json && r.json.result) || {};
  const blocks = (result.content || []).map((c) => (typeof c.text === 'string' ? c.text : ''));
  return { result, blocks, all: blocks.join('\n'), sc: result.structuredContent || {},
    status: (tracks.slice(before).filter((t) => t.tool === name).pop() || {}).status,
    tracked: tracks.slice(before).filter((t) => t.tool === name) };
}
const proseBlocks = (blocks) => blocks.filter((t) => !isJson(t));

describe('tools/list: claim_free_key leads the full catalog', () => {
  it('is first on /mcp, with every other tool in its old relative order and the count unchanged', async () => {
    const seat = await open();
    const r = await post(seat.h, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = r.json.result.tools.map((t) => t.name);
    expect(names.length).toBe(94);
    expect(names[0]).toBe('claim_free_key');
    expect(new Set(names).size).toBe(names.length);
    // registration order, from the one canonical catalog, minus the tool that moved
    const reg = Object.keys(S.createServer()._registeredTools);
    expect(reg.length).toBe(94);
    expect(reg.indexOf('claim_free_key'), 'the fixture is vacuous if it was already first').toBeGreaterThan(40);
    expect(names.slice(1)).toEqual(reg.filter((n) => n !== 'claim_free_key'));
  });

  it('the cached stateless list is the same order (the path Smithery-style hosts read)', async () => {
    const r = await S._buildToolsListResult(null);
    expect(r.tools[0].name).toBe('claim_free_key');
    expect(r.tools.length).toBe(94);
  });

  it('a profile that does not list the tool is untouched, a pack keeps its declared order', async () => {
    const grok = await open({ path: '/mcp/grok' });
    const g = (await post(grok.h, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, '/mcp/grok')).json.result.tools.map((t) => t.name);
    expect(g).not.toContain('claim_free_key');
    expect(g[0]).toBe('execute_plan');
    const def = S.MCP_PACKS.get('/mcp/site');
    const pk = await open({ path: '/mcp/site' });
    const p = (await post(pk.h, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, '/mcp/site')).json.result.tools.map((t) => t.name);
    expect(p).toEqual(S.packToolNames(def));            // the spine stays last on purpose
    expect(p.indexOf('claim_free_key')).toBeGreaterThan(0);
  });

  it('_claimKeyFirst is a stable move, a no-op when absent or already first, and the switch restores order', () => {
    const t = (n) => ({ name: n });
    expect(S._claimKeyFirst([t('a'), t('b'), t('claim_free_key'), t('c')]).map((x) => x.name)).toEqual(['claim_free_key', 'a', 'b', 'c']);
    expect(S._claimKeyFirst([t('a'), t('b')]).map((x) => x.name)).toEqual(['a', 'b']);
    expect(S._claimKeyFirst([t('claim_free_key'), t('a')]).map((x) => x.name)).toEqual(['claim_free_key', 'a']);
    process.env.DCHUB_CLAIM_KEY_FIRST = '0';
    try {
      expect(S._claimKeyFirst([t('a'), t('claim_free_key')]).map((x) => x.name)).toEqual(['a', 'claim_free_key']);
    } finally { delete process.env.DCHUB_CLAIM_KEY_FIRST; }
  });

  it('the handshake is the same text and still inside the 2,048 budget', async () => {
    const init = await post({ 'x-forwarded-for': '198.51.100.250' }, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claim-handoff-test', version: '1.0' } } });
    const ins = init.json.result.instructions;
    expect(ins.length).toBeLessThanOrEqual(2048);
    expect(ins).toContain('KEYS: get your human\'s email, then `claim_free_key`; save it, never re-mint;');
  });
});

describe('the pure line', () => {
  const allow = 'previews plus 2 full answers per tool per day, 50/day with an email';
  for (const status of ['anon_daily_cap', 'anon_hard_wall', 'trial_used']) {
    it(`${status}: names the tool, says how to use it, carries no link, plan name or price`, () => {
      const t = L.claimHandoffText({ status, allowance: allow });
      expect(t).toContain('`claim_free_key`');
      expect(t).toContain('X-API-Key');
      // Onboarding item 1 (2026-10-20): every status asks for the email first; the limit line keeps the
      // no-email claim as the fallback, in words, so a human who declines is not stranded.
      expect(t).toMatch(status === 'trial_used' ? /their email first/ : /ask your human for an email, pass it to `claim_free_key`/);
      if (status !== 'trial_used') expect(t).toMatch(/without one also works/);
      expect(t).not.toMatch(/one call, no email/);
      expect(t).not.toMatch(/https?:\/\/|dchub\.cloud/);
      expect(t).not.toMatch(PLAN_WORD);
      expect(t).not.toMatch(/\$\d|unlock/i);
      expect(t.length).toBeLessThan(420);
    });
  }
  it('a limit quotes the canon allowance; a preview wall promises nothing about what the key returns', () => {
    const allow2 = 'previews plus 2 full answers per tool per day, 50/day with an email';
    expect(L.claimHandoffText({ status: 'anon_daily_cap', allowance: allow2 })).toContain(allow2);
    expect(L.claimHandoffText({ status: 'anon_hard_wall', allowance: allow2 })).toContain(allow2);
    const p = L.claimHandoffText({ status: 'trial_used', allowance: allow2 });
    expect(p).not.toContain(allow2);
    expect(p).not.toMatch(/full answers|call `[a-z_]+` again|deepen|unlock/i);
  });
  it('only the limit statuses say the anonymous allowance is spent', () => {
    expect(L.claimHandoffText({ status: 'anon_daily_cap' })).toMatch(/anonymous allowance/);
    expect(L.claimHandoffText({ status: 'trial_used' })).not.toMatch(/anonymous allowance/);
  });
  it('the status set is the keyless limit and preview walls a free key answers, nothing else', () => {
    expect([...L.CLAIM_HANDOFF_STATUSES].sort()).toEqual(['anon_daily_cap', 'anon_hard_wall', 'trial_used']);
    for (const s of ['pro_wall', 'lp_wall', 'blocked_paid_only', 'depth_teased', 'ok', 'trial_cap_exceeded']) {
      expect(L.CLAIM_HANDOFF_STATUSES).not.toContain(s);
    }
  });
});

describe('keyless limit: anon_daily_cap', () => {
  // Wall email option C wide (owner 2026-10-26) makes this wall email first for a caller with a real
  // session, and its first wall of the day withholds this line (keyless-wall-email-first pins that).
  // These cases pin the handoff line on the wall that C leaves in place with the switch off.
  beforeAll(() => { process.env.DCHUB_KEYLESS_EMAIL_FIRST_ALL = '0'; });
  afterAll(() => { delete process.env.DCHUB_KEYLESS_EMAIL_FIRST_ALL; });
  it('names claim_free_key in the first prose block, ahead of the execute_plan nudge, and logs the limit hit', async () => {
    const seat = await open({ ip: CAPPED_IP });
    const r = await call(seat, 'search_facilities', { state: 'VA' });
    expect(r.status, 'the limit-hit counter: the call is logged with its own status').toBe('anon_daily_cap');
    expect(isJson(r.blocks[0]), 'block 0 stays the JSON a client parses').toBe(true);
    const prose = proseBlocks(r.blocks);
    expect(prose.length).toBeGreaterThan(0);
    expect(prose[0], 'the handoff is the first prose block').toMatch(/^This IP has used today's anonymous allowance\. Free, one call: ask your human for an email, pass it to `claim_free_key`/);
    expect(prose[0]).toContain('X-API-Key');
    expect(prose[0]).not.toMatch(/https?:\/\//);
    expect(prose[0]).not.toMatch(PLAN_WORD);
    const iClaim = r.all.indexOf('claim_free_key', r.blocks[0].length);
    const iNudge = r.all.indexOf('execute_plan', r.blocks[0].length);
    expect(iNudge, 'the nudge is still there: the step adds, it does not delete').toBeGreaterThan(-1);
    expect(iClaim).toBeLessThan(iNudge);
    // the JSON's own instruction is untouched
    expect(r.sc._upgrade && r.sc._upgrade.next_tool).toBe('claim_free_key');
  });

  it('names it once in prose', async () => {
    const seat = await open({ ip: CAPPED_IP });
    const r = await call(seat, 'get_news', {});
    const n = proseBlocks(r.blocks).join('\n').split('claim_free_key').length - 1;
    expect(n).toBe(1);
  });

  it('DCHUB_CLAIM_HANDOFF=0 restores the earlier response: the tool is named in the JSON only', async () => {
    process.env.DCHUB_CLAIM_HANDOFF = '0';
    try {
      const seat = await open({ ip: CAPPED_IP });
      const r = await call(seat, 'search_facilities', { state: 'VA' });
      expect(r.status).toBe('anon_daily_cap');
      expect(proseBlocks(r.blocks).join('\n')).not.toContain('claim_free_key');
      expect(r.blocks[0]).toContain('claim_free_key');
    } finally { delete process.env.DCHUB_CLAIM_HANDOFF; }
  });
});

describe('keyless preview wall: trial_used', () => {
  it('leads with the handoff, drops the trailing clause, keeps the payer ask and the human line', async () => {
    const seat = await open();
    const r = await call(seat, 'get_pipeline', { country: 'US' });
    expect(r.status).toBe('trial_used');
    const prose = proseBlocks(r.blocks);
    expect(prose[0]).toMatch(/^Free, one call: ask your human for their email first, then call `claim_free_key` with it \(only an address they gave you\), then send the api_key it returns as the X-API-Key header/);
    expect(prose[0]).not.toMatch(/https?:\/\//);
    expect(prose[0]).not.toMatch(PLAN_WORD);
    const joined = prose.join('\n');
    expect(joined.split('claim_free_key').length - 1, 'named once, first').toBe(1);
    expect(joined).not.toContain('for a durable free-tier key');
    expect(joined.indexOf('claim_free_key')).toBeLessThan(joined.indexOf('the payer checks out in one click'));
    expect(joined).toMatch(/\*\*For your human:\*\*/);      // the human relay line is where it was
    expect(joined).toMatch(/https:\/\/dchub\.cloud\/upgrade\/h\//);
  });

  it('on the unsplit shape the step really sees (JSON and wall in one block) the line sits between them', async () => {
    // This step runs before _splitHumanBlock, so on every transport block 0 is JSON + prose here; drive that shape.
    const json = JSON.stringify({ ok: true, rows: [] });
    const text = json + '\n\n---\n\n\u{1F512} **Free-tier preview of `get_pipeline`.** Full results: the payer checks out in one click: x.'
      + L.CLAIM_ALT_TAIL + '\n';
    const out = await S._ctxALS.run({ session_id: 's', client_ip: '198.51.100.9', tier: 'free', platform: 'cursor', _wallStatus: 'trial_used' },
      async () => S._claimHandoffStep({ content: [{ type: 'text', text }], structuredContent: { ok: true } }, 'get_pipeline'));
    expect(out.content).toHaveLength(1);
    const t = out.content[0].text;
    expect(t.startsWith(json + '\n\n---\n\nFree, one call: ask your human for their email first, then call `claim_free_key`')).toBe(true);
    expect(t).toMatch(/\.\n\n\u{1F512} \*\*Free-tier preview of `get_pipeline`\.\*\*/u);   // the wall's own header follows the line
    expect(t.indexOf('claim_free_key')).toBeLessThan(t.indexOf('the payer checks out'));
    expect(t).not.toContain('durable free-tier key');
    expect(isJson(t.slice(0, json.length))).toBe(true);
  });
});

describe('what it must not do', () => {
  it('says nothing to a caller holding a key', async () => {
    const seat = await open({ ip: CAPPED_IP, key: KEY });
    const r = await call(seat, 'search_facilities', { state: 'VA' });
    expect(r.all).not.toContain('This IP has used today');
    expect(proseBlocks(r.blocks).join('\n')).not.toMatch(/Free, one call: ask your human for their email first/);
  });

  it('leaves the decision tools alone while the item-3 switch is off: their 10-08 wall says a free key does not deepen them', async () => {
    // Item 3 (owner draft 2026-10-16): with DCHUB_EMAIL_FULL_DECISION_TOOLS on (default) a keyless decision
    // preview DOES carry its own line (test/email-bound-decision-full.test.mjs); off restores this.
    process.env.DCHUB_EMAIL_FULL_DECISION_TOOLS = '0';
    try {
      const seat = await open();
      const r = await call(seat, 'get_market_intel', { market: 'northern-virginia' });
      expect(proseBlocks(r.blocks).join('\n')).not.toMatch(/Free, one call: ask your human for their email first/);
    } finally { delete process.env.DCHUB_EMAIL_FULL_DECISION_TOOLS; }
    expect(S._singleAskWall('get_market_intel')).toBe(false);   // not a single-ask wall by default; excluded by the decision rule
  });

  it('leaves the owner-approved single-ask walls alone while their switch is on', async () => {
    expect(S._singleAskWall('get_grid_intelligence')).toBe(true);
    expect(S._singleAskWall('get_fiber_intel')).toBe(true);
    expect(S._singleAskWall('get_pipeline')).toBe(false);
    process.env.DCHUB_PAID_SELL_LINE = '1';
    try {
      for (const n of ['get_market_intel', 'compare_isos', 'rank_markets', 'analyze_site', 'compare_sites']) {
        expect(S._singleAskWall(n), n).toBe(true);
      }
    } finally { delete process.env.DCHUB_PAID_SELL_LINE; }
    process.env.DCHUB_GRID_SELL_LINE = '0';
    try { expect(S._singleAskWall('get_grid_intelligence')).toBe(false); } finally { delete process.env.DCHUB_GRID_SELL_LINE; }
  });

  it('QA-only diagnostic: a QA-marked call is told where the step skipped; any other caller gets the result unchanged', async () => {
    const res = () => ({ content: [{ type: 'text', text: '{}' }, { type: 'text', text: 'A free preview.' }], structuredContent: { ok: true } });
    const base = { session_id: 's', client_ip: '198.51.100.9', tier: 'free', platform: 'cursor', _wallStatus: 'depth_teased', auth_source: 'none' };
    const qa = await S._ctxALS.run({ ...base, qa_marker: true }, async () => S._claimHandoffStep(res(), 'get_grid_intelligence'));
    const d = qa.structuredContent._claim_handoff_debug;
    expect(d, 'QA caller gets the skip point').toBeTruthy();
    expect(d.at).toBe('s5');                       // depth_teased is not a claim-handoff status
    expect(d.status).toBe('depth_teased');
    expect(d.tool).toBe('get_grid_intelligence');
    const plain = await S._ctxALS.run({ ...base }, async () => S._claimHandoffStep(res(), 'get_grid_intelligence'));
    expect(plain.structuredContent, 'a real caller never sees the diagnostic').toEqual({ ok: true });
    // a result with no structuredContent still reports (production's grid preview reaches the step that way)
    const bare = await S._ctxALS.run({ ...base, qa_marker: true }, async () => S._claimHandoffStep({ content: [{ type: 'text', text: 'x' }] }, 'get_grid_intelligence'));
    expect(bare.structuredContent._claim_handoff_debug.had_structured).toBe(false);
    const bare2 = await S._ctxALS.run({ ...base }, async () => S._claimHandoffStep({ content: [{ type: 'text', text: 'x' }] }, 'get_grid_intelligence'));
    expect(bare2.structuredContent, 'and a real caller still gets none').toBeUndefined();
  });

  it('the step skips a single-ask or decision PREVIEW wall, but answers a LIMIT on every tool', async () => {
    const res = () => ({ content: [{ type: 'text', text: '{}' }, { type: 'text', text: 'A free preview. Open the page for the full answer.' }], structuredContent: { ok: true } });
    const run = (name, status = 'trial_used') => S._ctxALS.run({ session_id: 's', client_ip: '198.51.100.9', tier: 'free', platform: 'cursor',
      _wallStatus: status }, async () => S._claimHandoffStep(res(), name));
    // grid sell line (default ON): get_fiber_intel is a single-ask wall; its one-ask copy tests pin no claim_free_key
    expect((await run('get_fiber_intel')).content, 'fiber, sell line on').toHaveLength(2);
    process.env.DCHUB_GRID_SELL_LINE = '0';
    try { expect((await run('get_fiber_intel')).content, 'fiber, sell line off').toHaveLength(3); }
    finally { delete process.env.DCHUB_GRID_SELL_LINE; }
    // the decision tools (item 3, default on): a keyless preview carries the decision line; off: left alone
    const runKeyless = (name) => S._ctxALS.run({ session_id: 's', client_ip: '198.51.100.9', tier: 'free', platform: 'cursor',
      auth_source: 'none', _wallStatus: 'trial_used' }, async () => S._claimHandoffStep(res(), name));
    for (const n of ['get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel']) {
      expect((await runKeyless(n)).content, n + ' item 3 on').toHaveLength(3);
    }
    process.env.DCHUB_EMAIL_FULL_DECISION_TOOLS = '0';
    try {
      for (const n of ['get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel']) {
        expect((await runKeyless(n)).content, n + ' item 3 off').toHaveLength(2);
      }
    } finally { delete process.env.DCHUB_EMAIL_FULL_DECISION_TOOLS; }
    // paid sell line (default OFF): served by default, skipped when the owner turns it on
    for (const n of ['compare_isos', 'rank_markets']) expect((await run(n)).content, n + ' default').toHaveLength(3);
    process.env.DCHUB_PAID_SELL_LINE = '1';
    try { for (const n of ['compare_isos', 'rank_markets']) expect((await run(n)).content, n + ' on').toHaveLength(2); }
    finally { delete process.env.DCHUB_PAID_SELL_LINE; }
    // a LIMIT is the IP's, not the tool's: answered on the decision and single-ask tools as well
    for (const n of ['get_grid_intelligence', 'get_fiber_intel', 'get_market_intel']) {
      for (const st of ['anon_daily_cap', 'anon_hard_wall']) expect((await run(n, st)).content, n + ' ' + st).toHaveLength(3);
    }
  });

  it('adds nothing when the response already hands out a key, nor on the key tools or a directory profile', async () => {
    const mk = (text, sc = { ok: true }) => ({ content: [{ type: 'text', text: '{}' }, { type: 'text', text }], structuredContent: sc });
    const run = (store, name, res) => S._ctxALS.run({ session_id: 's', client_ip: '198.51.100.9', tier: 'free', platform: 'cursor',
      _wallStatus: 'trial_used', ...store }, async () => S._claimHandoffStep(res, name));
    const base = mk('A free-tier preview.');
    const got = await run({}, 'get_pipeline', base);
    expect(got.content).toHaveLength(3);                                   // control: the step does fire here
    expect((await run({}, 'get_pipeline', mk('Your key: dch_trial_abcdef123456'))).content).toHaveLength(2);
    expect((await run({}, 'claim_free_key', base)).content).toHaveLength(2);
    expect((await run({ profile: 'chatgpt_directory' }, 'get_pipeline', base)).content).toHaveLength(2);
    expect((await run({ platform: 'chatgpt' }, 'get_pipeline', base)).content).toHaveLength(2);
    expect((await run({ api_key: KEY }, 'get_pipeline', base)).content).toHaveLength(2);
    expect((await run({ _wallStatus: 'pro_wall' }, 'get_pipeline', base)).content).toHaveLength(2);
    expect((await run({ _wallStatus: 'ok' }, 'get_pipeline', base)).content).toHaveLength(2);
  });

  it('is idempotent: a response that already names the tool in prose is returned as it was', async () => {
    const res = { content: [{ type: 'text', text: '{}' }, { type: 'text', text: 'Call `claim_free_key` (no email).' }], structuredContent: { ok: true } };
    const out = await S._ctxALS.run({ session_id: 's', client_ip: '198.51.100.9', tier: 'free', platform: 'cursor', _wallStatus: 'anon_daily_cap' },
      async () => S._claimHandoffStep(res, 'search_facilities'));
    expect(out).toBe(res);
  });
});

describe('the two counters the owner reads, for the same calls', () => {
  it('a keyless limit hit is logged with its status and a claim is logged as a claim_free_key row', async () => {
    const limit = await open({ ip: CAPPED_IP });
    const hit = await call(limit, 'search_facilities', { state: 'VA' });
    expect(hit.tracked.length).toBeGreaterThan(0);
    const row = hit.tracked[hit.tracked.length - 1];
    expect(row.status).toBe('anon_daily_cap');
    expect(row.tier).toBe('free');
    expect(row.api_key).toBeNull();

    const claim = await call(limit, 'claim_free_key', { client_name: 'claim-handoff-test' });
    expect(claim.tracked.length).toBeGreaterThan(0);
    const crow = claim.tracked[claim.tracked.length - 1];
    expect(crow.tool).toBe('claim_free_key');
    expect(crow.status).toBe('ok');
    expect(crow.session_id).toBe(row.session_id);   // joinable to the limit hit that preceded it
  });

  it('refused no off-loopback connection', () => {
    expect(foreign).toEqual([]);
  });
});
