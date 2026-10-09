// Grok 10-08 item 1: a hard wall (error pro_required, _wall true) returns no data, so its
// provenance must say "walled", not "unknown".
import { describe, it, expect } from 'vitest';
import { buildProvenance } from '../lib/attribution.mjs';

const wall = { ok: true, error: 'pro_required', _gated: true, _wall: true, required_plan: 'pro', message: 'Pro only' };

describe('hard wall provenance', () => {
  it('anonymous hard wall is walled, not unknown', () => {
    expect(buildProvenance(wall, { tier: 'anonymous', toolName: 'analyze_site' }).completeness).toBe('walled');
  });
  it('a gated payload that is not a hard wall keeps its old reading', () => {
    const p = buildProvenance({ rows: [], _gated: true }, { tier: 'anonymous', toolName: 'x' });
    expect(p.completeness).not.toBe('walled');
  });
});
