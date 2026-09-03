// continuation.test.mjs — the structured continuation object and the content of
// the ONE human line. (r-continuation, 2026-09-03)
//
// The line's PLACEMENT has been measured in both positions and is not the
// variable (5,704 signals -> 1 open -> 0 paid, r-data-first 2026-08-26). Its
// CONTENT has never been varied, and shipped carrying no information at all.
// These tests pin the two properties that make the new content worth shipping:
//
//   1. it never states a quantity the gate did not measure, and
//   2. it returns null — keeping the proven generic copy — rather than emit a
//      dressed-up absence.
//
// Both are must-fail-able: delete the guard in cleanFields and `invented field`
// goes red; make describeLocked fall back to a default count and `null when the
// gate knew nothing` goes red.
import { describe, it, expect } from 'vitest';
import {
  buildContinuation, buildContinueUrl, describeLocked,
  continuationHumanText, cleanFields, extractLockedFromPayload,
} from '../lib/continuation.mjs';

const FULL = { shown: 5, total: 47, field: 'grid_capacity',
               fields: ['interconnection_queue', 'fiber_routes', 'site_score'] };

describe('continuationHumanText — the content half of the human line', () => {
  it('leads with what the human ALREADY got, then the offer', () => {
    const line = continuationHumanText(FULL);
    expect(line).toMatch(/^your agent got 5 of 47/);
    expect(line.indexOf('got 5 of 47')).toBeLessThan(line.indexOf('paid layer'));
  });

  it('carries the numbers that make it worth repeating verbatim', () => {
    const line = continuationHumanText(FULL);
    expect(line).toContain('47');
    expect(line).toContain('the other 42');
    expect(line).toContain('grid_capacity');
  });

  it('does not name the field twice in one sentence', () => {
    const line = continuationHumanText({ shown: 5, total: 47, field: 'grid_capacity' });
    expect(line.match(/grid_capacity/g)).toHaveLength(1);
  });

  it('agrees in number when exactly one row is locked', () => {
    // "the other 1 rows" is the tell that a template is writing the sentence.
    const line = continuationHumanText({ shown: 11, total: 12, field: 'queue_position' });
    expect(line).toContain('the other 1 row');
    expect(line).not.toContain('1 rows');
  });

  it('★ returns null when the gate knew nothing — caller keeps the generic copy', () => {
    expect(continuationHumanText({})).toBeNull();
    expect(continuationHumanText({ shown: 5 })).toBeNull();          // no total ⇒ no ratio
    expect(continuationHumanText({ fields: [] })).toBeNull();
  });

  it('★ invents nothing from a partial gate: fields but no count ⇒ no count', () => {
    const line = continuationHumanText({ fields: ['gas_economics'] });
    expect(line).toContain('gas_economics');
    expect(line).not.toMatch(/\d/);
  });

  it('does not claim a remainder when shown >= total', () => {
    const line = continuationHumanText({ shown: 47, total: 47, field: 'grid_capacity' });
    expect(line).not.toContain('the other');
  });
});

describe('cleanFields — a field name reaches a human sentence only if it is one', () => {
  it('★ drops injected, empty and over-long names, keeps identifiers, dedupes', () => {
    expect(cleanFields(['ok_field', '<script>', '', 'x'.repeat(41), 'ok_field', 'a.b-c']))
      .toEqual(['ok_field', 'a.b-c']);
  });
  it('survives a non-array', () => {
    expect(cleanFields(null)).toEqual([]);
    expect(cleanFields('grid_capacity')).toEqual([]);
  });
});

