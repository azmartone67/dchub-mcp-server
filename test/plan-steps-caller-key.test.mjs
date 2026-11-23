// plan-steps-caller-key.test.mjs — owner 2026-11-11 ("Yes, build it"): execute_plan's steps run
// under the CALLER'S OWN KEY, never keyless, for a free key in the siting preview seat.
//
// Before: a no-email free key, and an email key whose monthly plan was spent (or whose counter did
// not answer), ran every plan step KEYLESS (server.mjs c.plan_steps_keyless), so the plan handed a
// keyed caller the anonymous preview of tools it could call in full directly.
//
// WHAT THIS PINS (real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend, off-loopback
// connects refused):
//   1) a no-email free key: every step's backend read carries the caller's X-API-Key;
//   2) an email key whose monthly run is spent, and one whose counter fails: the same;
//   3) a keyless caller: no step carries any key;
//   4) DCHUB_PLAN_STEPS_CALLER_KEY=0 restores the keyless steps (and the old envelope line);
//   5) a walled step inside the plan keeps its wall + human_url, is named in the envelope's
//      walled_steps and never called full; a step served in full is identical to the direct call
//      and is not named a preview;
//   6) the published siting clause stops naming execute_plan while the switch is on.
// SUPERSEDED 2026-11-23 (owner: execute_plan's full answer is paid-only): sections 1-5 now pin the inverse, a free
// key's plan is the preview and its steps run keyless, whatever DCHUB_PLAN_STEPS_CALLER_KEY says.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import * as L from '../lib/siting-email-seat.mjs';

// This file reads execute_plan step bodies and envelope keys, so it runs the full answer (what detail:"full" returns).
// The compact default is covered by test/plan-compact-1117 and, through the real handler, test/plan-fact-header.
const _compactWas = process.env.DCHUB_PLAN_COMPACT;
beforeAll(() => { process.env.DCHUB_PLAN_COMPACT = '0'; });
afterAll(() => { if (_compactWas === undefined) delete process.env.DCHUB_PLAN_COMPACT; else process.env.DCHUB_PLAN_COMPACT = _compactWas; });

// The lean step trims inner copy on /mcp; off so these read the plan envelope the handler built.
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

let S, PORT, httpServer, stub;
const runs = new Map();
const dataHits = [];   // {path, key} for every non-bookkeeping backend read

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
        if (k === PAIDK) return send({ valid: true, tier: 'paid', developer_id: 'd_pckpaid', email: 'paid@example.com', tier_detail: { users_plan: 'developer' } });
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
  S = await import('../server.mjs');
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  net.Socket.prototype.connect = realConnect;
});

const PAIDK = 'dch_live_planckpaiddeveloper0001';   // a Developer key: the control whose steps DO carry the key
async function post(headers, body, path = '/mcp') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
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
async function callAs(key, name, args, path = '/mcp') {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } }, path);
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' }, path);
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }, path);
  const result = JSON.parse(body).result || {};
  const text = (result.content || []).map((c) => c.text || '').join('\n');
  let data = {};
  try { data = JSON.parse((result.content || [])[0].text); } catch (_) { data = result.structuredContent || {}; }
  return { result, text, data };
}
const withEnv = async (k, v, fn) => { const prev = process.env[k]; process.env[k] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; } };
async function plan(key, args = PLAN_ARGS, path = '/mcp') {
  const before = dataHits.length;
  const r = await callAs(key, 'execute_plan', args, path);
  return { ...r, hits: dataHits.slice(before) };
}
const step = (r, tool) => (r.data.executed || []).find((e) => e.tool === tool);
const PLAN_OR_PRICE = /\b(Developer|Pro|Starter|Enterprise|Founding)\b|\$\s?\d|\/mo\b|[Pp]er month|stripe\.com/;
const OLD_LINE = /gets the same execute_plan preview as no key/;

// Owner 2026-11-23 supersedes the 2026-11-11 rule above: a full execute_plan needs a PAID key, and a free plan must
// not assemble a full answer from its steps. So for every free-class key (no email, email-bound, counter down) the
// steps run KEYLESS again, no monthly full run is metered, and the pointer is the paid path (unlock_more_data).
const PREVIEW_UPG = { tier: 'identified', next_tool: 'unlock_more_data' };
const planRunsMetered = () => [...runs.keys()].filter((id) => id.endsWith('|execute_plan'));

