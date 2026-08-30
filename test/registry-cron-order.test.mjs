// =============================================================================
// Registry onboarding: DISCOVER must be scheduled before PR-SUBMIT
// -----------------------------------------------------------------------------
// The two halves of auto-onboarding a new MCP partner:
//
//   registry-discover.yml    crawls for NEW curated MCP lists, files a stub PR
//                            adding each candidate to pr-submit's TARGETS
//   registry-pr-submit.yml   opens the listing PR to every configured TARGET
//
// Measured 2026-08-30, they ran in the WRONG ORDER: pr-submit at Monday 07:30,
// discover at Monday 07:40 — ten minutes later. Discovery therefore could not
// reach the submit run it feeds, by construction. Every candidate found on a
// Monday had already missed that Monday's window and waited a full week.
//
// ★ This ordering is necessary, NOT sufficient, and the test says so rather
// than implying a fix it did not make: a candidate still clears a HUMAN vet
// between the two — discover's stub PR must be MERGED into TARGETS before
// pr-submit acts on it. On 2026-08-29 the submission queue had held one item
// for 32 days; that is the review step, not this schedule. What the order
// buys is that discovery is no longer structurally guaranteed to miss.
//
// Why a test and not a comment: both files already carried a comment naming
// their relationship ("right after pr-submit"), and that comment described the
// broken order approvingly for six weeks. A comment cannot fail.
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

  it('discovery is scheduled before submission', () => {
    const d = weeklyCronMinutes(discover, 'registry-discover.yml');
    const s = weeklyCronMinutes(submit, 'registry-pr-submit.yml');
    expect(
      d,
      `registry-discover is scheduled AFTER registry-pr-submit ` +
        `(discover=${d}, submit=${s}, minutes-of-week). Discovery feeds ` +
        `submission's TARGETS, so running it second means anything it finds ` +
        `misses that week's submit run by construction — the exact defect ` +
        `fixed on 2026-08-30.`,
    ).toBeLessThan(s);
  });

  it('both run on the same weekday, so the order is meaningful', () => {
    const dow = (yaml) =>
      yaml.match(/^\s*-\s*cron:\s*['"]\S+\s+\S+\s+\S+\s+\S+\s+(\S+)['"]/m)?.[1];
    expect(
      dow(discover),
      'discover and pr-submit run on different weekdays; the ordering ' +
        'assertion above would still pass while the real gap became a week.',
    ).toBe(dow(submit));
  });

  it('neither file still describes discovery as following submission', () => {
    // The stale comment that made the wrong order look intentional.
    expect(discover).not.toMatch(/right after pr-submit/i);
  });
});
