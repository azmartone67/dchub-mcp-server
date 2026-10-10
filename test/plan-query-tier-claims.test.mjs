// plan-query-tier-claims.test.mjs — every tier claim in plan_query's
// coverage_notes is checked against what the tool actually returns, per seat.
//
// ★THE DEFECT (2026-09-29). Three coverage_notes said get_refined_queue was
// "depth-teased below Developer tier". It is not in DEPTH_TEASE_TOOLS, and
// driving the real handler shows no key gets a 3-row preview with names and MW
// withheld while ANY key, a free one included, gets the full survivor set. The
// same sweep found the "below Developer" / "Developer+" wording false for every
// tool it was used on: Starter and a $10 credit pack get the full answer on the
// DEPTH_TEASE tools (_isPaidDepthTier includes starter; the pack burns credits),
// get_grid_intelligence / get_fiber_intel still cap Developer to a daily
// allowance (unlimited is Pro), get_gas_economics masks its prices below Pro,
// and hyperscaler_deals ("free-tier friendly") gives a free key the same
// trimmed preview as no key.
//
// HOW THIS PINS THE NOTES. Each coverage_notes sentence is scanned for the
// claim phrases below. A phrase fixes the per-seat expectation; the tool names
// in front of it say which tools it is about. Every (tool, phrase) is then
// driven through POST /mcp on the real express app at no key, free key, an
// identified key holding a $10 pack, Starter, Developer and Pro, against a stub
// backend that answers the X-Internal-Key in full, with the per-day full-answer
// allowance both fresh and spent. Tier vocabulary left over outside a known
// phrase fails the test, so a new claim cannot land unchecked — the old
// "depth-teased below Developer" wording is still a known phrase, precisely so
// that re-inserting it is DRIVEN and fails on the real behaviour.
//
// HARD gate: deterministic, and its only network is two 127.0.0.1 listeners.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { _freeKeyAllowanceText } from '../lib/tier-canon.mjs';

const K_FREE = 'dch_live_tierclaim_free0001';
const K_PACK = 'dch_live_tierclaim_packs001';   // identified key holding a live $10 pack balance
const K_STARTER = 'dch_live_tierclaim_start001';
const K_DEV = 'dch_live_tierclaim_devel001';
const K_PRO = 'dch_live_tierclaim_propro01';
const KEY_TIER = { [K_FREE]: 'free', [K_PACK]: 'identified', [K_STARTER]: 'starter',
  [K_DEV]: 'developer', [K_PRO]: 'pro' };
const SEATS = [['anon', null], ['free', K_FREE], ['pack', K_PACK], ['starter', K_STARTER],
  ['developer', K_DEV], ['pro', K_PRO]];
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};

// Generic backend body: ten rows plus aggregates. FULL = the tenth row and the
// aggregate both reach the caller; anything trimmed loses one or both.
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  project_name: `Proj ${i}`, iso: 'PJM', state: 'OH', county: 'Franklin', fuel_type: 'Gas',
  capacity_mw: 1000 + i * 11.7, queue_status: 'active', estimated_ttp_months: 51,
  fuel_class: 'firm', lat: 39.9 + i / 100, lng: -83.0, coordinate_precision: 'county_centroid',
  fiber_km: 4.2 + i, candidate_id: `cand_${i}`, snapshot_id: 'snap_1',
  site_evaluation_handoff: { analyze_site: { lat: 39.9, lon: -83.0, capacity_mw: 1000 } } }));
const GENERIC = { ok: true, count: 10, total_mw: 10525.4, data: ROWS, results: ROWS, deals: ROWS,
  changes: ROWS, iso: 'PJM', iso_name: 'PJM Interconnection', demand_mw: 91234.5,
  fuel_mix: { gas: 40.1, nuclear: 33.3 }, constraint_score: 61.7, queue_depth_gw: 287.4, peak_mw: 95555.5,
  _cite: 'DC Hub (dchub.cloud)' };
