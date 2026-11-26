// unlock_more_data's message (server.mjs UNLOCK_HUMAN_MESSAGE, capabilities messaging 2026-11-26) names /pricing
// then /connect. The keyless wording step turns /pricing into /connect, so a keyless caller read
// "Open https://dchub.cloud/connect ... You can also start at https://dchub.cloud/connect." Live 2026-11-26 21:40Z.
import { describe, it, expect } from 'vitest';
import { neutralKeylessString } from '../lib/keyless-plan-wording.mjs';
import { UNLOCK_HUMAN_MESSAGE } from '../server.mjs';

const count = (s, needle) => s.split(needle).length - 1;

describe('unlock_more_data, keyless: one link, said once', () => {
  it('the keyed message is the brief text, with both links', () => {
    expect(UNLOCK_HUMAN_MESSAGE).toContain('https://dchub.cloud/pricing');
    expect(UNLOCK_HUMAN_MESSAGE).toContain('You can also start at https://dchub.cloud/connect.');
  });
  it('the keyless form names /connect exactly once and no pricing page', () => {
    const out = neutralKeylessString(UNLOCK_HUMAN_MESSAGE);
    expect(count(out, 'https://dchub.cloud/connect')).toBe(1);
    expect(out).not.toMatch(/pricing/i);
    expect(out).toBe('Some DC Hub answers are previews. Open https://dchub.cloud/connect to see how to get the full results.');
  });
});
