// The wall was platform-aware for exactly ONE platform: `_platform === 'claude'`.
// Every other client fell through to a generic italic "Hold your own key?" line.
//
// That is wrong for the BYO-MCP class specifically. Those clients run MCP
// SERVER-SIDE and mint a FRESH SESSION PER TOOL CALL, so a key handed back
// inside a tool RESULT is gone by the next call. Measured on
// platform='connectors-manager' (Grok): 95 of 98 calls anonymous; 3
// claim_free_key calls each issued a real key; 2 of those keys made exactly ONE
// call ever — the claim itself — and were never presented again.
//
// The connector URL is the only durable state on that transport. These tests
// pin that it LEADS for that class, and that it does NOT leak to the classes
// where it would mis-advise.
// HARD GATE (test/hard-gate.txt): qualifies because it is pure gating logic
// with NO network. It drives buildPaywallExtras through _ctxALS.run with a
// synthetic context and asserts on the returned strings; nothing here opens a
// socket, exactly as its sibling paywall-extras-attribution.test.mjs does.
import { describe, it, expect } from 'vitest';
import { _ctxALS, buildPaywallExtras, _BYO_MCP_PLATFORMS } from '../server.mjs';

const SID = 'sess-byo-test';
// ★ default tool is NOT PRO-only: analyze_site is, and the anonymous branch
// deliberately does not fire there. Using it as the default is what made the
// first run of this suite fail 11/16 against a working patch.
const wall = (ctx, tool = 'search_facilities') =>
  _ctxALS.run(ctx, () => buildPaywallExtras(tool, 'free', SID));
const msg = (ctx, tool) => wall(ctx, tool).human_message || '';

describe('BYO-MCP clients lead with the artifact that survives their session', () => {
  // ★ Parametrised over the SET, not a hand-listed copy of it. An equality
  // check against one platform — the bug this replaces — passes a test that
  // names only one name.
  for (const p of [..._BYO_MCP_PLATFORMS]) {
    it(`${p}: anonymous caller is pointed at claim_free_key and the connector URL`, () => {
      const m = msg({ session_id: SID, platform: p });
      expect(m).toContain('claim_free_key');
      expect(m).toContain('connector URL');
      expect(m).not.toContain('Hold your own key?');
    });

    it(`${p}: keyed caller gets the KEYED connect URL itself`, () => {
      const m = msg({ session_id: SID, platform: p, api_key: 'dch_live_abc123' });
      expect(m).toContain('dchub.cloud/mcp?apiKey=');
      expect(m).toContain('dch_live_abc123');
      expect(m).toContain('connector settings');
    });
  }

  it('claude keeps its own branch and never gets the connector lead', () => {
    // detectPlatformFromInit collapses Claude.ai web (BYO) and Claude Code /
    // Desktop (header-capable) into ONE tag, so leading with a connector URL
    // here would mis-advise the header-capable majority.
    expect(_BYO_MCP_PLATFORMS.has('claude')).toBe(false);
    const m = msg({ session_id: SID, platform: 'claude' });
    expect(m).toContain('Claude.ai web');
    expect(m).not.toContain('dchub.cloud/mcp?apiKey=');
  });

  it('a non-BYO platform is untouched', () => {
    const m = msg({ session_id: SID, platform: 'cursor' });
    expect(m).toContain('Hold your own key?');
    expect(m).not.toContain('connector settings');
  });

  it('no platform at all is untouched', () => {
    const m = msg({ session_id: SID });
    expect(m).toContain('Hold your own key?');
  });
});

describe('it must not promise what the tier cannot deliver', () => {
  it('a PRO-only tool does not get the free-key lead when ANONYMOUS', () => {
    // Same reason r-proonly-honesty excludes PRO_ONLY_TOOLS from the bind_email
    // ladder: claiming a free key cannot unlock a PRO-only tool, so leading
    // with it is a false promise into a wall.
    const m = msg({ session_id: SID, platform: 'connectors-manager' }, 'analyze_site');
    expect(m).not.toContain('connector URL');
    expect(m).toContain('Hold your own key?');
  });

  it('a PRO-only tool DOES get the connector lead when the caller is KEYED', () => {
    // Not a promise to unlock — a statement about where the key survives. True
    // on every tool, and PRO_ONLY covers most of the wall's traffic.
    const m = msg({ session_id: SID, platform: 'connectors-manager',
                    api_key: 'dch_live_abc123' }, 'analyze_site');
    expect(m).toContain('dchub.cloud/mcp?apiKey=');
  });
});

describe('the references resolve at call time', () => {
  it('does not throw a ReferenceError for symbols declared later in the module', () => {
    // _BYO_MCP_PLATFORMS and _connectUrl are both declared BELOW
    // buildPaywallExtras. That is fine at runtime and fatal if the reference
    // ever moves into module-evaluation order — node --check cannot see it,
    // and a ReferenceError here names the VARIABLE, not the ordering.
    expect(() => wall({ session_id: SID, platform: 'grok', api_key: 'dch_live_x' }))
      .not.toThrow();
  });

  it('platform matching is case- and whitespace-insensitive', () => {
    const m = msg({ session_id: SID, platform: '  Connectors-Manager  ' });
    expect(m).toContain('connector URL');
  });
});
