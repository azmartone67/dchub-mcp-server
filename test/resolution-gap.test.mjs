import { describe, it, expect } from 'vitest';
import { _resolutionGap, _planQuery, _planSignals, _STARTER_PACK } from '../server.mjs';

const gapFor = (intent) => {
  const p = _planQuery(intent, {});
  return (p.replay || {}).resolution_gap || null;
};

describe('H3 resolution gap — geography named but never bound', () => {
  it('H3b: a place outside the tracked index is reported as a COVERAGE gap', () => {
    const g = _resolutionGap('what is the grid headroom in Oslo',
      _planSignals('what is the grid headroom in Oslo', {}), 'grid_headroom');
    expect(g).toBeTruthy();
    expect(g.code).toBe('H3b');
    expect(g.kind).toBe('unmapped');
  });

  it('H3a: a place that IS in the index but did not bind is a PARSER defect', () => {
    // Signals deliberately empty — this is the Norway-bug state: the place was
    // named, we track it, and nothing bound.
    const g = _resolutionGap('grid headroom in Ashburn', {}, 'grid_headroom');
    expect(g.code).toBe('H3a');
    expect(g.matched).toBe('ashburn');
  });

  it('does NOT fire once geography actually binds (the Norway bug, post-fix)', () => {
    expect(gapFor('show power availability in Northern Virginia')).toBeNull();
    expect(gapFor('how much power is available in ERCOT')).toBeNull();
  });
});

describe('the assert must not cry wolf', () => {
  it('is silent on every published anchor intent', () => {
    // market_ranking legitimately answers with no geography at all, and it is
    // our single most-published intent. Firing here would drown the signal.
    for (const a of _STARTER_PACK) {
      expect(gapFor(a.intent), `fired on anchor: ${a.intent}`).toBeNull();
    }
  });

  it('ignores Tier 2 and Tier 3 classes entirely', () => {
    expect(_resolutionGap('rank markets in Oslo', {}, 'market_ranking')).toBeNull();
    expect(_resolutionGap('what changed in Oslo', {}, 'changes_delta')).toBeNull();
  });

  it('does not read time or quantity objects as places', () => {
    for (const t of ['power available in 90 days', 'capacity in 200 MW blocks',
                     'headroom in the next 12 months']) {
      expect(_resolutionGap(t, {}, 'grid_headroom'), `fired on: ${t}`).toBeNull();
    }
  });

  it('fails closed when signals are unavailable', () => {
    // Without signals we cannot know whether geography bound. Guessing would
    // report gaps that may not exist.
    expect(_resolutionGap('grid headroom in Ashburn', null, 'grid_headroom')).toBeNull();
    expect(_resolutionGap('grid headroom in Ashburn', undefined, 'grid_headroom')).toBeNull();
  });

  it('never throws on malformed input', () => {
    expect(() => _resolutionGap(null, {}, 'grid_headroom')).not.toThrow();
    expect(() => _resolutionGap('x', {}, null)).not.toThrow();
  });

  it('omits the field entirely when there is nothing to report', () => {
    const p = _planQuery('rank markets for a 200 MW AI campus', {});
    expect('resolution_gap' in (p.replay || {})).toBe(false);
  });
});
