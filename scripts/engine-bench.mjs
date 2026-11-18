#!/usr/bin/env node
// engine-bench.mjs -- run the engine's fixed question set against live /mcp and grade every answer.
//
// The first slice of the daily MCP self-improvement engine: benchmark + rubric, no auto-PR. Each question goes
// to execute_plan keyless with detail "compact", QA-marked by scripts/qa-probe.mjs (UA, X-DCHub-QA and client
// name), one at a time. lib/engine-grade.mjs grades the lead an agent reads. A walled or errored answer is
// BLIND, never RED; the run stops calling on the first wall, since every later call would be walled too.
//
// Usage:
//   node scripts/engine-bench.mjs [--out dir] [--only id,id] [--prev scores.json] [--url u] [--tag t]
//   node scripts/engine-bench.mjs --replay dir [--prev scores.json]     # grade saved raw/*.json, no network
// Writes <out>/raw/<id>.json (full JSON-RPC), <out>/scores.json and <out>/summary.md.
// Cost: one keyless call per question. The home IP has a 300/day anonymous cap; MAX_CALLS refuses bigger runs.

import fs from 'node:fs';
import path from 'node:path';
import { qaProbeRequest, parseRpcBody } from './qa-probe.mjs';
import { gradeRun, diffRuns, CHECKS, RED } from '../lib/engine-grade.mjs';

export const MAX_CALLS = 40;
const ROOT = new URL('..', import.meta.url).pathname;

export function loadQuestions(file = path.join(ROOT, 'engine/questions.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).questions;
}

/** The summary.md text for one graded run (and its diff against the previous run, when given). */
export function summaryMarkdown(run, meta = {}, diff = null) {
  const L = [];
  L.push(`# MCP engine bench ${meta.date || ''}`.trim(), '');
  L.push(`Endpoint ${meta.url || 'replay'}; keyless, detail compact, QA-marked. Planner ${meta.planner || 'n/a'}.`, '');
  L.push('| Set | Points | Possible | Graded | Blind |', '|---|---|---|---|---|');
  for (const [k, t] of Object.entries(run.totals)) L.push(`| ${k} | ${t.points} | ${t.possible} | ${t.graded} | ${t.blind} |`);
  L.push('', '| Check | RED rows | RED when |', '|---|---|---|');
  for (const [k, w] of Object.entries(CHECKS)) L.push(`| ${k} | ${run.red_by_check[k] || 0} | ${w} |`);
  L.push('', '## Rows', '');
  for (const r of run.rows) {
    if (r.verdict === 'BLIND') { L.push(`- **${r.id}** BLIND: ${r.blind_reason}`); continue; }
    const reds = Object.entries(r.checks).filter(([, c]) => c.status === RED);
    L.push(`- **${r.id}** ${r.points}/${r.possible}, class ${r.intent_class}, steps ${r.steps.executed}/${r.steps.planned}` +
      (reds.length ? `; RED ${reds.map(([k, c]) => `${k} (${String(c.evidence || '').slice(0, 140)})`).join('; ')}` : ''));
  }
  if (diff) {
    L.push('', '## Since the previous run', '', `Points on the ${diff.points.compared} questions graded both times: ${diff.points.before} -> ${diff.points.now} (of ${diff.points.possible_now}).`);
    for (const k of ['regressed', 'new_red', 'recovered', 'still_red']) L.push(`- ${k}: ${diff[k].length ? diff[k].map((x) => x.key).join(', ') : 'none'}`);
  }
  return `${L.join('\n')}\n`;
}

async function main(argv) {
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  let questions = loadQuestions(opt('--questions') || undefined);
  if (opt('--only')) { const ids = new Set(opt('--only').split(',')); questions = questions.filter((q) => ids.has(q.id)); }
  const replay = opt('--replay');
  const out = opt('--out') || replay || path.join(process.cwd(), `engine-run-${new Date().toISOString().slice(0, 10)}`);
  const url = opt('--url') || process.env.DCHUB_MCP_URL || 'https://dchub.cloud/mcp';
  const answers = {};
  fs.mkdirSync(path.join(out, 'raw'), { recursive: true });

  if (replay) {
    for (const q of questions) {
      const f = path.join(replay, 'raw', `${q.id}.json`);
      answers[q.id] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    }
  } else {
    if (questions.length > MAX_CALLS) { console.error(`refusing ${questions.length} calls (MAX_CALLS ${MAX_CALLS}); use --only`); return 2; }
    let walled = false;
    for (const q of questions) {
      if (walled) { answers[q.id] = null; continue; }
      const t0 = Date.now();
      let msg = null;
      try {
        const res = await fetch(url, qaProbeRequest('execute_plan', { intent: q.intent, detail: 'compact' }, opt('--tag') || 'engine-bench'));
        msg = parseRpcBody(await res.text());
      } catch (e) { msg = { error: { code: 'fetch', message: e.message } }; }
      const sc = (msg && msg.result && msg.result.structuredContent) || {};
      if (sc.error === 'anon_hard_wall' || sc.binding_limit === 'anon_ip_daily_hard') walled = true;
      answers[q.id] = msg;
      fs.writeFileSync(path.join(out, 'raw', `${q.id}.json`), JSON.stringify(msg, null, 2));
      console.log(`${q.id} ${Date.now() - t0}ms ${sc.intent_class || (walled ? 'WALLED' : 'no class')}`);
    }
  }

  const run = gradeRun(questions, answers);
  const planner = [...new Set(run.rows.map((r) => r.planner_version).filter(Boolean))].join(',');
  const meta = { date: new Date().toISOString(), url: replay ? `replay of ${replay}` : url, planner };
  const prev = opt('--prev') ? JSON.parse(fs.readFileSync(opt('--prev'), 'utf8')) : null;
  const diff = prev ? diffRuns(prev, run) : null;
  fs.writeFileSync(path.join(out, 'scores.json'), JSON.stringify({ meta, ...run, diff }, null, 2));
  const md = summaryMarkdown(run, meta, diff);
  fs.writeFileSync(path.join(out, 'summary.md'), md);
  console.log(`\n${md}`);
  console.log(`wrote ${path.join(out, 'scores.json')}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
