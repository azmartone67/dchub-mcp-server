// Grok QA 2026-10-23 item 7: an anonymous site_selection_canvas returned max_months null and
// capacity_mw null (with a withheld marker) in `inputs` and `applied_filters`: the caller's own
// arguments, hidden from the caller. Withhold DC Hub's data, never the caller's inputs.
import { describe, it, expect } from 'vitest';
import { trimForTrial } from '../server.mjs';

const body = () => ({
  ok: true,
  inputs: { capacity_mw: 200, region: 'OH', max_months: 24, verdicts: ['AVOID', 'CAUTION'], limit: 10 },
  applied_filters: { region: 'OH', verdicts: ['AVOID', 'CAUTION'], max_months: 24 },
  shortlist: [{ market: 'columbus', time_to_power_months: 60, excess_power_score: 71 }],
});

describe('site_selection_canvas echo', () => {
  it('keyless trim echoes the caller\'s own inputs and applied_filters byte-identically', () => {
    const t = trimForTrial(body(), 'site_selection_canvas');
    expect(t.inputs).toEqual(body().inputs);
    expect(t.applied_filters).toEqual(body().applied_filters);
    expect(JSON.stringify(t)).not.toMatch(/_max_months_(in_pro|withheld)|_capacity_mw_(in_pro|withheld)/);
  });

  it('still withholds DC Hub data in the same answer (the shortlist figures)', () => {
    const t = trimForTrial(body(), 'site_selection_canvas');
    expect(t.shortlist[0].excess_power_score).toBeNull();
  });

  it('is scoped to this tool: another tool\'s inputs block is trimmed as before', () => {
    const t = trimForTrial({ inputs: { capacity_mw: 200 } }, 'find_sites');
    expect(t.inputs.capacity_mw).toBeNull();
  });
});
