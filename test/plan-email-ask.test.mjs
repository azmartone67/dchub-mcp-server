// plan-email-ask.test.mjs — owner 2026-11-11 ("Yes, build it"): execute_plan carries ONE email ask
// when a step came back walled, and the steps' wall rows say so.
//
// Before: every email-ask step skips an execute_plan loopback step (the plan answer talks to the agent),
// and the plan answer asked nothing either. Live (funnel no_ask_split since 11-10 10:45Z), sessionless
// ai_capacity_index walls with no ask were plan steps.
//
// WHAT THIS PINS (real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend that records every
// funnel-event body, off-loopback connects refused):
//   1) a keyless plan with walled steps, sessionless (the live gap) and in a session: _upgrade asks for
//      the email through claim_free_key {email}, names the walled steps, no plan name or price; the
//      step's wall row reads email_ask 'line' (in a session it keeps the caller's session id);
//   2) a no-email key: the bind_email line it already had is now credited on the step rows;
//   3) Grok (G3: never asked) and the other excluded callers get no ask; step rows are credited only
//      when the final answer carries the ask (the real send path);
//   4) CONTROL DCHUB_PLAN_EMAIL_ASK=0: the live row comes back (a sessionless ai_capacity_index step wall
//      with no ask, no ask on the plan). A grid / queue step already asks on its own, so the control
//      uses the ai_capacity_index plan;
//   5) the sink: single-use step tokens, unknown ids refused, the fallback sends unmarked rows,
//      and an answer whose ask is gone is never credited.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import * as W from '../lib/plan-wall-sink.mjs';
import { EMAIL_ASK } from '../lib/claim-handoff.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
import { CLAUDE_PROFILE } from '../lib/claude-directory.mjs';
import { CORE_PROFILE } from '../lib/core-profile.mjs';
// The lean step stays ON (production): it shrinks _upgrade to machine fields, so the ask the agent
// receives is the plan's prose paragraph. mcp#1356 first shipped with lean off here and the live
// answer carried no ask.

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
// Fixture keys: test values only, never real credentials.
const NOEMAIL = 'dch_live_plancallerkeynoemail001';
let keyN = 0;
const freshBound = () => 'dch_live_planckbound' + String(100000 + (keyN++)).padStart(10, '0');
const FAILCTR = 'dch_live_planckcounterfails00001';   // email-bound; its monthly counter answers 500

// One row shape for every data path the grid plan reads.
const GENERIC = {
  iso: 'ERCOT', as_of: '2026-11-10T00:00:00Z', source: 'ERCOT', headroom_mw: 1234, available_mw: 900,
  total_mw: 5000, count: 2,
  projects: [
    { name: 'P1', mw: 100, capacity_mw: 100, status: 'active', iso: 'ERCOT', county: 'Travis', state: 'TX', fuel: 'solar' },
    { name: 'P2', mw: 200, capacity_mw: 200, status: 'active', iso: 'ERCOT', county: 'Harris', state: 'TX', fuel: 'gas' },
  ],
};
// The planner routes this to get_grid_intelligence, get_interconnection_queue, get_refined_queue.
const PLAN_ARGS = { intent: 'power availability in ERCOT' };
// Routes to ai_capacity_index first: sessionless, its step wall is the live no-ask row (item 1).
const AI_ARGS = { intent: 'rank markets for a 200 MW AI campus' };

