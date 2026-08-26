// capacity-context.test.mjs — (2026-08-25)
//
// `capacity_mw` is DECLARED on analyze_site and compare_sites and was inert.
// Measured live 2026-08-25, Dallas 32.7767,-96.7970:
//
//   analyze_site{lat,lon}                  -> composite_score 81.2
//   analyze_site{lat,lon,capacity_mw:1}    -> composite_score 81.2
//   analyze_site{lat,lon,capacity_mw:5000} -> composite_score 81.2
//
// identical after subtracting per-call noise — and `capacity_requested_mw` was
// not even echoed, because the structuredContent projection at the free-tier
// headline branch is an ALLOWLIST of five fields. An agent could send a 5 GW
// constraint and get back no trace of it at all.
//
// ★★★ WHY THIS FILE STANDS UP A STUB BACKEND. buildSiteHeadlineTease returns
// null unless the upstream payload carries a real numeric overall_score, so a
// test against an unreachable API_BASE never enters the branch being guarded —
// it would pass while proving nothing. That is precisely how Stage 0a shipped
// dead with 17 guards (see request-interpretation.test.mjs). The stub asserts
// its own hit count for the same reason: a guard that cannot run must FAIL,
// never quietly pass.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub, STUB_PORT;
let stubHits = 0;
let stubIncludesCapacityContext = true;

const CAP_CTX = {
  requested_mw: 5000,
  nearby_generation_mw: 12345.6,
  requested_pct_of_nearby_generation: 40.5,
  affects_overall_score: false,
  basis: 'installed nameplate generation within 80 km … NAMEPLATE IS NOT AVAILABLE HEADROOM',
  note: 'Requested load 5,000 MW is 40.5% of ALL installed generation nameplate within 80 km.',
  instead: 'get_power_availability_timeline(state=…, mw=…) applies the requested load …',
};

function sitePayload() {
  return {
    success: true,
    location: { lat: 32.7767, lon: -96.797, state: 'TX' },
    capacity_requested_mw: 5000,
    ...(stubIncludesCapacityContext ? { capacity_context: CAP_CTX } : {}),
    overall_score: 81.2,
    scores: { power_infrastructure: 70, gas_pipeline_access: 88, fiber_connectivity: 91,
              market_conditions: 80, risk_resilience: 77 },
    interpretation: 'Excellent site',
  };
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      stubHits += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(sitePayload()));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  STUB_PORT = stub.address().port;

  // server.mjs captures `const API_BASE` ONCE at module evaluation, so this must
  // be set BEFORE the import — and restored immediately after, because vitest can
  // share a worker's process.env and leaving it set points sibling live-network
  // tests at this stub (measured cost elsewhere in this suite: 3 phantom failures).
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${STUB_PORT}`;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;

  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
});

async function callOverHttp(name, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  const r = JSON.parse(json).result || {};
  if (r.structuredContent) return r.structuredContent;
  try { return JSON.parse((r.content || []).map((c) => c.text || '').join('')); } catch { return {}; }
}

describe('capacity_context reaches a real anonymous analyze_site call', () => {
  it('★ arrives in structuredContent — the allowlist that dropped capacity_requested_mw', async () => {
    stubIncludesCapacityContext = true;
    const before = stubHits;
    const sc = await callOverHttp('analyze_site',
      { latitude: 32.7767, longitude: -96.797, capacity_mw: 5000 });

    expect(stubHits,
      'the stub backend was never called — DCHUB_API_BASE did not take, so this ' +
      'guard exercised nothing. Do NOT relax this into a pass.').toBeGreaterThan(before);

    expect(sc.site_headline).toBe(true);            // the branch under test actually ran
    expect(sc.capacity_context).toBeTruthy();
    expect(sc.capacity_context.requested_mw).toBe(5000);
    expect(sc.capacity_context.affects_overall_score).toBe(false);
  });

  it('is ABSENT when the backend sent none — absence is the no-load signal', async () => {
    stubIncludesCapacityContext = false;
    const sc = await callOverHttp('analyze_site', { latitude: 32.7767, longitude: -96.797 });
    expect(sc.site_headline).toBe(true);
    expect(sc.capacity_context).toBeUndefined();
    stubIncludesCapacityContext = true;
  });

  it('does not disturb the citable headline fields', async () => {
    stubIncludesCapacityContext = true;
    const sc = await callOverHttp('analyze_site',
      { latitude: 32.7767, longitude: -96.797, capacity_mw: 500 });
    expect(sc.composite_score).toBe(81.2);
    expect(sc.verdict).toBe('Excellent site');
    expect(sc.limiting_factor?.score).toBe(70);     // lowest sub-score
    expect(sc.citation).toBeTruthy();
  });
});

describe('the tool contract tells the truth about what capacity_mw does', () => {
  it('analyze_site names capacity_context AND that it does not move the score', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const raw = await res.text();
    const json = raw.includes('data: ')
      ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
      : raw;
    const tools = (JSON.parse(json).result || {}).tools || [];
    const site = tools.find((t) => t.name === 'analyze_site');
    expect(site, 'analyze_site missing from tools/list').toBeTruthy();
    expect(site.description).toContain('capacity_context');
    expect(site.description).toContain('does NOT move overall_score');
  });
});
