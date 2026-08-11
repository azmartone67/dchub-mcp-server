// github-description-canon.test.mjs — (2026-08-11)
//
// THE SURFACE NO FILE-WALKING GUARD COULD SEE.
//
// daily-manifest-sync heals the "source files" Glama, PulseMCP and the GitHub
// MCP Registry scrape. The repo DESCRIPTION is scraped by all of them and is
// not a file — it is GitHub metadata. So `git grep 16,900` returned nothing,
// COVERAGE could not list it, and it sat at "16,900+ facilities" against a
// canon of 17,300+ until a third-party listing copied it in good faith and
// inherited the drift.
//
// Same shape as the two other holes this month: the retired-claim gap (a
// number with no canonical value to sync TOWARD falls outside the guard) and
// the robots `/*?` rule (a policy the logs could not show us). Each time the
// guard was working; the surface was simply outside it.
//
// Fixed by making the description a FILE, healed by the existing engine — no
// new heal rules. These tests pin that it stays inside the engine and that the
// file remains pushable verbatim.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const DESC = read('canonical/github_description.txt');
const SYNC = read('scripts/sync-tools-manifest.mjs');
const WF   = read('.github/workflows/daily-manifest-sync.yml');
const CANON = JSON.parse(read('canonical/canon_phrases.json'));

describe('the description file is pushable verbatim', () => {
  it('carries NO header or comment — its bytes become the metadata', () => {
    expect(DESC.trimStart().startsWith('#')).toBe(false);
    expect(DESC.trimStart().startsWith('//')).toBe(false);
    expect(DESC).not.toMatch(/^\s*<!--/);
  });

  it('is a single line', () => {
    expect(DESC.trim().split('\n')).toHaveLength(1);
  });

  it('fits GitHub\'s description limit', () => {
    // The push step refuses over 350 and logs rather than truncating; keep the
    // file itself inside the limit so that refusal never has to fire.
    expect(DESC.trim().length).toBeLessThanOrEqual(350);
  });

  it('still says what the repo is and where to reach it', () => {
    expect(DESC).toMatch(/dchub\.cloud\/mcp/);
    expect(DESC).toMatch(/AI agents/i);
  });
});

describe('it is healed by the SAME engine as every other surface', () => {
  it('is in the heal loop', () => {
    expect(SYNC).toContain("'canonical/github_description.txt']) {");
  });

  it('is in COVERAGE, so a stale claim fails the guard', () => {
    const cov = SYNC.slice(SYNC.indexOf('const COVERAGE = ['),
                           SYNC.indexOf('const COVERAGE = [') + 1200);
    expect(cov).toContain("'canonical/github_description.txt'");
  });

  it('adds no bespoke heal rules — that was the point', () => {
    // If a future edit reimplements phrase replacement for this one surface,
    // there are two rule sets again, which is the disease not the cure.
    expect(SYNC).not.toMatch(/github_description[\s\S]{0,400}?replace\(/);
  });
});

describe('the healed content matches canon', () => {
  it('carries the canonical facility count, not the stale one', () => {
    expect(CANON.facilities).toBeTruthy();
    expect(DESC).toContain(CANON.facilities);
    expect(DESC).not.toMatch(/16,9\d\d\+/);   // the exact figure that drifted
  });

  it('carries the canonical tool, market and deal counts', () => {
    expect(DESC).toContain(String(CANON.tools));
    expect(DESC).toContain(CANON.markets);
    expect(DESC).toContain(CANON.deals);
  });
});

describe('the push step is wired and fail-soft', () => {
  it('exists and reads the healed file', () => {
    expect(WF).toContain('Push the healed GitHub repo description');
    expect(WF).toContain('cat canonical/github_description.txt');
  });

  it('declares NO invalid permission key — this test used to enforce the bug', () => {
    // ★ THE MISTAKE THIS ENCODES. The first version of this test asserted
    // `administration: write`. That is not a valid Actions permissions key, so
    // the assertion PINNED an invalid workflow: YAML parsed fine, the test went
    // green, and the file was unloadable by GitHub — which took the ENTIRE
    // daily canon heal offline, not just the step it was added for.
    //
    // A test that asserts the presence of a wrong value is worse than no test:
    // it converts a typo into a guarded invariant.
    const VALID = new Set(['actions', 'attestations', 'checks', 'contents',
      'deployments', 'discussions', 'id-token', 'issues', 'packages', 'pages',
      'pull-requests', 'repository-projects', 'security-events', 'statuses']);
    const block = WF.slice(WF.indexOf('\npermissions:') + 1);
    const body = block.slice(0, block.indexOf('\n\n'));
    for (const line of body.split('\n').slice(1)) {
      const m = /^\s{2}([a-z-]+):\s*(read|write|none)\s*$/.exec(line);
      if (!m) continue;                       // comments and blanks
      expect(VALID.has(m[1]), `invalid Actions permission key: ${m[1]}`).toBe(true);
    }
  });

  it('does not pretend GITHUB_TOKEN can write repo metadata', () => {
    // Repo description is outside every Actions permission scope. The step must
    // say so and route to a PAT, or it silently no-ops forever.
    expect(WF).toContain('REPO_ADMIN_TOKEN');
    expect(WF).toMatch(/GITHUB_TOKEN (has no metadata scope|CANNOT do)/);
  });

  it('still REPORTS drift when it cannot push', () => {
    // The point of the file was to make an invisible drift visible. A step that
    // goes quiet without a PAT would recreate exactly the silence that let
    // "16,900+" sit on a public surface and propagate.
    const step = WF.slice(WF.indexOf('Push the healed GitHub repo description'),
                          WF.indexOf('Refresh the canonical problem taxonomy'));
    expect(step).toContain('[gh-desc] DRIFT');
    expect(step).toContain('live:');
    expect(step).toContain('want:');
  });

  it('never fails the daily heal', () => {
    // Every other step here is fail-closed-but-exit-0. A metadata blip must
    // not take down the file heal that actually matters.
    const step = WF.slice(WF.indexOf('Push the healed GitHub repo description'),
                          WF.indexOf('Refresh the canonical problem taxonomy'));
    expect(step).toContain('PUSH FAILED');
    expect(step).not.toMatch(/exit 1/);
  });

  it('is a no-op when already in sync', () => {
    const step = WF.slice(WF.indexOf('Push the healed GitHub repo description'),
                          WF.indexOf('Refresh the canonical problem taxonomy'));
    expect(step).toContain('in sync — no push needed');
  });
});
