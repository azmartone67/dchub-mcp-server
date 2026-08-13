#!/usr/bin/env node
// ============================================================================
// refresh-tool-maturity.mjs (2026-08-12) — pull the two CANONICAL maturity
// sources into one committed snapshot so server.mjs can put maturity and the
// real coverage limits INLINE on every tool in tools/list.
//
// WHY THIS EXISTS: both signals already existed and neither was where an agent
// looks. Maturity + coverage live at /api/v1/canon/coverage; measured
// execution lives in the canonical benchmark report. tools/list — the ONE
// surface an agent reads while CHOOSING — carried neither, so choosing well
// cost two extra round-trips and the measurement says nobody pays it.
//
// ★ DERIVE, NEVER RESTATE. Nothing in this file states a maturity value or a
// limit. It fetches them from the owner endpoints and writes them down
// verbatim. A second hand-authored maturity list is a second source of truth
// and it WILL drift — that exact defect (a count baked into a file) is why
// Glama published "33 tools / 21,000+" for months. If you find yourself
// typing the word "mature" next to a tool name, stop.
//
// THE TWO SOURCES, and what each is allowed to decide:
//   1. GET /api/v1/canon/coverage   (owner: dchub-backend routes/problem_taxonomy.py)
//      DECLARES per problem: the entry call, the workflow behind it, the
//      status enum, and the published limits. This is the only thing that can
//      make a tool look GOOD.
//   2. GET /api/v1/reports/canonical-benchmarks (owner: routes/canonical_benchmarks.py)
//      MEASURES real keyed captures. A step the planner recorded and could NOT
//      execute is named in deferred_steps. This is only ever allowed to make a
//      tool look WORSE (see server.mjs _buildMaturityIndex). A measurement
//      that could promote would be a flattering-default generator; a
//      measurement that can only demote cannot lie in our favour.
//
// WHY A COMMITTED SNAPSHOT instead of fetching in server.mjs: identical
// contract to refresh-problem-taxonomy.mjs and refresh-canon-phrases.mjs —
// startup and CI must be deterministic and network-free, and values move ONLY
// via a commit, atomically with the surfaces tested against them. A fetch on
// the tools/list hot path is also exactly the mistake r-tuner-warmcache
// documents (a synchronous backend call in init → pool exhaustion → 502s).
//
// FAIL-CLOSED, and closed means UNCHANGED: any fetch error, non-ok body, or a
// malformed field on EITHER endpoint → log and exit 0 WITHOUT writing. The
// committed snapshot stays in force. Note which direction that fails in: a
// benchmark outage must never drop the deferred list, because an empty
// deferred list is the FLATTERING state (no demotions). So a partial fetch is
// never half-written.
//
//   node scripts/refresh-tool-maturity.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'canonical', 'tool_maturity.json');
const COVERAGE_URL = 'https://dchub.cloud/api/v1/canon/coverage';
const BENCH_URL = 'https://dchub.cloud/api/v1/reports/canonical-benchmarks';

const UA = { 'User-Agent': 'dchub-mcp-maturity-refresh/1.0', 'Accept': 'application/json' };

async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const isToolName = (v) => typeof v === 'string' && /^[a-z][a-z0-9_]{2,48}$/.test(v);

function validateCoverage(body) {
  const bad = [];
  if (body?.ok !== true) bad.push('ok!==true');
  if (!/^[0-9a-f]{16}$/.test(String(body?.contract_hash || ''))) bad.push('contract_hash');

  // The status ENUM and its definitions are canon too — we publish the
  // definitions verbatim so a reader can check our verdicts, and we refuse a
  // status value that is not in the published enum rather than passing an
  // unrecognised label through to agents.
  const st = body?.statuses;
  const statuses = st && typeof st === 'object' && !Array.isArray(st) ? Object.keys(st) : [];
  if (statuses.length < 2 || statuses.length > 8 ||
      !Object.values(st || {}).every((v) => typeof v === 'string' && v.length >= 20)) {
    bad.push('statuses');
  }

  const cov = body?.coverage;
  if (!Array.isArray(cov) || cov.length < 8 || cov.length > 60) {
    bad.push('coverage');
  } else {
    for (const e of cov) {
      if (!e || typeof e !== 'object') { bad.push('coverage.entry'); break; }
      if (typeof e.problem !== 'string' || e.problem.length < 8) { bad.push('coverage.problem'); break; }
      if (!isToolName(e.entry_tool)) { bad.push('coverage.entry_tool'); break; }
      if (!Array.isArray(e.workflow) || e.workflow.length < 1 || e.workflow.length > 12 ||
          !e.workflow.every(isToolName)) { bad.push('coverage.workflow'); break; }
      if (!statuses.includes(e.status)) { bad.push('coverage.status'); break; }
      if (!Array.isArray(e.limits) ||
          !e.limits.every((l) => typeof l === 'string' && l.length >= 20 && l.length <= 400)) {
        bad.push('coverage.limits'); break;
      }
    }
  }
  return bad;
}

