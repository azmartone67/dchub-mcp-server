// Unit tests for the MCP gating primitives — the revenue-critical, pure logic
// that has regressed repeatedly (the "2/22 grids" over-redaction, trial-preview
// incidents). Imported directly from server.mjs (which skips app.listen under
// VITEST). No network, no prod dependency.
import { describe, it, expect } from 'vitest';
import {
  trimForTrial, applyTierGate, FREE_FULL_TOOLS, PAID_ONLY_TOOLS, _isMetricKey,
  shapeGridIntelligence, _anonInlineFullEnabled,
} from '../server.mjs';

describe('_anonInlineFullEnabled — DCHUB_ANON_INLINE_FULL A/B toggle', () => {
  it('defaults ON when unset/null/empty (preserve current behavior)', () => {
    expect(_anonInlineFullEnabled(undefined)).toBe(true);
    expect(_anonInlineFullEnabled(null)).toBe(true);
    expect(_anonInlineFullEnabled('')).toBe(true);
    expect(_anonInlineFullEnabled('on')).toBe(true);
  });
  it('is OFF only on an explicit "off" (case/space-insensitive)', () => {
    expect(_anonInlineFullEnabled('off')).toBe(false);
    expect(_anonInlineFullEnabled('OFF')).toBe(false);
    expect(_anonInlineFullEnabled('  Off  ')).toBe(false);
  });
  it('any other value stays ON (fail-safe to current behavior)', () => {
    expect(_anonInlineFullEnabled('true')).toBe(true);
    expect(_anonInlineFullEnabled('1')).toBe(true);
    expect(_anonInlineFullEnabled('disabled')).toBe(true);
  });
});

describe('trimForTrial — anonymous redaction (clean-data contract, 2026-06-07)', () => {
  // De-spam (Devin QA): gating must NOT pollute the data with promo strings —
  // arrays trim to the first row only (+ an honest side count), gated metrics
  // become null. The upgrade CTA lives once in the nudge header, not in the data.
  it('truncates arrays >1 to ONLY the first item + an honest side count (no inline promo)', () => {
    const out = trimForTrial({ grids: [{ iso: 'PJM' }, { iso: 'ERCOT' }, { iso: 'CAISO' }] });
    expect(Array.isArray(out.grids)).toBe(true);
    expect(out.grids).toHaveLength(1);
    expect(out.grids[0]).toEqual({ iso: 'PJM' });
    expect(out._grids_total_in_pro).toBe(3);
  });

  it('leaves a single-element array intact but NULLS metric scalars inside (no promo string)', () => {
    const out = trimForTrial({ rows: [{ iso: 'PJM', count: 5 }] });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].iso).toBe('PJM');
    expect(out.rows[0].count).toBe(null);
  });

  it('nulls aggregate metric scalars but keeps identifier fields', () => {
    const out = trimForTrial({
      count: 42, total_mw: 1000, gas_share_pct: 33.3,
      name: 'Northern Virginia', slug: 'northern-virginia', state: 'VA', iso: 'PJM',
    });
    expect(out.count).toBe(null);
    expect(out.total_mw).toBe(null);
    expect(out.gas_share_pct).toBe(null);
    expect(out.name).toBe('Northern Virginia');
    expect(out.slug).toBe('northern-virginia');
    expect(out.state).toBe('VA');
    expect(out.iso).toBe('PJM');
  });

  it('recurses into nested objects (stats:{...}) and nulls their metrics', () => {
    const out = trimForTrial({ stats: { total_mw: 999, region: 'east' } });
    expect(out.stats.total_mw).toBe(null);
    expect(out.stats.region).toBe('east');
  });

  it('passes through null / primitives unchanged', () => {
    expect(trimForTrial(null)).toBe(null);
    expect(trimForTrial(5)).toBe(5);
    expect(trimForTrial('hello')).toBe('hello');
  });
});