// Owner 2026-10-08: the grid taste KEEPS demand_mw, so the full sentinel is a withheld figure (peak_mw).
const FULL_SENTINELS = { get_grid_intelligence: ['95555.5'] };
const DEFAULT_SENTINELS = ['Proj 9', '10525.4'];

// Arguments per claimed tool. A claim about a tool with no entry here fails,
// so a new claim cannot be skipped for want of a driver.
const ARGS = {
  get_refined_queue: { iso: 'PJM', min_mw: 100, limit: 50 },
  get_interconnection_queue: { iso: 'PJM' },
  get_grid_intelligence: { iso: 'PJM' },
  get_fiber_intel: { market: 'columbus' },
  get_market_intel: { market: 'dallas' },
  list_transactions: { limit: 10 },
  hyperscaler_deals: {},
  get_gas_index: { state: 'OH' },
  get_gas_intelligence: { state: 'OH' },
  get_gas_economics: { market: 'dallas' },
  rank_markets: {},
  get_market_dcpi_rank: { market_slug: 'dallas' },
  get_metro_fiber: { market: 'dallas' },
  get_energy_prices: {},
  get_renewable_energy: {},
  get_changes: {},
  get_retirement_headroom: { target_mw: 200, horizon_months: 18, region_iso: 'MISO' },
};

const P = 'preview', F = 'full';
const m = (anon, free, pack, starter, developer, pro) => ({ anon, free, pack, starter, developer, pro });

