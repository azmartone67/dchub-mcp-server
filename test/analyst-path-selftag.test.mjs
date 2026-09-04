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

// ── r-source-path (2026-09-04): WHERE they came from, as a separate axis ─────
//
// The sibling of the self-path above, and deliberately NOT the same thing. A
// self path can only ever exclude ('dchub-internal'); a source path names a
// registry. Both branches are exercised, and the load-bearing property is the
// SEPARATION: a source must never move `platform`, because every published
// per-platform number is read off that field.
import { _pathSource, MCP_SOURCE_PATHS, MCP_PATHS as _PATHS } from '../server.mjs';

describe('the registry path tags the ARRIVAL SOURCE', () => {
  it('maps each declared registry path to its source', () => {
    expect(_pathSource({ path: '/mcp/glama' })).toBe('glama');
    expect(_pathSource({ path: '/mcp/smithery' })).toBe('smithery');
    expect(_pathSource({ path: '/mcp/pulsemcp' })).toBe('pulsemcp');
  });

  it('is EMPTY on the canonical path and on anything undeclared', () => {
    expect(_pathSource({ path: '/mcp' })).toBe('');
    expect(_pathSource({ path: '' })).toBe('');          // defaults to /mcp
    expect(_pathSource({})).toBe('');
    expect(_pathSource({ path: '/mcp/not-a-registry' })).toBe('');
    // no prefix matching — a longer path must not inherit a registry's tag
    expect(_pathSource({ path: '/mcp/glama/extra' })).toBe('');
  });

  it('tolerates a trailing slash, like the self-tag channel', () => {
    expect(_pathSource({ path: '/mcp/glama/' })).toBe('glama');
  });

  // ★ THE SAFETY PROPERTY. platform answers "which client", source answers
  // "who sent them". If a source path ever leaked into platform it would
  // silently restate every per-platform number we publish.
  it('a source path NEVER self-tags as internal and never mints a platform', () => {
    for (const path of MCP_SOURCE_PATHS.keys()) {
      expect(_pathSelfTag({ path })).toBe('');   // not excluded as our own traffic
    }
  });

  it('the two path maps are disjoint — no path can be both', () => {
    for (const p of MCP_SOURCE_PATHS.keys()) expect(MCP_SELF_PATHS_HAS(p)).toBe(false);
  });

  // every declared source path must actually be ROUTED, or the URL we publish
  // in a registry listing 404s and the listing sends traffic into a wall.
  it('every source path is mounted on MCP_PATHS', () => {
    for (const p of MCP_SOURCE_PATHS.keys()) expect(_PATHS).toContain(p);
    expect(_PATHS).toContain('/mcp');            // canonical path still served
    expect(_PATHS).toContain('/mcp/analyst');    // self path still served
  });
});

// MCP_SELF_PATHS is not exported; probe it through its accessor instead.
function MCP_SELF_PATHS_HAS(path) {
  return _pathSelfTag({ path }) !== '';
}

// ── r-source-path docs parity (2026-09-04) ──────────────────────────────────
// REGISTRY-LISTINGS.md is the paste-ready copy an owner works from when they
// switch a listing by hand. A URL in that table that no route serves would be
// pasted into a public registry and 404 every arrival it sent — the listing
// would look live and deliver nothing, which is the exact failure mode the
// registry work exists to detect. Pin the doc to the code.
describe('REGISTRY-LISTINGS.md cannot drift from the declared source paths', () => {
  const DOC = readFileSync(new URL('../REGISTRY-LISTINGS.md', import.meta.url), 'utf8');

  it('every dchub.cloud/mcp/<sub> URL in the doc is a route we actually serve', () => {
    const found = [...DOC.matchAll(/dchub\.cloud(\/mcp\/[a-z0-9-]+)/g)].map((m) => m[1]);
    expect(found.length).toBeGreaterThan(0);        // non-vacuity: the table exists
    for (const path of new Set(found)) {
      expect(_PATHS, `${path} is in the doc but not routed`).toContain(path);
    }
  });

  it('every declared source path appears in the doc', () => {
    for (const path of MCP_SOURCE_PATHS.keys()) {
      expect(DOC, `${path} is routed but undocumented`).toContain(`dchub.cloud${path}`);
    }
  });

  // ── r-cascade-path (2026-09-04): DELIBERATE CONTRACT REVERSAL ────────────
  // This asserted server.json carried NO source path, on the reasoning that
  // one url feeds four mirroring registries so tagging it would mis-credit
  // them all. That reasoning holds and is now enforced more precisely rather
  // than by a blanket ban: server.json carries the SHARED cascade tag, and
  // pointing it at a PER-REGISTRY path is the thing that must stay impossible.
  it('server.json carries the shared cascade tag, never a per-registry one', () => {
    const sj = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    const url = sj.remotes[0].url;
    expect(url).toBe('https://dchub.cloud/mcp/registry');

    // the listing url must be a path we actually serve, or every arrival 404s
    const path = new URL(url).pathname;
    expect(_PATHS).toContain(path);
    expect(_pathSource({ path })).toBe('mcp-registry');

    // ★ the invariant the old assertion was really protecting
    for (const p of MCP_SOURCE_PATHS.keys()) {
      if (p === '/mcp/registry') continue;
      expect(url, `server.json must not carry the per-registry path ${p}`).not.toContain(p);
    }
  });

  it('canonicalRemote stays /mcp so the origin is still declared honestly', () => {
    const sj = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    const pp = sj._meta['io.modelcontextprotocol.registry/publisher-provided'];
    expect(pp.canonicalRemote).toBe('https://dchub.cloud/mcp');
  });
});
