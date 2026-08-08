// A generic clientInfo.name is an ABSENCE, not a platform.
//
// Measured 2026-08-08: 229 of 281 new agents/30d carried platform='mcp'
// because `return safe` fired with safe='mcp', so detectPlatform(ua) NEVER
// ran for any of them. Two costs: UA-identifiable callers were never
// attributed, and the residual bucket was named after the protocol, so "81%
// unattributed" read as lost attribution rather than as what it is — bare
// programmatic clients (220 of 229 send UA 'node').
//
// ★ SCOPE, honestly: detectPlatform has no crawler rules, so this does NOT
//   identify Baiduspider et al. It stops them being called 'mcp'; naming them
//   is a separate gap.
import { describe, it, expect } from 'vitest';
import { detectPlatformFromInit, _GENERIC_CLIENT_NAMES } from '../server.mjs';

const init = (name) => ({ params: { clientInfo: { name } } });

describe('a generic self-ID falls through to UA detection', () => {
  it('a UA-identifiable caller is now attributed instead of tagged mcp', () => {
    // THE BUG: clientInfo 'mcp' short-circuited before detectPlatform ran, so
    // this returned 'mcp' and a real platform went unattributed.
    expect(detectPlatformFromInit(init('mcp'), 'windsurf/1.2')).toBe('windsurf');
    expect(detectPlatformFromInit(init('client'), 'curl/8.4')).toBe('curl');
  });

  it('every generic self-ID defers to a UA that names a platform', () => {
    for (const g of _GENERIC_CLIENT_NAMES) {
      expect(detectPlatformFromInit(init(g), 'cohere-sdk')).toBe('cohere');
    }
  });

  it('an unidentifiable caller lands in an honestly-named bucket', () => {
    // The 220-agent majority: generic name + a UA naming nothing.
    expect(detectPlatformFromInit(init('mcp'), 'node')).toBe('mcp-generic-client');
  });

  it('an unnamed crawler is no longer laundered into "mcp"', () => {
    // Not identified — but no longer counted under the protocol's own name.
    const p = detectPlatformFromInit(init('mcp'),
      'Mozilla/5.0 (compatible; Baiduspider-render/2.0)');
    expect(p).toBe('mcp-generic-client');
    expect(p).not.toBe('mcp');
  });

  it('does NOT rename callers who sent no clientInfo at all', () => {
    // A different population from a generic self-ID; only the latter is rebucketed.
    expect(detectPlatformFromInit({}, 'node')).toBe('mcp');
  });
});

describe('real attribution is unchanged', () => {
  it('a known client still wins', () => {
    expect(detectPlatformFromInit(init('claude'), 'node')).toBe('claude');
  });

  it('a distinctive custom name is still its own tag', () => {
    // Kills: over-broadening the generic set and erasing real integrators.
    expect(detectPlatformFromInit(init('acme-siting-agent'), 'node'))
      .toBe('acme-siting-agent');
  });

  it('the explicit hint still outranks everything', () => {
    expect(detectPlatformFromInit(init('mcp'), 'node', 'claude')).toBe('claude');
  });

  it('harness self-IDs are still folded to dchub-internal', () => {
    expect(detectPlatformFromInit(init('qa-judge-probe'), 'node'))
      .toBe('dchub-internal');
  });
});
