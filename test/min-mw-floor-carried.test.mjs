// min-mw-floor-carried.test.mjs
//
// Grok QA 2026-11-06 (item 6, the "u_plan" residue after #1284): a min_mw the caller passed was
// nulled quietly in two places.
//   1. execute_plan {intent:"100 MW sites in Ohio", context:{min_mw:150}} ran the queue step at
//      min_mw=100: the planner read the size from capacity_mw or the intent text, never from the
//      caller's own min_mw, and the intent's figure was minted into the step's literal args, which
//      beat the context. Live (Pro key): filters_applied.min_mw 100, count 134 (150 gives 110).
//   2. get_refined_queue {state:"OH", min_mw:150} below paid depth: the floor is left out on purpose
//      (lib/readable-filters.mjs: a count over a floor would read a withheld MW back out), and
//      filters_applied.min_mw came back null with nothing beside it. Live: 174 projects of every size.
// Rule: apply the floor, or say where it is echoed that it was not applied.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';
import { readGatedValues, markNotApplied } from '../lib/readable-filters.mjs';

const INTENT = '100 MW sites in Ohio';
const NOW = Date.parse('2026-11-06T20:00:00Z');

describe('execute_plan: a caller-typed min_mw is the size the queue step runs at', () => {
  let P;
  beforeAll(async () => { P = await import('../server.mjs'); });
  const queueHint = (ctx) => {
    const sc = P._planQuery(INTENT, ctx);
    const q = (sc.recommended_sequence || []).find((s) => s.tool === 'get_refined_queue');
    expect(q, 'the plan has no queue step: every assertion below would be vacuous').toBeTruthy();
    return q.args_hint;
  };

  it('context min_mw beats the figure in the intent text', () => {
    expect(P._planSignals(INTENT, { min_mw: 150 }).mw).toBe(150);
    expect(queueHint({ min_mw: 150 }).min_mw).toBe(150);
  });

  it('CONTROL: with no typed size the intent text still sets it', () => {
    expect(queueHint({}).min_mw).toBe(100);
    expect(P._planSignals(INTENT, { min_mw: null }).mw).toBe(100);   // Number(null) is 0, not a size
    expect(P._planSignals(INTENT, { min_mw: '' }).mw).toBe(100);
  });

  it('capacity_mw (the typed top-level param) still wins over context min_mw', () => {
    expect(P._planSignals(INTENT, { capacity_mw: 200, min_mw: 150 }).mw).toBe(200);
  });
});

describe('intent_answer names the floor the caller asked for, not the one in the text', () => {
  const q = (min_mw) => ({ tool: 'get_refined_queue', status: 'executed', args: { iso: 'PJM', state: 'OH', min_mw: 150 },
    result: { count_total_matching: 110, source_as_of: '2026-11-05', freshness_by_iso: { PJM: { source_as_of: '2026-11-05' } },
      filters_applied: { min_mw, state: 'OH' }, results: [] } });
  const ev = (extra, min_mw) => buildIntentAnswer({ intent: 'find 100 MW sites in Ohio', intent_class: 'capacity_search',
    constraint_iso: ['PJM'], resolution_gap: null, ...extra }, [q(min_mw)], null, NOW).evidence.join(' ');

  it('requested_mw 150 with the floor applied at 150', () => {
    expect(ev({ requested_mw: 150 }, 150)).toContain('110 active interconnection-queue projects match the 150 MW floor');
  });
  it('requested_mw 150 with the floor dropped says so at 150', () => {
    expect(ev({ requested_mw: 150 }, null)).toContain('the 150 MW floor was not applied to this count');
  });
  it('CONTROL: no requested_mw falls back to the intent text', () => {
    expect(ev({}, 150)).toContain('match the 100 MW floor');
  });
});

describe('filters_applied carries the floor it did not apply', () => {
  it('readGatedValues reads only the gated filters the caller set', () => {
    expect(readGatedValues('get_refined_queue', { min_mw: 150, state: 'OH', max_ttp_months: 0 })).toEqual({ min_mw: 150 });
    expect(readGatedValues('get_refined_queue', { state: 'OH' })).toEqual({});
    expect(readGatedValues('no_such_tool', { min_mw: 1 })).toEqual({});
  });
  it('markNotApplied keeps the null and names the asked value beside it', () => {
    const fa = { min_mw: null, state: 'OH' };
    const out = markNotApplied(fa, ['min_mw'], { min_mw: 150 });
    expect(out.min_mw).toBeNull();
    expect(out._min_mw_not_applied).toContain('min_mw=150 was asked and NOT applied');
    expect(fa).not.toHaveProperty('_min_mw_not_applied');               // never mutates
    expect(markNotApplied(fa, [], { min_mw: 150 })).toBe(fa);
    expect(markNotApplied(null, ['min_mw'], {})).toBeNull();
  });
});

// Through the real app: the backend stub echoes filters_applied the way routes/interconnection_queues.py does.
const K_DEV = 'dch_live_minmwecho_devel01';
const KEY_TIER = { [K_DEV]: 'developer' };
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};
let S, PORT, httpServer, stub;
let seen = [];

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
      const u = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (u.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(KEY_TIER[key]
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_minmw', email: null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (u.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: true, prior_calls: 1 })); return; }
      if (u.pathname === '/api/v1/mcp/credits/balance') { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      if (u.pathname === '/api/v1/interconnection-queue/refined') {
        const q = Object.fromEntries(u.searchParams.entries());
        seen.push(q);
        const floor = q.min_mw != null ? Number(q.min_mw) : null;
        res.end(JSON.stringify({ _entity: 'queue_results', ok: true, count_returned: 1,
          count_total_matching: floor ? 110 : 174,
          filters_applied: { min_mw: floor, state: q.state || null, status: 'active' },
          results: [{ project_name: 'P', iso: 'PJM', state: 'OH', capacity_mw: 400, queue_status: 'active' }] }));
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

let ipN = 0;
async function callOnce(headers, name, args) {
  const h0 = { ...headers, 'x-forwarded-for': `10.78.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}` };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'minmw-test', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...h0, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  seen = [];
  const { json } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
  const r = JSON.parse(json).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('');
  const m = text.match(/"filters_applied":(\{[^{}]*\})/);
  return { text, fa: m ? JSON.parse(m[1]) : null, upstream: seen.slice() };
}

describe('get_refined_queue min_mw=150 through the app', () => {
  it('anonymous: the floor is not sent, and filters_applied says it was asked and not applied', async () => {
    const out = await callOnce({}, 'get_refined_queue', { state: 'OH', min_mw: 150 });
    expect(out.upstream.length, 'the backend was never asked').toBe(1);
    expect(out.upstream[0]).not.toHaveProperty('min_mw');
    expect(out.fa, 'no filters_applied in the answer').toBeTruthy();
    expect(out.fa.min_mw).toBeNull();
    expect(out.fa._min_mw_not_applied).toContain('min_mw=150');
  });

  it('CONTROL: a developer key applies it, and filters_applied.min_mw equals it with no not-applied note', async () => {
    const out = await callOnce({ 'x-api-key': K_DEV }, 'get_refined_queue', { state: 'OH', min_mw: 150 });
    expect(out.upstream[0].min_mw).toBe('150');
    expect(out.fa.min_mw).toBe(150);
    expect(out.fa).not.toHaveProperty('_min_mw_not_applied');
  });
});
