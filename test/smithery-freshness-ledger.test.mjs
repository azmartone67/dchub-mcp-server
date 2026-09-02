// =============================================================================
// smithery-freshness.yml: a failed white-glove write must be VISIBLE.
// -----------------------------------------------------------------------------
// The white-glove step PATCHes the Smithery description with SMITHERY_API_KEY.
// Measured on run 33519871704 (2026-09-01 14:30Z), and the same on 08-31 and
// 08-29: `Smithery PATCH failed HTTP 403: Missing required permission:
// servers:write`. The key has never had write scope; the 08-30 "pass" was the
// early exit (live copy already == txt). Two things hid it:
//   · the job's error line said only "failure" — the missing PERMISSION, an
//     owner action, was buried in a step log;
//   · the dead-man beat ran BEFORE the write, success-only, so the ledger
//     recorded a clean beat minutes before the PATCH died. On the board the
//     lane read healthy; a failed day could only ever surface as "overdue",
//     a day later, indistinguishable from a cron that never fired.
//
// This pins the shape of the fix in the workflow text (the same pattern as
// registry-cron-order.test.mjs — a comment cannot fail, a test can):
//   · 403 → `::error title=SMITHERY_KEY_SCOPE::` naming the permission, handed
//     to the beat via GITHUB_OUTPUT;
//   · the beat is LAST, `if: always()`, and sends status=error with the failed
//     step named when any step failed — status=success only when all passed.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const wf = readFileSync(new URL('../.github/workflows/smithery-freshness.yml', import.meta.url), 'utf8');

/** Steps in file order: {name, id, cond, body}, split on the `- name:`/`- uses:` bullets under steps:. */
function steps() {
  const at = wf.indexOf('\n    steps:');
  expect(at).toBeGreaterThan(-1);
  return wf.slice(at).split(/\n      - (?=name:|uses:)/).slice(1).map((body) => ({
    name: body.match(/^name:\s*(.*)$/m)?.[1]?.trim() ?? '',
    id: body.match(/^\s{8}id:\s*(\S+)/m)?.[1] ?? null,
    cond: body.match(/^\s{8}if:\s*(.*)$/m)?.[1]?.trim() ?? null,
    body,
  }));
}
const byId = (id) => steps().find((s) => s.id === id);

describe('smithery-freshness.yml — the key-scope failure is named and reported', () => {
  it('parses the steps and finds every id this file reasons about (not vacuous)', () => {
    const ids = steps().map((s) => s.id).filter(Boolean);
    expect(ids).toEqual(expect.arrayContaining(['publish', 'converge', 'whiteglove', 'copycheck', 'beat']));
  });

  it('a 403 on the PATCH is a titled SMITHERY_KEY_SCOPE error that names the missing permission', () => {
    const wg = byId('whiteglove');
    expect(wg).toBeTruthy();
    expect(wg.body).toMatch(/e\.code == 403/);
    expect(wg.body).toContain('::error title=SMITHERY_KEY_SCOPE::');
    expect(wg.body).toMatch(/Missing required permission/);
    expect(wg.body).toContain('servers:write');
    expect(wg.body).toMatch(/OWNER ACTION/);
    // the scope is handed to the beat step
    expect(wg.body).toMatch(/GITHUB_OUTPUT/);
    expect(wg.body).toMatch(/key_scope_missing=/);
  });

  it('the ledger beat runs on failure too, and reports status=error naming the failed step', () => {
    const beat = byId('beat');
    expect(beat).toBeTruthy();
    expect(beat.cond).toBe('always()');
    for (const id of ['publish', 'converge', 'whiteglove', 'copycheck']) {
      expect(beat.body, `beat must read steps.${id}.outcome`).toContain(`steps.${id}.outcome`);
    }
    expect(beat.body).toMatch(/STATUS=error/);
    expect(beat.body).toMatch(/STATUS=success/);
    expect(beat.body).toMatch(/failure\|cancelled\)/);
    expect(beat.body).toMatch(/status:\$s/); // the status variable reaches the JSON body
    expect(beat.body).toMatch(/feed:"smithery-freshness"/); // feed name intact in the jq body
  });

  it('the beat note carries the scope marker so the dead-man board names the owner action', () => {
    const beat = byId('beat');
    expect(beat.body).toContain('steps.whiteglove.outputs.key_scope_missing');
    expect(beat.body).toMatch(/SMITHERY_KEY_SCOPE/);
    expect(beat.body).toMatch(/regenerate the key/i);
  });

  it('the beat is the LAST step — after the white-glove write and the copy check it reports on', () => {
    const all = steps();
    const idx = (id) => all.findIndex((s) => s.id === id);
    expect(idx('beat')).toBe(all.length - 1);
    expect(idx('beat')).toBeGreaterThan(idx('whiteglove'));
    expect(idx('beat')).toBeGreaterThan(idx('copycheck'));
    // and no other success-only beat survives earlier in the job
    expect(all.filter((s) => /dead-man ledger/i.test(s.name))).toHaveLength(1);
  });

  it('a ledger outage still cannot redden a healthy publish', () => {
    expect(byId('beat').body).toMatch(/\|\| echo "::warning::beat failed/);
  });
});
