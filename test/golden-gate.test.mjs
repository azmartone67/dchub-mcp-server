// Golden gate (Grok spec item 3 part B, 2026-11-24): the pure parts of scripts/golden-run.mjs,
// scripts/golden-compare.mjs and scripts/golden-scope.mjs, and the golden set's own rules.
// Qualifies for the hard gate: no network, no server, fixtures only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classify, classifyPlan, pct } from '../scripts/golden-run.mjs';
import { compare } from '../scripts/golden-compare.mjs';
import { decide, hunkLines } from '../scripts/golden-scope.mjs';

const SET = JSON.parse(readFileSync(new URL('./golden/agent-intents.json', import.meta.url), 'utf8'));
const BASELINE = JSON.parse(readFileSync(new URL('./golden/baseline.json', import.meta.url), 'utf8'));

const call = (sc, extra = {}) => ({ ms: 100, msg: { result: { content: [{ type: 'text', text: 'lead' }, ...(extra.content || [])], structuredContent: { _entity: 'plan_execution', ...sc } } } });
const row = (o) => ({ id: 'a', mode: 'keyless', status: 'FULL', failed_steps: 0, source_line: true, dated_cite: true, class_ok: true, intent_class: 'permitting', tools: ['x'], ms: 100, ...o });
const run = (rows, summary = {}) => ({ modes: ['keyless'], summary: { keyless: { 'NO DATA': 0, ERROR: 0, p95_ms: 1000, ...summary } }, results: rows });

describe('golden set', () => {
  it('has about 25 questions, unique ids, each with an expected class', () => {
    expect(SET.intents.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SET.intents.map((x) => x.id)).size).toBe(SET.intents.length);
    for (const x of SET.intents) { expect(x.intent.length).toBeGreaterThan(10); expect(x.expect_class.length).toBeGreaterThan(0); }
  });
  it('names PJM / SERC places only (DCPI hold: no ERCOT, MISO or AZ question)', () => {
    const held = /\b(ercot|texas|tx|dallas|houston|austin|san antonio|abilene|miso|chicago|illinois|minnesota|iowa|indiana|michigan|arizona|az|phoenix|mesa|goodyear|tucson)\b/i;
    for (const x of SET.intents) expect(held.test(x.intent), x.id).toBe(false);
    for (const x of SET.intents) expect(/ashburn|loudoun|columbus|charlotte|virginia|\bva\b|ohio|north carolina|\bnc\b|pjm|dominion|duke/i.test(x.intent), x.id).toBe(true);
  });
  it('the committed baseline covers every question', () => {
    const ids = new Set(BASELINE.results.map((r) => r.id));
    for (const x of SET.intents) expect(ids.has(x.id), x.id).toBe(true);
  });
});