// Claim phrases. `fresh` / `spent` = expected result per seat with the daily
// full-answer allowance unused / used up. Regexes are matched against the
// note text itself, so the wording IS the claim.
// v14 (owner 2026-10-10): the notes name no plan and no price ("a paid DC Hub plan gets the full answer",
// "a credit pack"). Each phrase accepts the old wording too, so re-inserting it is still driven.
const PHRASES = [
  // Owner 2026-10-08: the decision tools are previews on every non-paid seat, the pack
  // included; Developer and up get the full answer (test/free-decision-tools-preview-only).
  { id: 'developer-only-full',
    re: /a preview on every non-paid seat \(no key, a free key, a trial key, a bound email or a (?:\$10 )?credit pack\); (?:Developer and up get|a paid DC Hub plan gets) the full answer(?! \(a grandfathered)/,
    fresh: m(P, P, P, F, F, F), spent: m(P, P, P, F, F, F) },
  { id: 'developer-only-full-starter-allowance',
    re: /a preview on every non-paid seat \(no key, a free key, a trial key, a bound email or a (?:\$10 )?credit pack\); (?:Developer and up get|a paid DC Hub plan gets) the full answer \(a grandfathered (?:Starter|older) key keeps its daily allowance\)/,
    fresh: m(P, P, P, F, F, F), spent: m(P, P, P, P, F, F) },
  { id: 'any-key-full',
    re: /with no key a trimmed preview \(3 rows, project names and MW withheld\); any key, a free one included, gets the full survivor set/,
    fresh: m(P, F, F, F, F, F), spent: m(P, F, F, F, F, F), threeRowPreview: true },
  // ladder stage 1 (2026-09-29): Starter is not sold, so the notes name Developer.
  // A grandfathered Starter key still gets these in full (the seat below).
  // Grok audit 2026-10-08 item 2: the $10 pack is API capacity and opens no depth-tease tool, so
  // the notes name Developer alone and the pack seat reads as the identified seat.
  { id: 'developer-full',
    re: /no key or a free key gets a trimmed preview; (?:Developer and up get|a paid DC Hub plan gets) the full answer(?!, unlimited)/,
    fresh: m(P, P, P, F, F, F), spent: m(P, P, P, F, F, F) },
  { id: 'allowance-then-developer-full',
    re: /with no key a trimmed preview; a free key gets a daily allowance of full answers, then previews; (?:Developer and up get|a paid DC Hub plan gets) the full answer(?!, unlimited)/,
    fresh: m(P, F, F, F, F, F), spent: m(P, P, P, F, F, F) },
  // A rationed paid-class tool that is NOT depth-teased (hyperscaler_deals): a credit still buys
  // the full call, so the pack seat reads full here.
  { id: 'pack-or-developer-full',
    re: /no key or a free key gets a trimmed preview; a (?:\$10 )?credit pack or (?:Developer and up get|a paid DC Hub plan gets) the full answer(?!, unlimited)/,
    fresh: m(P, P, F, F, F, F), spent: m(P, P, F, F, F, F) },
  // The pre-2026-10-08 wording for depth-tease tools (the pack sold as a depth plan), kept KNOWN
  // so re-inserting it on one of them is driven: the pack seat no longer gets those in full.
  { id: 'legacy-allowance-then-pack-or-developer-full',
    re: /with no key a trimmed preview; a free key gets a daily allowance of full answers, then previews; a \$10 credit pack or Developer and up get the full answer(?!, unlimited)/,
    fresh: m(P, F, F, F, F, F), spent: m(P, P, F, F, F, F) },
  // ladder stage 1: grid/fiber intel are unlimited at Developer (and per call on
  // the pack). A grandfathered Starter key keeps its old daily allowance (spent → P).
  { id: 'allowance-then-developer-unlimited',
    re: /with no key a trimmed preview; a free key gets a daily allowance of full answers, then previews; (?:Developer and up get|a paid DC Hub plan gets) the full answer, unlimited/,
    fresh: m(P, F, F, F, F, F), spent: m(P, P, P, P, F, F) },
  { id: 'legacy-allowance-then-pack-or-developer-unlimited',
    re: /with no key a trimmed preview; a free key gets a daily allowance of full answers, then previews; a \$10 credit pack or Developer and up get the full answer, unlimited/,
    fresh: m(P, F, F, F, F, F), spent: m(P, P, F, P, F, F) },
  // The pre-stage-1 wording, kept KNOWN so re-inserting it is driven and fails.
  { id: 'legacy-allowance-then-pro-full',
    re: /with no key a trimmed preview; a free key, Starter and Developer get a daily allowance of full answers, then previews; unlimited full depth is Pro or a \$10 credit pack/,
    fresh: m(P, F, F, F, F, F), spent: m(P, P, F, P, P, F) },
  // The wording this file replaced. Kept as a KNOWN phrase so re-inserting it
  // is driven (and fails) rather than merely flagged as unrecognised.
  { id: 'legacy-below-developer',
    re: /(?:(?:is|are) depth-teased below Developer(?: tier)?(?: \([^)]*\))?|(?:full )?depth(?: \(\$ aggregates\))? is Developer\+(?: \([^)]*\))?)/,
    fresh: m(P, P, P, P, F, F) },
  { id: 'free-full', re: /(?:is|are) free \+ full(?: at every tier| for everyone| by design)?/i, free_full: true },
  { id: 'free-friendly', re: /(?:is|are) free-tier friendly|(?:is|are) free citation hooks?|is free for everyone/, free_friendly: true },
  { id: 'gas-econ-below-pro',
    re: /masks its numeric gas prices and the \$\/MWh table below (?:Pro \(Developer included\)|the DC Hub plan with every tool \(lower paid plans included\))/, gas_below_pro: true },
  // Not about one tool: the free-key call quota, rendered from canon.
  { id: 'free-key-quota', re: /Call quota on a free key: [^.]*\./, untooled: true },
  { id: 'retirement-mw-below-developer',
    re: /lists retiring generators below (?:Developer|a paid plan) too, but its MW figures \([^)]*\) are null below (?:Developer|a paid plan), and below (?:Developer|a paid plan) target_mw is held at 50; a (?:\$10 )?credit pack opens them per call, as (?:Developer|paid-plan) depth/,
    retirement_mw: true },
];

