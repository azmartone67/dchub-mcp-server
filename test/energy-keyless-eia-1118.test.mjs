// energy-keyless-eia-1118.test.mjs — owner via Grok note 2026-11-17, items 1 and 2.
//
// (1) Keyless public-domain figures: the EIA state gas prices reach every caller on
//     get_gas_economics (delivered industrial / electric, the burner-tip PEU mean and its
//     monthly min/max), each dated and labelled in figure_labels. Henry Hub is EIA's RNGWHHD
//     series, which EIA credits to Refinitiv (LSEG), so it stays behind DCHUB_KEYLESS_HENRY_HUB
//     (default off). get_refined_queue's project_name and queue_id pass through, except on a
//     held ISO's row (MISO, SPP: their terms bar republishing), which stays null with
//     identity_withheld below full depth, whether the backend or this server withheld it.
// (2) get_energy_prices' wholesale_lmp block (hub LMP, $/MWh) reaches every caller untouched,
//     the same figures /api/v1/iso-lmp/snapshot publishes; wholesale_lmp_withheld passes through;
//     the new `hub` argument reaches the backend.
//
// Real /mcp handler over loopback, 127.0.0.1 stub backend, off-loopback refused.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

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
// Sentinels: each appears in no template, so a match is the figure itself.
const RT_LMP = 31.4159, DA_LMP = 27.1828;
const IND = 4.6113, ELEC = 3.2117, BT = 2.9431, BT_MIN = 1.0537, BT_MAX = 5.7719;
const HH = 3.3391, HUB_SPOT = 3.0973, BASIS = -0.2418, USED = 2.9432;
const CCGT = 20.0131;

// ── get_energy_prices: the backend's answer for a keyless ERCOT call (retail gated by the backend) ──
const LMP = {
  label: 'wholesale LMP, $/MWh', iso: 'ERCOT', hub: 'HB_NORTH',
  hubs_available: ['HB_NORTH', 'HB_HOUSTON', 'HB_SOUTH', 'HB_WEST', 'HB_PAN', 'HB_BUSAVG'],
  real_time: { lmp_usd_mwh: RT_LMP, interval_ending: '2026-11-18T05:15:00-06:00', as_of: '2026-11-18T11:16:02Z',
    market: 'RTM', stale: false, stale_after_minutes: 30 },
  day_ahead: { lmp_usd_mwh: DA_LMP, delivery_date: '2026-11-18', hour_ending: 6, as_of: '2026-11-17T18:30:00Z', market: 'DAM' },
  day_ahead_note: null, source: 'ERCOT', source_url: 'https://www.ercot.com/mp/data-products',
  license: 'ERCOT public market data', basis: 'measured' };
const ENERGY_ERCOT = { ok: true, tool: 'get_energy_prices', filter: { iso: 'ERCOT', sector: 'all', state: null },
  scope: 'iso_footprint_avg', caller_tier: 'anonymous', gated: true,
  retail_rates: { avg_cents_kwh: null, min_cents_kwh: null, max_cents_kwh: null, latest_period: '2026-08', states_covered: null },
  natural_gas_usd_mmbtu: null, natural_gas: { hub: 'Henry Hub', period: '2026-11-14', status: 'withheld', reason: 'licence' },
  wholesale_lmp: LMP };
const ENERGY_PJM = { ok: true, tool: 'get_energy_prices', filter: { iso: 'PJM', sector: 'all', state: null },
  scope: 'iso_footprint_avg', caller_tier: 'anonymous', gated: true, wholesale_lmp: null,
  wholesale_lmp_withheld: { iso: 'PJM', reason: "PJM's terms do not permit redistribution of its LMP data." } };

// ── get_gas_economics: the two backend reads, served whole to this server (X-Internal-Key) ──
const PRICING = { market_name: 'Dallas', state: 'TX', pricing_hub_key: 'houston_ship_channel',
  henry_hub_spot_usd_mmbtu: HH, hub_spot_usd_mmbtu: HUB_SPOT, basis_diff_usd_mmbtu: BASIS,
  delivered_industrial_usd_mmbtu: IND, delivered_electric_usd_mmbtu: ELEC, period: '2026-08',
  fetched_at: '2026-11-18T04:00:12Z', data_basis: 'mixed',
  field_basis: { henry_hub_spot_usd_mmbtu: { basis: 'live', source: 'eia_v2_natural-gas/pri/fut' },
    delivered_industrial_usd_mmbtu: { basis: 'live', source: 'eia_gas_prices' },
    delivered_electric_usd_mmbtu: { basis: 'live', source: 'eia_gas_prices' },
    basis_diff_usd_mmbtu: { basis: 'synthetic', source: 'synthetic_seed_basis' } } };
