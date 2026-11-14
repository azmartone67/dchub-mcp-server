// Grok brief 2026-10-19 item 1: one in-chat email-ask wording, only where bind_email opens a fuller answer.
import { describe, it, expect } from 'vitest';
import { EMAIL_ASK, claimHandoffDecisionText, claimHandoffText } from '../lib/claim-handoff.mjs';
import { EMAIL_ASK_SOFT } from '../lib/unlock-line.mjs';

describe('EMAIL_ASK', () => {
  // Item 4 (Grok live review 2026-11-13): a softer ask, from lib/unlock-line.mjs. The 10-19 sentence is
  // EMAIL_ASK_LEGACY there and comes back with DCHUB_UNLOCK_LINE_V1=0 (test/unlock-line-ratchet.test.mjs).
  it('is the soft sentence from lib/unlock-line.mjs (the user decides; bind_email named)', () => {
    expect(EMAIL_ASK).toBe(EMAIL_ASK_SOFT);
    expect(EMAIL_ASK).toContain('`bind_email`');
    expect(EMAIL_ASK).toMatch(/^If your user would like the full answer, ask whether they want to share their email/);
  });
  it.each(['get_interconnection_queue', 'get_grid_intelligence'])('%s leads with it when a bound email deepens the tool', (tool) => {
    const t = claimHandoffDecisionText({ tool, emailCap: 3 });
    expect(t.startsWith(EMAIL_ASK)).toBe(true);
    expect(t).toContain('`claim_free_key`');   // fallback stays
  });
  it('is not used where bind_email opens nothing more (get_market_intel, cap 0) or on generic walls', () => {
    expect(claimHandoffDecisionText({ tool: 'get_market_intel', emailCap: 0 })).not.toContain(EMAIL_ASK);
    expect(claimHandoffText({ status: 'trial_used' })).not.toContain(EMAIL_ASK);
    expect(claimHandoffText({ status: 'anon_daily_cap' })).not.toContain(EMAIL_ASK);
  });
});
