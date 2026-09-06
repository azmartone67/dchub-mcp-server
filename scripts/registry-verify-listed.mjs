#!/usr/bin/env node
/**
 * registry-verify-listed — did the submission actually LAND?
 *
 * WHY THIS EXISTS
 * The weekly registry lane reported `success` for four consecutive runs while
 * two of its three targets were not listed at all. "Success" meant a branch was
 * prepared and a PR link surfaced — never that a maintainer accepted it. Nobody
 * was watching the outcome, so on 2026-08-05:
 *
 *   TensorBlock  PR #1136 MERGED    → listed ✅
 *   punkpeye     listed, but refresh #10161 open and FOUR earlier refreshes
 *                (#9013 #8200 #8198 #8016) CLOSED WITHOUT MERGE — we kept
 *                re-submitting into a repo that keeps declining
 *   MobinX       PR #346 open 2w    → NOT listed
 *   YuzeHao2023  PR #378 open 2w    → NOT listed
 *
 * This reads the SAME TARGETS table the submitter writes from (imported, never
 * copied — two copies of that table would drift, and a verifier checking a
 * stale list is worse than no verifier) and reports, per list, what is actually
 * true on the wire.
 *
 * ★ WHAT IS AND IS NOT OUR FAULT — the verdicts encode the difference.
 * We control whether a PR EXISTS. We do not control whether a maintainer merges
 * it. So:
 *   LISTED    the entry is in the file. Done.
 *   PENDING   not listed, but an open PR exists — waiting on a human who does
 *             not work here. NOT a failure; reported so it cannot be forgotten.
 *   DECLINED  not listed, and our last PR was closed unmerged. Also not a bug —
 *             but re-submitting into it burns goodwill, and the lane has done
 *             that four times.
 *   MISSING   not listed and NO PR exists. This one IS ours: the lane believes
 *             it submitted and did not.
 *   UNREADABLE the file or the API could not be read. Never counted as absent —
 *             "I could not look" is not "it is not there".
 *
 * Exit 1 ONLY on MISSING. A pending PR must never fail a build, or the signal
 * gets muted and the genuinely-broken case goes with it.
 */
import { TARGETS, REFRESH_TARGETS } from './registry-pr-submit.mjs';

const OWNER = 'azmartone67';
const UA = { 'User-Agent': 'dchub-registry-verify', 'Accept': 'application/vnd.github+json' };
const TOKEN = (process.env.REGISTRY_PAT || process.env.GITHUB_TOKEN || '').trim();
const STALE_PR_DAYS = Number(process.env.REGISTRY_PR_STALE_DAYS || 21);

const gh = (p) => fetch(`https://api.github.com${p}`, {
  headers: TOKEN ? { ...UA, Authorization: `Bearer ${TOKEN}` } : UA,
});

