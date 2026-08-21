// wall-transport.test.mjs — r-wall-transport (2026-08-20)
//
// WHAT THIS IS FOR
// `for_your_human` is the ONE link a human can act on. It rides exactly two
// responses — the `paid_only` wall (r50) and the `metered_enforced` wall — and
// both shipped `isError: true` as a LITERAL. That literal is why neither wall
// ever saw DCHUB_PREVIEW_ISERROR, including in production, where the operator
// has had that flag set to 0. The decision to serve previews on the success
// channel was made and deployed; the two responses that carry the link never
// got it.
//
// THE TENSION THIS ENCODES
// r50 measured a real failure: soft content got summarized away and 990 sessions
// hit the wall with 0 keys claimed. r51's own comment records the OPPOSITE
// failure on other clients — Grok and Mistral Le Chat treat isError as a hard
// failure and bail on a served preview. Both are true. They are different
// clients, so the gate is per-platform, not one global boolean.
//
// MEASURED 7d (2026-08-20): 146 relays minted -> 15 redeemed -> 0 verified human
// acted. Wall transport is the leading untested explanation for that 131-relay gap.
//
// THE RULE THIS ENCODES
// Default must be a NO-OP. A transport experiment that changes behavior the
// moment it merges is not an experiment, it is an unreviewed release.
import { describe, it, expect, afterEach } from 'vitest';
import { _wallIsError, _ctxALS } from '../server.mjs';

const ENV = ['DCHUB_WALL_ISERROR', 'DCHUB_WALL_SUCCESS_PLATFORMS'];
afterEach(() => { for (const k of ENV) delete process.env[k]; });

const asPlatform = (platform) => _ctxALS.run({ platform }, () => _wallIsError());

describe('wall transport gate', () => {
  it('defaults to r50 behavior — merging this changes nothing', () => {
    expect(_wallIsError()).toBe(true);
    expect(asPlatform('claude')).toBe(true);
    expect(asPlatform('grok')).toBe(true);
  });

  it('DCHUB_WALL_ISERROR=0 moves every wall to the success channel', () => {
    process.env.DCHUB_WALL_ISERROR = '0';
    expect(_wallIsError()).toBe(false);
    expect(asPlatform('claude')).toBe(false);
  });

  it('flips only the listed platforms, by substring', () => {
    process.env.DCHUB_WALL_SUCCESS_PLATFORMS = 'grok, mistral';
    expect(asPlatform('grok')).toBe(false);
    expect(asPlatform('mistral-le-chat')).toBe(false);   // substring, not equality
    expect(asPlatform('GROK')).toBe(false);              // case-insensitive
    expect(asPlatform('claude')).toBe(true);             // unlisted client unchanged
    expect(asPlatform('chatgpt')).toBe(true);
  });

  it('preserves r50 when the platform is unknown or absent', () => {
    process.env.DCHUB_WALL_SUCCESS_PLATFORMS = 'grok';
    expect(asPlatform('')).toBe(true);
    expect(asPlatform(undefined)).toBe(true);
    expect(_wallIsError()).toBe(true);                   // no ctx at all
  });

  // Pins BEHAVIOR, not the fast-path branch: deleting the `!list.length` early
  // return leaves this green because [].some() is already false. That mutant is
  // equivalent, verified 2026-08-20 — the branch is perf, the assertion is contract.
  it('an empty or whitespace list is not "match everything"', () => {
    process.env.DCHUB_WALL_SUCCESS_PLATFORMS = '  , ,';
    expect(asPlatform('grok')).toBe(true);
    expect(asPlatform('claude')).toBe(true);
  });
});
