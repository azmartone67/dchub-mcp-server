// Grok brief 2026-10-19 item 1: one in-chat email-ask wording, only where bind_email opens a fuller answer.
import { describe, it, expect } from 'vitest';
import { EMAIL_ASK, claimHandoffDecisionText, claimHandoffText } from '../lib/claim-handoff.mjs';

describe('EMAIL_ASK', () => {
  it('is the approved sentence', () => {
    expect(EMAIL_ASK).toBe('Ask your user for their email, then call `bind_email` with it to unlock the full answer.');
  });
  it.each(['get_interconnection_queue', 'get_grid_intelligence'])('%s leads with it when a bound email deepens the tool', (tool) => {
    const t = claimHandoffDecisionText({ tool, emailCap: 3 });
    expect(t.startsWith(EMAIL_ASK)).toBe(true);
    expect(t).toContain('`claim_free_key`');   // fallback stays
  });
  it('is not used where bind_email opens nothing more (get_market_intel, cap 0) or on generic walls', () => {
    expect(claimHandoffDecisionText({ tool: 'get_market_intel', emailCap: 0 })).not.toContain('unlock the full answer');
    expect(claimHandoffText({ status: 'trial_used' })).not.toContain('unlock the full answer');
    expect(claimHandoffText({ status: 'anon_daily_cap' })).not.toContain('unlock the full answer');
  });
});
