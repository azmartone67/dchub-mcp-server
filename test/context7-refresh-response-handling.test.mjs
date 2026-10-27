// context7-refresh.yml answers Context7's refresh API. Context7 allows one refresh
// per library every 10 days and replies 400 {"error":"too-early"} inside that
// window (measured 2026-10-27: /llmstxt/dchub_cloud_llms_txt, "Last update was 0
// days ago. Minimum 10 days required between updates."). We release almost daily,
// so with a real CONTEXT7_API_KEY that leg was red after most releases.
//
// This runs the workflow's REAL shell step under bash with a fake `curl` that
// returns a chosen status and body, so the test fails if the step's behaviour
// changes, not if its wording does.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WF = readFileSync(new URL('../.github/workflows/context7-refresh.yml', import.meta.url), 'utf8');

/** The `run: |` block of the step named "POST /api/v1/refresh", dedented. */
function refreshStep() {
  const lines = WF.split('\n');
  const start = lines.findIndex((l) => /^\s*- name: POST \/api\/v1\/refresh\s*$/.test(l));
  if (start < 0) throw new Error('refresh step not found');
  const run = lines.findIndex((l, i) => i > start && /^\s*run: \|\s*$/.test(l));
  if (run < 0) throw new Error('refresh step has no run block');
  const indent = lines[run].match(/^\s*/)[0].length + 2;
  const out = [];
  for (let i = run + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.trim() && l.match(/^\s*/)[0].length < indent) break;
    out.push(l.slice(indent));
  }
  return out.join('\n');
}

function runStep({ code, body, key = 'ctx7sk-test' }) {
  const dir = mkdtempSync(join(tmpdir(), 'c7-'));
  const shim = join(dir, 'curl');
  // Honours `-o FILE` like the real curl, and prints the status for `-w '%{http_code}'`.
  writeFileSync(shim, `#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift; fi
  shift
done
printf '%s' "$FAKE_BODY" > "$out"
printf '%s' "$FAKE_CODE"
`);
  chmodSync(shim, 0o755);
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const r = spawnSync('bash', ['-e', '-c', refreshStep()], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, CONTEXT7_API_KEY: key, LIBRARY: '/llmstxt/example',
      GITHUB_STEP_SUMMARY: summary, FAKE_CODE: String(code), FAKE_BODY: body },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, summary: readFileSync(summary, 'utf8') };
}

const TOO_EARLY = '{"error":"too-early","message":"Too early to refresh the project. Last update was 0 days ago. Minimum 10 days required between updates."}';

describe('context7-refresh: response handling', () => {
  it('MUST-FAIL CONTROL: the harness runs the real step and an accepted refresh passes', () => {
    const r = runStep({ code: 200, body: '{"message":"Refresh started successfully"}' });
    expect(r.status).toBe(0);
    expect(r.summary).toContain('Context7 refresh requested: /llmstxt/example (HTTP 200)');
  });

  it('too-early is a notice and does not fail the run', () => {
    const r = runStep({ code: 400, body: TOO_EARLY });
    expect(r.status).toBe(0);
    expect(r.out).toContain('::notice::');
    expect(r.out).not.toContain('::error::');
    expect(r.summary).toContain('Context7 refresh skipped (too early): /llmstxt/example');
  });

  it('any other 400 still fails the run', () => {
    for (const body of ['{"error":"invalid_library","message":"nope"}', 'not json at all', '']) {
      const r = runStep({ code: 400, body });
      expect(r.status, body).not.toBe(0);
      expect(r.out, body).toContain('::error::Context7 refresh for /llmstxt/example failed: HTTP 400');
    }
  });

  it('an invalid key (401) and a server error (500) still fail the run', () => {
    for (const code of [401, 403, 500, 502]) {
      const r = runStep({ code, body: '{"error":"invalid_api_key"}' });
      expect(r.status, String(code)).not.toBe(0);
      expect(r.out, String(code)).toContain(`HTTP ${code}`);
    }
  });

  it('a rate limit (429) stays a warning, and a missing key stays a warning', () => {
    const r = runStep({ code: 429, body: '{}' });
    expect(r.status).toBe(0);
    expect(r.out).toContain('::warning::Context7 rate limit');
    const noKey = runStep({ code: 200, body: '{}', key: '' });
    expect(noKey.status).toBe(0);
    expect(noKey.out).toContain('CONTEXT7_API_KEY secret not set');
  });
});
