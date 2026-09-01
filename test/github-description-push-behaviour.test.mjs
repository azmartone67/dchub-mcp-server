// github-description-push-behaviour.test.mjs — (2026-08-31)
//
// The sibling file, github-description-canon.test.mjs, guards the SHAPE of the
// "Push the healed GitHub repo description" step: that it exists, reads the
// canon file, reports drift, and never exits 1. Every one of those assertions
// was green on 2026-08-31, and the step had been broken for an unknown number
// of days:
//
//     HAVE_PAT: true
//     HTTP 401: Bad credentials (https://api.github.com/graphql)
//     [gh-desc] DRIFT: the published description does not match canon.
//     [gh-desc]   live:
//     [gh-desc] PUSH FAILED despite a PAT — check its scopes.
//
// The PAT was configured and DEAD. It was doing the READ as well as the write,
// so the read 401'd, `|| echo ''` swallowed it, and the step announced DRIFT
// with an empty `live:` — a verdict it had no evidence for, printed daily,
// under a green check.
//
// The shape guard could not have caught that, because the shape was right. So
// this file does not read the YAML for phrases: it EXTRACTS THE SHIPPED SCRIPT
// AND RUNS IT, against a `gh` stub that can be told to 401, 403, or succeed.
// Every assertion below is about what the step DID.
//
// The 2026-08-11 version is kept at the bottom as a control. It is not
// decoration: it is the mutation. If the extraction or the stub ever stopped
// exercising the real logic, the old script would pass these tests too — and
// the control proves it does not.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WF = readFileSync(new URL('../.github/workflows/daily-manifest-sync.yml',
                                import.meta.url), 'utf8');
const CANON = readFileSync(new URL('../canonical/github_description.txt',
                                   import.meta.url), 'utf8').trim();

// ---------------------------------------------------------------- extraction
// Pull the step's `run:` body out of the workflow and de-indent it. Anchored on
// the step NAME, so a reordering of the file cannot silently point this at some
// other step's script — an empty or foreign extraction is asserted against
// below, because a test that runs the wrong script is worse than none.
function extractRun(stepName) {
  const at = WF.indexOf(`- name: ${stepName}`);
  expect(at, `step not found: ${stepName}`).toBeGreaterThan(-1);
  const runAt = WF.indexOf('\n        run: |\n', at);
  expect(runAt, `no 'run: |' block under ${stepName}`).toBeGreaterThan(-1);
  const rest = WF.slice(runAt + '\n        run: |\n'.length).split('\n');
  const body = [];
  for (const line of rest) {
    if (line.trim() === '') { body.push(''); continue; }
    if (!line.startsWith('          ')) break;      // 10 spaces
    body.push(line.slice(10));
  }
  return body.join('\n');
}

const SHIPPED = extractRun('Push the healed GitHub repo description');

// ---------------------------------------------------------------- the harness
// A `gh` stub. The READ is `gh api repos/X --jq …`; the WRITE is
// `gh api -X PATCH repos/X …`. $2 tells them apart. The write's outcome is
// keyed on GH_TOKEN, which is how we prove the step picks a token by
// AUTHENTICATING rather than by which secret happened to be non-empty.
const STUB = `#!/usr/bin/env bash
if [ "$1" != api ]; then echo "stub: unexpected gh subcommand: $*" >&2; exit 90; fi
if [ "$2" = "-X" ]; then
  case "$GH_TOKEN" in
    ok)   exit 0 ;;
    dead) echo "gh: Bad credentials (HTTP 401)" >&2; exit 1 ;;
    weak) echo "gh: Resource not accessible by personal access token (HTTP 403)" >&2; exit 1 ;;
    *)    echo "gh: unknown token in stub: $GH_TOKEN" >&2; exit 1 ;;
  esac
fi
if [ "$READ_FAILS" = yes ]; then
  echo "gh: Bad credentials (HTTP 401)" >&2; exit 1
fi
printf '%s' "$STUB_LIVE"
`;

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gh-desc-'));
  writeFileSync(join(dir, 'gh'), STUB);
  chmodSync(join(dir, 'gh'), 0o755);
});

// Runs a script with the stub first on PATH, from the repo root so the real
// canonical/github_description.txt is the one read.
function run(script, env = {}) {
  const file = join(dir, 'step.sh');
  writeFileSync(file, script);
  const out = execFileSync('bash', ['-e', file], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'azmartone67/dchub-mcp-server',
      READ_TOKEN: 'ok', PRIMARY_TOKEN: '', FALLBACK_TOKEN: '',
      STUB_LIVE: CANON, READ_FAILS: 'no', HAVE_PAT: 'false', GH_TOKEN: 'ok',
      ...env,
    },
  });
  return out;
}

