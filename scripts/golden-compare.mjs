#!/usr/bin/env node
// Golden compare (Grok spec item 3 part B, 2026-11-24): diff two golden runs (scripts/golden-run.mjs) and fail
// when the second (the PR) is worse than the first (its base). Both runs should come from the same runner in the
// same minutes against the same backend, so a backend wobble moves both; see .github/workflows/golden-gate.yml.
//
// Fails (exit 1) on, per mode present in both runs:
//   1. the NO DATA count rises
//   2. the ERROR or WALLED count rises (WALLED: the call limit answered, not the planner; a walled row is not
//      compared question by question)
//   3. an intent's failed + timed_out step count rises
//   4. an answer that was FULL in the base and carried the dated "Source: DC Hub (dchub.cloud), as of YYYY-MM-DD"
//      line (or a cite_as dated "as of YYYY-MM-DD") no longer carries it
//   5. p95 latency rises more than --p95-pct (default 25) percent AND more than --p95-floor-ms (default 500) ms
//      (the floor keeps a 400 -> 520 ms wobble on a 26-sample run from failing a PR)
//   6. an intent whose class was in its expect_class list in the base is no longer in it (a misroute)
// Planned-tool changes and status moves that are not regressions are printed, not failed.
//
// Usage: node scripts/golden-compare.mjs <base.json> <head.json> [--p95-pct 25] [--p95-floor-ms 500]
// Writes a markdown report to stdout and, in GitHub Actions, to $GITHUB_STEP_SUMMARY.
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RANK = { FULL: 0, PLANNED: 0, PARTIAL: 1, 'NO DATA': 2, WALLED: 3, ERROR: 3 };

export function compare(base, head, { p95Pct = 25, p95FloorMs = 500 } = {}) {
  const fails = [];
  const notes = [];
  const modes = (base.modes || []).filter((m) => (head.modes || []).includes(m));
  if (!modes.length) fails.push('no mode in common between the two runs');
  const key = (r) => r.id + '|' + r.mode;
  const hb = new Map((head.results || []).map((r) => [key(r), r]));
  for (const m of modes) {
    const bs = base.summary && base.summary[m] || {};
    const hs = head.summary && head.summary[m] || {};
    for (const s of ['NO DATA', 'ERROR', 'WALLED']) {
      if ((hs[s] || 0) > (bs[s] || 0)) fails.push(`[${m}] ${s} count rose ${bs[s] || 0} -> ${hs[s] || 0}`);
    }
    const bp = bs.p95_ms; const hp = hs.p95_ms;
    if (Number.isFinite(bp) && Number.isFinite(hp) && hp > bp * (1 + p95Pct / 100) && hp - bp > p95FloorMs) {
      fails.push(`[${m}] p95 latency rose ${bp} -> ${hp} ms (+${Math.round((hp / bp - 1) * 100)}%, limit +${p95Pct}% and +${p95FloorMs} ms)`);
    }
    for (const b of (base.results || []).filter((r) => r.mode === m)) {
      const h = hb.get(key(b));
      if (!h) { fails.push(`[${m}] ${b.id}: missing from the head run`); continue; }
      // A walled row is the call limit's answer, not the planner's: no per-question rule reads it (the count rule
      // above still fails a head run walled more often than its base).
      if (b.status === 'WALLED' || h.status === 'WALLED') { notes.push(`[${m}] ${b.id}: not compared (${b.status} -> ${h.status})`); continue; }
      if ((h.failed_steps || 0) > (b.failed_steps || 0)) {
        fails.push(`[${m}] ${b.id}: failed/timed-out steps rose ${b.failed_steps || 0} -> ${h.failed_steps} (${(h.failed_tools || []).join(', ')})`);
      }
      if (b.status === 'FULL' && b.source_line && !h.source_line) fails.push(`[${m}] ${b.id}: FULL answer lost its dated Source line`);
      if (b.status === 'FULL' && b.dated_cite && !h.dated_cite) fails.push(`[${m}] ${b.id}: FULL answer lost its dated cite_as (${h.cite_as || 'none'})`);
      if (b.class_ok === true && h.class_ok === false) fails.push(`[${m}] ${b.id}: routed to ${h.intent_class}, was ${b.intent_class} (expected class)`);
      if (b.status !== h.status) {
        notes.push(`[${m}] ${b.id}: ${b.status} -> ${h.status}${RANK[h.status] > RANK[b.status] ? ' (worse)' : ' (better)'}`);
      }
      if (b.intent_class !== h.intent_class && !(b.class_ok === true && h.class_ok === false)) notes.push(`[${m}] ${b.id}: class ${b.intent_class} -> ${h.intent_class}`);
      const bt = (b.tools || []).join(','); const ht = (h.tools || []).join(',');
      if (bt !== ht) notes.push(`[${m}] ${b.id}: tools ${bt || '-'} -> ${ht || '-'}`);
    }
  }
  return { ok: fails.length === 0, fails, notes, modes };
}

function table(base, head, modes) {
  const cols = ['FULL', 'PARTIAL', 'NO DATA', 'ERROR', 'WALLED', 'failed_steps', 'class_mismatch', 'source_line', 'dated_cite', 'p95_ms'];
  const rows = ['| mode | run | ' + cols.join(' | ') + ' |', '|' + ' --- |'.repeat(cols.length + 2)];
  for (const m of modes) for (const [n, r] of [['base', base], ['head', head]]) {
    const s = r.summary && r.summary[m] || {};
    rows.push(`| ${m} | ${n} | ` + cols.map((c) => (s[c] ?? '')).join(' | ') + ' |');
  }
  return rows.join('\n');
}

function parse(argv) {
  const o = { files: [], p95Pct: 25, p95FloorMs: 500 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--p95-pct') o.p95Pct = Number(argv[++i]);
    else if (argv[i] === '--p95-floor-ms') o.p95FloorMs = Number(argv[++i]);
    else o.files.push(argv[i]);
  }
  if (o.files.length !== 2) throw new Error('usage: golden-compare.mjs <base.json> <head.json> [--p95-pct N] [--p95-floor-ms N]');
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parse(process.argv.slice(2));
  const [base, head] = o.files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const r = compare(base, head, o);
  const md = [`## Golden gate (${head.tool || 'execute_plan'}): ${r.ok ? 'PASS' : 'FAIL'}`,
    `base: ${base.target} (${base.started_at}); head: ${head.target} (${head.started_at})`,
    (head.skipped_modes || []).length ? `skipped: ${head.skipped_modes.join('; ')}` : '',
    '', table(base, head, r.modes), '',
    r.fails.length ? '### Regressions\n' + r.fails.map((f) => '- ' + f).join('\n') : 'No regression.',
    r.notes.length ? '\n### Changes (not failing)\n' + r.notes.map((f) => '- ' + f).join('\n') : ''].filter((x) => x !== '').join('\n');
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch (_) { /* summary is optional */ } }
  process.exit(r.ok ? 0 : 1);
}