describe('buildContinuation — the machine-readable half', () => {
  it('reports what continuing returns, not that the caller was refused', () => {
    const c = buildContinuation({ tool: 'get_grid_intelligence', tier: 'free', ...FULL });
    expect(c.status).toBe('upgrade_required');
    expect(c.answer_available).toBe(true);          // half the answer already shipped
    expect(c.gated.records_available).toBe(47);
    expect(c.gated.records_shown).toBe(5);
    expect(c.gated.fields_unlocked).toContain('fiber_routes');
  });

  it('★ omits every quantity the gate did not measure — absent, never zero', () => {
    const c = buildContinuation({ tool: 'get_fiber_intel' });
    expect(c.gated).toEqual({ tool: 'get_fiber_intel' });
    expect(c.gated).not.toHaveProperty('records_available');
    expect(c.specificity).toBe('generic');
  });

  it('★ never emits estimated_tool_calls_saved — nothing here can source it', () => {
    // The planner's estimated_calls is what a DC Hub plan COSTS, not a count of
    // avoided external retrievals. Publishing one under the other's name is the
    // failure this repo writes guards about.
    const json = JSON.stringify(buildContinuation({ tool: 'get_grid_intelligence', ...FULL }));
    expect(json).not.toContain('calls_saved');
    expect(json).not.toContain('tool_calls_saved');
  });

  it('labels quantified vs generic so the funnel can count them apart', () => {
    expect(buildContinuation({ tool: 't', ...FULL }).specificity).toBe('quantified');
    expect(buildContinuation({ tool: 't', fields: ['a'] }).specificity).toBe('quantified');
    expect(buildContinuation({ tool: 't' }).specificity).toBe('generic');
  });

  it('offers the agent an autonomous path, not only a human one', () => {
    const types = buildContinuation({ tool: 't', humanUrl: 'https://dchub.cloud/relay/x' })
      .continuations.map((a) => a.type);
    expect(types).toContain('human_authorization');
    expect(types).toContain('agent_autonomous');
  });

  it('refuses to build without a real tool name', () => {
    expect(buildContinuation({})).toBeNull();
    expect(buildContinuation({ tool: '<img src=x>' })).toBeNull();
  });
});

describe('buildContinueUrl — the link into the /continue renderer', () => {
  it('sends only params that page documents, and no markdown', () => {
    const u = buildContinueUrl({ tool: 'get_grid_intelligence', agent: 'Claude', ...FULL });
    const q = new URL(u).searchParams;
    expect(q.get('tool')).toBe('get_grid_intelligence');
    expect(q.get('records')).toBe('47');
    expect(q.get('agent')).toBe('Claude');
    // ★ /continue renders params with textContent, so a backtick is drawn as a
    // backtick. The prose form keeps them; the URL form must not.
    expect(q.get('need')).not.toContain('`');
    for (const k of q.keys()) {
      expect(['tool', 'records', 'fields', 'agent', 'need']).toContain(k);
    }
  });

  it('drops an agent string that is not one, rather than passing it through', () => {
    const q = new URL(buildContinueUrl({ tool: 't', agent: '<svg onload=1>' })).searchParams;
    expect(q.has('agent')).toBe(false);
  });

  it('returns null without a tool', () => {
    expect(buildContinueUrl({})).toBeNull();
  });
});

// ── r-continuation-coverage (2026-09-03) ────────────────────────────────────
//
// trimForTrial writes TWO honest markers, and the first cut read only one.
// `_<field>_total_in_pro` rides a SLICED ARRAY; `_<field>_in_pro: true` rides a
// field masked outright (grid headroom, time-to-power).
//
// get_grid_intelligence is the most-gated tool on the platform and returns
// scalars, not long arrays — so it carries the second marker and almost never
// the first. Reading only counts meant the highest-volume gated tool fell to the
// generic line on nearly every call, and the quantified/generic experiment would
// have under-sampled precisely the traffic it exists to measure.
describe('extractLockedFromPayload — both of trimForTrial\'s markers', () => {
  it('★ reads masked-field markers when there is no sliced array at all', () => {
    // The get_grid_intelligence shape: scalars, two fields masked to null with a
    // purpose-built boolean beside each.
    const grid = { demand_mw: 19297, iso: 'PJM',
                   headroom_mw: null, _headroom_mw_in_pro: true,
                   time_to_power_months: null, _time_to_power_months_in_pro: true };
    const l = extractLockedFromPayload(grid);
    expect(l).toBeTruthy();
    expect(l.fields).toEqual(['headroom_mw', 'time_to_power_months']);
    expect(l.total).toBeUndefined();                      // no count was measured
    expect(continuationHumanText(l)).toContain('headroom_mw');
    expect(continuationHumanText(l)).not.toMatch(/\d/);   // and none is invented
  });

  it('reads both markers together without double-counting the count field', () => {
    const l = extractLockedFromPayload({
      results: [1], _results_total_in_pro: 23, _headroom_mw_in_pro: true });
    expect(l.field).toBe('results');
    expect(l.total).toBe(23);
    expect(l.fields).toEqual(['headroom_mw']);            // NOT 'results_total'
  });

  it('★ ignores a bare null — only the purpose-built boolean counts', () => {
    // A metric masked to null has more than one cause; naming it as withheld
    // would be the confident-wrong claim this module refuses to make.
    expect(extractLockedFromPayload({ ok: true, headroom_mw: null })).toBeNull();
    expect(extractLockedFromPayload({ ok: true, _headroom_mw_in_pro: false })).toBeNull();
  });

  it('still returns null when the payload carries no marker of either kind', () => {
    expect(extractLockedFromPayload({ ok: true, demand_mw: 5 })).toBeNull();
  });
});
