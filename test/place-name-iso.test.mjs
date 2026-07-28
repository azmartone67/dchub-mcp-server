import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _CITY_ISO_META } from '../server.mjs';

const iso = (intent) => {
  const p = _planQuery(intent);
  const s = (p.recommended_sequence || [])[0] || {};
  return { tool: s.tool, args: s.args_hint || s.args || {}, plan: p };
};

describe('place name resolves to an ISO at step 1 (Mistral payload 2, 07-28)', () => {
  it('"Northern Virginia" routes like "PJM" does', () => {
    const metro = iso('show power availability in Northern Virginia');
    const named = iso('show power availability in PJM');
    expect(metro.tool).toBe(named.tool);
  });

  it.each([
    ['Northern Virginia', 'PJM'],
    ['Ashburn', 'PJM'],
    ['Dallas', 'ERCOT'],
    ['Phoenix', _CITY_ISO_META.phoenix.iso],
  ])('%s → %s', (place, want) => {
    const p = _planQuery(`how much power is available in ${place} for a 100 MW data center`);
    expect(JSON.stringify(p)).toContain(want);
  });

  it('an explicitly named ISO still wins over a place name in the same text', () => {
    // "power in ERCOT near Ashburn" is contradictory; the named operator is the
    // stronger signal and must not be overridden by the place fallback.
    const p = _planQuery('grid headroom in ERCOT');
    expect(JSON.stringify(p)).toContain('ERCOT');
    expect(JSON.stringify(p)).not.toContain('"PJM"');
  });

  it('does not fire on a word that merely CONTAINS a city name', () => {
    // word-boundary matched: "Renovation"/"Denverite" must not resolve.
    const p = _planQuery('renovation planning for a facility');
    const s = (p.recommended_sequence || [])[0] || {};
    expect(JSON.stringify(s.args_hint || {})).not.toContain('WECC');
  });

  it('leaves a geography-free intent unresolved rather than guessing', () => {
    const p = _planQuery('how much power is available');
    expect(JSON.stringify(p)).not.toContain('"iso":"PJM"');
  });
});

describe('the place fallback must NOT steal a class (regression, 07-28)', () => {
  // First cut of this fix set `iso` itself from the place name. `iso` feeds a
  // +1.5 CLASS BOOST for grid_headroom, so "…grid headroom overlap in Atlanta"
  // was stolen from fiber_power_pairing. A named OPERATOR is strong evidence of
  // a grid question; a place name is not — metros appear in fiber, site and
  // market questions equally. Hence two signals: `iso` (explicit, boosts the
  // class) and `isoFromPlace` (arguments only).
  it('a place name alone does not set the class-boosting `iso` signal', () => {
    const d = _planSignals('where do fiber density and grid headroom overlap in Atlanta', {});
    expect(d.iso).toBeFalsy();
    expect(d.isoFromPlace).toBeTruthy();
  });

  it('a named ISO sets `iso` and suppresses the place signal', () => {
    const d = _planSignals('grid headroom in ERCOT near Dallas', {});
    expect(d.iso).toBe('ERCOT');
    expect(d.isoFromPlace).toBeNull();
  });

  it('the fiber+power intent still routes to fiber_power_pairing', () => {
    const p = _planQuery('where do fiber density and grid headroom overlap in Atlanta', {});
    expect(p.intent_class).toBe('fiber_power_pairing');
  });
});
