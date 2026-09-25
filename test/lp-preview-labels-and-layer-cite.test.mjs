// ── Live verify 2026-09-25 (Grok, free key) ──────────────────────────────
//
// 1. analyze_site's preview nulled methodology_version ("composite-v2.4") and
//    every basis label, and get_composite_site_score's first caveat, because
//    the Land & Power preview nulls ANY string carrying a digit unless its key
//    is on a short keep-list; caveats were also cut to three with no marker.
// 2. site_selection_canvas on a free key cited "PARTIAL preview (tier-gated;
//    not the full dataset)" over a shortlist whose rows were all there — only
//    the decision layer (and row scores) were gated.
import { describe, it, expect } from 'vitest';
import { _lpPreviewPayload } from '../server.mjs';
import { buildCitation, detectGating } from '../lib/attribution.mjs';

const SITE = {
  overall_score: 81.2, scored_factors: '4/5', methodology_version: 'composite-v2.4',
  overall_basis: 'renormalised_without:risk_resilience',
  scores: { power_infrastructure: 88.4, risk_resilience: null },
  coverage: {
    state: { value: 'VA', basis: 'census_point_in_polygon' },
    power_infrastructure: { scored: true, basis: 'measured_point:nearest_hv_substation',
      source: 'HIFLD substations (nearest >=230 kV) + substation/plant counts', as_of: '2026-09-01' },
  },
  nearest: { hv_substation: { name: 'Loudoun 500', voltage_kv: 500, km: 1.2 } },
  caveats: [
    'water: WRI Aqueduct 4.0 baseline water stress.',
    'market_dcpi: unavailable in v1 — use rank_markets.',
    'natural-hazard layer is FEMA flood + FWS habitat + NWI wetlands only.',
    'advisory only — pair with analyze_site.',
    'power scored 88.4 on the nearest substation.',
  ],
};

describe('Land & Power preview keeps labels, never figures', () => {
  const p = _lpPreviewPayload(SITE);

  it('keeps the methodology, scored_factors and every basis label', () => {
    expect(p.methodology_version).toBe('composite-v2.4');
    expect(p.scored_factors).toBe('4/5');
    expect(p.overall_basis).toBe('renormalised_without:risk_resilience');
    expect(p.coverage.power_infrastructure.basis).toBe('measured_point:nearest_hv_substation');
    expect(p.coverage.power_infrastructure.source).toMatch(/HIFLD/);
    expect(p.coverage.state.basis).toBe('census_point_in_polygon');
  });

  it('still nulls every score, distance and kV', () => {
    expect(p.overall_score).toBeNull();
    expect(p.scores.power_infrastructure).toBeNull();
    expect(p.nearest.hv_substation.km).toBeNull();
    expect(p.nearest.hv_substation.voltage_kv).toBeNull();
  });

  it('keeps every caveat (not three), with a withheld figure blanked', () => {
    expect(p.caveats).toHaveLength(5);
    expect(p.caveats[0]).toBe('water: WRI Aqueduct 4.0 baseline water stress.');
    expect(p.caveats[1]).toBe('market_dcpi: unavailable in v1 — use rank_markets.');
    expect(p.caveats[4]).toBe('power scored … on the nearest substation.');
    expect(JSON.stringify(p)).not.toContain('88.4');
    expect(JSON.stringify(p)).not.toContain('81.2');
  });

  it('other arrays are still cut to three', () => {
    expect(_lpPreviewPayload({ rows: [1, 2, 3, 4, 5].map((i) => ({ name: 'r' + i })) }).rows).toHaveLength(3);
  });
});

const ROWS = Array.from({ length: 12 }, (_, i) => ({ market: 'M' + i, verdict: 'BUILD' }));

describe('cite_as says which part is gated', () => {
  it('rows complete, decision layer locked', () => {
    const payload = { shortlist: ROWS, synthesis: { locked: true, message: 'Unlock the decision layer' } };
    expect(detectGating(payload).scope).toBe('decision_layer');
    const c = buildCitation(payload, { tier: 'free' });
    expect(c.cite_as).toMatch(/PARTIAL: every row shown; the decision layer is tier-gated/);
    expect(c.cite_as).not.toMatch(/not the full dataset/);
    expect(c.completeness).toBe('partial_preview');
  });

  it('row fields withheld as well', () => {
    const payload = { shortlist: ROWS.map((r) => ({ ...r, excess_power_score: null, _excess_power_score_in_pro: true })),
      synthesis: { locked: true } };
    expect(buildCitation(payload, { tier: 'free' }).cite_as)
      .toMatch(/every row shown; some row fields and the decision layer are tier-gated/);
  });

  it('a real shown-of-total gap keeps its own wording', () => {
    const payload = { rows: ROWS.slice(0, 1), _rows_total_in_pro: 41, synthesis: { locked: true } };
    expect(buildCitation(payload, { tier: 'free' }).cite_as).toMatch(/PARTIAL preview, 1 of 41 shown/);
  });

  it('a structural preview flag keeps the generic wording', () => {
    const payload = { rows: ROWS, preview_is_partial: true, synthesis: { locked: true } };
    expect(buildCitation(payload, { tier: 'free' }).cite_as).toMatch(/not the full dataset/);
  });

  it('a paid response with nothing locked stays unrestricted', () => {
    const c = buildCitation({ shortlist: ROWS, synthesis: { decision: 'BUILD in M0' } }, { tier: 'paid' });
    expect(c.completeness).toBe('unrestricted');
    expect(c.cite_as).not.toMatch(/PARTIAL/);
  });
});
