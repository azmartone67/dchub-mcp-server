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
      res.setHeader('content-type', 'application/json');
      const p = new URL(req.url, 'http://_').pathname;
      // A key the server can resolve, and no pack, so the preview path is the one
      // under test (2026-09-22: a keyless caller gets the Land & Power wall).
      if (p === '/api/v1/keys/validate') {
        res.end(JSON.stringify({ valid: true, tier: 'free', developer_id: 'dev_capctx', email: null }));
        return;
      }
      if (p.startsWith('/api/v1/mcp/')) { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      stubHits += 1;
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

const FREE_KEY = 'dch_live_capacity_context_free';
async function callOverHttp(name, args, key = FREE_KEY) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               ...(key ? { 'x-api-key': key } : {}) },
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

// ★ 2026-09-22 (owner): analyze_site is Land & Power, and Land & Power details
// are Pro. A keyless caller now gets the wall and no data at all, so the call
// under test here is a FREE KEY's, which gets the Land & Power preview: the
// verdict, names and counts, every score and figure null. The subject is
// unchanged — capacity_mw must leave a trace in what comes back — and so is
// the rule this file was written for: the preview keeps the caller's own
// request (capacity_requested_mw, capacity_context.requested_mw) and the
// statement that it does not move the score.
describe('capacity_context reaches a real below-Pro analyze_site call (the preview)', () => {
  it('★ arrives in structuredContent — the allowlist that dropped capacity_requested_mw', async () => {
    stubIncludesCapacityContext = true;
    const before = stubHits;
    const sc = await callOverHttp('analyze_site',
      { latitude: 32.7767, longitude: -96.797, capacity_mw: 5000 });

    expect(stubHits,
      'the stub backend was never called — DCHUB_API_BASE did not take, so this ' +
      'guard exercised nothing. Do NOT relax this into a pass.').toBeGreaterThan(before);

    expect(sc._preview_only).toBe(true);            // the branch under test actually ran
    expect(sc.capacity_requested_mw).toBe(5000);
    expect(sc.capacity_context).toBeTruthy();
    expect(sc.capacity_context.requested_mw).toBe(5000);
    expect(sc.capacity_context.affects_overall_score).toBe(false);
    // the figures behind it are Land & Power details
    expect(sc.capacity_context.nearby_generation_mw).toBeNull();
    expect(sc.capacity_context.requested_pct_of_nearby_generation).toBeNull();
  });

  it('is ABSENT when the backend sent none — absence is the no-load signal', async () => {
    stubIncludesCapacityContext = false;
    const sc = await callOverHttp('analyze_site', { latitude: 32.7767, longitude: -96.797 });
    expect(sc._preview_only).toBe(true);
    expect(sc.capacity_context).toBeUndefined();
    stubIncludesCapacityContext = true;
  });

  it('does not disturb the verdict: the score is null, the verdict stays', async () => {
    stubIncludesCapacityContext = true;
    const sc = await callOverHttp('analyze_site',
      { latitude: 32.7767, longitude: -96.797, capacity_mw: 500 });
    expect(sc.overall_score).toBeNull();
    expect(Object.values(sc.scores || {}).every((v) => v === null)).toBe(true);
    expect(sc.interpretation).toBe('Excellent site');
    expect(sc.required_plan).toBe('pro');
  });

  it('★ gating the number keeps the explanation and the way to Pro', async () => {
    stubIncludesCapacityContext = true;
    const sc = await callOverHttp('analyze_site',
      { latitude: 32.7767, longitude: -96.797, capacity_mw: 500 });
    expect(sc._preview_note).toContain('Pro');
    // The response envelope files upgrade_url under `upgrade` on the wire.
    expect(sc.upgrade_url || (sc.upgrade && sc.upgrade.upgrade_url)).toMatch(/^https:\/\//);
  });

  it('a keyless caller gets the wall, and no capacity_context', async () => {
    const sc = await callOverHttp('analyze_site',
      { latitude: 32.7767, longitude: -96.797, capacity_mw: 5000 }, null);
    expect(sc._wall).toBe(true);
    expect(sc.capacity_context).toBeUndefined();
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
