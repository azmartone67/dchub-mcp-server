/**
 * r-cap-teaser (2026-09-16) — the over-cap trim must not re-gate the gate.
 *
 * THE MEASURED DEFECT
 * ───────────────────
 * Probed live 2026-09-16 23:26Z, the same two demo listings, minutes apart:
 *
 *   field            anon web /api/v1/listings   anon MCP source_capacity
 *   count                        2                        null
 *   capacity_mw                  1.2                      null
 *   capacity_kw                  1200                     null
 *   contiguous_kw                500                      null
 *   min_contract_kw              100                      null
 *
 * The channel meant to DRIVE demand was the blinder one: an agent could not
 * report how large a listing was, nor how many existed, while an anonymous
 * BROWSER on the same IP in the same minute could.
 *
 * WHY, and why the obvious diagnosis is wrong
 * ───────────────────────────────────────────
 * It is NOT the generic free-tier metric mask leaking onto teasers.
 * `source_capacity` has been in FREE_FULL_TOOLS since 2026-09-11, and the
 * final-return anon trim honours it (`… && !FREE_FULL_TOOLS.has(name)`).
 *
 * It is the OVER-CAP branches, which called trimForTrial unconditionally.
 * The live payload names the branch that fired: `_upgrade.tier` came back
 * 'anon_daily_cap', assigned in exactly one place. That branch's own comment
 * says covering FREE_FULL_TOOLS is deliberate — it stops an over-cap harvester
 * pulling the scoreboard or the 278k-record hosting-capacity corpus at full
 * depth. Right rule, wrong subject: a 2-row capacity teaser is served uncapped
 * and keyless at /api/v1/listings anyway, and nulling it destroys exactly the
 * numbers v2.12.18 instructs the agent to relay.
 *
 * WHAT THIS FILE PINS
 * ───────────────────
 *   1. The cap branch really FIRES on the call under test. Every parity
 *      assertion below is worthless if it does not — a green "fields intact"
 *      from a call that was never over-cap proves nothing. `_upgrade.tier`
 *      is asserted first, for that reason, on every case.
 *   2. The four size fields and the count survive it.
 *   3. The exemption stayed NARROW. get_global_power is FREE_FULL_TOOLS too
 *      and is NOT exempt: it must still be trimmed on the identical seat.
 *      Without this control, `_capTrim = (p) => p` passes the whole file.
 *
 * Pure-local: a stub backend on 127.0.0.1. No prod, no network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';

let srv, base, usageCount = 0, listingHits = 0;

const TEASER = {
  id: 100003, slug: 'sample-listing-dfw-1-2-mw-colocation-demo',
  title: 'Sample listing: DFW 1.2 MW colocation (demo)',
  summary: 'Demonstration colocation listing showing the Capacity Source format.',
  status: 'pocket', access_required: 'registered', locked: true,
  lock_reason: 'sign_in_required',
  market: 'Dallas-Fort Worth', state: 'TX', country: 'US', region: 'north_america',
  delivery_type: 'colocation', provider: null,
  capacity_mw: 1.2, capacity_kw: 1200, contiguous_kw: 500, min_contract_kw: 100,
  available: '2026-10', expires_at: null, update_cadence: null,
  created_at: '2026-09-15T02:33:17.312048+00:00',
  updated_at: '2026-09-16T22:19:57.824698+00:00',
  url: 'https://dchub.cloud/listings/sample-listing-dfw-1-2-mw-colocation-demo',
};
const VIEWER_ANON = {
  identified: false, tier: 'anonymous', channel: 'mcp', email_masked: null,
  identity_source: null, sign_in_url: 'https://dchub.cloud/login?redirect=%2Flistings',
};
const PROGRAM = {
  name: 'DC Hub Capacity Source', status: 'live',
  headline: 'The live source for data center capacity', summary: '…',
  how_it_works: ['…', '…', '…'],
  register_interest: { method: 'POST', path: '/api/v1/listings/interest', mcp_tool: 'request_capacity_intro' },
  terms: { version: '2026-09-15', url: 'https://dchub.cloud/listings#terms', summary: '…' },
};
const LISTINGS_BODY = {
  ok: true, program: PROGRAM, viewer: VIEWER_ANON,
  count: 2, pocket_locked_count: 2, caller_tier: 'anonymous', can_see_pocket: false,
  items: [TEASER, { ...TEASER, id: 100002, slug: 'sample-listing-dfw-40-mw-powered-shell-demo',
                    capacity_mw: 40.0, capacity_kw: 40000, contiguous_kw: null,
                    min_contract_kw: 1000, delivery_type: 'powered_shell' }],
};
// get_global_power: FREE_FULL_TOOLS, NOT cap-exempt. total_mw/count both match
// _isMetricKey, so an untouched cap trim must null them.
const GLOBAL_POWER_BODY = {
  ok: true, count: 7, total_mw: 182000,
  units: [{ name: 'Unit A', country: 'US', status: 'operating', capacity_mw: 640 }],
};

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const send = (body) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (path === '/api/v1/mcp/anon-usage') return send({ ok: true, count: usageCount });
    if (path.startsWith('/api/v1/listings')) { listingHits += 1; return send(LISTINGS_BODY); }
    if (path.startsWith('/api/v1/global-power')) return send(GLOBAL_POWER_BODY);
    return send({ ok: true });                  // telemetry / heartbeat
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => srv && srv.close());
beforeEach(() => { usageCount = 0; listingHits = 0; });

// A fresh module instance = env re-read, per-IP cache empty.
async function freshServer({ cap, mult = 10 }) {
  vi.resetModules();
  process.env.DCHUB_API_BASE = base;
  process.env.DCHUB_ANON_DAILY_CAP = String(cap);
  process.env.DCHUB_ANON_HARD_WALL_MULT = String(mult);
  const m = await import('../server.mjs');
  m._anonUsageCounts.clear();
  // Same determinism fix as anon-hard-wall.test.mjs: the anon-usage read is
  // bounded by a real 2500ms AbortSignal, and losing that race under the full
  // suite fails OPEN to count 0 — which silently un-fires the very branch this
  // file exists to test. A deadline no scheduling stall can reach removes the
  // race and changes no assertion.
  m._readDeadline.signal = () => AbortSignal.timeout(120_000);
  return m;
}

const ANON_SEAT = {
  api_key: null, tier: 'free', platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '198.51.100.9', session_id: 'sess-cap-teaser',
};

async function callOverCap(m, name, args = {}) {
  const T = m.createServer()._registeredTools[name];
  if (!T) throw new Error(`${name} not registered`);
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  const res = await m._ctxALS.run(ANON_SEAT, () =>
    T.handler(parsed.data, { signal: new AbortController().signal }));
  const text = (res.content || []).map((c) => c.text || '').join('\n');
  let body = null;
  try { body = JSON.parse(text); } catch { /* prose */ }
  return { res, body: res.structuredContent || body };
}