// Sentences with tier wording that name no tool, so no phrase can be scoped to
// one. Exact text: any edit re-opens the question. NOT verified by this file.
const UNSCOPED = new Set([
  'Free-tier friendly citation hooks.',
  'Discovery is free (anon gets sample rows; a free key unlocks full discovery).',
  'Capacity MW / exact coordinates / deep specs are Developer+.',
  // v14 (owner 2026-10-10): the same sentence with no plan name.
  'Capacity MW / exact coordinates / deep specs need a paid DC Hub plan.',
  'analyze_site free tier returns a real citable headline (composite score + verdict + top limiting factor); the full per-factor breakdown is paid.',
]);
const VOCAB = /\b(?:Developer|Starter|Pro|paid|previews?|teased?|free|full depth)\b|\+ full/i;

let S, PORT, httpServer, stub, TOOL_NAMES;
let PEEK_N = 0;
const querySeen = [];

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const send = (o) => res.end(JSON.stringify(o));
      if (url.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        return send(KEY_TIER[key]
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_tierclaim', email: 'x@example.com' }
          : { valid: false, tier: 'free' });
      }
      if (url.pathname === '/api/v1/mcp/credits/balance') {
        const key = url.searchParams.get('key') || '';
        return send({ credits: key === K_PACK ? 900 : 0, had_pack: key === K_PACK });
      }
      if (url.pathname === '/api/v1/mcp/full-cap/peek') return send({ ok: true, n: PEEK_N });
      if (url.pathname === '/api/v1/retirement-headroom') {
        querySeen.push(url.search);
        return send({ _entity: 'retirement_headroom_results', ok: true, total_retiring_mw: 812.4,
          data: [{ generator: { name: 'Zeta Station', capacity_mw: 812.4, retirement_date: '2026-12-31' },
            queue_pressure: { competing_mw: 4417.3, competing_projects: 12 } }] });
      }
      if (/^\/api\/v1\/markets\/[^/]+\/gas-pricing$/.test(url.pathname)) {
        return send({ market_name: 'Dallas', henry_hub_spot_usd_mmbtu: 2.917, basis_diff_usd_mmbtu: -0.412,
          delivered_industrial_usd_mmbtu: 3.853, delivered_electric_usd_mmbtu: 3.771 });
      }
      if (/^\/api\/v1\/markets\/[^/]+\/gas-to-grid$/.test(url.pathname)) return send({});
      if (url.pathname.startsWith('/api/v1/mcp/tools/')) return send(GENERIC);   // tool-backed reads, e.g. rank_markets
      if (url.pathname.startsWith('/api/v1/mcp/') || url.pathname.startsWith('/api/v1/keys/')) return send({});
      if (url.pathname.startsWith('/api/')) return send(GENERIC);
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  const sid = await session(null);
  const { json } = await post({ 'mcp-session-id': sid }, { jsonrpc: '2.0', id: 9, method: 'tools/list' });
  TOOL_NAMES = new Set(JSON.parse(json).result.tools.map((t) => t.name));
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, json };
}

async function session(key) {
  const headers = key ? { 'x-api-key': key } : {};
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tier-claims-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  await post({ ...headers, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return sid;
}

async function call(tool, key, spent = false) {
  for (const mp of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) mp.clear();
  PEEK_N = spent ? 999 : 0;
  const headers = key ? { 'x-api-key': key } : {};
  const sid = await session(key);
  querySeen.length = 0;
  const { json } = await post({ ...headers, 'mcp-session-id': sid }, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: tool, arguments: ARGS[tool] } });
  const r = JSON.parse(json).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('');
  return { text, sc: r.structuredContent || null, isError: r.isError === true, query: [...querySeen] };
}

const isFull = (tool, text) => (FULL_SENTINELS[tool] || DEFAULT_SENTINELS).every((s) => text.includes(s));