describe('_isMetricKey', () => {
  it('flags aggregate metric names', () => {
    for (const k of ['count', 'total_mw', 'gas_share_pct', 'renewable_rate', 'score', 'capacity', 'revenue', 'unique_callers'])
      expect(_isMetricKey(k), k).toBe(true);
  });
  it('does not flag identifier / descriptive keys', () => {
    for (const k of ['name', 'slug', 'iso', 'city', 'state', 'title', 'source', 'status'])
      expect(_isMetricKey(k), k).toBe(false);
  });
});

describe('applyTierGate — tier access', () => {
  it('paid + enterprise bypass all gating', () => {
    expect(applyTierGate('get_grid_intelligence', {}, 'paid', false, false).allowed).toBe(true);
    expect(applyTierGate('analyze_site', {}, 'enterprise', false, false).allowed).toBe(true);
  });
  it('blocks PAID_ONLY tools for anonymous free callers', () => {
    expect(applyTierGate('get_grid_intelligence', {}, 'free', false, false).allowed).toBe(false);
    expect(applyTierGate('analyze_site', {}, 'free', false, false).allowed).toBe(false);
  });
  it('allows free (non-paid) tools for anonymous callers', () => {
    expect(applyTierGate('get_grid_scoreboard', {}, 'free', false, false).allowed).toBe(true);
    expect(applyTierGate('get_news', {}, 'free', false, false).allowed).toBe(true);
  });
  it('keyed-free bonus unlocks the demand tools with an api key', () => {
    // Use a bonus-ONLY tool: get_market_intel is also in ALWAYS_PARTIAL_PREVIEW,
    // whose branch runs first (r-tease-wow → trial_taste), so it no longer reaches
    // the bonus path. get_grid_data is purely KEYED_FREE_BONUS.
    const g = applyTierGate('get_grid_data', {}, 'free', true, false);
    expect(g.allowed).toBe(true);
    expect(g.bonus).toBe(true);
  });
  it('keyed-free market_intel routes through the always-preview taste (r-tease-wow)', () => {
    const g = applyTierGate('get_market_intel', {}, 'free', true, false);
    expect(g.allowed).toBe(true);
    expect(g.trial_taste).toBe(true);
  });
  it('a validated trial unlocks the always-preview Pro tools as a taste', () => {
    const g = applyTierGate('get_grid_intelligence', {}, 'free', false, true);
    expect(g.allowed).toBe(true);
    expect(g.trial_taste).toBe(true);
  });
});

describe('FREE_FULL_TOOLS — flagship hook exemption (regression guard: 2/22 grids)', () => {
  it('get_grid_scoreboard is a free-full hook (must stay exempt from the anon trim)', () => {
    expect(FREE_FULL_TOOLS.has('get_grid_scoreboard')).toBe(true);
  });
  it('a Pro tool is NOT a free-full hook', () => {
    expect(FREE_FULL_TOOLS.has('get_grid_intelligence')).toBe(false);
    expect(PAID_ONLY_TOOLS.has('get_grid_intelligence')).toBe(true);
  });
  it('cluster_sites_by_latency is a free-full hook (r-cluster-open: anon gets ALL pairs, not 1-of-N)', () => {
    expect(FREE_FULL_TOOLS.has('cluster_sites_by_latency')).toBe(true);
    expect(PAID_ONLY_TOOLS.has('cluster_sites_by_latency')).toBe(false);
  });
});