const BURNER = { status: 'ok', state: 'TX', series: 'PEU', usd_mmbtu: BT, monthly_min_usd_mmbtu: BT_MIN,
  monthly_max_usd_mmbtu: BT_MAX, window: ['2025-09', '2026-08'], months_reported: 12, min_reported_months: 9,
  months_in_window: 12, reason: null, rule: 'peu-ttm-v1',
  method: 'trailing-12-month mean of reported months, negatives included',
  source: 'EIA price of natural gas sold to electric power consumers (PEU), by state' };
const G2G = { market_name: 'Dallas', gas_price_used_usd_mmbtu: USED, burner_tip: BURNER,
  scenarios_usd_per_mwh: { new_ccgt_6400_btu_kwh: 18.8361, avg_ccgt_6800_btu_kwh: CCGT, peaker_10500_btu_kwh: 30.9021 },
  formula: '$/MWh = (heat_rate_btu_per_kwh * gas_$/MMBtu) / 1000', fetched_at: '2026-11-18T04:00:12Z' };

// ── get_refined_queue, as the backend answers this server's internal key ──
// Measured on dchub-backend (be#8988): the REST tease already serves project_name / queue_id
// for every open ISO, nulls them on a held ISO's row (MISO, SPP) below a paid plan with
// identity_withheld + identity_withheld_reason, and answers the internal key in full. So the
// MISO row arrives here FULL and this server must hold it; the SPP row stands for a row the
// backend already withheld, which passes through untouched.
const HOLD_REASON = "this ISO's terms do not allow republishing its feed; publishing needs written permission from the ISO";
const QUEUE = { ok: true, _entity: 'queue_results', count: 4, _locked_fields: ['capacity_mw'],
  results: [
    { project_name: 'Sentinel Solar Ranch', queue_id: '24INR0999', iso: 'ERCOT', state: 'TX', fuel_type: 'Solar', queue_status: 'active' },
    { project_name: 'Ameren Sentinel Line', queue_id: 'MISO-J9999', iso: 'MISO', state: 'MO', fuel_type: 'Gas', queue_status: 'active' },
    { project_name: null, queue_id: null, iso: 'SPP', state: 'KS', fuel_type: 'Wind', queue_status: 'active',
      identity_withheld: ['project_name', 'queue_id'], identity_withheld_reason: HOLD_REASON },
    { project_name: 'Bluebonnet Gas Peaker', queue_id: '25INR0123', iso: 'ERCOT', state: 'TX', fuel_type: 'Gas', queue_status: 'active' },
  ] };

const FREE_KEY = 'dch_live_energykeyless11180000001';
const EMAIL_KEY = 'dch_live_energykeyless11180000002';
const PRO_KEY = 'dchub_pro_energykeyless1118000001';
const VALIDATE = {
  [FREE_KEY]: { valid: true, tier: 'free', developer_id: 'd_free_e', email: null },
  [EMAIL_KEY]: { valid: true, tier: 'identified', developer_id: 'd_id_e', email: 'agent@example.com' },
  [PRO_KEY]: { valid: true, tier: 'pro', developer_id: 'd_pro_e', email: 'pro@example.com', tier_detail: { users_plan: 'pro' } },
};

const seen = [];
let S, PORT, httpServer, stub;
const prev = {};
const ENV = { DCHUB_PREVIEW_ISERROR: '0', DCHUB_INTERNAL_KEY: SECRET, DCHUB_KEYLESS_HENRY_HUB: undefined, ISO_PUBLISH_RELEASED: undefined };

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const u = new URL(req.url, 'http://_');
      const p = u.pathname;
      seen.push(req.url);
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') { let b = ''; for await (const c of req) b += c; const k = (JSON.parse(b || '{}').api_key) || ''; return send(VALIDATE[k] || { valid: false, tier: 'free' }); }
      if (p === '/api/v1/keys/auto-mint') return send({ ok: false });
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/energy/summary') return send(u.searchParams.get('iso') === 'PJM' ? ENERGY_PJM : ENERGY_ERCOT);
      if (p === '/api/v1/markets/dallas/gas-pricing') return send(PRICING);
      if (p === '/api/v1/markets/dallas/gas-to-grid') return send(G2G);
      if (p === '/api/v1/interconnection-queue/refined') return send(QUEUE);
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prev.DCHUB_API_BASE = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  for (const [k, v] of Object.entries(ENV)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
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

let ipN = 40;
async function call(name, args, key) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  const text = (result.content || []).map((c) => c.text || '').join('\n');
  let sc = result.structuredContent;
  if (!sc) { try { sc = JSON.parse((result.content || [])[0].text); } catch (_) { sc = {}; } }
  return { result, sc: sc || {}, text };
}

