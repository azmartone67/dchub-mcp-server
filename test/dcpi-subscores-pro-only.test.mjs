// dcpi-subscores-pro-only.test.mjs — owner decisions 2026-10-31: the DCPI sub-scores move from
// "any paid plan" to Pro and above, on every tool and for every caller below Pro.
//
// Free for everyone stays the BUILD/CAUTION/AVOID verdict, composite_score and the bands.
// excess_power_score, constraint_score, time_to_power_months, queue wait, the risk/opportunity
// bullets, the get_market_dcpi_rank narrative and the per-ISO DCPI aggregates now need Pro,
// founding, enterprise, admin or internal. dchub-backend refuses them below Pro over REST
// (#8130), but this server calls it with X-Internal-Key and gets the full row.
//
// Pinned here, through the real /mcp handler against a 127.0.0.1 stub backend:
//   * Starter, Developer, a collapsed 'paid' key whose plan is Developer, an email-bound free key
//     and a free key: the fields are nulled with their `_withheld` marker, prose that states them
//     loses the number and keeps the sentence, the bands, verdict and composite stay, and one line
//     names the rung that opens them by the missed-rung link, with no plan name and no price;
//   * Pro, and a collapsed 'paid' key whose plan is Pro: the full answer, no line;
//   * the tools where an email seat reads a full answer (grid/market intel, find_sites,
//     site_selection_canvas, predict_market_trajectory) and the context packs, plus pure checks
//     of the walk on the other DCPI-bearing shapes (risk delta, radar, saved sites, changes,
//     execute_plan). get_grid_intelligence, compare_isos and the scoreboard are pinned in
//     test/dcpi-iso-aggregates-free.test.mjs;
//   * the top-20 metros stay whole for every caller (owner 2026-10-20).
// Off-loopback connections are refused.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
// The plan-name patterns of test/agent-output-names-no-plan.test.mjs (copied: importing that file runs its suite).
const PLAN_TOKEN = /_in_(pro|developer)\b|_unlocks_at\b|\brequired_tier\b/;
const PLAN_PROSE = /\b(Pro|Developer|Starter|Founder|Enterprise)\s+(plan|tier|seat|subscription|key|rung|users?|callers?|only)\b|\bDC Hub (Pro|Developer|Starter|Founder|Enterprise)\b|\b(in|with|on|needs|requires|upgrade to) (Pro|Developer|Starter|Enterprise)\b|\$\s?\d+(\.\d+)?\s*(\/|per)\s*mo(nth)?\b/;

process.env.DCHUB_TOP_METROS_FREE = '0';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'test-internal-key-not-a-real-secret';
// Every figure distinct, so a leak names its field.
const ROW = {
  market_slug: 'boise', market_name: 'Boise', state: 'ID', iso: 'WECC', verdict: 'CAUTION',
  composite_score: 47.31, excess_power_score: 66.17, constraint_score: 52.83, time_to_power_months: 33.47,
  queue_wait_months: 33.47, signal_tier: 'full',
  narrative: { text: 'Boise reads CAUTION: an excess-power score of 66.17 against a 52.83 constraint.', model: 'brief-v3' },
  computed_at: '2026-10-31T06:00:00+00:00', published: true,
  top_risks_json: ['33-month interconnection queue'], top_opportunities_json: ['4127 MW additions queued <12mo'],
  verdict_reasons: [
    { code: 'EXCESS_POWER_MEETS_CAUTION_FLOOR', component: 'excess_power_score', value: 66.17, threshold: 50.0,
      message: 'Excess-power score 66.17 meets the 50.0 floor the CAUTION band requires.' },
    { code: 'CONSTRAINT_WITHIN_CAUTION_CEILING', component: 'constraint_score', value: 52.83, threshold: 70.0,
      message: 'Constraint score 52.83 is within the 70.0 ceiling the CAUTION band allows.' },
  ],
};
const RANK = {
  criteria: 'ai_ready', region: 'us', count: 2,
  results: [
    { rank: 1, market: 'Boise', slug: 'boise', dcpi_verdict: 'BUILD', score: 71.22, excess_power_score: 81.94,
      constraint_score: 38.61, time_to_power_months: 11.43, value: 'BUILD · 81.94 excess-power · ~11mo to power' },
    { rank: 2, market: 'Reno', slug: 'reno', dcpi_verdict: 'CAUTION', score: 44.08, excess_power_score: 58.72,
      constraint_score: 61.39, time_to_power_months: 27.66, value: 'CAUTION · 58.72 excess-power · ~27mo to power' },
  ],
};
const SUB_NEEDLES = ['66.17', '52.83', '33.47', '4127 MW', '33-month', '81.94', '38.61', '11.43', '58.72', '61.39', '27.66'];

