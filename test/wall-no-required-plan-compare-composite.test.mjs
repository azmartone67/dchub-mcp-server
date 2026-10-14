// Owner 2026-10-14: compare_sites and get_composite_site_score walls carry no required_plan
// (agent walls name no plan, be#6703). _wall / error / next_tool stay the machine-readable markers.
import { describe, it, expect } from 'vitest';
import { _wallNoPlanFieldStep, _WALL_NO_PLAN_FIELD_TOOLS } from '../server.mjs';

const wall = () => {
  const sc = { error: 'pro_required', _gated: true, _wall: true, required_plan: 'pro', next_tool: 'claim_free_key',
    for_your_human: { text: 'x', url: 'https://dchub.cloud/u/abc123' } };
  return { isError: false, content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
};
describe('walls carry no required_plan', () => {
  for (const tool of ['compare_sites', 'get_composite_site_score']) {
    it(tool + ': stamped wall has no required_plan, keeps markers', () => {
      const input = wall();
      expect(input.structuredContent.required_plan).toBe('pro');   // really the wall (non-vacuous)
      const result = _wallNoPlanFieldStep(input, tool);
      const sc = result.structuredContent;
      expect(sc._wall).toBe(true);
      expect(sc.error).toBe('pro_required');
      expect(sc.next_tool).toBe('claim_free_key');
      expect('required_plan' in sc).toBe(false);
      expect(JSON.parse(result.content[0].text).required_plan).toBeUndefined();
      expect(sc.for_your_human.url).toBe('https://dchub.cloud/u/abc123');
    });
  }
  it('a full (non-wall) answer is untouched', () => {
    const r = { content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 1, required_plan: 'free' } };
    expect(_wallNoPlanFieldStep(r, 'compare_sites').structuredContent.required_plan).toBe('free');
  });
  it('other Pro-only tools lose it too (owner 2026-10-14, analyze_site and Pro walls)', () => {
    const result = _wallNoPlanFieldStep(wall(), 'analyze_site');
    expect('required_plan' in result.structuredContent).toBe(false);
    expect(result.structuredContent._wall).toBe(true);
    expect(_WALL_NO_PLAN_FIELD_TOOLS.size).toBe(2);
  });
});