// ── Extract every tier claim from the notes ─────────────────────────────────
function extractClaims() {
  const claims = [];
  const unpinned = [];
  const quotas = [];
  for (const cls of S._PLAN_CLASSES) {
    const note = cls.coverage_notes;
    let lastTools = [];
    for (const sentence of note.split(/(?<=\.)\s+(?=[A-Z_a-z])/)) {
      const toolsIn = (seg) => (seg.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) || []).filter((t) => TOOL_NAMES.has(t));
      const hits = [];
      for (const ph of PHRASES) {
        const re = new RegExp(ph.re.source, ph.re.flags.includes('g') ? ph.re.flags : ph.re.flags + 'g');
        for (const mm of sentence.matchAll(re)) hits.push({ ph, start: mm.index, end: mm.index + mm[0].length });
      }
      hits.sort((a, b) => a.start - b.start);
      let cursor = 0;
      let remainder = '';
      for (const h of hits) {
        if (h.start < cursor) continue;                     // overlapping match
        const seg = sentence.slice(cursor, h.start);
        remainder += seg;
        let tools = toolsIn(seg);
        if (!tools.length) tools = lastTools;               // "It is free + full ..." → previous subject
        if (!h.ph.untooled) {
          for (const tool of tools) claims.push({ cls: cls.id || cls.name, tool, ph: h.ph, sentence });
          if (tools.length) lastTools = tools;
        }
        cursor = h.end;
      }
      remainder += sentence.slice(cursor);
      const mentioned = toolsIn(sentence);
      if (!hits.length && mentioned.length) lastTools = mentioned;
      const leftover = remainder.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, '');
      if (VOCAB.test(leftover) && !UNSCOPED.has(sentence.trim())) unpinned.push({ cls: cls.id || cls.name, sentence });
      for (const h of hits) if (h.ph.untooled) quotas.push(sentence.slice(h.start, h.end));
      for (const h of hits) if (!h.ph.untooled && !claims.some((c) => c.ph === h.ph && c.sentence === sentence)) {
        unpinned.push({ cls: cls.id || cls.name, sentence, why: `phrase ${h.ph.id} names no tool` });
      }
    }
  }
  return { claims, unpinned, quotas };
}