// Fixture keys: test values only.
const K_FREE = 'dch_live_dcpipro_free0000000001';
const K_STARTER = 'dch_live_dcpipro_start000000001';
const K_DEV = 'dch_live_dcpipro_devel000000001';
const K_PAID_DEV = 'dch_live_dcpipro_paiddev0000001';   // 'paid' literal, plan Developer
const K_PAID_PRO = 'dch_live_dcpipro_paidpro0000001';   // 'paid' literal, plan Pro
const K_PRO = 'dch_live_dcpipro_propro00000001';
const K_EMAIL = 'dch_live_dcpipro_email000000001';   // identified, email bound: the email allowances
const VALIDATE = {
  [K_FREE]: { valid: true, tier: 'free', developer_id: 'd_f', email: null },
  [K_STARTER]: { valid: true, tier: 'starter', developer_id: 'd_s', email: 's@example.com', tier_detail: { users_plan: 'starter' } },
  [K_DEV]: { valid: true, tier: 'developer', developer_id: 'd_d', email: 'd@example.com', tier_detail: { users_plan: 'developer' } },
  [K_PAID_DEV]: { valid: true, tier: 'paid', developer_id: 'd_pd', email: 'pd@example.com', tier_detail: { users_plan: 'developer' } },
  [K_PAID_PRO]: { valid: true, tier: 'paid', developer_id: 'd_pp', email: 'pp@example.com', tier_detail: { users_plan: 'pro' } },
  [K_EMAIL]: { valid: true, tier: 'identified', developer_id: 'd_e', email: 'e@example.com' },
  [K_PRO]: { valid: true, tier: 'pro', developer_id: 'd_p', email: 'p@example.com', tier_detail: { users_plan: 'pro' } },
};

const FIX = {
  '/api/v1/dcpi/forecast': { market_slug: 'boise', method: 'ols', basis: { history_points: 30, history_span_days: 29, slope_per_day: 0.0123, trend: 'improving' }, horizon_quarters: 2,
    projection: [{ quarter_out: 1, excess_power_score: 67.91, excess_power_band: 'BUILD', constraint_score: 51.07, constraint_band: 'CAUTION' },
                 { quarter_out: 2, excess_power_score: 69.13, excess_power_band: 'BUILD', constraint_score: 49.88, constraint_band: 'CAUTION' }],
    caveat: 'Linear trend extrapolation, not a guarantee.' },
  '/api/v1/markets/boise': { slug: 'boise', name: 'Boise', facility_count: 41, total_mw: 812.5, operator_count: 9,
    dcpi: { verdict: 'CAUTION', composite_score: 47.31, excess_power_score: 66.17, constraint_score: 52.83, time_to_power_months: 33.47 },
    summary: 'Boise: DCPI CAUTION. DCPI: excess-power 66.17/100, constraint 52.83/100. 41 facility listings.' },
  '/api/v1/sites/find': { candidates: [{ anchor: { name: 'Sub A', lat: 43.6, lon: -116.2, state: 'ID', kv: 230 }, iso: 'WECC', verdict: 'CAUTION',
    market: { slug: 'boise', verdict: 'CAUTION', distance_km: 12.4 }, gas_distance_km: 3.21,
    time_to_power: { time_to_power_months: 33.47, time_to_power_band: 'CAUTION', basis: 'DCPI modelled estimate, not a utility date' } }], count: 1 },
  '/api/v1/site-selection/canvas': { matched: 1, shortlist: [{ market: 'boise', verdict: 'CAUTION', composite_score: 47.31, excess_power_score: 66.17,
    constraint_score: 52.83, time_to_power_months: 33.47, iso: 'WECC', facility_count: 41 }],
    synthesis: { pick: 'boise', why: ['excess-power score 66.17 (higher = more stranded/available headroom)', '~33 months to power'],
      sequence: ['~33 months to power fits your timeline; lock the queue slot to hold it.'] } },
  '/api/v1/context/market/boise': { ok: true, market: 'boise', tier: 'full', used_tokens: 90, sections: [
    { id: 'hero', title: 'Market & DCPI verdict', text: 'Boise (ID, WECC) — DCPI verdict: CAUTION. DCPI scores: excess-power 66.17/100, constraint 52.83/100. At a glance: 41 facility listings.', tokens: 30 },
    { id: 'grid', title: 'Power & grid', text: 'Power & grid: reserve margin 17.2%; queue wait ~33.47 months.', tokens: 20 },
    { id: 'ttp', title: 'Time to power', text: 'Time to power: ~33.47 months (as of 2026-10-31). Basis: DCPI modelled estimate, not a utility date.', tokens: 20 }],
    _free_preview: { used_tokens: 30, sections: [{ id: 'hero', title: 'Market & DCPI verdict', text: 'Boise (ID, WECC) — DCPI verdict: CAUTION.', tokens: 12 }], locked_sections: ['grid', 'ttp'] } },
  '/api/v1/context/iso/PJM': { ok: true, iso: 'PJM', tier: 'full', used_tokens: 60, sections: [
    { id: 'dcpi', title: 'DCPI verdicts & grid economics', text: 'DCPI: 30 tracked DCPI markets (10 BUILD / 12 CAUTION / 8 AVOID); avg queue wait ~37.58 months; avg power cost 8.64¢/kWh; reserve margin 17.25%.', tokens: 40 }],
    _free_preview: { used_tokens: 10, sections: [{ id: 'headline', title: 'Live grid snapshot', text: 'PJM demand 90,000 MW.', tokens: 10 }], locked_sections: ['dcpi'] } },
};

