#!/usr/bin/env node
// Does this diff touch the planner, the answer composer or the citation code? (golden gate scope)
//
// Usage: node scripts/golden-scope.mjs <base-ref>      prints run=true|false and why; writes run= to $GITHUB_OUTPUT
//
// In scope:
//   - lib files of the planner / composer / citation path (LIB_RES below)
//   - the golden set itself (test/golden/**, scripts/golden-*.mjs, the workflow)
//   - a server.mjs hunk that lands in the execute_plan or plan_query tool body, in withCitation /
//     _withCitationCore, or in a top-level declaration whose name is a planner name (NAME_RE: _exec*, plan*,
//     PLAN_*, EXEC_*, corridor tables, replay, intent, cite / citation, PLANNER_VERSION)
// Fail-open: when the diff cannot be read, the answer is run=true.
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIB_RES = [
  /^lib\/[^/]*plan[^/]*\.mjs$/i, /^lib\/[^/]*answer[^/]*\.mjs$/i, /^lib\/cite-[^/]*\.mjs$/, /^lib\/attribution\.mjs$/,
  /^lib\/source-line\.mjs$/, /^lib\/facility-(join|search-answer|location|names|ref)\.mjs$/, /^lib\/named-facility\.mjs$/,
  /^lib\/(site-hunt|metro-anchor|country-scope|cross-domain-answer|power-rotation-[^/]*)\.mjs$/,
  /^test\/golden\//, /^scripts\/golden-[^/]*\.mjs$/, /^\.github\/workflows\/golden-gate\.yml$/,
];
export const NAME_RE = /^_*(exec|Exec|EXEC|plan|Plan|PLAN|replay|REPLAY|corridor|CORRIDOR|intent|Intent|INTENT|cite|Cite|CITE|withCitation|citation|Citation|answerGuide)|PLANNER/;
const DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+([\w$]+)|(?:const|let|var)\s+([\w$]+))/;

// Line ranges (1-based, inclusive) of the planner regions in a server.mjs text.
export function serverRegions(src) {
  const lines = src.split('\n');
  const regions = [];
  const toolStart = (name) => lines.findIndex((l) => l.includes(`trackedTool(srv, '${name}'`));
  for (const name of ['execute_plan', 'plan_query']) {
    const s = toolStart(name);
    if (s < 0) continue;
    let e = lines.findIndex((l, i) => i > s && /^\s{2}trackedTool\(srv, '/.test(l));
    if (e < 0) e = lines.length;
    regions.push([s + 1, e]);
  }
  return { lines, regions };
}

export function lineInScope(lines, regions, n) {
  if (regions.some(([a, b]) => n >= a && n <= b)) return true;
  for (let i = Math.min(n, lines.length) - 1; i >= 0; i--) {
    const m = DECL_RE.exec(lines[i]);
    if (m) return NAME_RE.test(m[1] || m[2] || '');
  }
  return false;
}

// Head-side line numbers of each -U0 hunk ("@@ -a,b +c,d @@"); a pure deletion counts its neighbour line.
export function hunkLines(diff) {
  const out = [];
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = parseInt(m[1], 10); const len = m[2] === undefined ? 1 : parseInt(m[2], 10);
    if (len === 0) out.push(Math.max(1, start)); else for (let i = 0; i < len; i++) out.push(start + i);
  }
  return out;
}

export function decide(files, serverDiff, serverSrc) {
  const why = [];
  for (const f of files) if (LIB_RES.some((re) => re.test(f))) why.push(f);
  if (files.includes('server.mjs') && serverDiff) {
    const { lines, regions } = serverRegions(serverSrc);
    const hit = hunkLines(serverDiff).filter((n) => lineInScope(lines, regions, n));
    if (hit.length) why.push(`server.mjs lines ${hit.slice(0, 8).join(',')}${hit.length > 8 ? ',…' : ''}`);
  }
  return { run: why.length > 0, why };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] || 'origin/main';
  let res;
  try {
    const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
    const files = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    const sd = files.includes('server.mjs') ? git('diff', '-U0', `${base}...HEAD`, '--', 'server.mjs') : '';
    res = decide(files, sd, files.includes('server.mjs') ? readFileSync('server.mjs', 'utf8') : '');
  } catch (e) {
    res = { run: true, why: ['diff unreadable, running: ' + String(e.message || e).slice(0, 200)] };
  }
  console.log(`run=${res.run}${res.why.length ? ' (' + res.why.join('; ') + ')' : ' (no planner, composer or citation path touched)'}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${res.run}\n`);
}
