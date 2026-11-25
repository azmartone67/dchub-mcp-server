#!/usr/bin/env node
// Golden run (Grok spec item 3 part B, 2026-11-24): ask execute_plan every question in
// test/golden/agent-intents.json and record what the agent got back, per intent and per mode
// (keyless, and keyed when DCHUB_GOLDEN_KEY is set):
//
//   status        what the planner itself emitted:
//                   ERROR    transport failure, JSON-RPC error, isError, ok:false, or not a plan envelope
//                   WALLED   the call limit answered instead of the planner (quota / binding_limit / retry_after,
//                            no executed[]): the run says nothing about the planner for that question
//                   NO DATA  answer_guide carries the planner's "NO DATA:" marker (server.mjs, execute_plan:
//                            no step returned data in this run)
//                   PARTIAL  citation.completeness === 'partial_preview' or cite_as says PARTIAL
//                            (lib/attribution.mjs) — a tier preview
//                   FULL     anything else
//   intent_class  the planner's class; class_ok = it is in the intent's expect_class list
//   steps         executed[] count; failed / timed_out / not_run / skipped_unresolved / gated_preview counts
//   source_line   a "Source: DC Hub (dchub.cloud[/page]), as of YYYY-MM-DD" line anywhere in the answer
//                 (lib/cite-first.mjs SOURCE_LINE_RE; that wrapper is DCHUB_CITE_FIRST, OFF by owner choice,
//                 so most answers carry the planner's own Source line or none)
//   dated_cite    structuredContent.cite_as carries "as of YYYY-MM-DD"
//   ms            wall time of the call as this client saw it
//
// Every call sends X-DCHub-QA: 1 and the read-only QA User-Agent (dchub-qa-readonly), so it is excluded from the funnel and
// from every external-traffic metric. No outside LLM API is called; the only cost is DC Hub's own server.
//
// Usage:
//   node scripts/golden-run.mjs                                   # live https://dchub.cloud/mcp
//   node scripts/golden-run.mjs --url http://127.0.0.1:3100/mcp
//   node scripts/golden-run.mjs --local .  --out /tmp/head.json   # spawn <dir>/server.mjs on a free port
//   options: --intents <file> --out <file> --only id1,id2 --concurrency 3 --timeout 60000 --modes keyless,keyed
// Env: DCHUB_GOLDEN_KEY (keyed mode; skipped when unset). For --local, the spawned server reads its usual env
// (DCHUB_API_BASE defaults to the live backend).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
export const SOURCE_LINE_RE = /^Source: DC Hub \(dchub\.cloud(?:\/[^\s)]+)?\), as of \d{4}-\d{2}-\d{2}/;
const DATED_CITE_RE = /\bas of \d{4}-\d{2}-\d{2}/;
const STEP_STATES = ['executed', 'gated_preview', 'failed', 'timed_out', 'not_run', 'skipped_unresolved'];

function parseArgs(argv) {
  const o = { url: null, local: null, port: 0, intents: resolve(REPO, 'test/golden/agent-intents.json'),
    out: resolve(REPO, 'test/golden/baseline.json'), only: null, concurrency: 3, timeout: 60000, modes: null, label: null, tool: 'execute_plan' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const v = () => argv[++i];
    if (k === '--url') o.url = v();
    else if (k === '--local') o.local = resolve(v());
    else if (k === '--port') o.port = parseInt(v(), 10);
    else if (k === '--intents') o.intents = resolve(v());
    else if (k === '--out') o.out = resolve(v());
    else if (k === '--only') o.only = new Set(v().split(',').map((s) => s.trim()).filter(Boolean));
    else if (k === '--concurrency') o.concurrency = Math.max(1, parseInt(v(), 10) || 1);
    else if (k === '--timeout') o.timeout = Math.max(1000, parseInt(v(), 10) || 60000);
    else if (k === '--modes') o.modes = v().split(',').map((s) => s.trim());
    else if (k === '--label') o.label = v();
    else if (k === '--tool') { o.tool = v(); if (!['execute_plan', 'plan_query'].includes(o.tool)) throw new Error('--tool is execute_plan or plan_query'); }
    else if (k === '-h' || k === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0]); process.exit(0); }
    else throw new Error('unknown argument: ' + k);
  }
  return o;
}