describe('1) a no-email free key: the plan is the preview, its steps run keyless', () => {
  it('no step read carries the caller\'s key; the envelope points at the paid path', async () => {
    const r = await plan(NOEMAIL);
    expect(Array.isArray(r.data.executed), r.text.slice(0, 600)).toBe(true);
    expect(r.hits.length, 'the plan ran steps').toBeGreaterThan(0);
    expect(r.hits.filter((h) => h.key), JSON.stringify(r.hits)).toEqual([]);
    expect(r.data._upgrade).toMatchObject(PREVIEW_UPG);
    expect(r.data._upgrade.steps_ran_under).toBeUndefined();
    expect(r.data._upgrade.message).not.toMatch(PLAN_OR_PRICE);
    expect(r.data.totals.tier_note).toMatch(/steps ran keyless/);
  });
});

describe('2) an email key, and one whose counter fails: no monthly full plan, steps keyless', () => {
  it('email-bound: no run is metered, and both plans are the keyless-step preview', async () => {
    const key = freshBound();
    for (const n of [1, 2]) {
      const r = await plan(key);
      expect(r.data.free_full_runs, 'call ' + n).toBeUndefined();
      expect(r.hits.length).toBeGreaterThan(0);
      expect(r.hits.filter((h) => h.key), JSON.stringify(r.hits)).toEqual([]);
      expect(r.data._upgrade).toMatchObject(PREVIEW_UPG);
      expect(r.data.totals.tier_note).toMatch(/steps ran keyless/);
    }
    expect(planRunsMetered().filter((id) => id.startsWith(key)), 'no monthly execute_plan run was consumed').toEqual([]);
  });
  it('counter fails (500): the same preview, steps keyless', async () => {
    const r = await plan(FAILCTR);
    expect(r.data.free_full_runs).toBeUndefined();
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.filter((h) => h.key), JSON.stringify(r.hits)).toEqual([]);
    expect(r.data._upgrade).toMatchObject(PREVIEW_UPG);
  });
});

describe('3) a keyless caller is unchanged', () => {
  it('no step read carries any key', async () => {
    const r = await plan(null);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.filter((h) => h.key), JSON.stringify(r.hits)).toEqual([]);
    expect(r.data._upgrade?.steps_ran_under).toBeUndefined();
  });
});

describe('4) DCHUB_PLAN_STEPS_CALLER_KEY no longer opens a free key\'s steps (either value)', () => {
  it.each(['0', '1'])('=%s: no-email and email keys: steps keyless, the preview pointer', async (v) => {
    await withEnv('DCHUB_PLAN_STEPS_CALLER_KEY', v, async () => {
      for (const key of [NOEMAIL, freshBound()]) {
        const r = await plan(key);
        expect(r.hits.length).toBeGreaterThan(0);
        expect(r.hits.filter((h) => h.key), JSON.stringify(r.hits)).toEqual([]);
        expect(r.data._upgrade).toMatchObject(PREVIEW_UPG);
      }
    });
  });
});

