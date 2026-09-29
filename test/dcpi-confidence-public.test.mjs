// r-dcpi-confidence (2026-09-28) — the DCPI confidence + provenance blocks
// pass every free-tier trim intact, and the market_summary projection keeps
// them. The blocks rate the INPUTS behind a score and carry no score figure;
// the backend stamps them after its own masking for every tier.
import { describe, it, expect } from 'vitest';
import { trimForTrial, buildDepthTease, _isMetricKey, _applyProjection, _resolveProjection } from '../server.mjs';

const conf = () => ({
  level: 'medium', value: 0.75, reason: null,
  basis: {
    live_layers: 3, layer_max: 3, live_inputs: 4, input_count: 8,
    live_layer_names: ['grid telemetry', 'interconnection queue', 'planned generators'],
    silent_layer_names: [], iso_default_matched: true, freshness: 'fresh_24h',
  },
  evaluated_at: '2026-09-28T12:00:00+00:00',
});
const prov = () => ({
  score: 'modeled', input_basis: 'mixed',
  live_inputs: ['interconnection queue depth', 'interconnection queue wait',
    'planned generation additions (next 12 months)', 'reserve margin'],
  modeled_inputs: ['behind-the-meter headroom', 'demand growth',
    'queue approval rate', 'renewable curtailment'],
  broker_inputs: [], live_sources: ['grid telemetry', 'interconnection queue', 'planned generators'],
  modeled_source: 'DC Hub analyst estimate; not a per-market measurement',
  blended_inputs: ['reserve margin: modeled planning reserve adjusted by live grid telemetry'],
  structural_zero_inputs: ['grid emergencies (last 30 days)', 'stranded capacity'],
  as_of: '2026-09-28T10:00:00+00:00', method_version: '2.1.1', inputs_reason: null,
});
const scoreRow = () => ({
  market_slug: 'dallas', verdict: 'CAUTION', excess_power_score: 65.8,
  composite_score: 49.3, dcpi_confidence: conf(), dcpi_provenance: prov(),
});
const rankBody = () => ({
  criteria: 'ai_ready',
  results: [1, 2, 3, 4, 5].map((i) => ({ rank: i, market: `m${i}`, score: 80 - i,
    dcpi_verdict: 'BUILD', dcpi_confidence: conf(), dcpi_provenance: prov() })),
});

describe('dcpi_confidence / dcpi_provenance survive the free-tier trims', () => {
  it('CONTROL: without the exemption these shapes WOULD be cut', () => {
    // Guards against a vacuous pass: the same keys under another name are trimmed.
    expect(_isMetricKey('input_count')).toBe(true);
    const t = trimForTrial({ other: conf(), other2: prov() }, 'get_market_dcpi_rank');
    expect(t.other.basis.input_count).toBeNull();
    expect(t.other2.modeled_inputs.length).toBeLessThan(4);
  });

  it('get_market_dcpi_rank anon trim: both blocks byte-identical, score still gated', () => {
    const t = trimForTrial(scoreRow(), 'get_market_dcpi_rank');
    expect(t.dcpi_confidence).toEqual(conf());
    expect(t.dcpi_provenance).toEqual(prov());
    expect(t.excess_power_score).toBeNull();
    expect(t.composite_score).toBeNull();
  });

  it('rank_markets anon trim: every kept row keeps both blocks', () => {
    const t = trimForTrial(rankBody(), 'rank_markets');
    expect(t.results.length).toBeGreaterThan(0);
    for (const r of t.results) {
      expect(r.dcpi_confidence).toEqual(conf());
      expect(r.dcpi_provenance).toEqual(prov());
    }
  });

  it('depth tease (keyed free): blocks byte-identical', async () => {
    const result = { content: [{ type: 'text', text: JSON.stringify(scoreRow()) }] };
    const out = await buildDepthTease('get_market_dcpi_rank', result, {}, 'free');
    const text = out?.content?.find((c) => c.text && c.text.includes('dcpi_provenance'))?.text
      ?? JSON.stringify(out?.structuredContent ?? out);
    expect(text).toContain('"input_count":8');
    expect(text).toContain('"renewable curtailment"');
  });

  it('market_summary projection keeps both blocks', () => {
    const out = _applyProjection(rankBody(), _resolveProjection(undefined, 'market_summary'));
    for (const r of out.results) {
      expect(r.dcpi_confidence).toEqual(conf());
      expect(r.dcpi_provenance).toEqual(prov());
    }
  });
});
