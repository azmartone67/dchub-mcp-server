// Grok agent-text daily probe 2026-10-12, item 10: get_energy_prices said caller_tier
// "free" beside identity.tier "anonymous" in one envelope (measured live, anonymous).
// honestCallerTier stamps ctx.tier, which is 'free' on an anonymous seat; the registerTool
// wrapper now hands it the tier identity.tier reports (_servedTierCtx).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _servedTierCtx, _identitySource } from '../server.mjs';
import { honestCallerTier } from '../lib/honest-tier.mjs';

describe('caller_tier uses the identity.tier vocabulary', () => {
  const env = (t) => ({
    structuredContent: { caller_tier: t },
    content: [{ type: 'text', text: JSON.stringify({ caller_tier: t }) }],
  });
  const anon = { auth_source: 'none', tier: 'free', api_key: null };
  it('anonymous seat: caller_tier equals identity.tier', () => {
    const id = _identitySource(anon);
    const out = honestCallerTier(env('free'), _servedTierCtx(anon));
    expect(id.tier).toBe('anonymous');
    expect(out.structuredContent.caller_tier).toBe(id.tier);
    expect(JSON.parse(out.content[0].text).caller_tier).toBe(id.tier);
  });
  it('keyed free seat and paid seat still agree with identity.tier', () => {
    for (const c of [{ auth_source: 'header', tier: 'free', api_key: 'k' },
                     { auth_source: 'header', tier: 'pro', api_key: 'k' },
                     { auth_source: 'header', tier: 'free', api_key: 'k', email: 'a@b.c' }]) {
      const out = honestCallerTier(env('pro'), _servedTierCtx(c));
      expect(out.structuredContent.caller_tier).toBe(_identitySource(c).tier);
    }
  });
  it('a ctx with no auth_source is passed through unchanged', () => {
    const c = { tier: 'free' };
    expect(_servedTierCtx(c)).toBe(c);
  });
  it('the registerTool wrapper hands honestCallerTier the identity-vocabulary ctx', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/_honestCallerTier\(_ensureStructured\(await _stamped\(args, extra\)\), _servedTierCtx\(getCtx\(\)\)\)/);
  });
});