describe('the anonymous over-cap trim spares the Capacity Source teaser', () => {
  it('fires the cap branch and leaves size, count and market intact', async () => {
    usageCount = 50;     // inside the carrot band: >= cap 30, < the 10x wall at 300
    const m = await freshServer({ cap: 30 });
    const { body } = await callOverCap(m, 'source_capacity', { limit: 3 });

    // ★ FIRST: prove the branch under test actually ran. If this fails, every
    // assertion below is vacuous — a payload that was never trimmed cannot
    // demonstrate that the trim spared it.
    expect(body?._upgrade?.tier, 'the anon_daily_cap branch did not fire').toBe('anon_daily_cap');
    expect(body._upgrade.binding_limit).toBe('anon_ip_daily');
    expect(listingHits, 'the handler never reached the stub backend').toBeGreaterThan(0);

    // …and that it spared the advertisement.
    expect(body.count, 'an agent must be able to say how many listings exist').toBe(2);
    expect(body.pocket_locked_count).toBe(2);
    const first = body.items.find((i) => i.slug === TEASER.slug);
    expect(first, 'the teaser row went missing').toBeTruthy();
    expect(first.capacity_mw).toBe(1.2);
    expect(first.capacity_kw).toBe(1200);
    // The two numbers v2.12.18 instructs the agent to relay when it explains
    // why a listing did or did not fit.
    expect(first.contiguous_kw).toBe(500);
    expect(first.min_contract_kw).toBe(100);
    expect(first.market).toBe('Dallas-Fort Worth');

    // The wall itself is untouched: detail stays gated, the nudge still rides.
    expect(first.locked).toBe(true);
    expect(first.access_required).toBe('registered');
    expect(first.lock_reason).toBe('sign_in_required');
    expect(body._upgrade.next_tool).toBe('claim_free_key');
  });

  it('parity: the over-cap agent sees the same numbers the anonymous web teaser serves', async () => {
    usageCount = 50;                 // carrot band, as above
    const m = await freshServer({ cap: 30 });
    const { body } = await callOverCap(m, 'source_capacity', { limit: 3 });
    expect(body?._upgrade?.tier).toBe('anon_daily_cap');

    const web = LISTINGS_BODY.items.map((i) => ({
      slug: i.slug, capacity_mw: i.capacity_mw, capacity_kw: i.capacity_kw,
      contiguous_kw: i.contiguous_kw, min_contract_kw: i.min_contract_kw, market: i.market,
    }));
    const agent = body.items.map((i) => ({
      slug: i.slug, capacity_mw: i.capacity_mw, capacity_kw: i.capacity_kw,
      contiguous_kw: i.contiguous_kw, min_contract_kw: i.min_contract_kw, market: i.market,
    }));
    expect(agent).toEqual(web);
    expect(body.count).toBe(LISTINGS_BODY.count);
  });

  it('under the cap nothing changed — no cap branch, same numbers', async () => {
    usageCount = 3;                                    // well inside the free band
    const m = await freshServer({ cap: 30 });
    const { body } = await callOverCap(m, 'source_capacity', { limit: 3 });
    expect(body?._upgrade?.tier).not.toBe('anon_daily_cap');
    expect(body.count).toBe(2);
    expect(body.items[0].contiguous_kw).toBe(500);
  });
});

