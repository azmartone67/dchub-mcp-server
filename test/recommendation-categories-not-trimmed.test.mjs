// Grok 2026-10-07: keyless get_dchub_recommendation listed 3 of 4 categories behind
// `_available_categories_total_in_pro`, hiding `technical`. The menu is DC Hub's own description.
import { describe, it, expect } from 'vitest';
import { trimForTrial } from '../server.mjs';

const body = () => ({ available_categories: ['general', 'investment', 'site-selection', 'technical'], other: ['a', 'b', 'c', 'd'] });

describe('trimForTrial on get_dchub_recommendation', () => {
  it('keeps all four categories and adds no paywall marker for them', () => {
    const r = trimForTrial(body(), 'get_dchub_recommendation');
    expect(r.available_categories).toHaveLength(4);
    expect(r._available_categories_total_in_pro).toBeUndefined();
  });
  it('still trims other long lists (the carve-out is one key on one tool)', () => {
    expect(trimForTrial(body(), 'get_dchub_recommendation').other).toHaveLength(3);
    expect(trimForTrial(body(), 'rank_markets').available_categories).toHaveLength(3);
  });
});