const SEATS = [['anonymous', null], ['free key', FREE_KEY], ['email key', EMAIL_KEY]];

describe('get_energy_prices: wholesale_lmp reaches every caller', () => {
  for (const [seat, key] of SEATS) {
    it(`${seat}: the block is byte-identical to the backend's`, async () => {
      const { sc } = await call('get_energy_prices', { iso: 'ERCOT', hub: 'HB_NORTH' }, key);
      expect(sc.wholesale_lmp, `${seat}\n${JSON.stringify(sc).slice(0, 600)}`).toEqual(LMP);
      expect(sc._wholesale_lmp_in_pro).toBeUndefined();
      expect(sc._wholesale_lmp_withheld).toBeUndefined();
    });
    it(`${seat}: wholesale_lmp_withheld passes through for a barred ISO`, async () => {
      const { sc } = await call('get_energy_prices', { iso: 'PJM' }, key);
      expect(sc.wholesale_lmp ?? null).toBeNull();
      expect(sc.wholesale_lmp_withheld).toEqual(ENERGY_PJM.wholesale_lmp_withheld);
    });
  }

  it('hub reaches /api/v1/energy/summary', async () => {
    seen.length = 0;
    await call('get_energy_prices', { iso: 'ERCOT', hub: 'HB_HOUSTON' }, null);
    const q = seen.filter((u) => u.startsWith('/api/v1/energy/summary'));
    expect(q.length).toBeGreaterThan(0);
    expect(new URL(q[0], 'http://_').searchParams.get('hub')).toBe('HB_HOUSTON');
  });

  it('the trims alone keep both LMP figures and every hub (keyless trim, keyed numerics gate)', async () => {
    const out = S.trimForTrial(JSON.parse(JSON.stringify(ENERGY_ERCOT)), 'get_energy_prices');
    expect(out.wholesale_lmp.real_time.lmp_usd_mwh).toBe(RT_LMP);
    expect(out.wholesale_lmp.day_ahead.lmp_usd_mwh).toBe(DA_LMP);
    expect(out.wholesale_lmp.hubs_available).toEqual(LMP.hubs_available);
    const w = S.trimForTrial(JSON.parse(JSON.stringify(ENERGY_PJM)), 'get_energy_prices');
    expect(w.wholesale_lmp_withheld).toEqual(ENERGY_PJM.wholesale_lmp_withheld);
    const r = { content: [{ type: 'text', text: JSON.stringify(ENERGY_ERCOT) }], structuredContent: ENERGY_ERCOT };
    for (const tier of ['', 'anonymous', 'free', 'identified', 'trial']) {
      const g = await S._gateToolNumerics(r, 'get_energy_prices', { tier });
      expect(g.structuredContent.wholesale_lmp, tier).toEqual(LMP);
    }
  });
});