// ★ 2026-09-01: this was `CANON.replace('19,900+', '19,700+')` — substituting a
//   LITERAL that the daily canon-sync bot rotates. The bot moved canon to
//   "20,100+" in d412e4b, the replace then matched nothing, and STALE came out
//   byte-identical to CANON. Every test below that asserts "drift IS detected"
//   was handed a fixture with no drift in it: the shipped script correctly
//   reported "in sync — no push needed", and nine tests went red blaming the
//   script. The script was right and the FIXTURE was broken.
//
//   That commit carried [skip ci], so no run ever saw it — this file is on the
//   HARD gate, and main was still red the next day.
//
//   Derive the stale value from whatever figure canon currently carries, and
//   assert below that the substitution actually bit. A fixture that can silently
//   become a no-op is a test that can silently stop testing.
const FACILITIES_RE = /[\d,]+\+ facilities/;
const STALE = CANON.replace(FACILITIES_RE, '19,700+ facilities');

describe('the extraction is pointed at the real step', () => {
  it('found a script, not an empty string', () => {
    expect(SHIPPED.length).toBeGreaterThan(400);
  });

  it('the STALE fixture actually differs from canon', () => {
    // Without this, a fixture that stops substituting turns every drift test
    // below into a test of the no-drift path — which is how nine of them came
    // to fail at once with no indication that the fixture was the cause.
    expect(CANON).toMatch(FACILITIES_RE);
    expect(STALE).not.toBe(CANON);
    expect(STALE).toContain('19,700+ facilities');
  });
  it('is the description step and not a neighbouring one', () => {
    expect(SHIPPED).toContain('canonical/github_description.txt');
    expect(SHIPPED).toContain('[gh-desc]');
  });
});

describe('a read it cannot perform is UNKNOWN, never a verdict', () => {
  // ★ THE REGRESSION. This is the assertion whose absence let a dead PAT print
  // a daily finding it had no evidence for.
  it('reports UNKNOWN when the description cannot be read', () => {
    const out = run(SHIPPED, { READ_FAILS: 'yes' });
    expect(out).toContain('UNKNOWN');
  });

  it('does NOT call an unreadable field drifted', () => {
    const out = run(SHIPPED, { READ_FAILS: 'yes' });
    expect(out).not.toContain('DRIFT');
  });

  it('does NOT call an unreadable field in sync either', () => {
    // The opposite failure is worse: silence on a surface that may be stale.
    // Matched on the VERDICT LINE, not the bare phrase — the UNKNOWN message
    // says "NOT 'in sync'", and a substring grep scored that denial as the
    // claim. The same shape as the heal that rewrote the comments recording
    // its own past defects: a message naming what it rules out cannot be
    // tested by searching for the name.
    const out = run(SHIPPED, { READ_FAILS: 'yes' });
    expect(out).not.toMatch(/^\[gh-desc\] in sync/m);
  });

  it('surfaces the underlying API error rather than an empty line', () => {
    const out = run(SHIPPED, { READ_FAILS: 'yes' });
    expect(out).toMatch(/Bad credentials|401/);
  });

  it('still exits 0 — a metadata blip must not fail the daily heal', () => {
    expect(() => run(SHIPPED, { READ_FAILS: 'yes' })).not.toThrow();
  });
});

describe('the read no longer depends on a PAT being alive', () => {
  it('detects drift with NO PAT configured at all', () => {
    // The original design intent, preserved: a visible unfixed drift beats a
    // silent one. Reading is metadata:read, which GITHUB_TOKEN always has.
    const out = run(SHIPPED, { STUB_LIVE: STALE });
    expect(out).toContain('DRIFT');
    expect(out).toContain('19,700+');          // a real live value, not ''
    // ★ 2026-09-01: this asserted the literal '19,900+' — canon's value on the
    //   day it was written. The daily canon-sync bot moved canon to 20,100+ and
    //   this went red while the script was behaving correctly. Assert against
    //   canon's CURRENT figure, so the test tracks the thing it is about (the
    //   run prints what it WANTS) instead of a number that expires.
    expect(out).toContain(CANON.match(FACILITIES_RE)[0]);
  });

  it('detects drift even when every PAT is dead', () => {
    const out = run(SHIPPED, { STUB_LIVE: STALE, PRIMARY_TOKEN: 'dead' });
    expect(out).toContain('DRIFT');
    expect(out).toContain('19,700+');
  });

  it('is a no-op when the live field already matches canon', () => {
    const out = run(SHIPPED);
    expect(out).toContain('in sync');
    expect(out).not.toContain('DRIFT');
  });
});

describe('the write token is chosen by authenticating, not by being non-empty', () => {
  it('falls through a dead PRIMARY to a working FALLBACK', () => {
    // ★ The thing `${{ A || B }}` cannot do. `||` picks the first NON-EMPTY
    // secret; a configured-but-dead PAT wins it and takes the step down, so
    // adding a healthy fallback secret would not have helped.
    const out = run(SHIPPED, {
      STUB_LIVE: STALE, PRIMARY_TOKEN: 'dead', FALLBACK_TOKEN: 'ok',
    });
    expect(out).toContain('pushed');
    expect(out).toContain('FALLBACK_TOKEN');
    expect(out).not.toContain('PUSH FAILED');
  });

  it('uses PRIMARY when PRIMARY works, and does not reach for FALLBACK', () => {
    const out = run(SHIPPED, {
      STUB_LIVE: STALE, PRIMARY_TOKEN: 'ok', FALLBACK_TOKEN: 'ok',
    });
    expect(out).toContain('pushed via PRIMARY_TOKEN');
  });

  it('reports PUSH FAILED only when every configured token failed', () => {
    const out = run(SHIPPED, {
      STUB_LIVE: STALE, PRIMARY_TOKEN: 'dead', FALLBACK_TOKEN: 'weak',
    });
    expect(out).toContain('PUSH FAILED');
  });
});