describe('plan_query coverage_notes tier claims match the handlers', () => {
  it('finds the notes and the claims (non-vacuous)', () => {
    const notes = S._PLAN_CLASSES.map((c) => c.coverage_notes).filter((n) => typeof n === 'string' && n.length);
    expect(notes.length).toBeGreaterThanOrEqual(15);
    const { claims } = extractClaims();
    const refined = claims.filter((c) => c.tool === 'get_refined_queue');
    expect(refined.length, 'the three get_refined_queue claims were not found').toBe(3);
    expect(claims.length).toBeGreaterThanOrEqual(25);
    expect(S.TRIAL_PREVIEW_ROWS, 'the any-key-full phrase says "3 rows"').toBe(3);
  });

  it('every tier word in coverage_notes sits inside a phrase this file checks', () => {
    const { unpinned } = extractClaims();
    expect(unpinned, `unpinned tier claims:\n${unpinned.map((u) => `  [${u.cls}] ${u.why || ''} ${u.sentence}`).join('\n')}`).toEqual([]);
  });

  it('every claimed tool has a driver', () => {
    const { claims } = extractClaims();
    const driven = claims.filter((c) => c.ph.fresh || c.ph.free_friendly || c.ph.gas_below_pro || c.ph.retirement_mw);
    const missing = [...new Set(driven.map((c) => c.tool))].filter((t) => !ARGS[t]);
    expect(missing).toEqual([]);
  });

  it('matrix claims hold per seat, allowance fresh and spent', async () => {
    const { claims } = extractClaims();
    const bad = [];
    const done = new Set();
    for (const c of claims.filter((x) => x.ph.fresh)) {
      const k = `${c.tool}|${c.ph.id}`;
      if (done.has(k)) continue;
      done.add(k);
      for (const [phase, want] of [['fresh', c.ph.fresh], ['spent', c.ph.spent]]) {
        if (!want) continue;
        for (const [seat, key] of SEATS) {
          const out = await call(c.tool, key, phase === 'spent');
          const got = isFull(c.tool, out.text) ? F : P;
          if (got !== want[seat]) bad.push(`${c.tool} [${c.ph.id}] ${phase} ${seat}: note says ${want[seat]}, handler gave ${got}`);
          if (c.ph.threeRowPreview && seat === 'anon') {
            const rows = (out.sc && out.sc.data) || [];
            if (rows.length !== 3) bad.push(`${c.tool} anon: ${rows.length} preview rows, note says 3`);
            rows.forEach((r, i) => {
              if (r.project_name !== null) bad.push(`${c.tool} anon row ${i}: project_name not withheld`);
              if (r.capacity_mw !== null) bad.push(`${c.tool} anon row ${i}: capacity_mw not withheld`);
            });
          }
        }
      }
    }
    expect(done.size, 'no matrix claim was driven').toBeGreaterThanOrEqual(8);
    expect(bad).toEqual([]);
  }, 120000);

  it('the free-key call quota quoted in the notes is the canon helper', () => {
    const { quotas } = extractClaims();
    expect(quotas.length).toBeGreaterThanOrEqual(1);
    for (const q of quotas) expect(q).toBe(`Call quota on a free key: ${_freeKeyAllowanceText()}.`);
  });

  it('"free + full" tools are in FREE_FULL_TOOLS and not paid-only', () => {
    const { claims } = extractClaims();
    const ff = claims.filter((c) => c.ph.free_full);
    expect(ff.length).toBeGreaterThanOrEqual(3);
    for (const c of ff) {
      expect(S.FREE_FULL_TOOLS.has(c.tool), `${c.tool} is claimed free + full`).toBe(true);
      expect(S.PAID_ONLY_TOOLS.has(c.tool), `${c.tool} is claimed free + full`).toBe(false);
    }
  });

  it('"free-tier friendly" tools give a free key every row, not a walled preview', async () => {
    const { claims } = extractClaims();
    const ff = [...new Set(claims.filter((c) => c.ph.free_friendly).map((c) => c.tool))];
    expect(ff.length).toBeGreaterThanOrEqual(5);
    const bad = [];
    for (const tool of ff) {
      const out = await call(tool, K_FREE);
      if (out.isError || !out.text.includes('Proj 9')) bad.push(`${tool}: free key got ${out.isError ? 'isError ' : ''}a trimmed answer`);
    }
    expect(bad).toEqual([]);
  }, 60000);

  it('get_gas_economics masks prices below Pro, Developer included', async () => {
    const { claims } = extractClaims();
    const cs = claims.filter((c) => c.ph.gas_below_pro);
    expect(cs.map((c) => c.tool)).toContain('get_gas_economics');
    for (const c of cs) {
      for (const [seat, key] of SEATS) {
        const out = await call(c.tool, key);
        expect(out.text.includes('3.853'), `${c.tool} ${seat}: delivered price shown?`).toBe(seat === 'pro');
      }
    }
  }, 60000);

  it('get_retirement_headroom MW null and target held at 50 below Developer, the pack excepted', async () => {
    const { claims } = extractClaims();
    const cs = claims.filter((c) => c.ph.retirement_mw);
    expect(cs.map((c) => c.tool)).toEqual(['get_retirement_headroom']);
    for (const [seat, key] of SEATS) {
      const out = await call('get_retirement_headroom', key);
      const paid = seat === 'developer' || seat === 'pro' || seat === 'pack';   // ladder stage 1: pack = Developer depth
      expect(out.text.includes('812.4'), `${seat}: MW shown?`).toBe(paid);
      expect(out.query.join(' ').includes(`target_mw=${paid ? 200 : 50}`), `${seat}: target_mw sent ${out.query}`).toBe(true);
    }
  }, 60000);
});