const freePort = () => new Promise((res, rej) => {
  const s = createServer(); s.unref(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

async function startLocal(dir, port) {
  const p = port || await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: dir, env: { ...process.env, PORT: String(p) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const keep = (b) => { log = (log + b.toString()).slice(-20000); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server.mjs in ${dir} exited ${child.exitCode}:\n${log.slice(-3000)}`);
    try { const r = await fetch(`http://127.0.0.1:${p}/health`); if (r.ok) return { url: `http://127.0.0.1:${p}/mcp`, child, log: () => log }; } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGKILL');
  throw new Error(`server.mjs in ${dir} did not answer /health within 90 s:\n${log.slice(-3000)}`);
}

// One JSON-RPC tools/call; the server answers JSON or SSE ("event: message\ndata: {...}").
async function callPlan(url, intent, key, timeoutMs, tool = 'execute_plan') {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    'X-DCHub-QA': '1', 'User-Agent': 'dchub-qa-readonly/0.1 (QA - exclude) golden-run' };
  if (key) headers['X-API-Key'] = key;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { intent } } });
  const t0 = Date.now();
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers, body, signal: ac.signal });
    const text = await r.text();
    const ms = Date.now() - t0;
    if (!r.ok) return { ms, transport: `HTTP ${r.status}` };
    let msg = null;
    if (/^\s*\{/.test(text)) msg = JSON.parse(text);
    else for (const line of text.split('\n')) if (line.startsWith('data: ')) { try { const m = JSON.parse(line.slice(6)); if (m && (m.result || m.error)) msg = m; } catch (_) { /* partial */ } }
    if (!msg) return { ms, transport: 'no JSON-RPC message in response' };
    return { ms, msg };
  } catch (e) {
    return { ms: Date.now() - t0, transport: e.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : String(e.message || e) };
  } finally { clearTimeout(timer); }
}

function strings(v, out, depth = 0) {
  if (depth > 7 || out.length > 5000) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out, depth + 1);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out, depth + 1);
  return out;
}

// plan_query (--tool plan_query): the plan without running it. No backend data call, so it needs no key and no
// internal key: the routing half of the gate (class and planned tools) runs on any CI runner.
export function classifyPlan(call, expect) {
  const rec = { ms: call.ms };
  if (call.transport) return { ...rec, status: 'ERROR', error: call.transport };
  const { msg } = call;
  if (msg.error) return { ...rec, status: 'ERROR', error: 'JSON-RPC ' + (msg.error.code || '') + ' ' + String(msg.error.message || '').slice(0, 200) };
  const res = msg.result || {};
  let sc = res.structuredContent;
  if (!sc) { for (const c of res.content || []) { if (c && typeof c.text === 'string' && c.text.trim().startsWith('{')) { try { sc = JSON.parse(c.text); break; } catch (_) { /* not JSON */ } } } }
  sc = sc && typeof sc === 'object' ? sc : {};
  const cls = typeof sc.intent_class === 'string' ? sc.intent_class : null;
  const seq = Array.isArray(sc.recommended_sequence) ? sc.recommended_sequence : [];
  return { ...rec, status: res.isError === true || sc.ok === false ? 'ERROR' : 'PLANNED', intent_class: cls,
    class_ok: Array.isArray(expect) && expect.length ? expect.includes(cls) : null,
    tools: seq.map((s) => s && s.tool).filter(Boolean), steps_total: seq.length, failed_steps: 0 };
}

