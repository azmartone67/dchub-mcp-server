// canon-pack-price.test.mjs — lib/canon.mjs is the single reader of the credit-pack price (Grok A5).
//
// 1. The module reads canonical/tier_limits.json (daily fail-closed snapshot of /api/v1/tiers),
//    and renders exactly what served copy said before the refactor ("$10", 1,000 credits).
// 2. Served copy that names the pack carries lib/canon's figure, not a second one: every
//    "<price> one-time" phrase in server.mjs's tool-visible text equals PACK_PRICE.
// 3. No "$10" typed into a string literal of server.mjs or lib/*.mjs (the ratchet in
//    copy-plan-name-and-price-ratchet.test.mjs allows no more than its baseline; this pins ZERO for the pack).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PACK_PRICE, PACK_PRICE_USD, PACK_CREDITS } from '../lib/canon.mjs';
import { stringLiterals } from './helpers/js-literals.mjs';

const ROOT = new URL('../', import.meta.url);
const snap = JSON.parse(readFileSync(new URL('canonical/tier_limits.json', ROOT), 'utf8'));

describe('lib/canon.mjs', () => {
  it('reads the committed snapshot and renders the display form', () => {
    expect(snap.credit_pack).toEqual({ price_usd: PACK_PRICE_USD, credits: PACK_CREDITS });
    expect(PACK_PRICE).toBe('$' + snap.credit_pack.price_usd);
  });
  it('is identical to the customer-visible figure before the refactor ($10, 1,000 credits)', () => {
    expect(PACK_PRICE).toBe('$10');
    expect(PACK_CREDITS).toBe(1000);
  });
  it('the live-copy string built from it matches the historical sentence byte for byte', () => {
    expect(`${PACK_PRICE} one-time = 1,000 API credits`).toBe('$10 one-time = 1,000 API credits');
  });
});

describe('no typed pack price in copy', () => {
  const files = ['server.mjs', 'oauth.mjs', 'mpp-hook.mjs',
    ...readdirSync(new URL('lib/', ROOT)).filter((f) => f.endsWith('.mjs')).map((f) => 'lib/' + f)];
  for (const f of files) {
    it(f, () => {
      const hits = stringLiterals(readFileSync(new URL(f, ROOT), 'utf8')).filter((l) => /\$10(?![\d,.]*\d)(?![\w$])/.test(l.text));
      expect(hits.map((h) => `${f}:${h.line}`)).toEqual([]);
    });
  }
  it('the scan is not vacuous: it sees the thousands of literals in server.mjs', () => {
    expect(stringLiterals(readFileSync(new URL('server.mjs', ROOT), 'utf8')).length).toBeGreaterThan(5000);
    expect(stringLiterals("const a = 'one-time $10 pack';").filter((l) => /\$10(?![\d,.]*\d)(?![\w$])/.test(l.text))).toHaveLength(1);
  });
});
