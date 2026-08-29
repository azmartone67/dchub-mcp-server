// ── the four-field router ChatGPT specified ─────────────────────────────────
//
// Its words, in the 2026-08-29 partner round, on shape and on omissions:
//   "problem should use your canonical problem taxonomy, not free text. That
//    gives downstream agents a stable enum they can branch on."
//   "The routing hint should be ADVISORY, not executable authority."
//   "I would not put tool lists, latency promises, confidence scores, detailed
//    execution graphs, planner versions in the routing hint."
//   On not_for: "Only add that when you have a concrete routing failure that
//    cannot be prevented by the four fields above."
//
// The omissions are half the specification, so they are tested as hard as the
// contents. A later PR that helpfully adds `confidence` to this block is
// re-opening a decision that was made deliberately, and should have to delete a
// test that says so.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _routingHint } from '../server.mjs';

const CLASSES = ['market_ranking', 'market_comparison', 'capacity_search', 'site_analysis',
  'grid_headroom', 'interconnection_queue', 'hosting_capacity', 'water_climate', 'deals_ma',
  'fiber_power_pairing', 'fiber', 'price', 'incentives_tax', 'power_timeline',
  'changes_delta', 'facility_search', 'unknown'];

describe('routing_hint — contents', () => {
  it('every intent class the planner can emit produces a complete hint', () => {
    for (const c of CLASSES) {
      const h = _routingHint(c, 'rank_markets');
      expect(h.problem, c).toBe(c);
      expect(typeof h.why, c).toBe('string');
      expect(h.why.length, c).toBeGreaterThan(10);
      expect(Array.isArray(h.expected_outputs), c).toBe(true);
      expect(h.expected_outputs.length, c).toBeGreaterThan(0);
    }
  });

  it('problem is the SAME enum as intent_class — branchable, never free text', () => {
    expect(_routingHint('market_ranking', 'x').problem).toBe('market_ranking');
  });

  it('multi-capability questions route to the planner, single-capability ones do not', () => {
    expect(_routingHint('site_analysis', 'analyze_site').best_path).toBe('execute_plan');
    expect(_routingHint('market_comparison', 'get_market_dcpi_rank').best_path).toBe('execute_plan');
    // A single lookup through the planner is a wasted round trip, which is the
    // opposite of what this block exists to prevent.
    expect(_routingHint('facility_search', 'search_facilities').best_path).toBe('search_facilities');
    expect(_routingHint('changes_delta', 'get_changes').best_path).toBe('get_changes');
  });

  it('expected_outputs names output CLASSES, never tool names', () => {
    for (const c of CLASSES) {
      for (const o of _routingHint(c, 'rank_markets').expected_outputs) {
        expect(o, `${c}: "${o}"`).not.toMatch(/^(get_|rank_|search_|analyze_|compare_|execute_)/);
      }
    }
  });

  it('an unrecognized class degrades to the unknown route instead of throwing', () => {
    const h = _routingHint('some_future_class', 'discover_tools');
    expect(h.problem).toBe('some_future_class');      // echoed honestly
    expect(h.expected_outputs.length).toBeGreaterThan(0);
    expect(h.best_path).toBe('discover_tools');
  });

  it('says out loud that it is advisory', () => {
    expect(_routingHint('market_ranking', 'x').advisory.toLowerCase())
      .toContain('does not assert');
  });
});

// ★ The omissions ARE the specification.
describe('routing_hint — what it must NOT carry', () => {
  const BANNED = ['confidence', 'intent_confidence', 'workflow_confidence', 'latency_ms',
                  'estimated_ms', 'planner_version', 'execution_graph', 'recommended_sequence',
                  'tools', 'tool_list', 'waves', 'not_for'];
  it('carries none of the fields ChatGPT asked us to leave in replay', () => {
    for (const c of CLASSES) {
      const keys = Object.keys(_routingHint(c, 'rank_markets'));
      for (const b of BANNED) expect(keys, `${c} leaked ${b}`).not.toContain(b);
    }
  });
  it('stays exactly five keys — four fields plus the advisory disclaimer', () => {
    expect(Object.keys(_routingHint('market_ranking', 'x')).sort())
      .toEqual(['advisory', 'best_path', 'expected_outputs', 'problem', 'why']);
  });
});

// ★★★ THE WIRING, not the function. Stage 0a shipped INERT for eight days because
// its guards called the helper directly and grepped server.mjs for the call
// expression — neither can prove the block reaches a response. This drives a real
// plan_query over HTTP. plan_query is inspect-only and runs the deterministic
// no-LLM planner, so it needs no upstream.
describe('routing_hint reaches a real plan_query response', () => {
  let S, PORT, httpServer;
  beforeAll(async () => {
    const prev = process.env.DCHUB_API_BASE;
    process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
    S = await import('../server.mjs');
    if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
    await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
    PORT = httpServer.address().port;
  }, 60000);
  afterAll(async () => { await new Promise((r) => (httpServer ? httpServer.close(r) : r())); });

  async function plan(intent) {
    const url = `http://127.0.0.1:${PORT}/mcp`;
    const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const init = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18',
        capabilities: {}, clientInfo: { name: 'dchub-verify-probe', version: '1.0' } } }) });
    const sid = init.headers.get('mcp-session-id');
    const res = await fetch(url, { method: 'POST',
      headers: { ...h, ...(sid ? { 'mcp-session-id': sid } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'plan_query', arguments: { intent } } }) });
    const raw = await res.text();
    const j = raw.includes('data: ')
      ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
    return JSON.parse(j)?.result?.structuredContent ?? null;
  }

  it('a routed intent carries the hint, and it agrees with intent_class', async () => {
    const sc = await plan('compare Dallas vs Phoenix for a 100 MW GPU cluster');
    expect(sc?.routing_hint).toBeTruthy();
    expect(sc.routing_hint.problem).toBe(sc.intent_class);   // one enum, not two
    expect(sc.routing_hint.best_path).toBeTruthy();
  }, 30000);

  it('an UNROUTABLE intent still carries a hint — the fallback path is wired too', async () => {
    const sc = await plan('qqq zzz wibble');
    expect(sc?.routing_hint).toBeTruthy();
    expect(sc.routing_hint.problem).toBe(sc.intent_class);
  }, 30000);

  it('the hint is declared in the tool schema, so an agent can find it', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    const raw = await res.text();
    const j = raw.includes('data: ')
      ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
    const t = JSON.parse(j).result.tools.find((x) => x.name === 'plan_query');
    expect(Object.keys(t.outputSchema.properties)).toContain('routing_hint');
  }, 30000);
});