export function classify(call, expect) {
  const rec = { ms: call.ms };
  if (call.transport) return { ...rec, status: 'ERROR', error: call.transport };
  const { msg } = call;
  if (msg.error) return { ...rec, status: 'ERROR', error: 'JSON-RPC ' + (msg.error.code || '') + ' ' + String(msg.error.message || '').slice(0, 200) };
  const res = msg.result || {};
  let sc = res.structuredContent;
  const content = Array.isArray(res.content) ? res.content : [];
  if (!sc) { for (const c of content) { if (c && typeof c.text === 'string' && c.text.trim().startsWith('{')) { try { sc = JSON.parse(c.text); break; } catch (_) { /* not JSON */ } } } }
  sc = sc && typeof sc === 'object' ? sc : {};
  const executed = Array.isArray(sc.executed) ? sc.executed : [];
  const steps = Object.fromEntries(STEP_STATES.map((s) => [s, 0]));
  for (const e of executed) if (e && steps[e.status] !== undefined) steps[e.status] += 1;
  const guide = String(sc.answer_guide || '');
  const cit = sc.citation && typeof sc.citation === 'object' ? sc.citation : {};
  const citeAs = typeof sc.cite_as === 'string' ? sc.cite_as : '';
  let status = 'FULL';
  const isPlan = sc._entity === 'plan_execution' || Array.isArray(sc.executed);
  if (!isPlan && (sc.quota !== undefined || sc.binding_limit !== undefined || sc.retry_after !== undefined)) status = 'WALLED';
  else if (res.isError === true || sc.ok === false || !isPlan) status = 'ERROR';
  else if (/(^|\s)NO DATA:/.test(guide)) status = 'NO DATA';
  else if (cit.completeness === 'partial_preview' || /PARTIAL/i.test(citeAs) || /PARTIAL/i.test(String(cit.cite_as || ''))) status = 'PARTIAL';
  const all = strings(content.map((c) => c && c.text), []).concat(strings(sc, []));
  const sourceLine = all.some((s) => s.split('\n').some((l) => SOURCE_LINE_RE.test(l.trim())));
  const cls = typeof sc.intent_class === 'string' ? sc.intent_class : null;
  return {
    ...rec, status, intent_class: cls,
    class_ok: Array.isArray(expect) && expect.length ? expect.includes(cls) : null,
    planner_version: sc.planner_version || null,
    steps_total: executed.length, steps,
    failed_steps: steps.failed + steps.timed_out,
    failed_tools: executed.filter((e) => e && (e.status === 'failed' || e.status === 'timed_out')).map((e) => `${e.tool}:${e.status}`),
    tools: executed.map((e) => e && e.tool).filter(Boolean),
    source_line: sourceLine,
    dated_cite: DATED_CITE_RE.test(citeAs),
    cite_as: citeAs.slice(0, 160) || null,
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

export async function run(opts) {
  const set = JSON.parse(readFileSync(opts.intents, 'utf8'));
  const intents = set.intents.filter((x) => !opts.only || opts.only.has(x.id));
  const key = String(process.env.DCHUB_GOLDEN_KEY || '').trim();
  const tool = opts.tool || 'execute_plan';
  let modes = opts.modes || (tool === 'plan_query' ? ['keyless'] : ['keyless', 'keyed']);
  const skipped = [];
  if (modes.includes('keyed') && !key) { modes = modes.filter((m) => m !== 'keyed'); skipped.push('keyed (DCHUB_GOLDEN_KEY not set)'); }
  let local = null;
  let url = opts.url || 'https://dchub.cloud/mcp';
  if (opts.local) { local = await startLocal(opts.local, opts.port); url = local.url; }
  const started = new Date().toISOString();
  try {
    const jobs = [];
    for (const it of intents) for (const m of modes) jobs.push({ it, m });
    const results = await pool(jobs, opts.concurrency, async ({ it, m }) => {
      let call = await callPlan(url, it.intent, m === 'keyed' ? key : null, opts.timeout, tool);
      // One retry on a transport failure only (a dropped connection is not the planner's answer).
      if (call.transport) { await new Promise((r) => setTimeout(r, 1500)); call = await callPlan(url, it.intent, m === 'keyed' ? key : null, opts.timeout, tool); }
      const r = { id: it.id, topic: it.topic, mode: m, ...(tool === 'plan_query' ? classifyPlan : classify)(call, it.expect_class) };
      process.stderr.write(`${r.status.padEnd(7)} ${m.padEnd(7)} ${String(r.ms).padStart(6)}ms ${it.id} [${r.intent_class}]${r.class_ok === false ? ' (class not expected)' : ''}${r.failed_steps ? ` failed=${r.failed_tools.join(',')}` : ''}\n`);
      return r;
    });
    const counts = {};
    for (const m of modes) {
      const rows = results.filter((r) => r.mode === m);
      const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
      counts[m] = {
        intents: rows.length,
        PLANNED: rows.filter((r) => r.status === 'PLANNED').length,
        FULL: rows.filter((r) => r.status === 'FULL').length,
        PARTIAL: rows.filter((r) => r.status === 'PARTIAL').length,
        'NO DATA': rows.filter((r) => r.status === 'NO DATA').length,
        ERROR: rows.filter((r) => r.status === 'ERROR').length,
        WALLED: rows.filter((r) => r.status === 'WALLED').length,
        failed_steps: rows.reduce((s, r) => s + (r.failed_steps || 0), 0),
        class_mismatch: rows.filter((r) => r.class_ok === false).length,
        source_line: rows.filter((r) => r.source_line).length,
        dated_cite: rows.filter((r) => r.dated_cite).length,
        p50_ms: pct(ms, 50), p95_ms: pct(ms, 95),
      };
    }
    const out = { _about: 'Written by scripts/golden-run.mjs. Compare two runs with scripts/golden-compare.mjs.',
      label: opts.label || null, tool, target: opts.local ? `local ${opts.local}` : url, started_at: started,
      finished_at: new Date().toISOString(), modes, skipped_modes: skipped, intents_file: set.version, summary: counts, results };
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(out, null, 2) + '\n');
    process.stderr.write(`wrote ${opts.out}\n${JSON.stringify(counts, null, 1)}\n`);
    return out;
  } finally {
    if (local) local.child.kill('SIGTERM');
  }
}

export function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(parseArgs(process.argv.slice(2))).then(() => process.exit(0), (e) => { console.error(e && e.stack || e); process.exit(2); });
}
