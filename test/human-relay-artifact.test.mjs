// Shell #44 (2026-07-30) — the HUMAN-audience relay artifact reaches agents.
//
// The backend now mints TWO artifacts per high-intent relay: the single-use
// agent claim (unchanged, auto-redeemed by design) and a durable human view
// link (/relay/<token>: 7d, multi-open, binds nothing). This gateway's
// shouldMintClaim ALLOWLISTS backend fields — the exact mechanism that ate a
// working key in shell #38 — so the threading is pinned here from the
// caller's seat: if human_url ever falls out of the allowlist or the block
// builder, these tests fail before the funnel's human_acted v2 instrument
// silently measures a link nobody received.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildHighIntentClaimBlock } from '../server.mjs';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

// variant 'claude' is the header-less cohort: auto-redeem is deliberately
// skipped for it, so the builder runs with NO network in tests.
const CLAIM = {
  claim_url: 'https://dchub.cloud/claim/tok-agent',
  claim_token: 'tok-agent',
  count: 3,
  variant: 'claude',
  human_url: 'https://dchub.cloud/relay/tok-human',
  human_note: 'SHOW human_url TO YOUR HUMAN',
};

describe('human relay artifact threading', () => {
  it('shouldMintClaim allowlist carries human_url + human_note', () => {
    // Source-level pin on the allowlist itself (the function is network-bound).
    expect(SRC).toContain('human_url: data.human_url || null');
    expect(SRC).toContain('human_note: data.human_note || null');
  });

  it('the rendered block shows the human link with its contract', async () => {
    const { text, sc } = await buildHighIntentClaimBlock(CLAIM, 'rank_markets');
    expect(text).toContain('https://dchub.cloud/relay/tok-human');
    expect(text.toLowerCase()).toContain('multi-use');
    expect(text.toLowerCase()).toContain('binds nothing');
    expect(sc.high_intent_human_url).toBe('https://dchub.cloud/relay/tok-human');
  });

  it('no human_url → block is byte-identical to the old world', async () => {
    const bare = { ...CLAIM };
    delete bare.human_url; delete bare.human_note;
    const { text, sc } = await buildHighIntentClaimBlock(bare, 'rank_markets');
    expect(text).not.toContain('/relay/');
    expect(sc.high_intent_human_url).toBe(null);
  });

  it('the agent claim contract is untouched', async () => {
    const { sc } = await buildHighIntentClaimBlock(CLAIM, 'rank_markets');
    expect(sc.high_intent_claim_url).toBe('https://dchub.cloud/claim/tok-agent');
    expect(sc.high_intent_claim_token).toBe('tok-agent');
  });

  it('high_intent_human_url survives the envelope denylist', () => {
    // _ENV_DROP is an exact-name Set; assert the name is NOT in it, so a
    // future "tidy the envelope" edit can't silently eat the human link.
    const dropBlock = SRC.slice(SRC.indexOf('const _ENV_DROP'),
                                SRC.indexOf(']);', SRC.indexOf('const _ENV_DROP')));
    expect(dropBlock).not.toContain('high_intent_human_url');
  });
});
