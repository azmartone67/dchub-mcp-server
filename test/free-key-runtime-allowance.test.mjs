// The free key is 10 calls IN TOTAL, then 50/day once bound to an email
// (free-tier rule, 2026-09-27). Nine runtime messages printed
// "<free_calls_per_day> calls/day", reading the lifetime allowance as a daily
// one. They now quote _freeKeyAllowanceText(). This fails if the figure is
// printed next to "calls/day" again anywhere in server.mjs output.
//
// Allowed: the claim_free_key / unlock_more_data tool DESCRIPTIONS, which
// are frozen until 2026-10-02 and fixed separately in the MCP-text batch
// (mcp#612). The allowance is by tool, not by count, so it holds whichever
// PR merges first.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _freeKeyAllowanceText, _freeKeyOfferText, FREE_TIER } from '../lib/tier-canon.mjs';

const SRC = readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');
const FROZEN_DESCRIPTION_STARTS = [
  "'Mint a FREE DC Hub dev key instantly",
  "'Unlock DC Hub\\'s full depth.",
];
const PER_DAY = /free_calls_per_day\s*(?:\}|\+\s*['"])\s*calls\/day/;

describe('free-key allowance in runtime messages', () => {
  it('no runtime line prints the free-key figure as calls/day', () => {
    const bad = SRC.split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => PER_DAY.test(l))
      .filter(({ l }) => !FROZEN_DESCRIPTION_STARTS.some((s) => l.trimStart().startsWith(s)))
      .map(({ l, n }) => `server.mjs:${n}: ${l.trim().slice(0, 120)}`);
    expect(bad).toEqual([]);
  });

  it('the runtime messages use the helper (not vacuous)', () => {
    expect((SRC.match(/_freeKeyAllowanceText\(\)/g) || []).length).toBeGreaterThanOrEqual(9);
  });

  it('the helper states the published rule from canon', () => {
    const t = _freeKeyAllowanceText();
    // B1 (D4, live 2026-10-03): the free key's clause follows the published
    // allowance shape (lib/tier-canon _freeKeyOfferText), daily now.
    expect(t).toBe(_freeKeyOfferText() + ', ' + FREE_TIER.identified_calls_per_day + '/day with an email');
    expect(t).toBe('previews plus 2 full answers per tool per day, 50/day with an email');
    expect(t).not.toMatch(/calls\/day/);
    expect(t).not.toMatch(/undefined|n\/a|NaN/);
  });
});