/** Is our entry in the file the submitter writes to? null = could not read. */
async function isListed(t) {
  const url = `https://raw.githubusercontent.com/${t.upstream}/${t.base || 'main'}/${t.path}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'dchub-registry-verify' } });
    if (!r.ok) return null;                    // UNREADABLE, not absent
    const text = await r.text();
    // Reuse the submitter's OWN regex. A second pattern here could call a list
    // "missing" that the submitter considers listed, and they would fight.
    const re = t.listedRe || /dchub|dc[\s-]?hub/i;
    return re.test(text);
  } catch { return null; }
}

/** Our PRs to this upstream, newest first. null = could not read.
 *
 * ★ SEARCH BY AUTHOR, never `/pulls?per_page=N`. The first version listed the
 *   50 most recent PRs REPO-WIDE and filtered locally — which works on a quiet
 *   list and silently returns nothing on a busy one. punkpeye has thousands of
 *   PRs, so ours (#8016 #8198 #8200 #9013) sat far outside that window and the
 *   verifier reported a clean "LISTED" while four of our PRs had been declined.
 *   A pagination default is not a filter.
 */
async function ourPrs(upstream) {
  try {
    const q = encodeURIComponent(`repo:${upstream} author:${OWNER} type:pr`);
    const r = await gh(`/search/issues?q=${q}&per_page=100`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d.items)) return null;
    return d.items
      .map((p) => ({
        number: p.number,
        state: p.state,
        created_at: p.created_at,
        // The search API nests merge state under pull_request.merged_at.
        merged_at: p.pull_request?.merged_at || null,
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch { return null; }
}

const ageDays = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;

export function verdictFor(listed, prs, kind = 'add', target = {}) {
  // ★2026-09-06 — A DECISION IS NOT A FAILED SUBMISSION.
  //   #362 put five auto-discovered stubs into TARGETS: two enabled, three
  //   DECLINED with written reasons, and the declined ones kept deliberately so
  //   the crawl stops re-proposing them. This verifier iterated TARGETS without
  //   looking at `enabled`, so all three read as MISSING — "not listed and no PR
  //   of ours exists" — which exits 1. The weekly lane would have gone red
  //   forever, for three lists we had decided NOT to submit to.
  //   MISSING means "the lane believes it submitted and did not". A stub we
  //   chose never to submit has no such belief to betray.
  if (target.enabled === false) {
    return target.declined
      ? { state: 'DECLINED_BY_US', why: `we chose not to submit: ${target.declined}` }
      : { state: 'UNVETTED', why: 'stub awaiting human vet — never submitted, by design' };
  }
  if (listed === null) return { state: 'UNREADABLE', why: 'could not read the target file' };
  if (listed) {
    // ★ LISTED is not the whole truth for a REFRESH target. punkpeye lists us
    //   and has closed FOUR refresh PRs unmerged (#9013 #8200 #8198 #8016) — so
    //   the entry is there but its counts are frozen at whatever the last
    //   accepted edit said, and the lane kept re-submitting into it. Reporting a
    //   bare "LISTED" would hide the part that needs a human decision: stop
    //   re-submitting, or reach the maintainer.
    const declined = (prs || []).filter((p) => p.state === 'closed' && !p.merged_at);
    if (kind === 'refresh' && declined.length >= 2) {
      return {
        state: 'LISTED',
        why: `our entry is in the file, but ${declined.length} refresh PR(s) were `
          + `closed unmerged (${declined.slice(0, 4).map((p) => `#${p.number}`).join(' ')}) `
          + '— the listed COUNTS are likely stale and re-submitting is not working',
        refreshDeclined: declined.length,
      };
    }
    return { state: 'LISTED', why: 'our entry is in the file' };
  }
  if (prs === null) return { state: 'UNREADABLE', why: 'not listed; could not read PRs to say why' };
  const open = prs.find((p) => p.state === 'open');
  if (open) {
    const d = Math.round(ageDays(open.created_at));
    return {
      state: 'PENDING',
      why: `PR #${open.number} open ${d}d${d >= STALE_PR_DAYS ? ' — past the stale mark' : ''}`,
      stale: d >= STALE_PR_DAYS,
    };
  }
  const closedUnmerged = prs.filter((p) => p.state === 'closed' && !p.merged_at);
  if (closedUnmerged.length) {
    return {
      state: 'DECLINED',
      why: `${closedUnmerged.length} PR(s) closed without merge (`
        + closedUnmerged.slice(0, 4).map((p) => `#${p.number}`).join(' ') + ')',
    };
  }
  return { state: 'MISSING', why: 'not listed and no PR of ours exists' };
}

