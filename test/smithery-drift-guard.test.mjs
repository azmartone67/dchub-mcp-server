// =============================================================================
// The Smithery description auto-writer must never silently revert a live edit
// it did not make.
// -----------------------------------------------------------------------------
// 2026-09-24: a new description was pasted live on Smithery by hand, with no
// repo change. The white-glove step in .github/workflows/smithery-freshness.yml
// PATCHes scripts/smithery_description.txt whenever live differs, so its next
// run would have overwritten the live edit with the stale repo file, and every
// monitor would have read green. PR #537 mirrored it by hand.
//
// scripts/smithery_drift_guard.py now decides, before any PATCH:
//   live == repo            -> in_sync       (no write)
//   live == last written    -> write         (only the repo changed)
//   neither                 -> foreign_edit  (no write; warning + issue)
//   no record, live != repo -> foreign_edit  (fail safe)
//   --force                 -> write
// These tests run the REAL python against a stub api.smithery.ai (no network),
// and run the REAL white-glove shell gate lifted out of the workflow.
// =============================================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// execFileSync would block the event loop and starve the in-process stub server.
const run = promisify(execFile);
const REPO = process.cwd();
const GUARD = join(REPO, 'scripts/smithery_drift_guard.py');
const WF = readFileSync(join(REPO, '.github/workflows/smithery-freshness.yml'), 'utf8');

const norm = (t) => t.replace(/\\&/g, '&').replace(/\s+/g, ' ').trim();
const sha = (t) => createHash('sha256').update(norm(t), 'utf8').digest('hex');

const OLD = 'DC Hub is the live data layer. 1,900+ tracked M&A deals. Old sentence here.';
const NEW = 'DC Hub is the live data layer. 1,900+ tracked M&A deals. New sentence from the repo.';
const HAND = 'DC Hub is the live data layer. 1,900+ tracked M&A deals. A sentence Grok pasted by hand.';

