// r-grok-bot-path (2026-10-01) — OUR Grok Bot must not be published as external Grok demand.
//
// Measured 2026-10-01 on the 10 relay sessions minted by platform 'connectors-manager' since v11:
// every one has UA 'grok-connectors-manager/0.1.0' and clientInfo.name 'connectors-manager', identical to a
// real Grok user's, and the operator confirmed they are Grok Bot's own (weekday hand-off proof test, and
// the X/LinkedIn routines). Platform, UA and client name cannot separate them; the PATH we configure can.
// Both branches are exercised against the SAME UA: the False branch is the property that matters, because
// real Grok users on /mcp or /mcp/grok must still count.
import { describe, it, expect } from 'vitest';
import { _resolvePlatform, _pathSelfTag, MCP_PATHS } from '../server.mjs';

const call = () => ({ method: 'tools/call', params: { name: 'get_grid_intelligence' } });
const STALE = 'sid-never-minted-here';
const GROK_UA = 'grok-connectors-manager/0.1.0';

describe("Grok Bot's own path is a self-tag", () => {
  it('maps /mcp/hub-grok-bot to a dchub-* tag (and tolerates a trailing slash)', () => {
    expect(_pathSelfTag({ path: '/mcp/hub-grok-bot' })).toBe('dchub-operator-bot');
    expect(_pathSelfTag({ path: '/mcp/hub-grok-bot/' })).toBe('dchub-operator-bot');
  });

  it('THE REGRESSION: the connector call on that path is internal, not grok demand', () => {
    expect(_resolvePlatform(call(), GROK_UA, _pathSelfTag({ path: '/mcp/hub-grok-bot' }), STALE))
      .toBe('dchub-internal');
  });

  it('the server answers on that path (a tag on an unrouted path is a no-op)', () => {
    expect(MCP_PATHS).toContain('/mcp/hub-grok-bot');
  });
});

describe('the tag name cannot be mistaken for a brand', () => {
  it("does not contain 'grok' (the known-platform check runs on the header first)", () => {
    expect(_pathSelfTag({ path: '/mcp/hub-grok-bot' })).not.toMatch(/grok/i);
  });
});

describe('real Grok traffic still counts — the False branch', () => {
  it('does not self-tag /mcp, /mcp/grok or an unknown path', () => {
    for (const p of ['/mcp', '/mcp/grok', '/mcp/hub-grok', '/mcp/not-ours']) {
      expect(_pathSelfTag({ path: p }), p).toBe('');
    }
  });

  it('the identical connector call on the canonical path is NOT internal', () => {
    expect(_resolvePlatform(call(), GROK_UA, _pathSelfTag({ path: '/mcp' }), STALE))
      .not.toBe('dchub-internal');
    expect(_resolvePlatform(call(), GROK_UA, _pathSelfTag({ path: '/mcp/grok' }), STALE))
      .not.toBe('dchub-internal');
  });
});