describe('shapeGridIntelligence — non-empty per-ISO payload (regression guard: 2026-06-12 empty {freshness,citation})', () => {
  // The prior handler hit a lat/lon substation endpoint that returned a default
  // Colorado location for EVERY ISO and set NO structuredContent, so a keyed
  // enterprise caller got only the {freshness,citation} wrappers. This locks the
  // contract: given the three real feed shapes, the assembled object carries the
  // documented DATA fields (demand, fuel mix, DCPI scores, queue depth).
  const GI = {
    region: 'PJM', demand_mw: '133137', demand_period: '2026-06-13T00',
    generation_mix: {
      NG:  { mw: '58668' }, NUC: { mw: '32800' }, COL: { mw: '21826' },
      WND: { mw: '6854' },  SUN: { mw: '12' },    WAT: { mw: '2296' }, OTH: { mw: '4455' },
    },
  };
  const CMP = { isos: [
    { iso: 'PJM', iso_name: 'PJM Interconnection (mid-Atlantic + Ohio Valley)',
      avg_constraint: 55.4, avg_excess: 18.7, avg_queue_wait_months: 47.8,
      avg_curtailment_pct: 1.2, avg_reserve_margin_pct: 14.4, avg_kwh_cents: 14.12,
      total_stranded_capacity_mw: 1200.0, sum_emergency_30d: 0,
      market_count: 71, build_count: 1, latest_computed_at: '2026-06-13T01:25:38Z' },
    { iso: 'ERCOT', iso_name: 'ERCOT', avg_constraint: 40, market_count: 20, build_count: 1 },
  ] };
  const QSNAP = { by_iso: [
    { iso: 'ERCOT', queued_load_total_gw: 426.9, queued_load_dc_share_pct: 0.0, as_of: '2026-06-12' },
    { iso: 'PJM',   queued_load_total_gw: 172.6, queued_load_dc_share_pct: 3.4, as_of: '2026-06-12' },
  ] };

  it('assembles the documented data fields for a (keyed) PJM call — not an empty wrapper', () => {
    const out = shapeGridIntelligence('PJM', GI, CMP, QSNAP);
    // identity + live grid feed
    expect(out.iso).toBe('PJM');
    expect(out.iso_name).toMatch(/PJM/);
    expect(out.demand_mw).toBe(133137);
    expect(out.generation_mix_pct.NG).toBeCloseTo(46.2, 1); // 58668/127256
    expect(out.gas_share_pct).toBeCloseTo(46.2, 1);
    expect(out.renewable_share_pct).toBeCloseTo(7.2, 1);    // (6854+12+2296)/127256
    // DCPI Power Index row
    expect(out.constraint_score).toBe(55.4);
    expect(out.excess_power_score).toBe(18.7);
    expect(out.avg_time_to_power_months).toBe(47.8);
    expect(out.build_rate_pct).toBeCloseTo(1.4, 1);          // 1/71
    // live interconnection queue (matched to the RIGHT iso, not the first row)
    expect(out.queue_depth_gw).toBe(172.6);
    expect(out.data_center_share_pct).toBe(3.4);
    // ed328ee (honest freshness): last_updated now reflects the EIA telemetry
    // hour; the DCPI compute time moved to its own dcpi_computed_at field.
    expect(out.dcpi_computed_at).toBe('2026-06-13T01:25:38Z');
    expect(out.last_updated).toBe('2026-06-13T00:00:00Z');
    // the bug contract: at least the core data fields are non-null
    expect(out._warning).toBeUndefined();
    const nonNull = ['demand_mw', 'generation_mix_pct', 'constraint_score', 'queue_depth_gw']
      .filter((k) => out[k] != null);
    expect(nonNull).toHaveLength(4);
  });

  it('normalizes ISO-NE -> ISONE / HYDROQUEBEC -> HQ when matching the DCPI row', () => {
    const cmp = { isos: [{ iso: 'ISONE', iso_name: 'ISO New England', avg_constraint: 33 }] };
    const out = shapeGridIntelligence('ISO-NE', { error: 'API 404' }, cmp, { by_iso: [] });
    expect(out.iso).toBe('ISO-NE');
    expect(out.constraint_score).toBe(33);          // matched despite the hyphen
    expect(out._warning_grid).toMatch(/unavailable/); // grid feed down, scores still shown
  });

  it('emits a single _warning (not garbage) when every feed is empty for an unknown region', () => {
    const out = shapeGridIntelligence('ZZZ', { error: 'API 404' }, { isos: [] }, { by_iso: [] });
    expect(out.iso).toBe('ZZZ');
    expect(out.demand_mw).toBe(null);
    expect(out.constraint_score).toBe(null);
    expect(out._warning).toMatch(/No live feed/);
  });
});
