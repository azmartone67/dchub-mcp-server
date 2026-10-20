// Owner decision 2026-10-20 (agent panel re-run): a gated data answer mints no key.
// The panel read the unasked auto_trial_key / retry_with_header / persist_command as
// a trust problem. An agent gets a key when it asks (claim_free_key, named on every
// gated answer). DCHUB_AUTO_TRIAL_MINT=1 restores the inline mint without a deploy.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { _autoTrialMintOn, mintAutoTrial } from '../server.mjs';

let prev;
beforeEach(() => { prev = process.env.DCHUB_AUTO_TRIAL_MINT; delete process.env.DCHUB_AUTO_TRIAL_MINT; });
afterEach(() => {
  if (prev === undefined) delete process.env.DCHUB_AUTO_TRIAL_MINT;
  else process.env.DCHUB_AUTO_TRIAL_MINT = prev;
});

describe('auto-trial mint is off unless asked for', () => {
  it('the switch reads off by default and on only for "1"', () => {
    expect(_autoTrialMintOn({})).toBe(false);
    expect(_autoTrialMintOn({ DCHUB_AUTO_TRIAL_MINT: '0' })).toBe(false);
    expect(_autoTrialMintOn({ DCHUB_AUTO_TRIAL_MINT: 'true' })).toBe(false);
    expect(_autoTrialMintOn({ DCHUB_AUTO_TRIAL_MINT: '1' })).toBe(true);
    expect(_autoTrialMintOn({ DCHUB_AUTO_TRIAL_MINT: ' 1 ' })).toBe(true);
  });

  it('mintAutoTrial returns the preview answer (null) by default, without a network call', async () => {
    const realFetch = globalThis.fetch;
    let called = 0;
    globalThis.fetch = async () => { called += 1; throw new Error('no network in this test'); };
    try {
      expect(await mintAutoTrial('get_grid_intelligence')).toBe(null);
      expect(called).toBe(0);
    } finally { globalThis.fetch = realFetch; }
  });

  it('the switch is the first gate in mintAutoTrial', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const i = src.indexOf('export async function mintAutoTrial(tool_name) {');
    expect(i).toBeGreaterThan(0);
    const head = src.slice(i, src.indexOf('\n}\n', i));
    const gate = head.indexOf('if (!_autoTrialMintOn()) return null;');
    const firstOtherGate = head.indexOf('c.profile === DIRECTORY_PROFILE');
    expect(gate).toBeGreaterThan(0);
    expect(firstOtherGate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(firstOtherGate);
  });

  it('link labels carry no emoji', async () => {
    const S = await import('../server.mjs');
    for (const label of [S.RELAY_LABEL_DEFAULT, S.RELAY_LABEL_PRO, S.GROK_RELAY_LABEL,
                         S.GROK_RELAY_LABEL_PRO, S.GROK_RELAY_LABEL_DEV,
                         S._relayLinkLabel('claude', 'get_market_intel'),
                         S._relayLinkLabel('claude', 'analyze_site')]) {
      expect(label).toMatch(/^\[[^\]]+\]$/);
      expect(label).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
