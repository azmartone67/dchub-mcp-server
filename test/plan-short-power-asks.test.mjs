// Planner 5.23 (Grok QA relay 2026-11-13, Gemini cold start): a short power ask
// ("Texas 50 MW power") is a power question, and execute_plan's answer is never undated.
//
// Live before (planner 5.22, keyless, 2026-11-13 18:11Z): execute_plan(intent="Texas 50 MW power")
// returned intent_class "unknown", ran only discover_tools, and provenance.as_of was null.
import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { stampEnvelopeAttribution } from '../lib/attribution.mjs';
import { dataAsOfDay } from '../lib/source-line.mjs';

const POWER_ASKS = ['Texas 50 MW power', 'power in Texas for 50 MW', '50MW Texas power'];

describe('short power asks route to grid_headroom (planner 5.23)', () => {
  for (const q of POWER_ASKS) {
    it(`"${q}" -> grid_headroom: Texas power timeline + a 50 MW Texas queue read`, () => {
      const p = _planQuery(q, {});
      expect(p.intent_class).toBe('grid_headroom');
      const tools = p.recommended_sequence.map((s) => s.tool);
      expect(tools).not.toContain('search_facilities');
      expect(tools).not.toContain('discover_tools');
      const byTool = Object.fromEntries(p.recommended_sequence.map((s) => [s.tool, s]));
      expect(byTool.get_power_availability_timeline.args_hint).toEqual({ state: 'TX' });
      expect(byTool.get_refined_queue.args_hint).toMatchObject({ state: 'TX', min_mw: 50 });
    });
  }

  it('"Texas power 50 MW data center" is a power plan too (capacity_search, with the Texas timeline)', () => {
    const p = _planQuery('Texas power 50 MW data center', {});
    expect(p.intent_class).toBe('capacity_search');
    const tools = p.recommended_sequence.map((s) => s.tool);
    expect(tools).toContain('get_power_availability_timeline');
    expect(tools).not.toContain('search_facilities');
  });

  it('an ISO-named ask keeps the ERCOT reads', () => {
    const p = _planQuery('ERCOT 50 MW power', {});
    expect(p.intent_class).toBe('grid_headroom');
    expect(p.recommended_sequence[0]).toMatchObject({ tool: 'get_grid_intelligence', args_hint: { iso: 'ERCOT' } });
  });

  it('"power plant(s)" beside a MW figure is not a power-supply ask', () => {
    const p = _planQuery('power plants over 50 MW in Texas', {});
    expect((p.matched_classes || []).map((m) => m.class)).not.toContain('grid_headroom');
  });

  it('a utility named Power keeps the 11-11 Atlanta routing (capacity_search wins the tie)', () => {
    expect(_planQuery('Georgia Power 200MW data center Atlanta GA', {}).intent_class).toBe('capacity_search');
  });

  it('facility searches still route to facility_search', () => {
    const a = _planQuery('data centers in Texas over 50 MW', {});
    expect(a.intent_class).toBe('facility_search');
    expect(a.recommended_sequence[0].tool).toBe('search_facilities');
    const b = _planQuery('who operates in Dallas', {});
    expect(b.intent_class).toBe('facility_search');
    expect(b.recommended_sequence[0].tool).toBe('search_facilities');
  });

  it('planner_version moved with the routing change', () => {
    expect(PLANNER_VERSION).toBe('5.26');
  });
});

// One JSON text block, as the /mcp pipeline sees it before stamping.
const asResult = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], structuredContent: o });
const NOW = Date.parse('2026-11-13T18:11:01.885Z');

describe('execute_plan provenance.as_of is never null', () => {
  it('no dated step: as_of is the run time, labelled generated_at, and the evidence date stays null', () => {
    const env = { _entity: 'plan_execution', ok: true, intent: 'Texas 50 MW power', intent_class: 'unknown',
      executed: [{ step: 1, tool: 'discover_tools', status: 'executed', result: { ok: true, count: 3 } }] };
    const out = stampEnvelopeAttribution(asResult(env), { toolName: 'execute_plan', tier: 'anonymous', now: NOW });
    for (const o of [out.structuredContent, JSON.parse(out.content[0].text)]) {
      expect(o.provenance.as_of).toBe('2026-11-13T18:11:01.885Z');
      expect(o.provenance.as_of_kind).toBe('generated_at');
      expect(o.provenance.as_of_basis).toMatch(/^generated_at: /);
      expect(o.citation.cite_as).toContain('(plan run 2026-11-13; no source date stated)');
      expect(o.citation.as_of).toBe('2026-11-13T18:11:01.885Z');
      if (o.provenance.evidence) {
        expect(o.provenance.evidence.evidence_as_of).toBeNull();
        expect(o.provenance.evidence.limitations.map((l) => l.code)).toContain('as_of_is_run_time');
      }
      // The Source line never prints the run time as a data date.
      expect(dataAsOfDay(o)).toBeNull();
    }
  });

  it('a dated step keeps the source date (oldest), not the run time', () => {
    const env = { _entity: 'plan_execution', ok: true, intent: 'Texas power headroom', intent_class: 'grid_headroom',
      executed: [{ step: 1, tool: 'get_power_availability_timeline', status: 'executed',
        result: { ok: true, as_of: '2026-10-31T00:00:00Z', rows: [] } }] };
    const out = stampEnvelopeAttribution(asResult(env), { toolName: 'execute_plan', tier: 'anonymous', now: NOW });
    expect(String(out.structuredContent.provenance.as_of)).toMatch(/^2026-10-31T00:00:00/);
    expect(out.structuredContent.provenance.as_of_kind).toBeUndefined();
  });

  it('an execute_plan wall ran no plan, so it keeps the null', () => {
    const wall = { _entity: 'execute_plan', error: 'anon_hard_wall', tool: 'execute_plan' };
    const out = stampEnvelopeAttribution(asResult(wall), { toolName: 'execute_plan', now: NOW });
    expect(out.structuredContent.provenance.as_of).toBeNull();
    expect(out.structuredContent.provenance.as_of_kind).toBeUndefined();
  });

  it('other tools keep the honest null (the fallback is execute_plan only)', () => {
    const out = stampEnvelopeAttribution(asResult({ ok: true, count: 3 }), { toolName: 'discover_tools', now: NOW });
    expect(out.structuredContent.provenance.as_of).toBeNull();
  });
});