describe('classify (what the planner emitted)', () => {
  it('NO DATA from the planner marker, even after an UNRESOLVED lead', () => {
    const r = classify(call({ answer_guide: 'UNRESOLVED x. NO DATA: no step returned data in this run.', executed: [{ tool: 't', status: 'failed' }, { tool: 'u', status: 'timed_out' }] }), ['permitting']);
    expect(r.status).toBe('NO DATA');
    expect(r.failed_steps).toBe(2);
    expect(r.failed_tools).toEqual(['t:failed', 'u:timed_out']);
  });
  it('PARTIAL from citation.completeness or cite_as; FULL otherwise', () => {
    expect(classify(call({ citation: { completeness: 'partial_preview' } })).status).toBe('PARTIAL');
    expect(classify(call({ cite_as: 'DC Hub (dchub.cloud) — PARTIAL preview, 3 of 11 shown, as of 2026-10-23' })).status).toBe('PARTIAL');
    expect(classify(call({ cite_as: 'DC Hub (dchub.cloud), as of 2026-11-24' })).status).toBe('FULL');
  });
  it('ERROR on transport failure, JSON-RPC error or ok:false', () => {
    expect(classify({ ms: 5, transport: 'timeout after 60000 ms' }).status).toBe('ERROR');
    expect(classify({ ms: 5, msg: { error: { code: -32000, message: 'x' } } }).status).toBe('ERROR');
    expect(classify(call({ ok: false })).status).toBe('ERROR');
  });
  it('Source line: the dated line anywhere in the answer, not the undated one', () => {
    expect(classify(call({}, { content: [{ type: 'text', text: 'x\nSource: DC Hub (dchub.cloud), as of 2026-11-24' }] })).source_line).toBe(true);
    expect(classify(call({ intent_answer: { headline: 'a\nSource: DC Hub (dchub.cloud/permitting), as of 2026-10-23.' } })).source_line).toBe(true);
    expect(classify(call({}, { content: [{ type: 'text', text: 'Source: DC Hub (dchub.cloud), each figure dated in the line.' }] })).source_line).toBe(false);
  });
  it('WALLED when the call limit answers instead of the planner; a non-plan envelope is ERROR', () => {
    expect(classify(call({ _entity: 'quota', quota: {}, retry_after: 3600 })).status).toBe('WALLED');
    expect(classify(call({ _entity: 'something_else' })).status).toBe('ERROR');
  });
  it('class_ok against expect_class; plan_query rows are PLANNED', () => {
    expect(classify(call({ intent_class: 'unknown' }), ['permitting']).class_ok).toBe(false);
    const p = classifyPlan(call({ intent_class: 'permitting', recommended_sequence: [{ tool: 'get_permitting_intel' }] }), ['permitting']);
    expect(p).toMatchObject({ status: 'PLANNED', class_ok: true, tools: ['get_permitting_intel'] });
  });
  it('pct is nearest-rank', () => {
    expect(pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(pct([1, 2, 3, 4], 50)).toBe(2);
  });
});

describe('compare (each rule can fail, identical runs pass)', () => {
  const base = run([row({})]);
  it('identical runs pass', () => expect(compare(base, base).ok).toBe(true));
  it('NO DATA count up fails', () => expect(compare(base, run([row({ status: 'NO DATA' })], { 'NO DATA': 1 })).fails.join()).toMatch(/NO DATA count rose/));
  it('ERROR count up fails', () => expect(compare(base, run([row({ status: 'ERROR' })], { ERROR: 1 })).fails.join()).toMatch(/ERROR count rose/));
  it('failed steps per plan up fails', () => expect(compare(base, run([row({ failed_steps: 1, failed_tools: ['t:failed'] })])).fails.join()).toMatch(/failed\/timed-out steps rose 0 -> 1/));
  it('a FULL answer losing its Source line fails', () => expect(compare(base, run([row({ source_line: false })])).fails.join()).toMatch(/lost its dated Source line/));
  it('a FULL answer losing its dated cite_as fails', () => expect(compare(base, run([row({ dated_cite: false })])).fails.join()).toMatch(/lost its dated cite_as/));
  it('a PARTIAL base answer without a Source line is not held to one', () => {
    const b = run([row({ status: 'PARTIAL', source_line: false })]);
    expect(compare(b, b).ok).toBe(true);
  });
  it('p95 +25% and +500 ms fails; a small wobble does not', () => {
    expect(compare(base, run([row({})], { p95_ms: 1600 })).fails.join()).toMatch(/p95 latency rose/);
    expect(compare(base, run([row({})], { p95_ms: 1400 })).ok).toBe(true);
    const fast = run([row({})], { p95_ms: 400 });
    expect(compare(fast, run([row({})], { p95_ms: 800 })).ok).toBe(true);
  });
  it('a misroute out of the expected class fails (Loudoun read as coordinates)', () => {
    const r = compare(base, run([row({ intent_class: 'unknown', class_ok: false, tools: ['discover_tools'] })]));
    expect(r.fails.join()).toMatch(/routed to unknown, was permitting/);
  });
  it('a question already outside its class in the base does not fail the PR', () => {
    const b = run([row({ intent_class: 'capacity_search', class_ok: false })]);
    expect(compare(b, run([row({ intent_class: 'facility_search', class_ok: false })])).ok).toBe(true);
  });
  it('a head walled more often than its base fails; walled rows are not compared one by one', () => {
    expect(compare(base, run([row({ status: 'WALLED' })], { WALLED: 1 })).fails.join()).toMatch(/WALLED count rose/);
    const w = run([row({ status: 'WALLED', source_line: false, class_ok: null })], { WALLED: 1 });
    expect(compare(w, w).ok).toBe(true);
  });
  it('a question missing from the head fails', () => expect(compare(base, run([])).fails.join()).toMatch(/missing from the head run/));
});

describe('scope', () => {
  const src = ['const x = 1;', 'function _execRoute(t) {', '  return 1;', '}', 'function unrelated() {', '  return 2;', '}',
    'function reg(srv) {', "  trackedTool(srv, 'execute_plan', 'd', {}, async () => {", '    return 3;', '  });', "  trackedTool(srv, 'search_facilities', 'd', {}, async () => {", '    return 4;', '  });', '}'].join('\n');
  it('a planner lib file is in scope; an unrelated one is not', () => {
    expect(decide(['lib/plan-routing.mjs'], '', '').run).toBe(true);
    expect(decide(['lib/cite-first.mjs'], '', '').run).toBe(true);
    expect(decide(['lib/agent-beat.mjs', 'README.md'], '', '').run).toBe(false);
  });
  it('server.mjs: a planner function or the execute_plan body is in scope, another tool is not', () => {
    expect(decide(['server.mjs'], '@@ -3 +3 @@\n', src).run).toBe(true);
    expect(decide(['server.mjs'], '@@ -10 +10 @@\n', src).run).toBe(true);
    expect(decide(['server.mjs'], '@@ -6 +6 @@\n', src).run).toBe(false);
    expect(decide(['server.mjs'], '@@ -13 +13 @@\n', src).run).toBe(false);
  });
  it('hunk lines read the head side; a pure deletion counts its neighbour', () => {
    expect(hunkLines('@@ -1,2 +5,3 @@\n@@ -9,1 +12,0 @@\n')).toEqual([5, 6, 7, 12]);
  });
});
