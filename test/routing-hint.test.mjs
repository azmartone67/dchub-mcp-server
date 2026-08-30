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
  // ★ THE COUNT MOVED FROM FIVE TO SIX, ON PURPOSE, ONCE.
  // The five-key assertion existed so a helpful future PR adding `confidence`
  // would have to delete a test that says the omission was deliberate. That
  // ceremony is being paid, not skipped: ChatGPT — the author of the original
  // four-field spec AND of its omissions — asked for
  // `external_sources_recommended` by name in its 2026-08-30 briefing. Its
  // exclusions were all OUR OWN execution metadata, which belongs in `replay`;
  // a source we do not own is not that. Every banned field above stays banned.
  it('stays exactly six keys — five fields plus the advisory disclaimer', () => {
    expect(Object.keys(_routingHint('market_ranking', 'x')).sort())
      .toEqual(['advisory', 'best_path', 'expected_outputs',
                'external_sources_recommended', 'problem', 'why']);
  });
});

// ── external_sources_recommended — the Research Stack field ──────────────────
// ChatGPT, 2026-08-30: "That gives an agent a complete research plan without
// pretending DC Hub has every source."
describe('routing_hint — external_sources_recommended', () => {
  const ALLOWED = ['brokerage_research', 'market_analytics', 'financial_context',
                   'utility_or_iso_filing', 'operator_disclosure'];

  it('every intent class resolves the field, and only to the closed enum', () => {
    for (const c of CLASSES) {
      const ext = _routingHint(c, 'rank_markets').external_sources_recommended;
      expect(Array.isArray(ext), c).toBe(true);
      for (const e of ext) {
        expect(ALLOWED, `${c}: unknown source_class ${e.source_class}`).toContain(e.source_class);
        expect(typeof e.why, c).toBe('string');
        expect(e.why.length, `${c}/${e.source_class}: why is too thin to act on`)
          .toBeGreaterThan(60);
      }
      // No class may recommend the same source twice.
      const names = ext.map((e) => e.source_class);
      expect(new Set(names).size, `${c}: duplicate source_class`).toBe(names.length);
    }
  });

  it('NAMES CLASSES, NEVER VENDORS — the first helpful edit here will add one', () => {
    // A company gets acquired, renamed or repriced and the string rots in every
    // agent that cached it. Same wording rule the problem taxonomy lives under.
    const VENDORS = new RegExp('\\b(' + [
      'CBRE', 'JLL', 'Cushman', 'Colliers', 'Newmark', 'DC ?Byte', 'DataCenterHawk',
      'dchawk', 'Baxtel', 'DCD', 'Data ?Center ?Frontier', 'S&P', 'Moody', 'Gartner',
      'Synergy', 'Omdia', 'Structure ?Research', '451',
    ].join('|') + ')\\b', 'i');
    for (const c of CLASSES) {
      for (const e of _routingHint(c, 'x').external_sources_recommended) {
        const blob = `${e.source_class} ${e.why}`;
        expect(blob, `${c}: vendor name in the contract`).not.toMatch(VENDORS);
      }
    }
  });

  it('an empty list is a real answer, and some classes give one', () => {
    // Recommending an outside source for something we DO cover teaches an agent
    // to leave for no reason — worse than saying nothing. So "we cover this end
    // to end" has to be expressible, and has to actually occur.
    const empties = CLASSES.filter(
      (c) => _routingHint(c, 'x').external_sources_recommended.length === 0);
    expect(empties.length, 'every class recommends leaving — that is not a contract, it is a shrug')
      .toBeGreaterThan(2);
    expect(empties, 'fiber coverage is not an admitted gap').toContain('fiber');
    expect(empties, 'unknown cannot recommend a source for a question it did not read')
      .toContain('unknown');
  });

  it('the classes that DO recommend are the ones with a published limit behind them', () => {
    // grid_headroom publishes "supply-side signals, not a load-interconnection
    // promise"; interconnection_queue publishes "no delivery dates". Both point
    // at the same owner: the utility or ISO filing.
    const of = (c) => _routingHint(c, 'x').external_sources_recommended.map((e) => e.source_class);
    expect(of('grid_headroom')).toContain('utility_or_iso_filing');
    expect(of('interconnection_queue')).toContain('utility_or_iso_filing');
    // "no per-rack power density is ingested; there is no public source"
    expect(of('capacity_search')).toContain('operator_disclosure');
    // "DC Hub rescores daily and serves the present day" — the historical
    // series is the real DC Byte / DC Hawk gap and we should say so.
    expect(of('market_ranking')).toContain('market_analytics');
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

  it('external_sources_recommended reaches a real response, not just the helper', async () => {
    // Stage 0a shipped INERT for eight days because its guards called the helper
    // directly. Drive the field over HTTP or it is not shipped.
    const sc = await plan('rank markets for a 200 MW AI campus');
    const ext = sc?.routing_hint?.external_sources_recommended;
    expect(Array.isArray(ext)).toBe(true);
    expect(ext.length).toBeGreaterThan(0);
    expect(ext[0].source_class).toBeTruthy();
    expect(ext[0].why.length).toBeGreaterThan(60);
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
    // and the new field is declared INSIDE it — an undeclared field is one an
    // agent can only find by accident. Optional fields render as
    // anyOf:[{object}, {null}], so unwrap rather than assuming the shape.
    const node = t.outputSchema.properties.routing_hint;
    const obj = node.properties ? node : (node.anyOf || []).find((b) => b.properties);
    expect(obj, 'routing_hint has no object branch to declare fields in').toBeTruthy();
    expect(Object.keys(obj.properties)).toContain('external_sources_recommended');
  }, 30000);
});