const PACK = new Set();   // keys holding a live $10-pack balance
let S, PORT, httpServer, stub;
const prev = {};
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_PREVIEW_ISERROR'];

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o) => res.end(JSON.stringify(o));
      if (p === '/api/v1/keys/validate') {
        let b = ''; for await (const c of req) b += c;
        return send(VALIDATE[(JSON.parse(b || '{}').api_key) || ''] || { valid: false, tier: 'free' });
      }
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/credits/balance') {
        const k = new URL(req.url, 'http://_').searchParams.get('key') || '';
        return send(PACK.has(k) ? { credits: 900, had_pack: true } : { credits: 0 });
      }
      if (p === '/api/v1/dcpi/scores/boise') return send(ROW);
      if (p === '/api/v1/dcpi/scores/dallas') return send({ ...ROW, market_slug: 'dallas', market_name: 'Dallas', state: 'TX', iso: 'ERCOT' });
      if (p === '/api/v1/mcp/tools/rank_markets') return send(RANK);
      if (FIX[p]) return send(FIX[p]);
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}

let ipN = 20;
async function call(key, name, args) {
  for (const m of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) { if (m && m.clear) m.clear(); }
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  const texts = (result.content || []).map((c) => c.text || '');
  const lead = (() => { try { return JSON.parse(texts[0].slice(0, texts[0].lastIndexOf('}') + 1)); } catch (_) { return null; } })();
  return { result, texts, text: texts.join('\n'), lead };
}

const LINE = /\u{1F512} This answer hid .*They come with the DC Hub plan that includes every tool/u;
const leaks = (hay, needle) => (/^[\d.]+$/.test(needle)
  ? new RegExp(`(?<![0-9A-Za-z_.])${needle.replace(/\./g, '\\.')}(?![0-9A-Za-z_])`).test(hay)
  : hay.includes(needle));

