// r-ci-selftag (2026-08-18) — our own CI must not be published as external demand.
//
// The defect this pins: our live smoke suite self-identified via
// clientInfo.name, which is sent ONCE at initialize and remembered only in
// _PLATFORM_RECALL — an in-process Map. A tools/call routed to a replica that
// never saw the initialize found nothing to recall, fell through to UA
// detection ('node' → the generic 'mcp' default) and was written as an
// anonymous EXTERNAL agent. Measured in mcp_call_log inside ONE session:
// b5821b64 → 2 calls 'dchub-internal', 48 calls 'mcp'.
//
// The fix is that a self-tag now also rides the per-request platform header, so
// no routing decision can lose it. These tests exercise BOTH branches
// separately — a guard whose False branch has never been seen is unverified,
// and the 08-17 round proved a single mutation can leave a sibling branch
// vacuous (both cases resolving to the same envelope).
import { describe, it, expect } from 'vitest';
import { _resolvePlatform } from '../server.mjs';
import { readFileSync } from 'node:fs';

// A tools/call as it actually arrives on the stateless path: no clientInfo at
// all, generic 'node' UA, and a session id this replica has never seen.
const call = () => ({ method: 'tools/call', params: { name: 'search_facilities' } });
const STALE = 'sid-never-minted-here';

describe('the per-request header carries an internal self-tag', () => {
  it('tags a harness call internal even when the session is unknown', () => {
    // THE REGRESSION. Before the fix this returned 'mcp' and the row was
    // published as a real external agent.
    expect(_resolvePlatform(call(), 'node', 'dchub-regression-test', STALE))
      .toBe('dchub-internal');
  });

  it('holds for the second live suite, which uses a different tag', () => {
    expect(_resolvePlatform(call(), 'node', 'dchub-mcp-test', STALE))
      .toBe('dchub-internal');
  });

  it('still returns the generic bucket when NO tag is supplied', () => {
    // The False branch, stated explicitly: the fix must not tag everything
    // internal. If this ever passes as 'dchub-internal' the header rule has
    // stopped reading its input.
    expect(_resolvePlatform(call(), 'node', '', STALE)).toBe('mcp');
  });
});

describe('the header cannot mint or steal a brand', () => {
  it('a known platform in the header still wins over the internal rule', () => {
    expect(_resolvePlatform(call(), 'node', 'cursor', STALE)).toBe('cursor');
  });

  it('an unrecognized third-party name is NOT swallowed as internal', () => {
    // 'acme-agent' matches neither vocabulary — it must fall through to UA
    // detection, not vanish into our own excluded bucket.
    expect(_resolvePlatform(call(), 'node', 'acme-agent', STALE)).toBe('mcp');
  });

  it('a real UA still beats an internal-looking header', () => {
    // Ordering property: positive detection is consulted first, so crawl or
    // client traffic can never be hidden by a header it happens to send.
    expect(_resolvePlatform(call(), 'Claude-User/1.0', 'cursor', STALE)).toBe('cursor');
  });
});

describe('one vocabulary, not two', () => {
  const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  // Strip comments first — on 08-17 an assertion was satisfied by a COMMENT
  // that merely contained the token it searched for.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the internal-tag regex is defined exactly once', () => {
    const hits = CODE.match(/selfheal\|canary\|smoke\|regression/g) || [];
    expect(hits.length,
      'the internal-tag vocabulary was restated — that is the regex-twin drift '
      + 'this repo keeps paying for; both channels must call _INTERNAL_SELF_TAG',
    ).toBe(1);
  });

  it('the clientInfo branch routes through the shared rule', () => {
    expect(CODE).toMatch(/_INTERNAL_SELF_TAG\(safe\)/);
  });
});

describe('the live suites actually send the header', () => {
  // Without this the server-side fix is a no-op for the traffic that caused the
  // problem — the same reachability class as the retention affordance that was
  // shipped behind a gate ~95% of callers never reach.
  for (const [file, tag] of [
    ['../test/regression.test.mjs', 'dchub-regression-test'],
    ['../test/mcp.test.mjs', 'dchub-mcp-test'],
  ]) {
    it(`${file.split('/').pop()} sets X-MCP-Platform: ${tag}`, () => {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      const code = src.replace(/^\s*\/\/.*$/gm, '');
      expect(code).toMatch(
        new RegExp(`['"]X-MCP-Platform['"]\\s*:\\s*['"]${tag}['"]`));
      // And it must be on the shared HEADERS object every request spreads —
      // set on a single fetch it would cover one call and miss the rest.
      const h = code.indexOf('const HEADERS');
      expect(h, 'HEADERS block not found').toBeGreaterThan(-1);
      expect(code.slice(h, code.indexOf('};', h))).toMatch(/X-MCP-Platform/);
    });
  }
});