let S, PORT, httpServer, stub;
const runs = new Map();
const dataHits = [];
const events = [];   // every funnel-event body the server sent   // {path, key} for every non-bookkeeping backend read

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') {
        const k = (await readBody(req)).api_key || '';
        if (k === NOEMAIL) return send({ valid: true, tier: 'free', developer_id: 'd_pckne', email: null });
        if (k === FAILCTR || k.startsWith('dch_live_planckbound')) {
          return send({ valid: true, tier: 'identified', developer_id: 'd_' + k.slice(-6), email: 'plan+' + k.slice(-6) + '@example.com' });
        }
        return send({ valid: false, tier: 'free' });
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        const b = await readBody(req);
        if (b.api_key === FAILCTR) return send({ error: 'counter down' }, 500);
        const limit = b.tool === 'execute_plan' || b.tool === 'site_selection_canvas' ? 1 : 0;
        const id = `${b.api_key}|${b.tool}`;
        let used = runs.get(id) || 0;
        const out = (allowed) => send({ ok: true, allowed, used, limit, remaining: Math.max(0, limit - used),
          resets_at: '2026-12-01T00:00:00Z', email_bound: true, ...(allowed ? { source: 'free', charge_ref: 'free' } : {}) });
        if (limit <= 0) return out(false);
        if (b.op === 'consume') { if (used < limit) { used += 1; runs.set(id, used); return out(true); } return out(false); }
        if (b.op === 'release') { used = Math.max(0, used - 1); runs.set(id, used); return out(false); }
        return out(false);
      }
      if (p === '/api/v1/keys/auto-mint') return send({ ok: false });
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send({ error: 'not found' }, 404);
      if (p.startsWith('/api/v1/mcp/full-cap/')) return send({ ok: false });
      if (p === '/api/v1/mcp/signal-paywall') return send({ ok: true });
      if (p === '/api/v1/mcp/credits/balance') return send({ credits: 0 });
      if (p === '/api/v1/mcp/funnel-event') { events.push(await readBody(req)); return send({ ok: true }); }
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/sources/') || p.startsWith('/api/v1/keys/')) return send({ ok: true });
      dataHits.push({ path: p, key: req.headers['x-api-key'] || '' });
      return send(GENERIC);
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  // execute_plan's steps loop back to 127.0.0.1:PORT, read once at import.
  process.env.PORT = String(await freePort());
  process.env.DCHUB_INTERNAL_KEY = SECRET;   // read at import: the wall rows are sent
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
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
let ipN = 20, rpcId = 100;
// sessionless: no initialize, one bare tools/call (the live gap: the step rows read reason no_session).
async function callAs(key, name, args, client = 'claude-code', { sessionless = false } = {}) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}),
    ...(sessionless ? { 'x-mcp-platform': client } : {}) };
  const init = sessionless ? null : await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1.0' } } });
  const sid = init ? init.headers.get('mcp-session-id') : null;
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  const text = (result.content || []).map((c) => c.text || '').join('\n');
  let data = {};
  try { data = JSON.parse((result.content || [])[0].text); } catch (_) { data = result.structuredContent || {}; }
  return { result, text, data };
}
const withEnv = async (k, v, fn) => { const prev = process.env[k]; process.env[k] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; } };
// One plan; the quota_wall_hit rows it caused (they leave when the plan's answer is final).
async function plan(key, client, opts, args = PLAN_ARGS) {
  const b = events.length;
  const r = await callAs(key, 'execute_plan', args, client, opts);
  await new Promise((res) => setTimeout(res, 300));
  return { ...r, walls: events.slice(b).filter((e) => e.event === 'quota_wall_hit') };
}
const step = (r, tool) => (r.data.executed || []).find((e) => e.tool === tool);
const PLAN_OR_PRICE = /\b(Developer|Pro|Starter|Enterprise|Founding)\b|\$\s?\d|\/mo\b|[Pp]er month|stripe\.com/;
const OLD_LINE = /gets the same execute_plan preview as no key/;