async function main() {
  const all = [...TARGETS.map((t) => ({ ...t, kind: 'add' })),
               ...REFRESH_TARGETS.map((t) => ({ ...t, kind: 'refresh' }))];
  console.log(`▶ registry-verify-listed — ${all.length} list(s)`
    + (TOKEN ? '' : ' (no token: PR state UNREADABLE)') + '\n');

  const rows = [];
  for (const t of all) {
    const [listed, prs] = await Promise.all([isListed(t), ourPrs(t.upstream)]);
    const v = verdictFor(listed, prs, t.kind, t);
    rows.push({ key: t.key, upstream: t.upstream, kind: t.kind, ...v });
    const icon = { LISTED: '✅', PENDING: '⏳', DECLINED: '🚫', MISSING: '❌', UNREADABLE: '⚪', DECLINED_BY_US: '⛔', UNVETTED: '⏸' }[v.state];
    console.log(`  ${icon} ${v.state.padEnd(10)} ${t.key.padEnd(12)} ${t.upstream}`);
    console.log(`     ${v.why}`);
  }

  const n = (s) => rows.filter((r) => r.state === s).length;
  // ★2026-09-06 — `stale` was COMPUTED AND DISCARDED. verdictFor() has set it
  //   since STALE_PR_DAYS was introduced, and nothing downstream read it: the
  //   counts line, the job summary and the closing sentence all treated a PR
  //   open 3 days and one open 58 days as the same "pending". So the one number
  //   that says whether submitting is WORKING was calculated every run and
  //   thrown away.
  //   Measured the day this landed: MobinX #346 open 58d, YuzeHao #378 41d,
  //   docker/mcp-registry #4644 31d — 1 merge out of 6 submissions, under a
  //   green check reading "every list is either listed, pending a maintainer,
  //   or declined by one". True, and the reason nobody looked.
  const stale = rows.filter((r) => r.stale);
  console.log(`\n  listed ${n('LISTED')} · pending ${n('PENDING')} (${stale.length} stale)`
    + ` · declined ${n('DECLINED')}`
    + ` · missing ${n('MISSING')} · unreadable ${n('UNREADABLE')}`
    + ` · ours-declined ${n('DECLINED_BY_US')} · unvetted ${n('UNVETTED')}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ['## 📋 Registry listing status\n',
      '| | list | state | detail |', '|---|---|---|---|',
      ...rows.map((r) => `| ${r.stale ? '🕰️' : { LISTED: '✅', PENDING: '⏳', DECLINED: '🚫', MISSING: '❌', UNREADABLE: '⚪', DECLINED_BY_US: '⛔', UNVETTED: '⏸' }[r.state]}`
        + ` | \`${r.upstream}\` | ${r.state}${r.stale ? ' (stale)' : ''} | ${r.why} |`),
      '',
      '_`PENDING` waits on a maintainer and is not a failure. `MISSING` means the',
      'lane believes it submitted and did not — that one is ours._',
      `_🕰️ = our PR has been open past ${STALE_PR_DAYS}d. Still not a build failure —`,
      'we do not control merges — but it is a different state from "just submitted",',
      'and it is the one that says submitting has stopped working._', ''].join('\n');
    try {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    } catch { /* summary is a courtesy, never the check */ }
  }

  // ★ Only MISSING fails. A pending PR failing the build would train everyone to
  //   ignore this step, and the genuinely-broken case would be ignored with it.
  if (n('MISSING')) {
    console.error(`\n❌ ${n('MISSING')} list(s) have no entry AND no PR — the lane did not submit.`);
    process.exit(1);
  }
  // ★ Stale does NOT exit 1, deliberately — we control whether a PR exists, not
  //   whether a stranger merges it, and failing a build over someone else's
  //   queue is how this step gets muted. But it must not be reported as clean
  //   either: that closing sentence was TRUE while five PRs sat unmerged, the
  //   oldest 58 days, and being true is exactly what made it useless.
  if (stale.length) {
    console.log(`\n🕰️  ${stale.length} of our PR(s) open past ${STALE_PR_DAYS}d — `
      + 'submitted, not landed:');
    for (const r of stale) console.log(`     ${r.upstream} — ${r.why}`);
    console.log('   Not a failure and not ours to fix. Worth a nudge, a different '
      + 'list, or accepting that this one will not land.');
    return;
  }
  console.log('\n✓ every list is either listed, pending a maintainer, or declined by one.');
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
}
