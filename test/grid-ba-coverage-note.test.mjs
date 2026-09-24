// grid-ba-coverage-note.test.mjs — r-ba-coverage-note (2026-09-24)
//
// A Grok run read DUK's null DCPI scores as "DUK is not covered" and proposed
// pointing agents at get_interconnection_queue for SERC. That tool refuses
// iso=SERC (7 ISOs only), so the hint would have been a dead end. A non-ISO balancing
// authority with live EIA data and no DCPI row now carries a coverage_note that
// says what is covered, what is not, and one tool that works there.
//
// Deterministic, no network.
import { describe, it, expect } from 'vitest';
import { shapeGridIntelligence, _baCoverageNote } from '../server.mjs';

const liveGi = {
  demand_mw: 12504, demand_period: '2026-09-24T15',
  generation_mix: { NUC: 6060, NG: 2950, COL: 2830 }, generation_mix_period: '2026-09-24T03',
};

describe('coverage_note on a non-ISO balancing authority', () => {
  it('DUK with live EIA data and no DCPI row names what is and is not covered', () => {
    const out = shapeGridIntelligence('DUK', liveGi, null, null);
    expect(out._warning_dcpi).toContain('DUK');
    expect(out.coverage_note).toBe(_baCoverageNote('DUK'));
    expect(out.coverage_note).toContain('EIA-930 demand and fuel mix');
    expect(out.coverage_note).toContain('analyze_site');
    // Never sends the agent to a tool that refuses this region.
    expect(out.coverage_note).not.toMatch(/get_interconnection_queue (for|with) (SERC|DUK)/);
  });

  it('control: an ISO without a DCPI row gets no BA note', () => {
    for (const iso of ['PJM', 'ERCOT', 'ISONE', 'ISO-NE']) {
      expect(shapeGridIntelligence(iso, liveGi, null, null).coverage_note).toBeUndefined();
    }
  });

  it('control: no live feed → the existing unsupported-region warning, no note', () => {
    const out = shapeGridIntelligence('XYZ', { error: 'no data' }, null, null);
    expect(out._warning).toMatch(/No live feed/);
    expect(out.coverage_note).toBeUndefined();
  });
});
