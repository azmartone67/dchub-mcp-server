// plan-dcpi-lead.test.mjs: owner funnel brief 2026-11-11, item 3.
//
// execute_plan("Is Phoenix a good place to build?") is a one-market siting verdict. Before, the planner
// routed it to the unknown class (discover_tools only, no data read). Now it routes to market_outlook,
// runs get_market_dcpi_rank for Phoenix first, and the answer LEADS with that market's Data Center Power
// Index (DCPI) verdict and its citation line: `dcpi_verdict` is the first key of the plan answer. The
// email-key offer (the plan's ask paragraph) rides a LATER content block, so it reads after the verdict.
//
// Real /mcp handler over loopback HTTP; the backend is a 127.0.0.1 stub (the plan-email-ask.test.mjs
// harness); off-loopback connects are refused. Hard-gate qualified: loopback only, no disk writes.
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

// Routes to ai_capacity_index first: sessionless, its step wall is the live no-ask row (item 1).


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
      if (p === '/api/v1/dcpi/scores/phoenix') return send(DCPI_PHOENIX);
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



// A clean, dated DCPI scorecard for the one market asked about.
const DCPI_PHOENIX = { market_slug: 'phoenix', market_name: 'Phoenix', state: 'AZ', iso: 'WECC', verdict: 'CAUTION',
  composite_score: 43.5, excess_power_score: 40, constraint_score: 55, time_to_power_months: 30,
  as_of: '2026-11-10T08:00:00Z', provenance: { as_of: '2026-11-10T08:00:00Z' } };
const ASK = { intent: 'Is Phoenix a good place to build?' };
const SOURCE_RE = /^Source: DC Hub \(dchub\.cloud\/markets\/phoenix\), as of 2026-11-10/;

describe('the planner routes a one-market siting verdict to the DCPI read', () => {
  it.each([
    ['Is Phoenix a good place to build?', 'phoenix'],
    ['Is Phoenix a good place to build a data center?', 'phoenix'],
    ['Should we build in Dallas?', 'dallas'],
  ])('%s -> market_outlook, get_market_dcpi_rank first', (q, slug) => {
    const r = S._planQuery(q, {});
    expect(r.intent_class).toBe('market_outlook');
    expect(r.recommended_sequence[0].tool).toBe('get_market_dcpi_rank');
    expect(r.recommended_sequence[0].args_hint.market_slug).toBe(slug);
  });
  it.each([
    ['where should I build a 100 MW data center in Texas'],
    ['what is the best place to build a data center'],
    ['compare Dallas vs Phoenix for a hyperscale campus'],
  ])('%s stays a ranking / comparison (never one market)', (q) => {
    expect(S._planQuery(q, {}).intent_class).not.toBe('market_outlook');
  });
});

describe('execute_plan("Is Phoenix a good place to build?") leads with the DCPI verdict, then the offer', () => {
  it.each([['in a session', {}], ['sessionless', { sessionless: true }]])('keyless, %s', async (_l, opts) => {
    const r = await callAs(null, 'execute_plan', ASK, 'claude-code', opts);
    expect(r.result.isError).not.toBe(true);
    const blocks = (r.result.content || []).map((b) => b.text || '');
    // 1) the verdict is the first thing in the answer: block 0's first key
    const d = JSON.parse(blocks[0]);
    // (a walled answer's wall puts its one link field, human_url, at the top: a URL, not an offer)
    expect(Object.keys(d).filter((k) => k !== 'human_url')[0]).toBe('dcpi_verdict');
    expect(d.intent_class).toBe('market_outlook');
    expect(d.executed[0].tool).toBe('get_market_dcpi_rank');
    const v = d.dcpi_verdict;
    expect(v.market_slug).toBe('phoenix');
    expect(v.verdict).toBe('CAUTION');
    // keyless: the verdict and composite are open; time-to-power is a withheld field on a preview
    expect(v.text).toMatch(/^Data Center Power Index \(DCPI\): Phoenix: CAUTION, composite 43\.5\/100\./);
    // 2) with its citation line
    expect(v.cite).toMatch(SOURCE_RE);
    // 3) the offer (the plan's email ask, or the wall's one-link line) comes after it, in a later block
    const offerAt = blocks.findIndex((t, i) => i > 0 && (t.includes(EMAIL_ASK) || /dchub\.cloud\/upgrade\//.test(t)));
    expect(offerAt, blocks.map((t) => t.slice(0, 80)).join(' | ')).toBeGreaterThan(0);
    // the verdict is the first key; the offer prose is not ahead of it inside block 0 either
    const at = blocks[0].indexOf(EMAIL_ASK);
    expect(at === -1 || at > blocks[0].indexOf('"dcpi_verdict"')).toBe(true);
  });
  it('a market the index does not track gets no verdict block (never a substitute)', async () => {
    const r = await callAs(null, 'execute_plan', { intent: 'Is Timbuktu a good place to build?' }, 'claude-code');
    const d = JSON.parse(r.result.content[0].text);
    expect(d.dcpi_verdict).toBeUndefined();
  });
  it('_planDcpiLead: only a market-scoped verdict; ISO bands and other kinds are not led with', () => {
    const ia = { kind: 'market_check', verdict: { value: 'BUILD', scope: 'market', subject: 'san-antonio', composite_score: 71 },
      evidence: [], source: 'Source: DC Hub (dchub.cloud/markets/san-antonio), as of 2026-11-10' };
    expect(S._planDcpiLead(ia).text).toBe('Data Center Power Index (DCPI): San Antonio: BUILD, composite 71/100.');
    expect(S._planDcpiLead({ ...ia, verdict: { ...ia.verdict, scope: 'iso' } })).toBe(null);
    expect(S._planDcpiLead({ ...ia, kind: 'siting' })).toBe(null);
    expect(S._planDcpiLead(null)).toBe(null);
  });
  it('the frozen /mcp/chatgpt and /mcp/claude answers carry no new block', async () => {
    for (const path of ['/mcp/chatgpt', '/mcp/claude']) {
      const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-forwarded-for': `198.51.100.${ipN++}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'execute_plan', arguments: ASK } }) });
      const raw = await res.text();
      expect(raw, path).not.toContain('dcpi_verdict');
    }
  });
  it('no backend read left loopback', () => { expect(foreign).toEqual([]); });
});