describe('CONTROL — the exemption stayed narrow', () => {
  it('a FREE_FULL tool that is NOT cap-exempt is still trimmed on the same seat', async () => {
    usageCount = 50;                 // carrot band, as above
    const m = await freshServer({ cap: 30 });
    expect(m.FREE_FULL_TOOLS.has('get_global_power'), 'control tool is not FREE_FULL — pick another')
      .toBe(true);
    expect(m.CAP_TRIM_EXEMPT.has('get_global_power')).toBe(false);

    const { body } = await callOverCap(m, 'get_global_power', {});
    expect(body?._upgrade?.tier, 'the cap branch did not fire for the control')
      .toBe('anon_daily_cap');
    // If these come back with their numbers, the cap trim has been disabled
    // wholesale rather than narrowed — the harvester hole the branch exists to
    // close. Asserted on the fields this tool actually SERVES (the handler
    // reshapes the upstream body), scalar and nested.
    expect(body.total_capacity_mw, 'the over-cap trim no longer bites anything').toBeNull();
    expect(body.count).toBeNull();
    expect(body.largest_units[0].capacity_mw, 'nested metrics escaped the trim').toBeNull();
    // …and it is the same shape of field the teaser above kept: capacity_mw.
    expect(body.largest_units[0].name, 'the trim ate identifiers too').toBe('Unit A');
  });

  it('CAP_TRIM_EXEMPT is exactly the Capacity Source trio, and a subset of FREE_FULL_TOOLS', async () => {
    const m = await freshServer({ cap: 30 });
    expect([...m.CAP_TRIM_EXEMPT].sort()).toEqual(
      ['accept_capacity_terms', 'request_capacity_intro', 'source_capacity']);
    for (const n of m.CAP_TRIM_EXEMPT) {
      expect(m.FREE_FULL_TOOLS.has(n), `${n} is cap-exempt but not FREE_FULL`).toBe(true);
    }
    expect(m.CAP_TRIM_EXEMPT.size).toBeLessThan(m.FREE_FULL_TOOLS.size);
  });

  it('_capTrim trims a non-exempt payload and passes an exempt one through untouched', async () => {
    const m = await freshServer({ cap: 30 });
    const payload = () => ({ count: 2, items: [{ capacity_mw: 1.2, contiguous_kw: 500 }] });
    const trimmed = m._capTrim(payload(), 'get_global_power');
    expect(trimmed.count, 'control: _capTrim must still null a non-exempt metric').toBeNull();
    expect(trimmed.items[0].capacity_mw).toBeNull();
    expect(m._capTrim(payload(), 'source_capacity')).toEqual(payload());
  });
});
