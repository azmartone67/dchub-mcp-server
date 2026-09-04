// Retired public claims must not come back.
//
// The canon refresher (scripts/refresh-canon-phrases.mjs) governs exactly five
// quantities — tools, facilities, countries, deals, markets. A figure that is
// RETIRED rather than restated is outside that set entirely, so nothing stopped
// "369 GW capacity pipeline / 540+ projects" surviving for months in:
//   · server.mjs get_pipeline description  <- read by EVERY MCP client
//   · mcp-server.json (the manifest registries scrape)
//   · smithery.yaml   (the one registry that actually delivers traffic)
//   · integrations/chatgpt/instructions.txt
//
// `pipeline_gw`/`pipeline_mw`/`curated_pipeline_gw` were withdrawn from
// /api/v1/stats on 2026-08-08 as unreliable. /api/ai/query still publishes a
// (different) 676 GW, so the honest move on a permanent third-party surface is
// to carry NO pipeline figure rather than swap one contested number for
// another — a registry listing is far harder to correct than our own page.
//
// ★ This is a BAN, not a ratchet: unlike a predicate with legitimate remaining
//   uses, a retired number has no correct occurrence. If a pipeline figure is
//   ever re-published, delete this test in the same PR that re-publishes it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync,
         mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.next']);
const RETIRED = [
  { pattern: /369\s*GW/i, why: 'retired pipeline capacity figure' },
  { pattern: /540\+\s*projects/i, why: 'retired pipeline project count' },
  // Unscoped CC-BY over the whole corpus. DATA-LICENSE.md §3 grants NO
  // redistribution right on the facility inventory (OpenStreetMap is ODbL
  // share-alike; several upstreams are terms-unconfirmed), so a blanket
  // "open CC-BY-4.0 cited data" beside an 18,000+ facilities claim asserts a
  // grant we do not hold. CC-BY-4.0 itself is CORRECT and must stay legal on
  // the DCPI/grid/energy/tax tools (§1, §2) — only the unscoped phrasing is
  // banned, which is why this is a phrase ban and not a token ban.
  { pattern: /open CC-BY-4\.0 cited data/i, why: 'unscoped CC-BY grant over the facility corpus (DATA-LICENSE.md §3)' },
];

// A directory holding its own `.git` is a SEPARATE CHECKOUT — a git worktree,
// a submodule, a nested clone. Its files are some other commit's content, not
// this tree's, so a ban on what THIS branch publishes must not read them.
//
// ★2026-09-04 — this is not hypothetical tidiness. The repo's own change
// workflow creates worktrees under .claude/worktrees/ (and wt-base/ at the
// root), and any one of them on a branch that predates a retirement made this
// guard fail — deterministically, 3 of 3 full-suite runs measured, naming a
// file the working tree does not contain. A guard that fails because a
// colleague has a branch checked out teaches people to ignore it.
//
// This does NOT narrow the ban's reach over this tree: every tracked and
// untracked file in the working tree is still read, which the two coverage
// assertions at the bottom of this file pin down.
const isSeparateCheckout = (dir) => existsSync(join(dir, '.git'));

function* files(dir) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (isSeparateCheckout(p)) continue;
      yield* files(p);
    }
    else if (st.size < 3_000_000) yield p;
  }
}

describe('retired pipeline claims stay retired', () => {
  for (const { pattern, why } of RETIRED) {
    it(`no file re-publishes ${pattern} (${why})`, () => {
      const hits = [];
      for (const f of files(ROOT)) {
        if (f.endsWith('retired-claims.test.mjs')) continue;  // this file names them
        let body; try { body = readFileSync(f, 'utf8'); } catch { continue; }
        if (pattern.test(body)) hits.push(f.replace(ROOT, ''));
      }
      expect(hits, `retired claim re-published in: ${hits.join(', ')}`).toEqual([]);
    });
  }

  it('the scan actually reads files (not a vacuous pass)', () => {
    // ★ An empty or broken walker would pass every ban above forever. Prove the
    //   walker sees real content before trusting a green.
    const all = [...files(ROOT)];
    expect(all.length).toBeGreaterThan(20);
    expect(all.some((f) => f.endsWith('server.mjs'))).toBe(true);
    expect(readFileSync(join(ROOT, 'server.mjs'), 'utf8').length)
      .toBeGreaterThan(100_000);
  });

  it('every surface the ban exists for is still inside the scan', () => {
    // ★ The exclusion above is the one change that could make every ban in this
    //   file vacuous by over-reaching. These are the four surfaces the header
    //   names as having carried the retired figure for months — if the walker
    //   ever stops reaching them, the bans are decorative and this says so.
    const all = [...files(ROOT)].map((f) => f.replace(ROOT, ''));
    for (const must of ['server.mjs', 'mcp-server.json', 'smithery.yaml',
                        'integrations/chatgpt/instructions.txt']) {
      expect(all, `${must} must be inside the scan`).toContain(must);
    }
  });

  it('a separate checkout is not this tree, and is not scanned', () => {
    // Built out-of-repo so it is deterministic whether or not a worktree
    // happens to be open here, and so it cannot perturb a parallel test file.
    const tmp = mkdtempSync(join(tmpdir(), 'retired-claims-'));
    try {
      mkdirSync(join(tmp, 'wt'));
      writeFileSync(join(tmp, 'wt', '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
      writeFileSync(join(tmp, 'wt', 'server.mjs'), 'a 369 GW capacity pipeline\n');
      writeFileSync(join(tmp, 'kept.txt'), 'an ordinary file in this tree\n');
      // The worktree's copy is invisible; everything else is still read.
      expect([...files(tmp)].map((f) => f.replace(tmp, ''))).toEqual(['/kept.txt']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the ban would FIRE on a reintroduced claim', () => {
    // Mutation proof in-test: the pattern must match the exact retired string.
    expect(RETIRED[0].pattern.test('a 369 GW capacity pipeline')).toBe(true);
    expect(RETIRED[1].pattern.test('(540+ projects, x)')).toBe(true);
  });
});
