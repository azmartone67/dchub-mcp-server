// kff-grid-data-backend-gate-1119.test.mjs — Grok daily note 2026-11-19, item 11 (3rd day open): a keyless
// get_grid_data that was the caller's first full answer of the day said "This is today's full `get_grid_data`
// answer without a key" over a payload whose demand_24h / gen_mix / peak_mw read "<gated: identified-tier or
// higher>" and `gated: true`. Measured live 2026-11-20 ~02:05Z (ERCOT, metric=demand).
//
// Root cause: the data API picks the /api/v1/grid/intelligence/<iso> payload from the caller's key (or this server's
// internal read), not from the forwarded caller tier (X-DCHub-Caller-Tier). The first full answer only changed this server's gate, so
// the handler still read the keyless stub. test/keyless-first-full.test.mjs stubs the backend at full depth for any
// caller, so it could not see this. This file's stub answers the way production does: the keyless payload unless the
// call carries a key or is this server's internal read.
//
//   A) the direct first full answer is full (demand_24h, gen_mix, peak) and says so; call 2 is the preview.
//   B) a first-full plan's get_grid_data step (plan token) reads the full payload too.
//   C) its data equals what an email-bound free key gets from the same backend.
//   D) safety net: if the payload is still the stub, the answer never says "full", is not tagged, and the seat is
//      given back (the next call can still be the first full answer).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as F from '../lib/keyless-first-full.mjs';
import { assignArm, ARM_CONTROL } from '../lib/continuation.mjs';

process.env.DCHUB_TOP_METROS_FREE = '0';
process.env.DCHUB_LEAN_RESPONSES = '0';

const BASE = 'https://backend.kff-grid-data-1119.test';
const SECRET = 'kff-grid-data-1119-internal-key-not-real';
const G = '<gated: identified-tier or higher>';
const FULL = {
  region: 'ERCOT', rto_code: 'ERCO', demand_mw: 53502, demand_period: '2026-11-20T01', peak_mw: 61234, min_mw: 44100,
  load_factor: 0.81, gen_mix: { NG: 0.41, WND: 0.3 }, data_center_load: { mw: 3100 },
  demand_24h: Array.from({ length: 6 }, (_, i) => ({ period: `2026-11-19T${String(i + 2).padStart(2, '0')}`, mw: 50000 + i * 300 })),
  note: 'Demand: EIA hourly RTO data via api.eia.gov/v2/electricity/rto.',
};
// The data API's keyless answer for the same route (dchub-backend main.py phase19b_grid_intelligence).
const STUB = {
  region: 'ERCOT', rto_code: 'ERCO', demand_mw: 53502, demand_period: '2026-11-20T01', demand_24h: G, peak_mw: G,
  min_mw: G, load_factor: G, gen_mix: G, data_center_load: G, gated: true, tier_required: 'identified',
  message: 'You got the headline demand for ERCOT (53502 MW @ 2026-11-20T01). Full 24h series + generation mix + headroom '
    + 'requires a free key (no email needed, no credit card). For fund-grade access see /enterprise.',
  agent_action: { type: 'claim_free_key', method: 'POST', url: 'https://dchub.cloud/api/v1/keys/claim', then: 'retry' },
};
const backend = { stubAlways: false, reads: [] };
const writes = { track: [], consume: [] };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, prevBase, prevInternal;

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = SECRET;
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (!url.startsWith(BASE)) throw new Error('network fence: ' + url);
    const p = new URL(url).pathname;
    const h = (init && init.headers) || {};
    let body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch { body = {}; }
    if (p === '/api/v1/mcp/track') { writes.track.push(body); return json({ ok: true }); }
    if (p === '/api/v1/mcp/full-cap/consume') { writes.consume.push(body); return json({ ok: false }); }
    if (p === '/api/v1/mcp/full-cap/peek') return json({ ok: false });
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: 0, had_pack: false });
    if (p.startsWith('/api/v1/grid/intelligence/')) {
      // Production's rule: a key or this server's internal read gets the full payload; the caller-tier header is not read.
      const full = !backend.stubAlways
        && (!!h['X-API-Key'] || String(h['User-Agent'] || '').toLowerCase().startsWith('dchub-'));
      backend.reads.push({ full, tier: h['X-DCHub-Caller-Tier'] });
      return json(structuredClone(full ? FULL : STUB));
    }
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE; process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});
afterEach(() => { backend.stubAlways = false; delete process.env.DCHUB_KEYLESS_FIRST_FULL; });