describe('get_gas_economics: the EIA state prices are free, the rest stays masked', () => {
  const FREE_FIGS = [IND, ELEC, BT, BT_MIN, BT_MAX];
  const MASKED_FIGS = [HUB_SPOT, BASIS, USED, 18.8361, 30.9021];
  for (const [seat, key] of SEATS) {
    it(`${seat}: delivered + burner-tip prices served, labelled and dated`, async () => {
      const { sc, text } = await call('get_gas_economics', { market: 'dallas' }, key);
      expect(sc.delivered_industrial_usd_mmbtu, `${seat}\n${text.slice(0, 500)}`).toBe(IND);
      expect(sc.delivered_electric_usd_mmbtu).toBe(ELEC);
      expect(sc.burner_tip.usd_mmbtu).toBe(BT);
      expect(sc.burner_tip.monthly_min_usd_mmbtu).toBe(BT_MIN);
      expect(sc.burner_tip.monthly_max_usd_mmbtu).toBe(BT_MAX);
      for (const k of ['delivered_industrial_usd_mmbtu', 'delivered_electric_usd_mmbtu', 'burner_tip']) {
        const l = sc.figure_labels[k];
        expect(l.source, k).toMatch(/^EIA/);
        expect(l.basis, k).toBeTruthy();
        expect(l.as_of, k).toBe('2026-11-18T04:00:12Z');
        expect(l.license, k).toMatch(/Public domain/);
      }
      expect(sc.figure_labels.delivered_industrial_usd_mmbtu.period).toBe('2026-08');
      expect(sc.figure_labels.burner_tip.period).toEqual(['2025-09', '2026-08']);
      // Henry Hub, the hub/basis pair, the price used and the table stay masked; the
      // disclosure lists exactly what was withheld.
      for (const k of ['henry_hub_spot_usd_mmbtu', 'hub_spot_usd_mmbtu', 'basis_diff_usd_mmbtu', 'gas_price_used_usd_mmbtu']) {
        expect(sc[k], `${seat} ${k}`).toBeNull();
      }
      expect(sc.figure_labels.henry_hub_spot_usd_mmbtu.served_to).toBe('full-access callers');
      expect(sc.tier_masked.fields).toEqual(['henry_hub_spot_usd_mmbtu', 'hub_spot_usd_mmbtu', 'basis_diff_usd_mmbtu',
        'gas_price_used_usd_mmbtu', 'scenarios_usd_per_mwh']);
      expect(sc.scenarios_usd_per_mwh.avg_ccgt_6800_btu_kwh).toBe('~$20/MWh (illustrative)');
      expect(sc.scenarios_usd_per_mwh.new_ccgt_6400_btu_kwh).toBeNull();
      for (const f of [HH, ...MASKED_FIGS]) expect(text, `${seat}: leaked ${f}`).not.toContain(String(f));
      for (const f of FREE_FIGS) expect(text, `${seat}: ${f} missing`).toContain(String(f));
    });
  }

  it('DCHUB_KEYLESS_HENRY_HUB=1 opens Henry Hub only', async () => {
    process.env.DCHUB_KEYLESS_HENRY_HUB = '1';
    try {
      const { sc } = await call('get_gas_economics', { market: 'dallas' }, null);
      expect(sc.henry_hub_spot_usd_mmbtu).toBe(HH);
      expect(sc.figure_labels.henry_hub_spot_usd_mmbtu.served_to).toBe('every caller');
      expect(sc.hub_spot_usd_mmbtu).toBeNull();
      expect(sc.tier_masked.fields).not.toContain('henry_hub_spot_usd_mmbtu');
      expect(sc.tier_masked.fields).toContain('hub_spot_usd_mmbtu');
    } finally { delete process.env.DCHUB_KEYLESS_HENRY_HUB; }
  });

  it('a full-access seat keeps every number', async () => {
    const { sc } = await call('get_gas_economics', { market: 'dallas' }, PRO_KEY);
    expect(sc.henry_hub_spot_usd_mmbtu).toBe(HH);
    expect(sc.gas_price_used_usd_mmbtu).toBe(USED);
    expect(sc.scenarios_usd_per_mwh.avg_ccgt_6800_btu_kwh).toBe(CCGT);
    expect(sc.tier_masked).toBeUndefined();
  });
});

