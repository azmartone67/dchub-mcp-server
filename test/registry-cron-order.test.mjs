// =============================================================================
// Registry onboarding: the ordering guard SURVIVES its own schedules
// -----------------------------------------------------------------------------
// ORIGINAL PURPOSE (2026-08-30). Two halves of auto-onboarding a new MCP
// partner: registry-discover crawls for new curated lists and files a stub PR
// into pr-submit's TARGETS; registry-pr-submit opens the listing PR to each
// TARGET. They ran in the WRONG ORDER — submit 07:30, discover 07:40 — so
// discovery could not reach the submit run it feeds, by construction. This
// test held the order.
//
// 2026-09-07 — r-stop-the-rank-chase. BOTH schedules were removed. The channel
// they serve produced, over 30 days on production: 1 install-page key minted
// (client_name `verify-durability` — our own probe), 0 calls, 0 returns; and
// 0 of 2 honest paid sales bridged to any MCP signal. The workflows stay
// runnable via workflow_dispatch; only the cron is gone.
//
// ★ THE GUARD IS NOT DELETED, IT IS REPOINTED. An ordering assertion over two
// unscheduled workflows is vacuous — the old `weeklyCronMinutes()` would have
// failed on "no '- cron:' schedule line found", and the tempting fix (delete
// the file) silently discards the constraint. If either workflow is ever
// re-scheduled, the ordering requirement comes back with it and nothing would
// have been left to say so. So this now asserts the CURRENT state and fails
// loudly, with instructions, the moment that state changes.
//
// Why a test and not a comment: both files already carried a comment naming
// their relationship, and that comment described the broken order approvingly
// for six weeks. A comment cannot fail.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const wf = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

/**
 * Weekly cron minute-of-week for a `- cron: 'M H * * D'` line, or null.
 * Only the first schedule entry is read — these workflows have exactly one.
 */
function weeklyCronMinutes(yaml, file) {
  const m = yaml.match(/^\s*-\s*cron:\s*['"](\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)['"]/m);
  expect(m, `${file}: no '- cron:' schedule line found`).toBeTruthy();
  const [, min, hour, dom, mon, dow] = m;
  expect(
    /^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dow),
    `${file}: cron '${min} ${hour} ${dom} ${mon} ${dow}' is not a plain ` +
      `weekly minute/hour/day — this guard compares fixed weekly times and ` +
      `cannot reason about ranges or steps. Update it with the schedule.`,
  ).toBe(true);
  return Number(dow) * 1440 + Number(hour) * 60 + Number(min);
}

describe('registry onboarding cron order', () => {
  const discover = wf('registry-discover.yml');
  const submit = wf('registry-pr-submit.yml');

  // A workflow is "scheduled" iff it has an ACTIVE `- cron:` line. The
  // disabling PR left the original crons in place as comments so restoring
  // them is one edit, so this must not match a commented line.
  const activeCrons = (yaml) =>
    yaml.split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .filter((l) => /^\s*-\s*cron:/.test(l));

  it('both onboarding workflows are dispatch-only', () => {
    for (const [name, yaml] of [['registry-discover.yml', discover],
                                ['registry-pr-submit.yml', submit]]) {
      expect(
        activeCrons(yaml),
        `${name} has regained a schedule. That is allowed — but the ordering ` +
          `constraint this file was written for comes BACK with it: discovery ` +
          `feeds submission's TARGETS, so discover must run BEFORE pr-submit ` +
          `in minutes-of-week. Restore the weeklyCronMinutes() comparison ` +
          `(see git history for this file) rather than deleting this test.`,
      ).toEqual([]);
      expect(yaml, `${name} lost workflow_dispatch — it is now unrunnable`)
        .toMatch(/^\s*workflow_dispatch:/m);
    }
  });

  it('the original crons are preserved as comments, so restoring is one edit', () => {
    expect(discover, 'registry-discover.yml lost its commented-out cron')
      .toMatch(/#\s*-\s*cron:\s*'30 7 \* \* 1'/);
    expect(submit, 'registry-pr-submit.yml lost its commented-out cron')
      .toMatch(/#\s*-\s*cron:\s*'40 7 \* \* 1'/);
  });

  it('the stale-number guard is NOT disabled', () => {
    // registry-refresh's first job fails the build if a forbidden/stale figure
    // ($324B, wrong facility counts) reappears in the source files the public
    // registries pull from. That is correctness, not rank, and it stays.
    expect(activeCrons(wf('registry-refresh.yml')).length,
      'registry-refresh lost its schedule — the stale-number guard that keeps ' +
      'retracted figures off journalist-facing registry pages no longer runs',
    ).toBeGreaterThan(0);
  });
});
