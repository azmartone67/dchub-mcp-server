// gas-index-dcgi-paid-set.test.mjs — owner 2026-11-04, "Gate it" (DCGI numerics are paid).
//
// MEASURED live 2026-11-04 10:44Z, anonymous get_gas_index {limit: 2}: the preview
// withheld gas_access_score and gas_cost_score (a `_score` name rule) and served
// dcgi 77.2 / 67.9, gas_price 2.803 / 0.37, pipelines, operators and interstate in
// the clear. dchub-backend masks ALL of routes/dcgi.py _DCGI_MASK_FIELDS below a
// paid plan, list and single state alike (be#8300), but serves this server whole
// (X-Internal-Key), so the rule has to be applied here. A free key had no DCGI
// shape in _gateToolNumerics at all and got every number.
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
// dchub-backend routes/dcgi.py _DCGI_MASK_FIELDS on origin/main 2026-11-04, verbatim.
const BACKEND_MASK_FIELDS = ['dcgi', 'gas_access_score', 'gas_cost_score', 'pipelines', 'operators',
  'interstate', 'gas_price', 'gas_price_sector', 'gas_price_series', 'gas_price_period'];
const BASIS = 'OLDEST of the two DCGI inputs';
const row = (state, dcgi, acc, cost, pipes, ops, inter, price, verdict) => ({
  state, dcgi, gas_access_score: acc, gas_cost_score: cost, pipelines: pipes, operators: ops,
  interstate: inter, gas_price: price, gas_price_sector: 'electric_power', gas_price_series: 'PEU',
  gas_price_period: '2026-08', gas_price_window: ['2025-09', '2026-08'], gas_price_months_reported: 12,
  gas_price_method: 'trailing-12-month mean of reported months, negatives included',
  verdict, data_as_of: '2026-08-01', data_as_of_basis: BASIS });
// The live 11-04 rows, as the backend serves them to this server (full: X-Internal-Key).
const TX = row('TX', 77.2, 84.9, 65.6, 6657, 54, 1629, 2.803, 'GAS-ADVANTAGED');
const NM = row('NM', 67.9, 46.4, 100.0, 1082, 16, 223, 0.37, 'ADEQUATE');
const LIST = { ok: true, index: 'Data Center Gas Index (DCGI)', count: 2, license: 'CC BY 4.0',
  methodology: '/api/v1/dcgi/methodology', verdict_legend: ['GAS-ADVANTAGED', 'ADEQUATE', 'GAS-CONSTRAINED'],
  states: [TX, NM] };
const ONE = { ok: true, index: 'DCGI', state: 'NM', license: 'CC BY 4.0',
  methodology: '/api/v1/dcgi/methodology', score: NM };
// Each fixture's paid values, as they would print. None may appear below a paid seat.
const PAID_FRAGMENTS = ['77.2', '84.9', '65.6', '6657', '1629', '2.803',
  '67.9', '46.4', '1082', '0.37', 'electric_power', '"PEU"'];

// Fixture keys: test values only.
const FREE_KEY = 'dch_live_gasidxpaidset000000001';
const EMAIL_KEY = 'dch_live_gasidxpaidset000000002';
const PRO_KEY = 'dchub_pro_gasidxpaidset00000001';
const VALIDATE = {
  [FREE_KEY]: { valid: true, tier: 'free', developer_id: 'd_free_g', email: null },
  [EMAIL_KEY]: { valid: true, tier: 'identified', developer_id: 'd_id_g', email: 'agent@example.com' },
  [PRO_KEY]: { valid: true, tier: 'pro', developer_id: 'd_pro_g', email: 'pro@example.com', tier_detail: { users_plan: 'pro' } },
};

let S, PORT, httpServer, stub, prevBase, prevSecret, prevIsError;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') { let b = ''; for await (const c of req) b += c; const k = (JSON.parse(b || '{}').api_key) || ''; return send(VALIDATE[k] || { valid: false, tier: 'free' }); }
      if (p === '/api/v1/keys/auto-mint') return send({ ok: false });
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/dcgi/scores') return send(LIST);
      if (p === '/api/v1/dcgi/scores/NM') return send(ONE);
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('DCHUB_PREVIEW_ISERROR', prevIsError);
  restore('DCHUB_INTERNAL_KEY', prevSecret);
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  restore('DCHUB_API_BASE', prevBase);
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