describe('get_refined_queue: names and queue ids open, a held ISO\'s identity stays withheld', () => {
  const expectHeld = (rows, text, label) => {
    const ercot = rows.find((r) => r.queue_id === '24INR0999');
    expect(ercot, `${label}: ERCOT row lost its id\n${text.slice(0, 600)}`).toBeDefined();
    expect(ercot.project_name).toBe('Sentinel Solar Ranch');
    expect(ercot._project_name_in_pro ?? ercot._project_name_withheld).toBeUndefined();
    expect(ercot.identity_withheld).toBeUndefined();
    const miso = rows.find((r) => r.iso === 'MISO');
    expect(miso.project_name, label).toBeNull();
    expect(miso.queue_id, label).toBeNull();
    expect(miso.identity_withheld).toEqual(['project_name', 'queue_id']);
    expect(miso.identity_withheld_reason).toBe(HOLD_REASON);
    expect(miso._project_name_in_pro ?? miso._project_name_withheld).toBe(true);
    expect(miso._queue_id_in_pro ?? miso._queue_id_withheld).toBe(true);
    const spp = rows.find((r) => r.iso === 'SPP');
    expect(spp.project_name).toBeNull();
    expect(spp.queue_id).toBeNull();
    expect(spp.identity_withheld).toEqual(['project_name', 'queue_id']);
    expect(spp.identity_withheld_reason).toBe(HOLD_REASON);
    for (const leak of ['Ameren Sentinel Line', 'MISO-J9999']) expect(text, `${label}: leaked ${leak}`).not.toContain(leak);
  };
  for (const [seat, key] of SEATS) {
    it(`${seat}`, async () => {
      const { sc, text } = await call('get_refined_queue', { status: 'active' }, key);
      const rows = sc.results || [];
      expect(rows.length, `${seat}\n${text.slice(0, 600)}`).toBeGreaterThanOrEqual(3);
      expectHeld(rows, text, seat);
      const blue = rows.find((r) => r.queue_id === '25INR0123');
      if (blue) expect(blue.project_name).toBe('Bluebonnet Gas Peaker');   // the keyless preview keeps 3 rows
    });
  }

  it('a full-access seat sees the held ISO\'s identifiers, as the backend\'s paid seats do', async () => {
    const { sc } = await call('get_refined_queue', { status: 'active' }, PRO_KEY);
    const miso = sc.results.find((r) => r.iso === 'MISO');
    expect(miso.project_name).toBe('Ameren Sentinel Line');
    expect(miso.queue_id).toBe('MISO-J9999');
    expect(miso.identity_withheld).toBeUndefined();
  });

  it('ISO_PUBLISH_RELEASED=MISO lifts the hold with no code change', async () => {
    process.env.ISO_PUBLISH_RELEASED = 'MISO';
    try {
      const { sc } = await call('get_refined_queue', { status: 'active' }, null);
      const miso = sc.results.find((r) => r.iso === 'MISO');
      expect(miso.project_name).toBe('Ameren Sentinel Line');
      expect(sc.results.find((r) => r.iso === 'SPP').identity_withheld).toEqual(['project_name', 'queue_id']);
    } finally { delete process.env.ISO_PUBLISH_RELEASED; }
  });

  it('a row the backend already withheld is returned as the same object (never re-opened)', () => {
    const out = S._withholdHeldIsoIdentity(JSON.parse(JSON.stringify(QUEUE)));
    expect(out.results[2]).toEqual(QUEUE.results[2]);
    expect(out.results[1].project_name).toBeNull();
    const already = { results: [QUEUE.results[2]] };
    expect(S._withholdHeldIsoIdentity(already)).toBe(already);
  });

  it('trimForTrial alone: open ids on this tool, the depth gate everywhere else', () => {
    const out = S.trimForTrial(JSON.parse(JSON.stringify(QUEUE)), 'get_refined_queue');
    expect(out.results[0].project_name).toBe('Sentinel Solar Ranch');
    expect(out.results[0].queue_id).toBe('24INR0999');
    expect(out.results[2].project_name).toBeNull();
    const other = S.trimForTrial({ projects: [{ project_name: 'X', queue_id: 'Y' }] }, 'get_interconnection_queue');
    expect(other.projects[0].project_name).toBeNull();
    expect(other.projects[0].queue_id).toBeNull();
  });
});

describe('get_gas_index rows carry a source label beside the now-free price', () => {
  it('adds gas_price_source only when absent', () => {
    const row = { state: 'TX', gas_price: 2.803, gas_price_series: 'PEU' };
    expect(S._dcgiPriceSource(row).gas_price_source).toBe('EIA, price of natural gas sold to electric power consumers, by state');
    expect(S._dcgiPriceSource({ ...row, gas_price_source: 'backend label' }).gas_price_source).toBe('backend label');
    expect(S._dcgiPriceSource({ state: 'VT', gas_price: null })).toEqual({ state: 'VT', gas_price: null });
  });
});

describe('the reviewed /mcp/chatgpt catalog does not gain `hub`', () => {
  it('hub is held on that profile', async () => {
    const { DIRECTORY_HELD_INPUTS } = await import('../lib/chatgpt-directory.mjs');
    expect(DIRECTORY_HELD_INPUTS.get_energy_prices).toEqual(['hub']);
  });
  it('made no off-loopback connection', () => { expect(foreign).toEqual([]); });
});
