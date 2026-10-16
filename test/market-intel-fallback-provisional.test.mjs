// market-intel-fallback-provisional.test.mjs — G-1016-02 (Grok, 2026-10-16).
//
// MEASURED: anonymous get_market_intel market="Northern Virginia" returned the free
// taste with headline dcpi_verdict AVOID while the Ashburn site teasers said BUILD.
// The AVOID is the DCPI FALLBACK band (dchub-backend util/dcpi_method.py
// VERDICT_FALLBACK = "AVOID"; util/market_siting.py _dcpi_block labels it "did not
// clear a BUILD or CAUTION band (fallback; includes a market with a missing input)"),
// and lib/free-decision-taste.mjs _marketTaste copied the verdict into the headline
// with nothing saying it was a fallback.
//
// RULE (owner): no hard verdict on a fallback band. The verdict vocabulary stays
// BUILD / CAUTION / AVOID; "provisional" is a separate field.
//
// Real /mcp handler over loopback, anonymous seat, 127.0.0.1 stub backend.
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
const METHOD = 'https://dchub.cloud/dcpi/methodology';
// The live northern-virginia siting.dcpi block (read 2026-10-16 18:4xZ with the read-only key).
const NOVA_DCPI = { verdict: 'AVOID',
  band: 'did not clear a BUILD or CAUTION band (fallback; includes a market with a missing input)',
  definition: 'Thresholds are the published DCPI method, not this market\'s scores. The scores are a paid field.',
  signal_tier: 'full', data_basis: 'mixed', as_of: '2026-10-16T18:46:47.566274+00:00', method_url: METHOD };
const DALLAS_DCPI = { verdict: 'CAUTION',
  band: 'excess-power score at least 50 and grid-constraint score at most 70',
  definition: NOVA_DCPI.definition, signal_tier: 'full', data_basis: 'measured', as_of: '2026-10-16', method_url: METHOD };
// A fallback verdict whose band line is missing: the verdict alone must still mark it provisional.
const TULSA_DCPI = { verdict: 'AVOID', band: null, signal_tier: 'low', as_of: '2026-10-16', method_url: METHOD };
const market = (name, id, dcpi) => ({
  success: true, market: { id, name, cities: [name] },
  stats: { facility_count: 120, total_power_mw: 900.0, provider_count: 30, mw_reporting_count: 40 },
  as_of: '2026-10-15T21:07:47Z',
  siting: { available: true, iso: { code: 'PJM', class: 'RTO', operator: 'PJM Interconnection', as_of: '2026-10-16' },
    dcpi, time_to_power: { band: '24_to_48_months', edges_months: [24, 48], as_of: '2026-10-16' } },
});

let S, PORT, httpServer, stub, prevBase, prevSecret, prevFlag, prevIsError;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') return send({ valid: false, tier: 'free' });
      if (p === '/api/v1/keys/auto-mint') return send({ ok: false });
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/markets/northern-virginia') return send(market('Northern Virginia', 'northern-virginia', NOVA_DCPI));
      if (p === '/api/v1/markets/dallas') return send(market('Dallas', 'dallas', DALLAS_DCPI));
      if (p === '/api/v1/markets/tulsa') return send(market('Tulsa', 'tulsa', TULSA_DCPI));
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevFlag = process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
  delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;   // default ON: the taste path
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
  restore('DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY', prevFlag);
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

let ipN = 60;
async function anonCall(name, args) {
  const h0 = { 'x-forwarded-for': `203.0.113.${ipN++}` };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  return { result, sc: result.structuredContent || {}, text: (result.content || []).map((c) => c.text || '').join('\n') };
}

describe('G-1016-02: no hard verdict on a DCPI fallback band (get_market_intel free taste)', () => {
  it('Northern Virginia AVOID from the fallback band is labelled provisional, vocabulary unchanged', async () => {
    const { sc, text } = await anonCall('get_market_intel', { market: 'northern-virginia' });
    expect(sc.taste, text.slice(0, 600)).toBeTruthy();
    const h = sc.taste.headline;
    expect(h.value).toBe('AVOID');                       // owner vocabulary: BUILD / CAUTION / AVOID only
    expect(h.provisional).toBe(true);
    expect(h.verdict_band_kind).toBe('fallback');
    expect(h.provisional_basis).toMatch(/fallback/);
    expect(h.provisional_basis).toMatch(/missing input/);
    expect(h.provisional_basis).toMatch(/not a measured judgement/);
    // no invented verdict word anywhere in the taste
    for (const v of JSON.stringify(sc.taste).match(/"value":"[A-Z_]+"/g) || []) {
      expect(['"value":"BUILD"', '"value":"CAUTION"', '"value":"AVOID"']).toContain(v);
    }
  });

  it('a fallback verdict with no band line is still provisional', async () => {
    const { sc } = await anonCall('get_market_intel', { market: 'tulsa' });
    expect(sc.taste.headline).toMatchObject({ value: 'AVOID', provisional: true, verdict_band_kind: 'fallback' });
  });

  it('a banded verdict (CAUTION) is not provisional', async () => {
    const { sc } = await anonCall('get_market_intel', { market: 'dallas' });
    expect(sc.taste.headline.value).toBe('CAUTION');
    expect(sc.taste.headline.provisional).toBe(false);
    expect(sc.taste.headline.verdict_band_kind).toBeUndefined();
    expect(sc.taste.headline.provisional_basis).toBeUndefined();
  });

  it('made no off-loopback connection', () => {
    expect(foreign).toEqual([]);
  });
});