describe('401 and 403 are named apart, because their fixes differ', () => {
  it('calls a 401 expired and explicitly not a scope problem', () => {
    const out = run(SHIPPED, { STUB_LIVE: STALE, PRIMARY_TOKEN: 'dead' });
    expect(out).toMatch(/INVALID or EXPIRED/);
    expect(out).toMatch(/Reissue/i);
  });

  it('does not send a reader to audit the scopes of a dead token', () => {
    // ★ The old message was "PUSH FAILED despite a PAT — check its scopes."
    // For a 401 that is a wrong instruction: the scopes are fine, the token
    // is not. Asserted on the STEP OUTPUT, never on the file, so the comment
    // that records the old wording cannot satisfy or break this.
    const out = run(SHIPPED, { STUB_LIVE: STALE, PRIMARY_TOKEN: 'dead' });
    expect(out).not.toMatch(/401[\s\S]{0,200}check its scopes/);
  });

  it('calls a 403 a scope problem and names the scope', () => {
    const out = run(SHIPPED, { STUB_LIVE: STALE, PRIMARY_TOKEN: 'weak' });
    expect(out).toMatch(/REFUSED/);
    expect(out).toMatch(/Administration: write|repo' scope/);
  });
});

describe('every path is annotated, so a dead token is visible in the run', () => {
  // The old step printed bare echo. A GitHub Actions log line is invisible
  // unless someone opens the job; ::warning:: puts it on the run summary. That
  // is the difference between "broken for days" and "noticed the same day".
  it('annotates the unreadable case', () => {
    expect(run(SHIPPED, { READ_FAILS: 'yes' })).toContain('::warning::');
  });
  it('annotates a total push failure', () => {
    const out = run(SHIPPED, { STUB_LIVE: STALE, PRIMARY_TOKEN: 'dead' });
    expect(out).toContain('::warning::');
  });
  it('annotates a successful push', () => {
    const out = run(SHIPPED, { STUB_LIVE: STALE, PRIMARY_TOKEN: 'ok' });
    expect(out).toContain('::notice::');
  });
});

// ------------------------------------------------------------------- control
// The 2026-08-11 script, frozen. Its presence answers the only question that
// matters about the suite above: would it pass anything? Each assertion here
// is one the new script satisfies and the old one does not, run through the
// same extraction-free path and the same stub.
const OLD = `DESC="$(cat canonical/github_description.txt)"
LIVE="$(gh repo view "$GITHUB_REPOSITORY" --json description --jq .description || echo '')"
if [ "$DESC" = "$LIVE" ]; then
  echo "[gh-desc] in sync — no push needed"
  exit 0
fi
echo "[gh-desc] DRIFT: the published description does not match canon."
echo "[gh-desc]   live: $LIVE"
echo "[gh-desc]   want: $DESC"
if [ "$HAVE_PAT" != "true" ]; then
  echo "[gh-desc] no REPO_ADMIN_TOKEN configured — cannot push"
  exit 0
fi
if gh api -X PATCH "repos/$GITHUB_REPOSITORY" -f description="$DESC" >/dev/null; then
  echo "[gh-desc] pushed"
else
  echo "[gh-desc] PUSH FAILED despite a PAT — check its scopes."
fi
`;

describe('the control: the old script fails exactly these tests', () => {
  it('announced DRIFT from a read it never performed', () => {
    const out = run(OLD, { READ_FAILS: 'yes', GH_TOKEN: 'ok' });
    expect(out).toContain('DRIFT');            // the bug, reproduced
    expect(out).not.toContain('UNKNOWN');
  });

  it('printed a blank live: line as if it were a measurement', () => {
    const out = run(OLD, { READ_FAILS: 'yes', GH_TOKEN: 'ok' });
    expect(out).toMatch(/live:\s*\n/);
  });

  it('could not fall through a dead PAT to a working one', () => {
    // GH_TOKEN was a single resolved value; there was nothing to fall back to.
    const out = run(OLD, {
      STUB_LIVE: STALE, HAVE_PAT: 'true', GH_TOKEN: 'dead',
    });
    expect(out).toContain('PUSH FAILED');
    expect(out).not.toContain('pushed via');
  });

  it('diagnosed a 401 as a scope problem', () => {
    const out = run(OLD, {
      STUB_LIVE: STALE, HAVE_PAT: 'true', GH_TOKEN: 'dead',
    });
    expect(out).toContain('check its scopes');
  });
});
