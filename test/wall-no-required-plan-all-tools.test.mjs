// Owner 2026-10-14: every agent wall / gated preview / locked view drops required_plan, last step.
import { describe, it, expect } from 'vitest';
import { _wallNoPlanFieldStep } from '../server.mjs';
const mk = (sc) => ({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc });
const both = (r) => [r.structuredContent, JSON.parse(r.content[0].text)];
describe('required_plan removed from every wall shape', () => {
  const cases = {
    'pro_required wall': { error: 'pro_required', _wall: true, _gated: true, required_plan: 'pro' },
    'gated preview': { _gated: true, _preview_only: true, required_plan: 'pro', tool: 'find_sites', upgrade_url: 'https://dchub.cloud/x' },
    'preview only': { _preview_only: true, required_plan: 'pro' },
  };
  for (const [k, sc] of Object.entries(cases)) {
    it(k, () => {
      const out = _wallNoPlanFieldStep(mk(sc), 'find_sites');
      for (const o of both(out)) {
        expect('required_plan' in o).toBe(false);
        for (const f of Object.keys(sc)) if (f !== 'required_plan') expect(o[f]).toEqual(sc[f]);
      }
    });
  }
  it('nested substation locked view and free-runs block', () => {
    const sc = { overall_score: null, substations: { locked: true, required_plan: 'pro', substations_in_radius: 3 },
      free_full_runs: { reason: 'free_monthly_limit_reached', required_plan: 'pro', limit: 3 },
      free_view: { locked_fields: ['name'], required_plan: 'pro', tier_required: 'pro' } };
    for (const o of both(_wallNoPlanFieldStep(mk(sc), 'analyze_site'))) {
      expect('required_plan' in o.substations).toBe(false);
      expect(o.substations.locked).toBe(true);
      expect('required_plan' in o.free_full_runs).toBe(false);
      expect('required_plan' in o.free_view).toBe(false);
      expect(o.free_view.tier_required).toBe('pro');
    }
  });
  it('a non-wall object that names required_plan is untouched', () => {
    const sc = { tier: 'free', required_plan: 'pro', plans: [] };
    expect(_wallNoPlanFieldStep(mk(sc), 'me').structuredContent.required_plan).toBe('pro');
  });
});
