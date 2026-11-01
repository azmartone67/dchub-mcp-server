// dcpi-subscores-pro-only.test.mjs — owner decision 2026-10-31: the DCPI sub-scores move from
// "any paid plan" to Pro and above.
//
// Free for everyone stays the BUILD/CAUTION/AVOID verdict and composite_score. excess_power_score,
// constraint_score, time_to_power_months, the risk/opportunity bullets and the per-ISO aggregates
// now need Pro, founding, enterprise, admin or internal. dchub-backend (dcpi/subscores-pro-1031)
// refuses them to Starter/Developer over REST, but this server calls it with X-Internal-Key and
// gets the full row, so before this change a Developer key read every sub-score over MCP.
//
// Pinned here, through the real /mcp handler against a 127.0.0.1 stub backend:
//   * Starter, Developer, and a collapsed 'paid' key whose plan is Developer: the fields are
//     nulled with their `_withheld` marker, the bands, verdict and composite stay, and one line
//     names the rung that opens them by the missed-rung link, with no plan name and no price;
//   * Pro, and a collapsed 'paid' key whose plan is Pro: byte-for-byte the full row, no line;
//   * a free key: the free path it had (the sub-scores nulled there already), without this line.
// Scope: get_market_dcpi_rank, rank_markets, compare_isos, get_grid_scoreboard (the last two in
// test/dcpi-iso-aggregates-free.test.mjs). Tools where a free seat reads the fields in full by an
// owner grant (email allowances, top-20 metros) are left whole, so no rung drops below a lower one.
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
  queue_wait_months: 33.47, signal_tier: 'full', computed_at: '2026-10-31T06:00:00+00:00', published: true,
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
const VALIDATE = {
  [K_FREE]: { valid: true, tier: 'free', developer_id: 'd_f', email: null },
  [K_STARTER]: { valid: true, tier: 'starter', developer_id: 'd_s', email: 's@example.com', tier_detail: { users_plan: 'starter' } },
  [K_DEV]: { valid: true, tier: 'developer', developer_id: 'd_d', email: 'd@example.com', tier_detail: { users_plan: 'developer' } },
  [K_PAID_DEV]: { valid: true, tier: 'paid', developer_id: 'd_pd', email: 'pd@example.com', tier_detail: { users_plan: 'developer' } },
  [K_PAID_PRO]: { valid: true, tier: 'paid', developer_id: 'd_pp', email: 'pp@example.com', tier_detail: { users_plan: 'pro' } },
  [K_PRO]: { valid: true, tier: 'pro', developer_id: 'd_p', email: 'p@example.com', tier_detail: { users_plan: 'pro' } },
};

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
      if (p === '/api/v1/mcp/credits/balance') return send({ credits: 0 });
      if (p === '/api/v1/dcpi/scores/boise') return send(ROW);
      if (p === '/api/v1/dcpi/scores/dallas') return send({ ...ROW, market_slug: 'dallas', market_name: 'Dallas', state: 'TX', iso: 'ERCOT' });
      if (p === '/api/v1/mcp/tools/rank_markets') return send(RANK);
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

function expectBelowPro(out, label) {
  const row = out.lead;
  expect(row && row.market_slug, `${label}: no DCPI row came back`).toBe('boise');
  for (const k of ['excess_power_score', 'constraint_score', 'time_to_power_months', 'queue_wait_months',
    'top_risks_json', 'top_opportunities_json']) {
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
  expect(all, `${label}: a paid seat was told free-tier`).not.toContain('free-tier limit');
}

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

  it('get_market_dcpi_rank: a free key keeps the free path it had (sub-scores already withheld, no new line)', async () => {
    const out = await call(K_FREE, 'get_market_dcpi_rank', { market_slug: 'boise' });
    expect(out.lead && out.lead.verdict).toBe('CAUTION');
    expect(out.lead.composite_score).toBe(47.31);
    for (const k of ['excess_power_score', 'constraint_score', 'time_to_power_months']) expect(out.lead[k]).toBeNull();
    expect(out.text).not.toMatch(LINE);
  });

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

  it('tools where an email-bound free key reads the fields in full stay whole for a paying key', () => {
    for (const t of ['get_grid_intelligence', 'get_market_intel', 'find_sites', 'site_selection_canvas',
      'predict_market_trajectory', 'execute_plan']) expect(S.DCPI_PRO_FIELD_TOOLS.has(t), t).toBe(false);
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