// The ONLY thing taken from the benchmark report: which tools a real capture
// recorded and did NOT execute. Deliberately not the maturity column on those
// rows — that column is per-INTENT, and an intent is not a tool.
function deriveCaptureEvidence(body) {
  const bad = [];
  if (body?.report !== 'canonical-benchmarks') bad.push('report');
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length < 1) bad.push('rows');
  const summary = body?.summary;
  if (!summary || typeof summary !== 'object') bad.push('summary');
  if (bad.length) return { bad };

  const measured = rows.filter((r) => r && r.status === 'measured');
  // A report where nothing was measured carries no evidence — and "no
  // evidence" must not be written over a snapshot that HAD some, because the
  // no-evidence state is the one that demotes nobody.
  if (measured.length < 1) return { bad: ['no measured rows'] };

  const deferred = new Set();
  for (const r of measured) {
    for (const s of (Array.isArray(r.deferred_steps) ? r.deferred_steps : [])) {
      if (isToolName(s)) deferred.add(s);
    }
  }
  const stamps = measured.map((r) => r.last_successful_execution).filter(Boolean);
  return {
    bad: [],
    evidence: {
      source: BENCH_URL,
      captures_measured: measured.length,
      captures_contracted: rows.length,
      last_successful_execution: stamps.length ? stamps.sort().slice(-1)[0] : null,
      // Sorted so the committed file is stable and a diff means a real change.
      deferred_tools: [...deferred].sort(),
      means: 'tools a real keyed capture RECORDED as a planned step and could '
           + 'not execute. Used only to DEMOTE a declared maturity, never to raise one.',
    },
  };
}

async function main() {
  let cov, bench;
  try {
    cov = await getJson(COVERAGE_URL);
  } catch (e) {
    console.log(`maturity refresh: coverage fetch failed (${String(e?.message || e)}) — keeping the committed snapshot`);
    return;
  }
  try {
    bench = await getJson(BENCH_URL);
  } catch (e) {
    console.log(`maturity refresh: benchmark fetch failed (${String(e?.message || e)}) — keeping the committed snapshot`);
    return;
  }

  const covBad = validateCoverage(cov);
  if (covBad.length) {
    console.log(`maturity refresh: invalid coverage field(s) ${covBad.join(', ')} — keeping the committed snapshot`);
    return;
  }
  const { bad: benchBad, evidence } = deriveCaptureEvidence(bench);
  if (benchBad.length) {
    console.log(`maturity refresh: invalid benchmark field(s) ${benchBad.join(', ')} — keeping the committed snapshot`);
    return;
  }

  const snap = {
    _generated_by: 'scripts/refresh-tool-maturity.mjs',
    _warning: 'CANONICAL SNAPSHOT — DO NOT HAND-EDIT. Every value here is fetched '
            + 'verbatim from the owner endpoints named in _sources. server.mjs derives '
            + 'the per-tool maturity/limits annotations on tools/list from this file; '
            + 'test/tool-maturity-annotation.test.mjs asserts the served annotations '
            + 'match a re-derivation from it, so a hand-edit here moves what agents '
            + 'read. The owners are dchub-backend routes/problem_taxonomy.py '
            + '(coverage) and routes/canonical_benchmarks.py (capture evidence).',
    _sources: { coverage: COVERAGE_URL, capture_evidence: BENCH_URL },
    retrieved_at: new Date().toISOString(),
    contract_hash: cov.contract_hash,
    version: cov.version ?? null,
    source: cov.source,
    statuses: cov.statuses,
    note: cov.note,
    coverage: cov.coverage,
    capture_evidence: evidence,
  };

  // Compare everything EXCEPT retrieved_at: re-stamping a file whose content
  // did not change turns a freshness date into noise, and a date that moves
  // when nothing moved is how "last updated" claims stop meaning anything.
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
  const stripped = (o) => { if (!o) return null; const c = { ...o }; delete c.retrieved_at; return JSON.stringify(c); };
  if (prev && stripped(prev) === stripped(snap)) {
    console.log(`maturity refresh: ✓ snapshot already matches the owners (contract_hash ${snap.contract_hash}) — not rewriting`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap, null, 2) + '\n');
  console.log(
    `maturity refresh: ✓ wrote ${path.relative(ROOT, OUT)} — hash ${snap.contract_hash}, `
    + `${snap.coverage.length} problems, ${evidence.deferred_tools.length} deferred tool(s) `
    + `from ${evidence.captures_measured}/${evidence.captures_contracted} measured captures`);
}

main();
