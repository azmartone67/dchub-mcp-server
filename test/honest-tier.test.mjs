// The tier we SAY we served at must be the tier we served at.
//
// Live defect (2026-08-05, qa-superuser #2264): a fully anonymous MCP session —
// no API key — was handed `caller_tier: 'pro'` by get_energy_prices, in the same
// envelope that gated it down to a 1-result preview. The gating was right; the
// label described the BACKEND's caller (this server, using its own credentials),
// not the agent.
//
// It costs conversion rather than data: an agent that reads caller_tier to
// decide whether to surface an upgrade prompt concludes its human already pays,
// and never asks.
import { describe, it, expect } from 'vitest';
import { honestCallerTier } from '../lib/honest-tier.mjs';

const envelope = (tier, extra = {}) => ({
  structuredContent: { market: 'ashburn', caller_tier: tier, ...extra },
  content: [{ type: 'text', text: JSON.stringify({ market: 'ashburn', caller_tier: tier, ...extra }) }],
});

describe('honestCallerTier — the label matches the seat', () => {
  it('rewrites a paid tier claimed for a keyless caller', () => {
    // The exact live case.
    const out = honestCallerTier(envelope('pro'), { tier: null });
    expect(out.structuredContent.caller_tier).toBe('free');
  });

  it('rewrites the mirrored content[0] JSON too', () => {
    // ★ Correcting structuredContent alone would leave the envelope
    //   contradicting itself — the same bug wearing a smaller hat. Hosts read
    //   whichever half they render.
    const out = honestCallerTier(envelope('pro'), { tier: null });
    expect(JSON.parse(out.content[0].text).caller_tier).toBe('free');
  });

  it('does not demote a caller who really IS paid', () => {
    // The guard must not become "always say free" — that would hide a genuine
    // paid seat and is just the same lie pointing the other way.
    const out = honestCallerTier(envelope('free'), { tier: 'pro' });
    expect(out.structuredContent.caller_tier).toBe('pro');
    expect(JSON.parse(out.content[0].text).caller_tier).toBe('pro');
  });

  it('leaves an envelope that makes no tier claim completely untouched', () => {
    // No claim is not a claim of 'free'. Inventing one would manufacture a field
    // the tool never promised.
    const noClaim = {
      structuredContent: { market: 'ashburn' },
      content: [{ type: 'text', text: '{"market":"ashburn"}' }],
    };
    expect(honestCallerTier(noClaim, { tier: 'free' })).toBe(noClaim);
  });

  it('preserves every other field', () => {
    const out = honestCallerTier(envelope('pro', { stats: { mw: 42 } }), { tier: null });
    expect(out.structuredContent.market).toBe('ashburn');
    expect(out.structuredContent.stats).toEqual({ mw: 42 });
  });

  it('normalises case so PRO and pro are one tier', () => {
    const out = honestCallerTier(envelope('free'), { tier: 'PRO' });
    expect(out.structuredContent.caller_tier).toBe('pro');
  });

  it('still corrects structuredContent when the content mirror is unparseable', () => {
    // Fail-soft must not mean fail-silent: the half we CAN fix still gets fixed.
    const mixed = {
      structuredContent: { caller_tier: 'pro' },
      content: [{ type: 'text', text: 'not json at all' }],
    };
    expect(honestCallerTier(mixed, { tier: null }).structuredContent.caller_tier).toBe('free');
  });

  it('never throws on a malformed result', () => {
    // Runs on every tool response; a throw here would break the data path for
    // an envelope shape that was merely unusual.
    for (const bad of [null, undefined, 'string', 42, [], { content: 'nope' }]) {
      expect(() => honestCallerTier(bad, { tier: 'free' })).not.toThrow();
    }
  });

  it('never throws on a missing context', () => {
    const out = honestCallerTier(envelope('pro'), undefined);
    expect(out.structuredContent.caller_tier).toBe('free');
  });
});