async function tryRun(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await run(cmd, args, { encoding: 'utf8', ...opts });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('smithery_drift_guard.py — the writer only overwrites text it wrote', () => {
  let server, port, dir;
  // `served` is a queue of live descriptions (last one repeats); null = HTTP 500.
  let served, reqs;

  beforeAll(async () => {
    server = createServer((req, res) => {
      reqs.push({ url: req.url, auth: req.headers.authorization ?? null });
      const next = served.length > 1 ? served.shift() : served[0];
      if (next === null) { res.writeHead(500); res.end('boom'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ qualifiedName: 'azmartone67/dchub', description: next }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(() => server.close());
  beforeEach(() => {
    served = [];
    reqs = [];
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'drift-guard-'));
  });

  /** Run the guard: repo text, live queue, optional record, extra args. */
  async function guard({ repo, live, record, args = [] }) {
    served = Array.isArray(live) ? [...live] : [live];
    const repoFile = join(dir, 'desc.txt');
    const recordFile = join(dir, 'state', 'last_written.sha256');
    const out = join(dir, 'gh_output');
    const issue = join(dir, 'issue.md');
    writeFileSync(repoFile, repo);
    if (record !== undefined) {
      await run('mkdir', ['-p', join(dir, 'state')]);
      writeFileSync(recordFile, record + '\n');
    }
    const r = await tryRun('python3', [GUARD,
      '--repo-file', repoFile, '--record', recordFile,
      '--api', `http://127.0.0.1:${port}/servers/azmartone67/dchub`,
      '--issue-body-out', issue, '--interval', '0', ...args,
    ], { env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: out, SMITHERY_API_KEY: 'test-key' } });
    const ghOut = existsSync(out) ? readFileSync(out, 'utf8') : '';
    return {
      ...r,
      verdict: ghOut.match(/^verdict=(.*)$/m)?.[1] ?? null,
      record: existsSync(recordFile) ? readFileSync(recordFile, 'utf8').trim() : null,
      issue: existsSync(issue) ? readFileSync(issue, 'utf8') : null,
    };
  }

  it('live == repo -> in_sync, no write, and the record is (re)seeded with that text', async () => {
    // whitespace + the \& escape differ; the normalised text is the same
    const r = await guard({ repo: NEW, live: NEW.replace(' ', '  \n').replace('&', '\\&') });
    expect(r.code).toBe(0);
    expect(r.verdict).toBe('in_sync');
    expect(r.record).toBe(sha(NEW));
    expect(r.issue).toBeNull();
  });

  it('live == last written, repo moved on -> write (existing behaviour)', async () => {
    const r = await guard({ repo: NEW, live: OLD, record: sha(OLD) });
    expect(r.code).toBe(0);
    expect(r.verdict).toBe('write');
    expect(r.issue).toBeNull();
    expect(r.record).toBe(sha(OLD)); // only a CONFIRMED write moves the record
  });

  it('live != repo and != last written -> foreign_edit: no write, warning, issue body with diff + instruction, exit 0', async () => {
    const r = await guard({ repo: NEW, live: HAND, record: sha(OLD) });
    expect(r.code).toBe(0); // a human decision, not a red lane
    expect(r.verdict).toBe('foreign_edit');
    expect(r.stdout).toMatch(/::warning::drift guard: foreign_edit/);
    expect(r.record).toBe(sha(OLD)); // carried forward untouched
    expect(r.issue).toContain('mirror the live text into scripts/smithery_description.txt (PR) or re-run with force to revert it');
    expect(r.issue).toContain('--- scripts/smithery_description.txt (repo)');
    expect(r.issue).toContain('+++ api.smithery.ai description (live)');
    expect(r.issue).toMatch(/^-New sentence from the repo\.$/m);
    expect(r.issue).toMatch(/^\+A sentence Grok pasted by hand\.$/m);
    expect(r.issue).toContain(HAND); // the full live text, ready to mirror
    // a foreign verdict is confirmed by re-reading, not taken off one read
    expect(reqs.length).toBe(3);
  });

  it('no record yet (first run) and live != repo -> foreign_edit (fail safe toward NOT overwriting)', async () => {
    const r = await guard({ repo: NEW, live: OLD });
    expect(r.verdict).toBe('foreign_edit');
    expect(r.code).toBe(0);
    expect(r.issue).toContain('no record yet');
  });

  it('a garbage record is treated as no record, not as a match', async () => {
    const r = await guard({ repo: NEW, live: OLD, record: 'not-a-hash' });
    expect(r.verdict).toBe('foreign_edit');
  });

  it('force_overwrite bypasses the guard on a foreign edit', async () => {
    const r = await guard({ repo: NEW, live: HAND, record: sha(OLD), args: ['--force', 'true'] });
    expect(r.verdict).toBe('write');
    expect(r.issue).toBeNull();
  });

  it("force 'false' (the dispatch default and the schedule's empty input) does NOT bypass", async () => {
    const r = await guard({ repo: NEW, live: HAND, record: sha(OLD), args: ['--force', 'false'] });
    expect(r.verdict).toBe('foreign_edit');
  });

  it('an unreadable live description is no write and not red', async () => {
    const r = await guard({ repo: NEW, live: null, record: sha(OLD) });
    expect(r.code).toBe(0);
    expect(r.verdict).toBe('unreadable');
  });

  it('one stale edge read does not make a foreign edit: a re-read that matches the record writes', async () => {
    const r = await guard({ repo: NEW, live: [HAND, OLD], record: sha(OLD) });
    expect(r.verdict).toBe('write');
    expect(r.issue).toBeNull();
  });

  it('reads the authoritative store authed, with a cache-busting query string on every read', async () => {
    await guard({ repo: NEW, live: HAND, record: sha(OLD) });
    expect(reqs.length).toBeGreaterThan(0);
    for (const q of reqs) {
      expect(q.auth).toBe('Bearer test-key');
      expect(q.url).toMatch(/^\/servers\/azmartone67\/dchub\?_=\d+$/);
    }
  });

  it('--mark-written records the repo text (what the workflow runs after a confirmed write)', async () => {
    const repoFile = join(dir, 'desc.txt');
    const recordFile = join(dir, 'nested', 'last_written.sha256');
    writeFileSync(repoFile, NEW);
    const r = await tryRun('python3', [GUARD, '--repo-file', repoFile, '--record', recordFile, '--mark-written']);
    expect(r.code).toBe(0);
    expect(readFileSync(recordFile, 'utf8').trim()).toBe(sha(NEW));
    expect(reqs.length).toBe(0); // no network in this mode
  });

  it('a missing repo file is the guard failing to run (non-zero), never a verdict', async () => {
    const r = await tryRun('python3', [GUARD, '--repo-file', join(dir, 'nope.txt'), '--record', join(dir, 'r'),
      '--api', `http://127.0.0.1:${port}/x`]);
    expect(r.code).not.toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The workflow wiring. A guard nobody consults is decoration.
// ─────────────────────────────────────────────────────────────────────────────
function steps() {
  const at = WF.indexOf('\n    steps:');
  expect(at).toBeGreaterThan(-1);
  return WF.slice(at).split(/\n      - (?=name:|uses:)/).slice(1).map((body) => ({
    name: body.match(/^name:\s*(.*)$/m)?.[1]?.trim() ?? '',
    id: body.match(/^\s{8}id:\s*(\S+)/m)?.[1] ?? null,
    body,
  }));
}
const byId = (id) => steps().find((s) => s.id === id);

describe('smithery-freshness.yml — the white-glove write is gated by the drift guard', () => {
  it('the guard runs before the write and reads api.smithery.ai through the script, never the registry', () => {
    const all = steps();
    const g = all.findIndex((s) => s.id === 'driftguard');
    const w = all.findIndex((s) => s.id === 'whiteglove');
    expect(g).toBeGreaterThan(-1);
    expect(w).toBeGreaterThan(g);
    // the step's own text only: the next step's leading comments (6-space
    // indent) land in this slice, and they legitimately NAME the registry.
    const body = byId('driftguard').body.split('\n      #')[0];
    expect(body).toContain('scripts/smithery_drift_guard.py');
    expect(body).toContain('python3 scripts/smithery_drift_guard.py');
    expect(body).not.toContain('registry.smithery.ai');
    expect(readFileSync(GUARD, 'utf8')).toMatch(/^API = "https:\/\/api\.smithery\.ai\/servers\/azmartone67\/dchub"$/m);
  });

  it('the guard step dedupes the issue by its fixed title and never fails red on a foreign edit', () => {
    const body = byId('driftguard').body;
    expect(body).toContain('ISSUE_TITLE: Smithery listing edited outside the repo');
    expect(body).toMatch(/gh issue list[^\n]*--state open/);
    expect(body).toContain('gh issue edit');
    expect(body).toContain('gh issue create');
    expect(body).toContain('--force "$FORCE_OVERWRITE"');
  });

  it('workflow_dispatch has force_overwrite, boolean, default false; permissions allow the artifact read and the issue', () => {
    expect(WF).toMatch(/workflow_dispatch:\n\s+inputs:\n\s+force_overwrite:[\s\S]*?type: boolean\n\s+default: false/);
    expect(WF).toMatch(/^permissions:\n(?:  .*\n|\s*#.*\n)*?  actions: read\n  issues: write/m);
    expect(byId('driftguard').body).toContain("FORCE_OVERWRITE: ${{ inputs.force_overwrite || 'false' }}");
  });

  it('the record is only marked after the write heredoc exits 0, and is carried as an artifact before the beat', () => {
    const wg = byId('whiteglove').body;
    const end = wg.indexOf('PY_WG\n', wg.indexOf("<<'PY_WG'") + 1);
    expect(end).toBeGreaterThan(-1);
    expect(wg.indexOf('--mark-written')).toBeGreaterThan(end);
    const all = steps();
    const up = all.findIndex((s) => /uses: actions\/upload-artifact/.test(s.body));
    expect(up).toBeGreaterThan(all.findIndex((s) => s.id === 'whiteglove'));
    expect(up).toBeLessThan(all.findIndex((s) => s.id === 'beat'));
    expect(all[up].body).toContain('name: smithery-description-last-written');
    expect(byId('driftguard').body).toContain('name=smithery-description-last-written');
  });

  it('copycheck does not go red on a held foreign edit; the beat reads the guard', () => {
    expect(byId('copycheck').body).toMatch(/if \[ "\$\{DRIFT_VERDICT:-\}" = "foreign_edit" \]; then[\s\S]*?exit 0/);
    const beat = byId('beat').body;
    expect(beat).toContain('steps.driftguard.outcome');
    expect(beat).toContain('"driftguard:$OUTCOME_DRIFTGUARD"');
  });

  // Run the REAL gate shell from the workflow, with the python write swapped
  // for a marker, for every verdict the guard can hand it.
  async function gate(verdict) {
    const wg = byId('whiteglove').body;
    const runAt = wg.indexOf('run: |\n');
    const pyAt = wg.indexOf("python3 - <<'PY_WG'");
    expect(runAt).toBeGreaterThan(-1);
    expect(pyAt).toBeGreaterThan(runAt);
    const shell = wg.slice(runAt + 'run: |\n'.length, pyAt).replace(/^ {10}/gm, '') + 'echo WOULD_WRITE\n';
    const env = { PATH: process.env.PATH, SMITHERY_API_KEY: 'k' };
    if (verdict !== undefined) env.DRIFT_VERDICT = verdict;
    return tryRun('bash', ['-eo', 'pipefail', '-c', shell], { env });
  }

  it('the white-glove shell reaches the PATCH ONLY on verdict=write', async () => {
    expect((await gate('write')).stdout).toContain('WOULD_WRITE');
    for (const v of ['foreign_edit', 'in_sync', 'unreadable', '', undefined]) {
      const r = await gate(v);
      expect(r.code, `verdict ${v}`).toBe(0);
      expect(r.stdout, `verdict ${v} must not write`).not.toContain('WOULD_WRITE');
    }
    expect((await gate('foreign_edit')).stdout).toMatch(/::warning::drift guard: the live description was edited outside the repo/);
  });
});
