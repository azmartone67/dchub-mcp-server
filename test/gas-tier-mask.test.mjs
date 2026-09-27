// gas-tier-mask.test.mjs — 2026-09-27
//
// dchub-backend resolves every MCP call as internal (callAPI sends
// X-Internal-Key), so the gas $/MWh republished 2026-09-27 reached ANONYMOUS
// MCP callers in full. The two gas tools now mask to the REST API's own rule
// for the caller's tier: get_gas_economics numerics are Pro, the gas brief's
// $/MWh needs any key. Sentinel 41.7371 appears in no template.
//
// Hard-gate qualified: loopback stub backend only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

const SENT = 41.7371;
let S, PORT, httpServer, stub;

const g2g = {
  gas_price_used_usd_mmbtu: SENT,
  scenarios_usd_per_mwh: { new_ccgt_6400_btu_kwh: SENT, avg_ccgt_6800_btu_kwh: SENT, peaker_10500_btu_kwh: SENT },
  burner_tip: { status: 'ok', usd_mmbtu: SENT, monthly_min_usd_mmbtu: SENT, monthly_max_usd_mmbtu: SENT,
                window: ['2025-07', '2026-06'], months_reported: 12, reason: null },
};
const pricing = { henry_hub_spot_usd_mmbtu: SENT, delivered_electric_usd_mmbtu: SENT, market_name: 'Dallas' };
const brief = {
  region: 'TX', henry_hub_usd_mmbtu: 2.9,
  gas_to_grid_usd_per_mwh: { new_ccgt_6400_btu_kwh: SENT, avg_ccgt_6800_btu_kwh: SENT },
  headline_behind_meter_vs_grid_delta_usd_mwh: SENT,
  headline: { delta_usd_mwh: SENT, gas_to_grid_new_ccgt_usd_mwh: SENT, interpretation: `≈ $${SENT}/MWh`, note: 'n' },
  burner_tip: { status: 'ok', usd_mmbtu: SENT, window: ['2025-07', '2026-06'] },
};

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    const url = req.url || '';
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.includes('/gas-to-grid')) return res.end(JSON.stringify(g2g));
    if (url.includes('/gas-pricing')) return res.end(JSON.stringify(pricing));
    if (url.includes('/gas/intelligence/')) return res.end(JSON.stringify(brief));
    return res.end('{}');
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
});

async function callTool(name, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  const r = JSON.parse(json);
  return (((r.result || {}).content || [])[0] || {}).text || '';
}

describe('anonymous MCP callers get the REST free view of gas $/MWh', () => {
  it('get_gas_economics: no sentinel anywhere in the response', async () => {
    const text = await callTool('get_gas_economics', { market: 'dallas' });
    expect(text.length).toBeGreaterThan(50);
    expect(text).not.toContain(String(SENT));
    const out = JSON.parse(text);
    expect(out.scenarios_usd_per_mwh.avg_ccgt_6800_btu_kwh).toMatch(/^~\$42\/MWh/);
    expect(out.scenarios_usd_per_mwh.new_ccgt_6400_btu_kwh).toBeNull();
    expect(out.burner_tip.window).toEqual(['2025-07', '2026-06']);   // explanation kept
    expect(out.tier_masked.tier_required).toBe('pro');
  });

  it('get_gas_intelligence: no sentinel anywhere in the response', async () => {
    const text = await callTool('get_gas_intelligence', { region: 'TX' });
    expect(text.length).toBeGreaterThan(50);
    expect(text).not.toContain(String(SENT));
    expect(text).not.toContain('41.74');   // no rounded copy either
  });
});

describe('the masks themselves', () => {
  it('economics mask keeps keys and every non-price field', () => {
    const o = S._maskGasEconomicsBelowPro({ ...g2g, ...pricing, market_slug: 'dallas' });
    expect(Object.keys(o.scenarios_usd_per_mwh)).toEqual(Object.keys(g2g.scenarios_usd_per_mwh));
    expect(o.market_slug).toBe('dallas');
    expect(o.burner_tip.months_reported).toBe(12);
    expect(JSON.stringify(o)).not.toContain(String(SENT));
  });

  it('brief mask is a no-op on a brief with no $/MWh (withdrawn or withheld)', () => {
    const o = S._maskGasIntelligenceAnonymous({ region: 'TX', henry_hub_usd_mmbtu: 2.9 });
    expect(o).toEqual({ region: 'TX', henry_hub_usd_mmbtu: 2.9 });
  });
});
