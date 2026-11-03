import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _resolutionGap, _CITY_ISO_META } from '../server.mjs';

// Grok #117536 (2026-11-03): "in Southern Nevada" bound no geography, so
// execute_plan answered unscoped (H3b) instead of scoping to Las Vegas.
describe('regional Nevada names bind to their metro', () => {
  it.each([
    ['find 75-100 MW of buildable land with power in Southern Nevada', 'las-vegas-nv'],
    ['grid headroom in northern nevada', 'reno-nv'],
  ])('%s', (intent, slug) => {
    const s = _planSignals(intent, {});
    expect(s.isoFromPlace).toBe('WECC');
    const p = _planQuery(intent, {});
    expect(_resolutionGap(intent, s, p.intent_class)).toBeNull();
    expect(Object.values(_CITY_ISO_META).some((m) => m.slug === slug)).toBe(true);
  });
});