describe('5) inside the free plan, the paid-only step is the preview too', () => {
  it('get_refined_queue is walled with its relay link and never the key\'s full rows', async () => {
    const r = await plan(NOEMAIL);
    const rq = step(r, 'get_refined_queue');
    expect(rq, JSON.stringify((r.data.executed || []).map((e) => e.tool))).toBeTruthy();
    expect(rq.result.human_url, JSON.stringify(rq.result).slice(0, 400)).toMatch(/^https:\/\/dchub\.cloud\//);
    expect(rq.result.preview_is_partial || rq.result.trial_preview || rq.result._upgrade).toBeTruthy();
    const direct = await callAs(NOEMAIL, 'get_refined_queue', rq.args);
    expect(direct.data.human_url, 'the direct call is the preview for this key too').toMatch(/^https:\/\/dchub\.cloud\//);
  });
});

// Review of #1700: on the frozen ChatGPT directory _sitingSeat seats no one, so plan_steps_keyless was never set and a
// free key's steps sent its X-API-Key. The rule holds there too; the frozen copy is untouched (output only).
describe('5b) /mcp/chatgpt: a free-class key\'s plan steps run keyless; a Developer key\'s carry its key', () => {
  for (const [label, keyOf] of [['no-email free key', () => NOEMAIL], ['email-bound key', () => freshBound()]]) {
    it(`${label}: no step read carries the caller's key`, async () => {
      const r = await plan(keyOf(), PLAN_ARGS, '/mcp/chatgpt');
      expect(Array.isArray(r.data.executed), r.text.slice(0, 600)).toBe(true);
      expect(r.hits.length, 'the plan ran steps').toBeGreaterThan(0);
      expect(r.hits.filter((h) => h.key), JSON.stringify(r.hits)).toEqual([]);
    });
  }
  it('CONTROL: a Developer key on /mcp/chatgpt: every step read carries its key', async () => {
    const r = await plan(PAIDK, PLAN_ARGS, '/mcp/chatgpt');
    expect(r.hits.length, 'the plan ran steps').toBeGreaterThan(0);
    expect(r.hits.filter((h) => h.key !== PAIDK), JSON.stringify(r.hits)).toEqual([]);
  });
  it('the seat rule (the profile both /mcp/chatgpt and /mcp/chatgpt/oauth resolve to)', async () => {
    const f = S._directoryPlanStepsKeyless;
    const D = (await import('../lib/chatgpt-directory.mjs')).DIRECTORY_PROFILE;
    expect(await f({ api_key: NOEMAIL, tier: 'free', profile: D }, 'free')).toBe(true);
    expect(await f({ api_key: 'k', tier: 'identified', profile: D }, 'identified')).toBe(true);
    expect(await f({ api_key: 'k', tier: 'trial', profile: D }, 'trial')).toBe(true);
    expect(await f({ api_key: PAIDK, tier: 'paid', profile: D }, 'paid')).toBe(false);
    expect(await f({ api_key: NOEMAIL, tier: 'free' }, 'free')).toBe(false);   // not the directory: _sitingSeat's rule
    expect(await f({ tier: 'free', profile: D }, 'free')).toBe(false);        // keyless: no key to send anyway
  });
});

describe('6) helpers and the published clause', () => {
  it('the switch reads per call, default on', () => {
    expect(L.planStepsCallerKeyOn({})).toBe(true);
    for (const v of ['0', 'false', 'no', 'off', ' OFF ']) expect(L.planStepsCallerKeyOn({ DCHUB_PLAN_STEPS_CALLER_KEY: v })).toBe(false);
    for (const v of ['1', 'true', 'on', '']) expect(L.planStepsCallerKeyOn({ DCHUB_PLAN_STEPS_CALLER_KEY: v })).toBe(true);
  });
  it('the envelope line names only the walled steps and calls none full', () => {
    const u = L.planCallerKeyUpgrade('noemail', [{ step: 2, tool: 'get_grid_data' }], null);
    expect(u).toMatchObject({ next_tool: 'bind_email', steps_ran_under: 'your_key', walled_steps: [{ step: 2, tool: 'get_grid_data' }] });
    expect(u.message).toContain('step 2 (get_grid_data)');
    const none = L.planCallerKeyUpgrade('email', [], { used: 1, limit: 1, remaining: 0, resets_at: '2026-12-01T00:00:00Z' });
    expect(none.walled_steps).toBeUndefined();
    expect(none.message).not.toMatch(/preview/i);
    expect(none).toMatchObject({ next_tool: 'unlock_more_data', free_full_runs: { remaining: 0 } });
  });
  it('the siting clause never names execute_plan (owner 2026-11-23: no free full plan), whatever the switch', () => {
    const on = S._sitingFreeClause({});
    expect(on).toBe(L.sitingFreeClause(L.SITING_FREE_PLANS_PER_MONTH, { planCallerKey: true }));
    expect(on).not.toContain('execute_plan');
    expect(on).toContain(L.SITING_FREE_PLANS_PER_MONTH + ' full site_selection_canvas a month');
    expect(S._sitingFreeClause({ DCHUB_PLAN_STEPS_CALLER_KEY: '0' })).not.toContain('execute_plan');
    // Owner decision 2026-11-15: the handshake carries the two free offers, not the siting clause; the clause
    // still rides on claim_free_key / bind_email (free_tier_siting_tools).
    expect(S._INSTRUCTIONS_LEAN).not.toContain(on);
    expect(on).not.toMatch(PLAN_OR_PRICE);
  });
  it('no off-loopback connection was attempted', () => {
    expect(foreign).toEqual([]);
  });
});

