// r-analyst-path (2026-08-28) — our own analyst must not be published as
// external demand.
//
// The defect this pins: the DC Hub siting analyst (Managed Agents) reaches this
// server through ANTHROPIC's MCP connector. Its calls therefore arrive on
// Anthropic IPs, with an Anthropic UA, and with a clientInfo we do not set — so
// they classified as platform 'claude', the most credible external-demand
// bucket we publish, and no existing self-traffic rule could see them. The one
// channel we own end-to-end is the URL we hand the agent, so the PATH is the tag.
//
// Both branches are exercised separately and against the SAME user agent: a
// guard whose False branch has never been seen is unverified, and here the
// False branch is the whole safety property — real Claude traffic must still
// count. See ci-selftag.test.mjs, whose header channel this reuses verbatim.
import { describe, it, expect } from 'vitest';
import { _resolvePlatform, _pathSelfTag, MCP_PATHS } from '../server.mjs';
import { readFileSync } from 'node:fs';

// A tools/call as it arrives on the stateless path: no clientInfo, and a
// session id this replica has never seen (so _PLATFORM_RECALL cannot help).
const call = () => ({ method: 'tools/call', params: { name: 'search_facilities' } });
const STALE = 'sid-never-minted-here';
// What Anthropic's connector actually looks like on the wire.
const ANTHROPIC_UA = 'Claude-User/1.0 (Anthropic; +https://anthropic.com)';

describe('the first-party path tags its own traffic', () => {
  it('maps the analyst path to a self-tag', () => {
    expect(_pathSelfTag({ path: '/mcp/analyst' })).toBe('dchub-analyst');
  });

  it('tolerates a trailing slash', () => {
    // Express matches '/mcp/analyst/' on the same route, so the tag must too —
    // otherwise one request shape is tagged and its twin is published.
    expect(_pathSelfTag({ path: '/mcp/analyst/' })).toBe('dchub-analyst');
  });

  it('THE REGRESSION: an Anthropic-connector call on the analyst path is internal', () => {
    // Before this shipped, this exact call resolved to 'claude' and was counted
    // as real external demand against a 7d denominator of 227 calls.
    expect(_resolvePlatform(call(), ANTHROPIC_UA, _pathSelfTag({ path: '/mcp/analyst' }), STALE))
      .toBe('dchub-internal');
  });
});

describe('the canonical path is untouched — the False branch', () => {
  it('does not self-tag /mcp', () => {
    expect(_pathSelfTag({ path: '/mcp' })).toBe('');
  });

  it('a REAL Claude user on /mcp still counts as claude', () => {
    // The non-vacuity proof, and the property that matters most: identical UA,
    // identical body, only the PATH differs — and the verdicts are opposite.
    // If this ever returns 'dchub-internal' the fix has started deleting the
    // demand it was built to measure honestly.
    expect(_resolvePlatform(call(), ANTHROPIC_UA, _pathSelfTag({ path: '/mcp' }), STALE))
      .toBe('claude');
  });

  it('an unknown path does not self-tag', () => {
    expect(_pathSelfTag({ path: '/mcp/not-ours' })).toBe('');
  });

  it('a missing path does not throw and does not self-tag', () => {
    expect(_pathSelfTag({})).toBe('');
    expect(_pathSelfTag(undefined)).toBe('');
  });
});

describe('the path can never mint or steal a brand', () => {
  it('the tag resolves only through the shared internal vocabulary', () => {
    // Every value in the map must land in the excluded bucket. A future entry
    // that happened to contain a brand name ('claude-lab') would otherwise
    // ATTRIBUTE our own traffic to that brand instead of excluding it.
    for (const tag of MCP_SELF_PATHS_VALUES()) {
      expect(_resolvePlatform(call(), 'node', tag, STALE)).toBe('dchub-internal');
    }
  });

  function MCP_SELF_PATHS_VALUES() {
    // Read the map's values back out of the source, so adding a path without
    // adding it here cannot silently skip this check.
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const m = src.match(/const MCP_SELF_PATHS = new Map\(\[([\s\S]*?)\]\);/);
    expect(m, 'MCP_SELF_PATHS not found').toBeTruthy();
    const tags = [...m[1].matchAll(/'[^']+'\s*,\s*'([^']+)'/g)].map((x) => x[1]);
    expect(tags.length, 'no tags parsed out of MCP_SELF_PATHS').toBeGreaterThan(0);
    return tags;
  }
});

describe('the server actually answers on the tagged path', () => {
  // Without this the tag is a no-op: the analyst would get a 404 from Express
  // and fall back to nothing at all. This is the reachability class that let a
  // shipped affordance sit behind a gate ~95% of callers never reached.
  const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('exposes the analyst path in the route list', () => {
    expect(MCP_PATHS).toContain('/mcp/analyst');
    expect(MCP_PATHS).toContain('/mcp');
  });

  for (const verb of ['post', 'get', 'delete']) {
    it(`app.${verb} registers every MCP path, not just '/mcp'`, () => {
      expect(CODE).toMatch(new RegExp(`app\\.${verb}\\(MCP_PATHS,`));
      expect(CODE, `app.${verb}('/mcp', …) still hardcodes the single path`)
        .not.toMatch(new RegExp(`app\\.${verb}\\('/mcp',`));
    });
  }

  it('the path tag feeds the SAME explicit-hint channel as the CI header', () => {
    // One vocabulary, not two — the regex-twin drift this repo keeps paying for.
    expect(CODE).toMatch(/const platformHeader = \(_pathSelfTag\(req\)/);
  });
});