let n = 0;
function seat(over = {}) {
  n += 1;
  while (assignArm({ sessionId: `sess-kffgd-${n}`, eligible: true }) !== ARM_CONTROL) n += 1;
  return { tier: 'free', platform: 'cursor', client_name_raw: 'cursor', user_agent: 'cursor/1.0',
    client_ip: `203.0.119.${(n % 250) + 1}`, session_id: `sess-kffgd-${n}`, ...over };
}
const ARGS = { iso: 'ERCOT', metric: 'demand' };
async function call(s, args = ARGS) {
  const T = TOOLS.get_grid_data;
  const parsed = await T.inputSchema.safeParseAsync(args);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
function head(r) {
  for (const b of r.content || []) {
    if (!b || typeof b.text !== 'string' || !b.text.trimStart().startsWith('{')) continue;
    try { return JSON.parse(b.text); } catch { /* a preview appends its relay prose after the JSON */ }
    try { return JSON.parse(b.text.split('\n\n---')[0]); } catch { /* next block */ }
  }
  return null;
}
const DATA = ['demand_mw', 'demand_period', 'demand_24h', 'peak_mw', 'min_mw', 'load_factor', 'gen_mix', 'gated'];
const dataOf = (h) => Object.fromEntries(DATA.map((k) => [k, h ? h[k] : undefined]));
const kffId = (ip) => F.KEYLESS_FIRST_FULL_ID_PREFIX + 'ip-' + createHash('sha256').update(ip).digest('hex');
const kffConsumes = (ip) => writes.consume.filter((w) => w.identity === kffId(ip));
const kffTracks = () => writes.track.filter((w) => w.status === F.KEYLESS_FIRST_FULL_STATUS);
const settle = () => new Promise((r) => setTimeout(r, 25));
const reset = () => { backend.reads.length = 0; writes.track.length = 0; writes.consume.length = 0; };

describe('A) the direct first full answer is full', () => {
  it('call 1: the full payload, and the block that says so; call 2: the preview, no block', async () => {
    reset();
    const ip = '198.18.119.1';
    const r1 = await call(seat({ client_ip: ip }));
    const h1 = head(r1);
    expect(h1.first_full_answer).toMatchObject({ used: 1, limit: 1 });
    expect(h1.gated, 'the first full answer is not the keyless stub').not.toBe(true);
    expect(Array.isArray(h1.demand_24h) && h1.demand_24h.length).toBe(6);
    expect(h1.peak_mw).toBe(61234);
    expect(h1.gen_mix).toEqual({ NG: 0.41, WND: 0.3 });
    expect(JSON.stringify(r1)).not.toContain(G);
    expect(backend.reads[0].full).toBe(true);
    const r2 = await call(seat({ client_ip: ip }));
    const h2 = head(r2);
    expect(h2.first_full_answer).toBeUndefined();
    expect(r2.structuredContent?.first_full_answer).toBeUndefined();
    expect(h2.demand_24h).toBe(G);
    expect(backend.reads[1].full, 'the preview still reads the keyless view').toBe(false);
    await settle();
    expect(kffConsumes(ip).map((w) => w.tool)).toEqual(['get_grid_data']);
    expect(kffTracks().filter((w) => w.tool === 'get_grid_data').length).toBe(1);
  }, 60_000);

  it('the lane off: the keyless view, as before', async () => {
    reset();
    process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
    const r = await call(seat({ client_ip: '198.18.119.2' }));
    expect(head(r).first_full_answer).toBeUndefined();
    expect(backend.reads.map((x) => x.full)).toEqual([false]);
  }, 60_000);
});

describe('B) a first-full plan step reads the full payload', () => {
  it('with the plan token: full; without it: the keyless view', async () => {
    reset();
    const full = head(await call(seat({ loopback_step: true, plan_first_full: true, session_id: null })));
    expect(Array.isArray(full.demand_24h)).toBe(true);
    expect(full.gated).not.toBe(true);
    const prev = head(await call(seat({ loopback_step: true, session_id: null })));
    expect(prev.demand_24h).toBe(G);
    expect(backend.reads.map((x) => x.full)).toEqual([true, false]);
  }, 60_000);

  it('a step in the email_depth arm (M2.2) reads the full payload too: it takes the email-bound key\'s depth', async () => {
    reset();
    const h = head(await call(seat({ loopback_step: true, plan_first_full: true, kff_arm: 'email_depth', session_id: null })));
    expect(Array.isArray(h.demand_24h)).toBe(true);
    expect(backend.reads.map((x) => x.full)).toEqual([true]);
  }, 60_000);
});

describe('C) never above the email-bound free key', () => {
  it('the first answer\'s data = the email-bound key\'s', async () => {
    const keyed = head(await call(seat({ api_key: `dch_live_kffgd_parity_${n}`, tier: 'free', email: 'kff@example.com' })));
    const first = head(await call(seat({ client_ip: '198.18.119.3' })));
    expect(first.first_full_answer).toBeDefined();
    expect(dataOf(first)).toEqual(dataOf(keyed));
  }, 60_000);
});

describe('D) a payload that is still the stub never says "full"', () => {
  it('no block, no funnel tag, nothing durable; the seat is given back', async () => {
    reset();
    backend.stubAlways = true;
    const ip = '198.18.119.4';
    const r1 = await call(seat({ client_ip: ip }));
    expect(head(r1).gated).toBe(true);
    expect(head(r1).first_full_answer).toBeUndefined();
    expect(r1.structuredContent?.first_full_answer).toBeUndefined();
    expect(JSON.stringify(r1)).not.toMatch(/today[’']s full `get_grid_data` answer/);
    await settle();
    expect(kffConsumes(ip)).toEqual([]);
    expect(kffTracks()).toEqual([]);
    backend.stubAlways = false;
    const r2 = await call(seat({ client_ip: ip }));
    expect(head(r2).first_full_answer, 'the seat came back').toMatchObject({ used: 1 });
    expect(Array.isArray(head(r2).demand_24h)).toBe(true);
  }, 60_000);

  it('resultHeldBack reads block 0 and structuredContent, and nothing else', () => {
    const txt = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
    expect(F.resultHeldBack(txt({ gated: true }))).toBe(true);
    expect(F.resultHeldBack({ content: [{ type: 'text', text: '{}' }], structuredContent: { gated: true } })).toBe(true);
    expect(F.resultHeldBack(txt({ gated: false, demand_mw: 1 }))).toBe(false);
    expect(F.resultHeldBack(txt({ nested: { gated: true } }))).toBe(false);
    expect(F.resultHeldBack({ isError: true, content: [{ type: 'text', text: '{"gated":true}' }] })).toBe(false);
    expect(F.resultHeldBack({ content: [{ type: 'text', text: 'prose' }] })).toBe(false);
    expect(F.resultHeldBack(null)).toBe(false);
  });
});
