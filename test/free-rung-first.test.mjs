// free-rung-first.test.mjs — r-free-first (2026-09-17).
//
// THE LADDER STARTS AT THE RUNG THE CALLER CAN ACTUALLY TAKE.
//
// siteHeadlineHeader emitted the human ask first ("$10 … or Pro $99") and the
// free rung last, to every caller. Two defects in one ordering:
//
//   * an ANONYMOUS agent was asked to go find a human with a card before it was
//     told about the free key it can mint itself, in one call, with no email;
//   * a caller ALREADY HOLDING A KEY was told to claim one.
//
// Measured the day this shipped, live anonymous `analyze_site` on
// https://dchub.cloud/mcp: the 👉 human ask appeared at offset 431 of the CTA
// and the ⚡ free line at 918 — the paid ask 487 characters ahead of the free
// one, in a block a summarising model reads top-down.
//
// get_market_intel's header has had the right shape since 2026-06 ("⚡ Free,
// one call, no email — do this first" above the paid rungs), so the guard here
// is ORDER and AUDIENCE, not the existence of the line.
//
// Qualifies for the hard gate: pure functions over AsyncLocalStorage, no network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _ctxALS, _freeRungLine, siteHeadlineHeader, _priceLabel } from '../server.mjs';

const SID = '1aa6536d-b1d4-24b4-74a8-e89ba266e781';
const KEY = 'dch_live_testkey_not_real';
const ENV = ['DCHUB_INTERNAL_KEY', 'DCHUB_GO_LINKS', 'DCHUB_HUMAN_RELAY'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});
const withCtx = (store, fn) => _ctxALS.run({ ...store }, fn);

describe('_freeRungLine — who is offered the free key', () => {
  it('offers it to an anonymous caller, naming the tool it unblocks', () => {
    const line = withCtx({ session_id: SID }, () => _freeRungLine('analyze_site'));
    expect(line).toContain('claim_free_key');
    expect(line).toContain('analyze_site');
    expect(line).toContain('no email');
  });

  it('★ says NOTHING to a caller that already holds a key', () => {
    // The rung is spent. Re-offering it is noise on a keyed caller and wrong
    // on an identified one.
    expect(withCtx({ session_id: SID, api_key: KEY },
                   () => _freeRungLine('analyze_site'))).toBe('');
  });

  it('is an AGENT action, never phrased as something to relay to a human', () => {
    const line = withCtx({ session_id: SID }, () => _freeRungLine('analyze_site'));
    expect(line).not.toContain('Tell your human');
    expect(line).not.toContain('your human');
    // A human cannot call an MCP tool; test/one-human-cta holds the envelope
    // to exactly one human ask, and this line must not become a second.
    expect(line).not.toMatch(/https:\/\/dchub\.cloud\/(go\/c|upgrade\/h)\//);
  });
});

describe('siteHeadlineHeader — the order an agent reads', () => {
  it('★ anonymous: the free rung comes BEFORE the paid ask', () => {
    const h = withCtx({ session_id: SID }, () => siteHeadlineHeader('analyze_site', SID));
    const free = h.indexOf('claim_free_key');
    const paid = h.indexOf('Tell your human');
    expect(free).toBeGreaterThan(-1);
    expect(paid).toBeGreaterThan(-1);
    expect(free, 'the paid ask still leads for an anonymous caller').toBeLessThan(paid);
  });

  it('keyed: no free rung, and the paid ask is still there', () => {
    const h = withCtx({ session_id: SID, api_key: KEY },
                      () => siteHeadlineHeader('analyze_site', SID));
    expect(h).not.toContain('claim_free_key');
    expect(h).toContain('Tell your human');
  });

  it('keeps the whole ladder — free, then $10, then Pro — in that order', () => {
    const h = withCtx({ session_id: SID }, () => siteHeadlineHeader('analyze_site', SID));
    const free = h.indexOf('claim_free_key');
    const pack = h.indexOf('$10 one-time');
    const pro = h.indexOf('**Pro ' + _priceLabel('pro') + '**');
    expect(pack, 'the $10 rung vanished').toBeGreaterThan(-1);
    expect(pro, 'the Pro rung vanished').toBeGreaterThan(-1);
    expect(free).toBeLessThan(pack);
    expect(pack).toBeLessThan(pro);
  });

  it('still names exactly one human ask', () => {
    const h = withCtx({ session_id: SID }, () => siteHeadlineHeader('analyze_site', SID));
    expect((h.match(/Tell your human/g) || []).length).toBe(1);
    expect(h).not.toContain('→ **For your human:**');
  });

  it('never sends the human to the bare pricing wall', () => {
    const h = withCtx({ session_id: SID }, () => siteHeadlineHeader('analyze_site', SID));
    expect(h).not.toMatch(/dchub\.cloud\/pricing\b/);
    expect(h).not.toContain('/ai?ref=');
  });
});