const ASK_LEAD = /ask your human for their email[^.]*call `claim_free_key` with \{email\}/;
// The plan's ask paragraph: its own prose block (never inside block 0's JSON).
const askBlock = (r) => (r.result.content || []).map((b) => (b && b.type === 'text' ? b.text : ''))
  .find((t) => !/^\s*[{[]/.test(t) && t.includes(W.PLAN_ASK_LEAD) && t.includes(EMAIL_ASK)) || null;

describe('1) a keyless plan whose steps walled asks once, and its step rows say so', () => {
  it.each([
    ['sessionless ai_capacity_index (the live gap)', { sessionless: true }, AI_ARGS],
    ['sessionless queue plan', { sessionless: true }, PLAN_ARGS],
    ['in a session', {}, PLAN_ARGS],
  ])('%s: the answer names the walled steps and asks for the email; the row reads line', async (_l, opts, args) => {
    const r = await plan(null, undefined, opts, args);
    const walledE = (r.data.executed || []).filter((e) => e.result && e.result.human_url);
    const walled = walledE.map((e) => e.tool);
    expect(walled.length, JSON.stringify((r.data.executed || []).map((e) => e.tool))).toBeGreaterThan(0);
    // An email opens these; the rest are depth walls (paid fields), which the ask never names.
    const opens = [...new Set(walledE.filter((e) => S._planStepEmailOpens(e.tool, e.result, {})).map((e) => e.tool))];
    const depth = [...new Set(walled)].filter((t) => !opens.includes(t));
    expect(opens.length, 'the plan walled a step an email opens').toBeGreaterThan(0);
    expect(r.data._upgrade, r.text.slice(0, 600)).toMatchObject({ tier: 'anonymous', next_tool: 'bind_email' });
    for (const t of walled) expect(r.data._upgrade.walled_steps.map((w) => w.tool)).toContain(t);
    expect(r.result.structuredContent._upgrade).toEqual(r.data._upgrade);
    // What the agent reads after the lean step: one prose paragraph, naming every walled step.
    const para = askBlock(r);
    expect(para, r.text.slice(0, 1200)).toBeTruthy();
    for (const t of opens) expect(para.match(new RegExp('step \\d+ \\(' + t + '\\)', 'g')), t + ' named once').toHaveLength(1);
    for (const t of depth) expect(para, t + ' is a depth step: an email does not open it').not.toContain('(' + t + ')');
    expect(para).toContain('Only use an address they gave you');
    expect(para).not.toMatch(PLAN_OR_PRICE);
    expect(para).not.toMatch(/\n/);
    expect(r.walls.length, 'a step wrote a wall row').toBeGreaterThan(0);
    for (const w of r.walls) {
      expect(opens, 'only steps the ask names wrote wall rows here').toContain(w.tool);
      expect(w.email_ask, JSON.stringify(w)).toBe('line');
      if (!opts.sessionless) expect(w.session_id, 'the step row keeps the caller session').toBeTruthy();
    }
  });
});

describe('1b) with the lean step off, _upgrade still carries the ask in prose', () => {
  it('sessionless keyless plan', async () => {
    await withEnv('DCHUB_LEAN_RESPONSES', '0', async () => {
      const r = await plan(null, undefined, { sessionless: true }, AI_ARGS);
      expect(r.data._upgrade.message).toMatch(ASK_LEAD);
      expect(askBlock(r)).toBeTruthy();
      for (const w of r.walls) expect(w.email_ask).toBe('line');
    });
  });
});

describe('2) a no-email key: the bind_email line it already gets is credited on the step rows', () => {
  it('the row reads line', async () => {
    const r = await plan(NOEMAIL);
    expect(r.data._upgrade).toMatchObject({ next_tool: 'bind_email', steps_ran_under: 'your_key' });
    expect(r.data._upgrade.walled_steps.length, 'lean keeps walled_steps').toBeGreaterThan(0);
    const para = askBlock(r);
    expect(para, r.text.slice(0, 1200)).toContain('`bind_email` {api_key, email}');
    expect(para).not.toMatch(PLAN_OR_PRICE);
    expect(r.walls.length).toBeGreaterThan(0);
    for (const w of r.walls) expect(w.email_ask, JSON.stringify(w)).toBe('line');
  });
});

describe('3) Grok is never asked (G3), nor the other excluded callers', () => {
  it('a Grok plan carries no ask', async () => {
    const r = await plan(null, 'grok', { sessionless: true }, AI_ARGS);
    expect(r.data._upgrade?.walled_steps).toBeUndefined();
    expect(askBlock(r)).toBeNull();
  });
  it('the gate: Grok, connectors-manager and the directory / Claude / core profiles are out', () => {
    expect(S._planAnonEmailAskAllowed({ platform: 'claude' })).toBe(true);
    for (const platform of ['grok', 'connectors-manager']) expect(S._planAnonEmailAskAllowed({ platform }), platform).toBe(false);
    for (const profile of [DIRECTORY_PROFILE, CLAUDE_PROFILE, CORE_PROFILE]) {
      expect(profile).toBeTruthy();
      expect(S._planAnonEmailAskAllowed({ platform: 'claude', profile }), profile).toBe(false);
    }
    expect(S._planAnonEmailAskAllowed(null)).toBe(false);
  });
  it('step rows leave marked only when the final answer carries the ask (the real send path)', async () => {
    const sink = S._planWallSinkForTest;
    const row = (sid) => ({ c: { platform: 'claude', client_ip: '198.51.100.250', session_id: sid }, e: { name: 'ai_capacity_index', status: 'trial_used', sent: false, timer: null } });
    const asked = { structuredContent: { _upgrade: W.planAnonEmailUpgrade([{ step: 1, tool: 'ai_capacity_index' }]) } };
    for (const [result, want] of [[{ structuredContent: { _upgrade: { next_tool: 'unlock_more_data', message: 'x' } } }, undefined], [asked, 'line']]) {
      const plan = {};
      plan._planWallSinkId = sink.open();
      const r = row('sink-' + String(want));
      expect(sink.park(plan._planWallSinkId, r.c, r.e)).toBe(true);
      const b = events.length;
      S._drainPlanWallSinkForTest(plan, result);
      await new Promise((res) => setTimeout(res, 200));
      const got = events.slice(b).filter((e) => e.event === 'quota_wall_hit' && e.tool === 'ai_capacity_index');
      expect(got.length).toBe(1);
      expect(got[0].email_ask).toBe(want);
      expect(plan._planWallSinkId, 'drained once').toBeNull();
    }
  });
});

describe('4) CONTROL: DCHUB_PLAN_EMAIL_ASK=0', () => {
  it('the sessionless keyless plan asks nothing and its step rows are unmarked, as before', async () => {
    await withEnv('DCHUB_PLAN_EMAIL_ASK', '0', async () => {
      const r = await plan(null, undefined, { sessionless: true }, AI_ARGS);
      expect(r.data._upgrade?.walled_steps).toBeUndefined();
      expect(askBlock(r)).toBeNull();
      expect(r.walls.length).toBeGreaterThan(0);
      for (const w of r.walls) expect(w.email_ask, JSON.stringify(w)).toBeUndefined();
    });
  });
});

describe('4b) depth steps are never named, fan-out steps once, and only named steps are credited', () => {
  const W2 = [{ step: 1, tool: 'ai_capacity_index', email_opens: true }, { step: 2, tool: 'get_market_dcpi_rank', email_opens: false },
    { step: 2, tool: 'get_market_dcpi_rank', email_opens: false }, { step: 3, tool: 'get_grid_intelligence', email_opens: true },
    { step: 3, tool: 'get_grid_intelligence', email_opens: true }];
  it('the paragraph and the upgrade name only what an email opens, each once', () => {
    for (const p of [W.planAskParagraph(W2), W.planAskParagraph(W2, { keyed: true }), W.planAnonEmailUpgrade(W2).message]) {
      expect(p).toContain('step 1 (ai_capacity_index), step 3 (get_grid_intelligence).');
      expect(p).not.toContain('get_market_dcpi_rank');
    }
    expect(W.planAnonEmailUpgrade(W2).walled_steps, 'the machine list keeps every walled step, once').toEqual([
      { step: 1, tool: 'ai_capacity_index' }, { step: 2, tool: 'get_market_dcpi_rank' }, { step: 3, tool: 'get_grid_intelligence' }]);
  });
  it('a plan whose only walled step is a depth step asks nothing', () => {
    const d = [{ step: 2, tool: 'get_market_dcpi_rank', email_opens: false }];
    expect(W.planAskParagraph(d)).toBeNull();
    expect(W.planAskParagraph(d, { keyed: true })).toBeNull();
    expect(W.planAnonEmailUpgrade(d)).toBeNull();
  });
  it('the classifier: DCPI is depth (owner 11-02), a keyless get_grid_data free-key wall opens, grid intelligence opens', () => {
    expect(S._planStepEmailOpens('get_market_dcpi_rank', { human_url: 'https://dchub.cloud/u/x', preview_is_partial: true }, {})).toBe(false);
    expect(S._planStepEmailOpens('get_grid_intelligence', {}, {})).toBe(true);
    expect(S._planStepEmailOpens('ai_capacity_index', {}, {})).toBe(true);
    expect(S._planStepEmailOpens('get_grid_data', {}, {}), 'keyless get_grid_data is a free-key wall').toBe(true);
    expect(S._planStepEmailOpens('compare_isos', {}, {})).toBe(false);
  });
  it('the drain credits only the rows of named tools (the real send path)', async () => {
    const sink = S._planWallSinkForTest;
    const planC = { _planWallSinkId: sink.open() };
    for (const tool of ['ai_capacity_index', 'get_market_dcpi_rank']) {
      sink.park(planC._planWallSinkId, { platform: 'claude', client_ip: '198.51.100.251', session_id: 'drain-' + tool },
        { name: tool, status: 'trial_used', sent: false, timer: null });
    }
    const b = events.length;
    S._drainPlanWallSinkForTest(planC, { content: [{ type: 'text', text: '{}' }, { type: 'text', text: W.planAskParagraph(W2) }] });
    await new Promise((res) => setTimeout(res, 200));
    const got = Object.fromEntries(events.slice(b).filter((e) => e.event === 'quota_wall_hit').map((e) => [e.tool, e.email_ask]));
    expect(got).toEqual({ ai_capacity_index: 'line', get_market_dcpi_rank: undefined });
  });
});

describe('5) the sink and the helpers', () => {
  const sent = [];
  const mk = (ms) => W.createPlanWallSink({ send: (c, e) => sent.push([c, e]), fallbackMs: ms });
  it('a step token is single-use; an unknown or drained sink takes nothing', () => {
    const k = mk(60000);
    const id = k.open();
    const t = k.mintStepToken(id);
    expect(k.consumeStepToken(t)).toBe(id);
    expect(k.consumeStepToken(t)).toBeNull();
    expect(k.consumeStepToken('made-up')).toBeNull();
    expect(k.park('made-up', {}, {})).toBe(false);
    expect(k.park(id, { n: 1 }, {})).toBe(true);
    const before = sent.length;
    expect(k.drain(id, (c) => { c._emailAsk = 'line'; })).toBe(1);
    expect(sent.slice(before).map(([c]) => c._emailAsk)).toEqual(['line']);
    expect(k.park(id, {}, {})).toBe(false);
    expect(k.consumeStepToken(k.mintStepToken(id))).toBeNull();
  });
  it('a sink nobody drains still sends its rows, unmarked', async () => {
    const k = mk(20);
    const id = k.open();
    k.park(id, { n: 2 }, {});
    const before = sent.length;
    await new Promise((res) => setTimeout(res, 80));
    expect(sent.slice(before).map(([c]) => [c.n, c._emailAsk])).toEqual([[2, undefined]]);
  });
  it('only an answer whose _upgrade still asks for the email is credited', () => {
    const asks = { next_tool: 'claim_free_key', message: 'Came back as a preview: step 1 (ai_capacity_index). ask your human for their email' };
    expect(W.planAnswerAsks({ structuredContent: { _upgrade: asks } })).toBe(true);
    expect(W.planAnswerAsks({ content: [{ type: 'text', text: JSON.stringify({ _upgrade: asks }) }] })).toBe(true);
    expect(W.planAnswerAsks({ structuredContent: { _upgrade: { next_tool: 'unlock_more_data', message: 'email' } } })).toBe(false);
    expect(W.planAnswerAsks({ structuredContent: { _upgrade: { next_tool: 'bind_email', message: 'more answers' } } })).toBe(false);
    expect(W.planAnswerAsks({ structuredContent: {} })).toBe(false);
    const para = W.planAskParagraph([{ step: 1, tool: 'ai_capacity_index' }]);
    expect(W.planAnswerAsks({ content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: para }] })).toBe(true);
    expect(W.planAnswerAsks({ content: [{ type: 'text', text: JSON.stringify({ executed: [{ result: para }] }) }] }), 'a copy in the JSON does not count').toBe(false);
    expect(W.planAnswerAsks({ content: [{ type: 'text', text: EMAIL_ASK }] }), 'another wall line is not the plan ask').toBe(false);
    expect(W.planAskParagraph([])).toBeNull();
    expect(W.planAskParagraph([{ step: 2, tool: 'get_grid_data' }], { keyed: true })).toContain('{api_key, email}');
    // A key whose email is bound (seat 'email') is never asked; Grok never; a no-email seat is.
    const w = [{ step: 2, tool: 'get_grid_data' }];
    expect(S._planKeyedAskParagraph('noemail', w, { platform: 'claude' })).toContain('{api_key, email}');
    expect(S._planKeyedAskParagraph('email', w, { platform: 'claude' })).toBeNull();
    expect(S._planKeyedAskParagraph('noemail', w, { platform: 'grok' })).toBeNull();
    expect(S._planKeyedAskParagraph('noemail', [], { platform: 'claude' })).toBeNull();
    expect(W.planAnswerAsks(undefined)).toBe(false);
    expect(W.planAnswerAsks({ structuredContent: { _upgrade: { next_tool: 'bind_email', message: 'give us your email' } } }), 'an ask naming no step credits nothing').toBe(false);
  });
  it('the upgrade is null with no walled step, and the switch reads per call', () => {
    expect(W.planAnonEmailUpgrade([])).toBeNull();
    expect(W.planAnonEmailUpgrade([{ step: 2, tool: 'ai_capacity_index' }]).message).toContain('step 2 (ai_capacity_index)');
    expect(W.planEmailAskOn({})).toBe(true);
    for (const v of ['0', 'false', 'off', ' NO ']) expect(W.planEmailAskOn({ DCHUB_PLAN_EMAIL_ASK: v })).toBe(false);
  });
  it('no off-loopback connection was attempted', () => {
    expect(foreign).toEqual([]);
  });
});