function expectBelowPro(out, label, { paying = true } = {}) {
  const row = out.lead;
  expect(row && row.market_slug, `${label}: no DCPI row came back`).toBe('boise');
  for (const k of ['excess_power_score', 'constraint_score', 'time_to_power_months', 'queue_wait_months',
    'top_risks_json', 'top_opportunities_json', 'narrative']) {
    expect(row[k], `${label}.${k}`).toBeNull();
    expect(row[`_${k}_withheld`], `${label}._${k}_withheld`).toBe(true);
  }
  // the free surface the owner kept
  expect(row.verdict).toBe('CAUTION');
  expect(row.composite_score).toBe(47.31);
  expect(row.excess_power_score_band).toBe('BUILD');     // 66.17 clears the 65 BUILD floor (DCPI_VERDICT_BANDS)
  expect(row.constraint_score_band).toBe('CAUTION');
  for (const r of row.verdict_reasons) {
    expect(r.value, `${label} reason ${r.code}`).toBeNull();
    expect(r.code).toMatch(/_CAUTION_/);
  }
  const all = JSON.stringify(out.result);
  for (const n of SUB_NEEDLES) expect(leaks(all, n), `${label}: "${n}" reached the result`).toBe(false);
  // one line, the Pro rung by its link, no plan name and no price
  expect(out.text, `${label}: no upgrade line`).toMatch(LINE);
  expect(out.text).toMatch(/→ https:\/\/dchub\.cloud\//);
  expect(PLAN_PROSE.test(out.text), `${label}: a plan named in prose`).toBe(false);
  expect(PLAN_TOKEN.test(out.text), `${label}: a plan token in text`).toBe(false);
  // a paying seat is never told it hit a "free-tier limit" (_boundaryPhrase reads the caller's tier)
  if (paying) expect(all, `${label}: a paid seat was told free-tier`).not.toContain('free-tier limit');
}
// Any answer below Pro: none of `needles` anywhere, the withheld markers present, one upgrade line.
// `line`: false where the free path had already withheld the field before this step ran (the
// email seat's find_sites / canvas preview), so this step changed nothing and adds no line.
// `marker`: false where only prose carried the figure (the context packs).
function expectWithheld(out, needles, label, { line = true, marker = true } = {}) {
  const all = JSON.stringify(out.result);
  for (const n of needles) expect(leaks(all, n), `${label}: "${n}" reached the result`).toBe(false);
  if (marker) expect(all, `${label}: no _withheld marker`).toMatch(/_withheld"/);
  if (line) expect(out.text, `${label}: no upgrade line`).toMatch(LINE);
  expect(PLAN_PROSE.test(out.text), `${label}: a plan named in prose`).toBe(false);
  expect(PLAN_TOKEN.test(out.text), `${label}: a plan token in text`).toBe(false);
}
const BELOW_PRO_SEATS = [[K_EMAIL, 'email-bound free key'], [K_STARTER, 'starter'], [K_DEV, 'developer']];

describe('owner 2026-10-31: DCPI sub-scores are Pro and above', () => {
  for (const [key, label] of [[K_STARTER, 'starter'], [K_DEV, 'developer'], [K_PAID_DEV, "'paid' (plan developer)"]]) {
    it(`get_market_dcpi_rank: ${label} gets the sub-scores withheld, verdict and composite kept`, async () => {
      expectBelowPro(await call(key, 'get_market_dcpi_rank', { market_slug: 'boise' }), label);
    });
  }

  for (const [key, label] of [[K_PRO, 'pro'], [K_PAID_PRO, "'paid' (plan pro)"]]) {
    it(`get_market_dcpi_rank: ${label} is unchanged`, async () => {
      const out = await call(key, 'get_market_dcpi_rank', { market_slug: 'boise' });
      for (const [k, v] of Object.entries(ROW)) expect(out.lead[k], `${label}.${k}`).toEqual(v);
      expect(out.text).not.toMatch(LINE);
    });
  }

  for (const [key, label] of [[K_FREE, 'free key'], [K_EMAIL, 'email-bound free key'], [null, 'keyless']]) {
    it(`get_market_dcpi_rank: a ${label} gets the sub-scores and the narrative withheld (one Pro floor for every seat)`, async () => {
      const out = await call(key, 'get_market_dcpi_rank', { market_slug: 'boise' });
      expect(out.lead && out.lead.verdict).toBe('CAUTION');
      expect(out.lead.composite_score).toBe(47.31);
      for (const k of ['excess_power_score', 'constraint_score', 'time_to_power_months', 'narrative']) expect(out.lead[k] ?? null, `${label}.${k}`).toBeNull();
      expect(out.lead._narrative_withheld, `${label}._narrative_withheld`).toBe(true);
      const all = JSON.stringify(out.result);
      for (const n of SUB_NEEDLES) expect(leaks(all, n), `${label}: "${n}" reached the result`).toBe(false);
      // the keyless preview carries its own single relay line (the anonymous envelope), not this one
      if (key) expect(out.text).toMatch(LINE);
    });
  }

  for (const [key, label] of [[K_STARTER, 'starter'], [K_DEV, 'developer']]) {
    it(`rank_markets ai_ready: ${label} keeps every row and the composite, loses the sub-scores and their display words`, async () => {
      const out = await call(key, 'rank_markets', { criteria: 'ai_ready', limit: 2 });
      const rows = (out.lead && out.lead.results) || [];
      expect(rows.length, `${label}: rows were cut, not only fields`).toBe(2);
      expect(rows.map((r) => r.score)).toEqual([71.22, 44.08]);
      expect(rows.map((r) => r.value)).toEqual(['BUILD', 'CAUTION']);
      for (const r of rows) {
        for (const k of ['excess_power_score', 'constraint_score', 'time_to_power_months']) expect(r[k], `${label} ${r.slug}.${k}`).toBeNull();
      }
      const all = JSON.stringify(out.result);
      for (const n of SUB_NEEDLES) expect(leaks(all, n), `${label}: "${n}" reached the result`).toBe(false);
      expect(out.text).toMatch(LINE);
    });
  }

  it('rank_markets ai_ready: pro is unchanged', async () => {
    const out = await call(K_PRO, 'rank_markets', { criteria: 'ai_ready', limit: 2 });
    expect(out.lead.results.map((r) => [r.excess_power_score, r.constraint_score, r.time_to_power_months, r.value]))
      .toEqual(RANK.results.map((r) => [r.excess_power_score, r.constraint_score, r.time_to_power_months, r.value]));
    expect(out.text).not.toMatch(LINE);
  });

  it('a top-20 metro stays whole for a developer key, as it is for every caller (owner 2026-10-20)', async () => {
    process.env.DCHUB_TOP_METROS_FREE = '1';
    try {
      const anon = await call(null, 'get_market_dcpi_rank', { market_slug: 'dallas' });
      expect(anon.lead.excess_power_score, 'control: keyless reads the top-metro row in full').toBe(ROW.excess_power_score);
      const dev = await call(K_DEV, 'get_market_dcpi_rank', { market_slug: 'dallas' });
      for (const k of ['excess_power_score', 'constraint_score', 'time_to_power_months']) expect(dev.lead[k], `dallas developer.${k}`).toBe(ROW[k]);
      expect(dev.text).not.toMatch(LINE);
    } finally {
      process.env.DCHUB_TOP_METROS_FREE = '0';
    }
    const off = await call(K_DEV, 'get_market_dcpi_rank', { market_slug: 'boise' });
    expect(off.lead.excess_power_score, 'control: boise is not a top-20 metro').toBeNull();
  });

  // ── the tools an email seat reads in full (owner 2026-10-31, second ruling) ──
  for (const [key, label] of BELOW_PRO_SEATS) {
    it(`predict_market_trajectory: ${label} gets the projected sub-scores withheld, the bands kept`, async () => {
      const out = await call(key, 'predict_market_trajectory', { market_slug: 'boise', horizon_quarters: 2 });
      const proj = (out.lead && out.lead.projection) || [];
      expect(proj.length, `${label}: projection rows were cut`).toBe(2);
      for (const r of proj) {
        expect(r.excess_power_score, `${label} q${r.quarter_out} excess`).toBeNull();
        expect(r.constraint_score, `${label} q${r.quarter_out} constraint`).toBeNull();
        expect(r._excess_power_score_withheld).toBe(true);
        expect([r.excess_power_band, r.constraint_band]).toEqual(['BUILD', 'CAUTION']);
      }
      expect(out.lead.basis.trend, `${label}: the trend word is not a DCPI figure`).toBe('improving');
      expectWithheld(out, ['67.91', '69.13', '51.07', '49.88'], `predict_market_trajectory ${label}`);
    });

    it(`get_market_intel: ${label} keeps the market figures, loses the DCPI sub-scores and their prose numbers`, async () => {
      const out = await call(key, 'get_market_intel', { market: 'boise' });
      expect([out.lead.facility_count, out.lead.total_mw, out.lead.operator_count], `${label}: non-DCPI figures changed`).toEqual([41, 812.5, 9]);
      expect(out.lead.dcpi.verdict).toBe('CAUTION');
      expect(out.lead.dcpi.composite_score).toBe(47.31);
      for (const k of ['excess_power_score', 'constraint_score', 'time_to_power_months']) expect(out.lead.dcpi[k], `${label} dcpi.${k}`).toBeNull();
      expect(out.lead.summary).toBe('Boise: DCPI CAUTION. DCPI: excess-power withheld, constraint withheld. 41 facility listings.');
      expectWithheld(out, ['66.17', '52.83', '33.47'], `get_market_intel ${label}`);
    });

    it(`find_sites: ${label} keeps the candidate and its band, loses the months to power`, async () => {
      const out = await call(key, 'find_sites', { lat: 43.6, lon: -116.2, capacity_mw: 100 });
      const cand = (out.lead && out.lead.candidates || [])[0];
      expect(cand && cand.verdict, `${label}: no candidate`).toBe('CAUTION');
      expect(cand.time_to_power.time_to_power_months).toBeNull();
      expect(cand.time_to_power._time_to_power_months_withheld).toBe(true);
      expect(cand.time_to_power.time_to_power_band).toBe('CAUTION');
      expect(cand.gas_distance_km, `${label}: a non-DCPI figure changed`).toBe(3.21);
      expectWithheld(out, ['33.47'], `find_sites ${label}`, { line: key !== K_EMAIL });
    });

    it(`site_selection_canvas: ${label} keeps the shortlist, the synthesis prose loses the sub-score figures`, async () => {
      const out = await call(key, 'site_selection_canvas', { capacity_mw: 100, region: 'ID' });
      const row = (out.lead && out.lead.shortlist || [])[0];
      expect(row && row.verdict, `${label}: no shortlist row`).toBe('CAUTION');
      for (const k of ['excess_power_score', 'constraint_score', 'time_to_power_months']) expect(row[k], `${label} ${k}`).toBeNull();
      expect([row.excess_power_score_band, row.constraint_score_band]).toEqual(['BUILD', 'CAUTION']);
      const syn = out.lead.synthesis;
      if (syn) {    // the decision layer itself is the free path's call; where it is served, its figures go
        expect(JSON.stringify(syn), `${label}: synthesis restated a sub-score`).not.toMatch(/66\.17|~33 months/);
      }
      expectWithheld(out, ['66.17', '52.83', '33.47'], `site_selection_canvas ${label}`, { line: key !== K_EMAIL });
    });
  }

  for (const [key, label] of [[K_STARTER, 'starter'], [K_DEV, 'developer'], [K_PAID_DEV, "'paid' (plan developer)"]]) {
    it(`get_market_context: ${label} keeps every section and sentence, the sub-score numbers go`, async () => {
      const out = await call(key, 'get_market_context', { market: 'boise' });
      const texts = ((out.lead && out.lead.sections) || []).map((x) => x.text);
      expect(texts).toEqual([
        'Boise (ID, WECC) — DCPI verdict: CAUTION. DCPI scores: excess-power withheld, constraint withheld. At a glance: 41 facility listings.',
        'Power & grid: reserve margin 17.2%; queue wait withheld.',
        'Time to power withheld (as of 2026-10-31). Basis: DCPI modelled estimate, not a utility date.',
      ]);
      expectWithheld(out, ['66.17', '52.83', '33.47'], `get_market_context ${label}`, { marker: false });
    });

    it(`get_iso_context: ${label} keeps the DCPI line, the per-ISO queue wait and price go`, async () => {
      const out = await call(key, 'get_iso_context', { iso: 'PJM' });
      expect(((out.lead && out.lead.sections) || []).map((x) => x.text)).toEqual([
        'DCPI: 30 tracked DCPI markets (10 BUILD / 12 CAUTION / 8 AVOID); avg queue wait withheld; avg power cost withheld; reserve margin 17.25%.',
      ]);
      expectWithheld(out, ['37.58', '8.64'], `get_iso_context ${label}`, { marker: false });
    });
  }

  it('Pro reads every newly gated tool whole, with no line', async () => {
    const cases = [
      ['predict_market_trajectory', { market_slug: 'boise', horizon_quarters: 2 }, ['67.91', '51.07']],
      ['get_market_intel', { market: 'boise' }, ['66.17', '52.83', '33.47']],
      ['find_sites', { lat: 43.6, lon: -116.2, capacity_mw: 100 }, ['33.47']],
      ['site_selection_canvas', { capacity_mw: 100, region: 'ID' }, ['66.17', '52.83', '33.47', '~33 months to power']],
      ['get_market_context', { market: 'boise' }, ['excess-power 66.17/100', 'Time to power: ~33.47 months']],
      ['get_iso_context', { iso: 'PJM' }, ['avg queue wait ~37.58 months', 'avg power cost 8.64']],
      ['get_market_dcpi_rank', { market_slug: 'boise' }, ['66.17', 'excess-power score of 66.17']],
    ];
    for (const [tool, args, needles] of cases) {
      for (const key of [K_PRO, K_PAID_PRO]) {
        const out = await call(key, tool, args);
        const all = JSON.stringify(out.result);
        for (const n of needles) expect(all.includes(n), `pro ${tool}: "${n}" missing`).toBe(true);
        expect(all, `pro ${tool}: a field was withheld`).not.toMatch(/_(excess_power_score|constraint_score|time_to_power_months|narrative)_withheld/);
        expect(out.text, `pro ${tool}: upgrade line on a Pro answer`).not.toMatch(LINE);
      }
    }
  });

  it('a pack balance on a free seat keeps the fields (owner: the pack behaviour is unchanged)', async () => {
    const r = { content: [{ type: 'text', text: JSON.stringify(ROW) }] };
    const below = await S._dcpiSubscoresBelowPro(r, 'get_market_dcpi_rank', { tier: 'identified', api_key: K_EMAIL }, { market_slug: 'boise' });
    expect(JSON.parse(below.content[0].text).excess_power_score, 'control: no pack, withheld').toBeNull();
    const K_PACK = 'dch_live_dcpipro_packs000000001';   // not read before: the balance cache is per key
    PACK.add(K_PACK);
    const pack = await S._dcpiSubscoresBelowPro(r, 'get_market_dcpi_rank', { tier: 'identified', api_key: K_PACK }, { market_slug: 'boise' });
    expect(pack, 'a pack holder was gated').toBe(r);
  });

  it('the directory / Claude / core profiles: the fields are withheld too, with no added line (their wall copy is fixed)', async () => {
    const r = { content: [{ type: 'text', text: JSON.stringify(ROW) }] };
    for (const profile of ['chatgpt_directory', 'claude_directory', 'core_profile']) {
      const out = await S._dcpiSubscoresBelowPro(r, 'get_market_dcpi_rank', { tier: 'identified', api_key: K_EMAIL, profile }, { market_slug: 'boise' });
      expect(out, profile).not.toBe(r);
      expect(JSON.parse(out.content[0].text).excess_power_score, profile).toBeNull();
      expect(out.content, `${profile}: a line was added`).toHaveLength(1);
    }
    const plain = await S._dcpiSubscoresBelowPro(r, 'get_market_dcpi_rank', { tier: 'identified', api_key: K_EMAIL }, { market_slug: 'boise' });
    expect(plain.content, 'control: /mcp gets the line').toHaveLength(2);
  });

  it('execute_plan: the steps and the intent answer it carries lose the figures, for a free seat too', async () => {
    const plan = { intent_class: 'market_comparison', intent_answer: { headline: 'Boise: DCPI CAUTION (47.31).',
      evidence: ['DCPI time-to-power: 33.47 months.', 'PJM average time-to-power: 29.86 months.', '12 active interconnection-queue projects match.'] },
    executed: [{ step: 1, tool: 'get_market_dcpi_rank', status: 'ok', result: ROW },
      { step: 2, tool: 'get_grid_intelligence', status: 'ok', result: { iso: 'PJM', demand_mw: 90000, constraint_score: 52.83, constraint_score_band: 'CAUTION', avg_time_to_power_months: 29.86 } }] };
    const r = { content: [{ type: 'text', text: JSON.stringify(plan) }] };
    for (const tier of ['identified', 'developer']) {
      const out = await S._dcpiSubscoresBelowPro(r, 'execute_plan', { tier, api_key: tier === 'developer' ? K_DEV : K_EMAIL }, {});
      const j = JSON.parse(out.content[0].text);
      expect(j.executed[0].result.excess_power_score, `${tier} step 1`).toBeNull();
      expect(j.executed[0].result.verdict).toBe('CAUTION');
      expect(j.executed[1].result.avg_time_to_power_months, `${tier} step 2`).toBeNull();
      expect(j.executed[1].result.demand_mw).toBe(90000);
      expect(j.intent_answer.evidence).toEqual(['DCPI time-to-power withheld.', 'PJM average time-to-power withheld.',
        '12 active interconnection-queue projects match.']);
      expect(j.intent_answer.headline).toBe('Boise: DCPI CAUTION (47.31).');
      for (const n of ['66.17', '52.83', '33.47', '29.86']) expect(leaks(out.content[0].text, n), `${tier}: ${n}`).toBe(false);
      expect(out.content.at(-1).text).toMatch(LINE);
    }
    expect(await S._dcpiSubscoresBelowPro(r, 'execute_plan', { tier: 'pro', api_key: K_PRO }, {}), 'pro').toBe(r);
  });

  it('the walk on the other DCPI-bearing shapes: the sub-score goes, its delta and the non-DCPI layers stay', () => {
    // get_facility_risk_delta: `now` IS the excess-power score; the delta and direction stay
    const rd = S._dcpiProShape({ dcpi_market_health: { coverage: 'validated', delta: 3.2, now: 66.2, direction: 'improving',
      basis: 'DCPI excess-power score change over 7d' }, summary: 'Boise DCPI market health improving 3.2pt over 7d' }, 'get_facility_risk_delta', []);
    expect(rd.value.dcpi_market_health).toMatchObject({ now: null, _now_in_pro: true, delta: 3.2, direction: 'improving' });
    expect(rd.value.summary).toBe('Boise DCPI market health improving 3.2pt over 7d');
    // grid_transition_radar: the ISO rollup's averages and the leaderboard's scores
    const radar = S._dcpiProShape({ iso_rollup: [{ iso: 'ERCOT', build_rate_pct: 41.2, avg_excess_power: 61.4, avg_time_to_power_months: 21.7 }],
      leaderboard: [{ market: 'midland', verdict: 'BUILD', excess_power_score: 86.4, time_to_power_months: 9.6 }] }, 'grid_transition_radar', []).value;
    expect(radar.iso_rollup[0]).toMatchObject({ avg_excess_power: null, avg_time_to_power_months: null, build_rate_pct: 41.2 });
    expect(radar.leaderboard[0]).toMatchObject({ excess_power_score: null, time_to_power_months: null, verdict: 'BUILD', excess_power_score_band: 'BUILD' });
    // list_saved_sites / get_changes: the score goes, the delta over the window stays
    const saved = S._dcpiProShape({ sites: [{ name: 'Site A', dcpi_score_at_save: 47.3, verdict_now: 'CAUTION', excess_power_score: 66.2,
      constraint_score: 52.8, time_to_power_months: 33.5, excess_power_delta_window: 1.4 }],
    dcpi_movers: [{ market: 'reno', excess_power_score: 58.7, delta: -2.1 }] }, 'list_saved_sites', []).value;
    expect(saved.sites[0]).toMatchObject({ excess_power_score: null, constraint_score: null, time_to_power_months: null,
      excess_power_delta_window: 1.4, dcpi_score_at_save: 47.3 });
    expect(saved.dcpi_movers[0]).toMatchObject({ excess_power_score: null, delta: -2.1 });
    // not DCPI: a queue row's own time to power, an energy price, a MW figure beside the words
    const other = { results: [{ project: 'Solar 1', estimated_ttp_months: 30, time_to_power_months: 30, capacity_mw: 200 }],
      prices: { retail_price_cents_kwh: 9.1 }, note: '578 MW behind-the-meter excess power 300 MW; transmission constraint 500 MW' };
    expect(S._dcpiProShape(other, 'get_refined_queue', []).changed, 'a non-DCPI shape was touched').toBe(false);
  });

  it('the prose scrub takes the number, keeps the sentence', () => {
    const f = S._scrubDcpiProse;
    expect(f('DCPI scores: excess-power 65.8/100, constraint 54.7/100.')).toBe('DCPI scores: excess-power withheld, constraint withheld.');
    expect(f('The 62/100 constraint score is high.')).toBe('The withheld constraint score is high.');
    expect(f('~33 months to power fits your timeline.')).toBe('time to power withheld fits your timeline.');
    expect(f('Time to power: ~33.5 months (as of 2026-10-31).')).toBe('Time to power withheld (as of 2026-10-31).');
    expect(f('Estimated time-to-power on the queue rows shown: 12-36 months.')).toBe('Estimated time-to-power on the queue rows shown: 12-36 months.');
    expect(f('0-100 excess-power component')).toBe('0-100 excess-power component');
  });

  it('_dcpiProShape is pure: the cached input object is not mutated', () => {
    const input = JSON.parse(JSON.stringify(ROW));
    const g = S._dcpiProShape(input, 'get_market_dcpi_rank', []);
    expect(g.changed).toBe(true);
    expect(input).toEqual(ROW);
  });

  it('made no off-loopback connection', () => {
    expect(foreign).toEqual([]);
  });
});