let ipN = 30;
async function call(args, key) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'get_gas_index', arguments: args } });
  const result = JSON.parse(body).result || {};
  return { result, sc: result.structuredContent || {}, text: (result.content || []).map((c) => c.text || '').join('\n') };
}

// The rows of an answer, in either form.
const rowsOf = (sc) => (Array.isArray(sc.states) ? sc.states : (sc.score ? [sc.score] : []));
const FIXTURE = { TX, NM };

function expectMasked(sc, result, label) {
  const rows = rowsOf(sc);
  expect(rows.length, `${label}: no rows\n${JSON.stringify(sc).slice(0, 400)}`).toBeGreaterThan(0);
  for (const r of rows) {
    for (const k of BACKEND_MASK_FIELDS) {
      expect(r[k], `${label} ${r.state}.${k}`).toBeNull();
      expect(r[`_${k}_withheld`], `${label} ${r.state}._${k}_withheld`).toBe(true);
    }
    const src = FIXTURE[r.state];
    for (const k of ['state', 'verdict', 'data_as_of', 'data_as_of_basis', 'gas_price_window', 'gas_price_method']) {
      expect(r[k], `${label} ${r.state}.${k} kept`).toEqual(src[k]);
    }
  }
  const all = JSON.stringify(result);
  for (const frag of PAID_FRAGMENTS) expect(all, `${label}: leaked ${frag}`).not.toContain(frag);
  expect(all, `${label}: a plan price in the text`).not.toMatch(/\$\d/);
}

describe('get_gas_index below a paid seat withholds the whole backend DCGI paid set', () => {
  for (const [seat, key] of [['anonymous', null], ['free key', FREE_KEY], ['email key', EMAIL_KEY]]) {
    it(`${seat}: per-state NM`, async () => {
      const { sc, result } = await call({ state: 'NM' }, key);
      expectMasked(sc, result, `${seat} state=NM`);
    });
    it(`${seat}: list limit=2`, async () => {
      const { sc, result } = await call({ limit: 2 }, key);
      expectMasked(sc, result, `${seat} limit=2`);
    });
  }

  it('a paid seat keeps every number, both forms', async () => {
    const one = await call({ state: 'NM' }, PRO_KEY);
    for (const k of BACKEND_MASK_FIELDS) expect(one.sc.score[k], `pro NM.${k}`).toEqual(NM[k]);
    const list = await call({ limit: 2 }, PRO_KEY);
    const nm = list.sc.states.find((r) => r.state === 'NM');
    for (const k of BACKEND_MASK_FIELDS) expect(nm[k], `pro list NM.${k}`).toEqual(NM[k]);
  });

  // The keyless trim runs on its own too (the depleted-pack teaser, the capped
  // limit), not only ahead of the keyed gate the /mcp calls above reach.
  it('trimForTrial alone withholds the paid set, list and single state', () => {
    for (const [form, payload] of [['list', LIST], ['state', ONE]]) {
      const out = S.trimForTrial(JSON.parse(JSON.stringify(payload)), 'get_gas_index');
      const rows = rowsOf(out);
      expect(rows.length, form).toBeGreaterThan(0);
      for (const r of rows) {
        for (const k of BACKEND_MASK_FIELDS) {
          expect(r[k], `${form} ${r.state}.${k}`).toBeNull();
          expect(r[`_${k}_in_pro`], `${form} ${r.state}._${k}_in_pro`).toBe(true);
        }
        expect(r.verdict, `${form} ${r.state}.verdict`).toBe(FIXTURE[r.state].verdict);
      }
    }
  });

  it('the server field list is the backend tuple, exactly', () => {
    expect([...S.DCGI_PAID_KEYS]).toEqual(BACKEND_MASK_FIELDS);
  });

  it('made no off-loopback connection', () => {
    expect(foreign).toEqual([]);
  });
});
