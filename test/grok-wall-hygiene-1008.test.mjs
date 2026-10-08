// grok-wall-hygiene-1008.test.mjs — the owner's external Grok auditor read the live tool
// output after mcp#825 (relay sids, /u/ links, keyed mint gate) and asked for five things.
// Real registered handlers under a real caller seat; only the backend is stubbed (no network).
//
//   1. ONE dchub.cloud page link per wall for a caller below Developer (text + structuredContent):
//      human_url. No /go/c in the text rungs, no upgrade.developer_url / usage_url /
//      pricing.metered_url, no $0.50 note; the repeat wall of a session points at the page too.
//      Kill switch DCHUB_WALL_ONE_LINK=0 restores the 10-07 response (the control below).
//   2. _packOpensTool: the $10 pack is API capacity — it opens no depth-tease tool; the seat
//      predicates the missed-upgrade line reads agree; no code line sells "full depth" for $10.
//   3. The relay token carries the wall kind: w-capacity (ration spent), w-freekey (a free key
//      returns it), nothing for depth; Pro-only unchanged. Kill switch DCHUB_WALL_KIND_STAMP=0.
//   4. X-DCHub-QA: 1 (ctx.qa_marker) makes a QA caller on its own, whatever clientInfo says.
//   5. partner_inbox: a partner key's unread notes ride the first result of its session and
//      every get_changes, with the session's own key; a non-partner session probes once; a
//      keyless session never probes. No new tool. Kill switch DCHUB_PARTNER_INBOX=0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { isGatedResult } from '../lib/paywall-contract.mjs';

const BASE = 'https://backend.grok-wall-hygiene-1008.test';
const INTERNAL = 'grok-wall-hygiene-1008-internal-key';
const RELAY = /^https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?\S*)?$/;
const PAGE_LINK = /https:\/\/(?:www\.)?dchub\.cloud\/[^\s"'`<>\\)\]}]*[^\s"'`<>\\)\]}.,;:!?*]/g;
let S, TOOLS, realFetch, prevInternal, prevBase;

const QUEUE = { iso: 'PJM', as_of: '2026-10-08', project_count: 25, queued_generation_gw: 287.4,
  projects: Array.from({ length: 25 }, (_, i) => ({ project_name: 'Proj ' + i, queue_id: 'AF' + i,
    capacity_mw: 100 + i, county: 'York', state: 'PA', fuel_type: 'Gas', queue_status: 'Active' })) };
const GRID = { iso: 'ERCOT', as_of: '2026-10-08', generation_mix: { NG: 4000, WND: 2000 }, demand_mw: 70000,
  headroom_mw: 1234.5, time_to_power_months: 18, queue: { total_gw: 120.3, projects: 40 } };
const ENERGY = { iso: 'ERCOT', as_of: '2026-10-08', retail_price_cents_kwh: 8.1, wholesale_price_usd_mwh: 31.2,
  natural_gas_usd_mmbtu: 2.9, min_cents_kwh: 5.2, max_cents_kwh: 12.4, grid_status: 'normal' };
const ROWS = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, name: 'Site ' + i, iso: 'PJM', score: 50 + i,
  lat: 39 + i / 10, lon: -77, city: 'Ashburn', state: 'VA', country: 'US' }));
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

// The inbox stub: per-test mode and a hit log (what the server sent).
const inbox = { mode: 'not_partner', notes: [], hits: [] };
const NOTE = { id: 7, title: 'hello', body: 'note body', author: 'owner', created_at: '2026-10-08T00:00:00+00:00' };

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = INTERNAL;
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    let u = null; try { u = new URL(url); } catch { /* not a URL */ }
    const p = u ? u.pathname : '';
    if (p === '/api/v1/inbox') {
      const h = (init && init.headers) || {};
      inbox.hits.push({ key: h['X-API-Key'] || h['x-api-key'] || null, accept: h['Accept'] || h['accept'] || null, peek: u.searchParams.get('peek') });
      if (inbox.mode === 'partner') return json({ ok: true, inbox_slug: 'slug-test', count: inbox.notes.length, peek: false, notes: inbox.notes });
      if (inbox.mode === 'no_key') return json({ ok: false, error: 'api_key_required' }, 401);
      if (inbox.mode === 'error') return json({ ok: false, error: 'db_unavailable' }, 503);
      return json({ ok: false, error: 'not_a_partner_key' }, 403);
    }
    if (p === '/api/v1/interconnection-queue/by-iso') return json(structuredClone(QUEUE));
    if (p.startsWith('/api/v1/grid/intelligence/')) return json(structuredClone(GRID));
    if (p === '/api/v1/energy/summary') return json(structuredClone(ENERGY));
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    if (p === '/api/v1/changes/since') return json({ generated_at: '2026-10-08T00:00:00Z', movers: [], new_facilities: [], deals: [] });
    return json({ success: true, count: ROWS.length, data: ROWS, results: ROWS, demand_mw: 18000 });
  };
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  for (const k of ['DCHUB_WALL_ONE_LINK', 'DCHUB_WALL_KIND_STAMP', 'DCHUB_PARTNER_INBOX']) delete process.env[k];
});
beforeEach(() => {
  for (const k of ['DCHUB_WALL_ONE_LINK', 'DCHUB_WALL_KIND_STAMP', 'DCHUB_PARTNER_INBOX']) delete process.env[k];
  inbox.mode = 'not_partner'; inbox.notes = []; inbox.hits = [];
  process.env.DCHUB_PARTNER_INBOX = '1';   // opt-in since mcp#831 ships read_inbox as a tool (see _partnerInboxOn)
  S._resetPartnerInboxForTest();
  S.keyCache.clear();
});

let n = 0;
const seat = (extra = {}) => ({
  tier: 'anonymous', platform: 'cursor', client_name_raw: 'cursor', ...extra,
  client_ip: '203.0.113.' + (10 + (n % 200)), session_id: 'sess-hygiene-1008-' + (++n),
});
async function call(name, args, s, { fresh = true } = {}) {
  if (fresh) for (const m of [S._anonUsageCounts, S._fullCapHydrated]) if (m && m.clear) m.clear();
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const textOf = (r) => r.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
const base = (u) => String(u).replace(/[?#].*$/, '');
// Every distinct dchub.cloud PAGE link in the whole response (text + structuredContent).
// Not counted: machine endpoints (/api/v1/, the /mcp connector URL the persist command carries,
// /.well-known/) and the citation's bare host (no path) — the same set the step exempts.
const ENDPOINT = /^https:\/\/dchub\.cloud\/(?:api\/v1\/|mcp(?![A-Za-z0-9_-])|\.well-known\/)/;
function pageLinks(r) {
  const all = JSON.stringify(r).match(PAGE_LINK) || [];
  return [...new Set(all.filter((u) => !ENDPOINT.test(u)).map(base))];
}
function tokenFields(url) {
  const m = /\/upgrade\/h\/([A-Za-z0-9_-]+)\.([0-9a-f]{32})/.exec(String(url || ''));
  if (!m) return null;
  const sig = createHmac('sha256', INTERNAL).update(m[1]).digest('hex').slice(0, 32);
  expect(sig, 'the re-signed token verifies under the internal key').toBe(m[2]);
  return Buffer.from(m[1], 'base64url').toString().split('|');
}

// ── 1. one link ───────────────────────────────────────────────────────────────
describe('item 1: a wall below Developer carries ONE dchub.cloud page link, human_url', () => {
  it('anonymous depth wall (get_interconnection_queue): one link, the relay, no /go/c, no rung fields', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, seat());
    expect(isGatedResult(r)).toBe(true);
    const sc = r.structuredContent;
    expect(sc.human_url).toMatch(RELAY);
    expect(pageLinks(r)).toEqual([base(sc.human_url)]);
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/dchub\.cloud\/go\/c\//);
    expect(all).not.toMatch(/developer_url|usage_url|metered_url/);
    expect(all).not.toContain('$0.50');
    // the human-facing fields still agree with the one link
    expect(sc.for_your_human.url).toBe(sc.human_url);
    expect(textOf(r)).toContain(base(sc.human_url));
    // the keepers (measured 2026-10-08: this wall carries provenance and no citation block, flag on or off)
    expect(sc.provenance).toBeTruthy();
    expect(sc.for_your_human).toBeTruthy();
    expect(sc.agent_instruction).toBe(S.RELAY_CONTRACT);
    // the pack rung's label no longer names the $10 pack beside a page that may sell Developer
    expect(textOf(r)).toContain('**the plans that include the full answer** → ' + base(sc.human_url));
    expect(textOf(r)).not.toMatch(/\$10 one-time = 1,000 API credits\*\*, credits don’t expire → https/);
  });

  it('keyed FREE caller, first and repeat wall in one session: the one link is the relay both times', async () => {
    const s = seat({ tier: 'free', api_key: 'dch_live_hygiene_1008_keyed_' + n });
    const first = await call('get_interconnection_queue', { iso: 'PJM' }, s);
    const repeat = await call('get_interconnection_queue', { iso: 'PJM' }, s);
    for (const [label, r] of [['first', first], ['repeat', repeat]]) {
      expect(isGatedResult(r), label).toBe(true);
      expect(JSON.stringify(r), label).not.toMatch(/dchub\.cloud\/go\/c\//);
      expect(pageLinks(r), label).toEqual([base(r.structuredContent.human_url)]);
      expect(r.structuredContent.human_url, label).toMatch(RELAY);
    }
    // the keyed token still binds the key (pk-): the page the human opens binds the same key
    expect(tokenFields(first.structuredContent.human_url).some((f) => /^pk-[0-9a-f]{64}$/.test(f))).toBe(true);
  });

  it('anonymous unlock_more_data: the ladder points at the one page', async () => {
    const r = await call('unlock_more_data', { reason: 'PJM queue depth' }, seat());
    const sc = r.structuredContent;
    expect(sc.human_url).toMatch(RELAY);
    expect(pageLinks(r)).toEqual([base(sc.human_url)]);
    expect(JSON.stringify(r)).not.toMatch(/dchub\.cloud\/go\/c\//);
    expect(sc.machine_pay).toBeUndefined();
    expect((sc.plans || []).some((p) => p.id === 'mpp')).toBe(false);
  });

  it('CONTROL — DCHUB_WALL_ONE_LINK=0 restores the 10-07 wall (the /go/c rungs come back)', async () => {
    process.env.DCHUB_WALL_ONE_LINK = '0';
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, seat());
    expect(isGatedResult(r)).toBe(true);
    expect(JSON.stringify(r)).toMatch(/dchub\.cloud\/go\/c\//);
    expect(pageLinks(r).length).toBeGreaterThan(1);
  });

  it('the step itself: endpoints survive, pointers converge, rungs collapse (unit, exported)', () => {
    const relay = 'https://dchub.cloud/upgrade/h/' + 'A'.repeat(24) + '.' + 'b'.repeat(32);
    const goc = 'https://dchub.cloud/go/c/abc.' + 'c'.repeat(32);
    const text = [
      '{"rows":[1],"_upgrade":{"developer_url":"' + goc + '","upgrade_url":"' + goc + '","message":"pay → ' + goc + '"}}',
      '',
      '   Keep it across future sessions: `claude mcp add dchub --transport http --header X-API-Key:k https://dchub.cloud/mcp`',
      'Claim: https://dchub.cloud/api/v1/keys/claim · docs https://dchub.cloud/.well-known/mcp-server.json',
      '👤 **Tell your human:** **$10 one-time = 1,000 API credits**, credits don’t expire → ' + goc + ' (`x` uses 5 credits per call) · or **Developer** (500 calls/day, full depth) → ' + goc + '.',
      'Autonomous: $0.50 per call via MPP.',
    ].join('\n');
    const result = { content: [{ type: 'text', text }], structuredContent: {
      _wall: true, human_url: relay, for_your_human: { url: relay, text: 'open ' + relay },
      upgrade: { developer_url: goc, usage_url: goc, upgrade_url: goc }, pricing: { metered_url: goc },
      machine_pay: { price_usd: '0.50' }, plans: [{ id: 'mpp', how: 'x' }, { id: 'credits', checkout_url: goc }],
      provenance: { source: 'https://dchub.cloud/grid/large-load-queue' }, citation: { url: 'https://dchub.cloud' },
      facility: { url: 'https://dchub.cloud/facility/abc' },
      email_capture: { type: 'capture_email_for_free_key', method: 'GET', url: 'https://dchub.cloud/notify?tool=x' },
      rows: [{ id: 1234567, name: 'Site', lat: 39.9223, mw: 48.7, url: 'https://dchub.cloud/facility/1234567' }],
      agent_action: { type: 'claim_free_key', method: 'POST', url: 'https://dchub.cloud/api/v1/keys/claim' },
    } };
    const out = S._ctxALS.run({ tier: 'free', platform: 'cursor' }, () => S._oneLinkWallStep(result, 'get_interconnection_queue'));
    const t = out.content[0].text;
    expect(t).toContain('https://dchub.cloud/mcp`');
    expect(t).toContain('https://dchub.cloud/api/v1/keys/claim');
    expect(t).toContain('https://dchub.cloud/.well-known/mcp-server.json');
    expect(t).not.toContain(goc);
    expect(t).not.toContain('$0.50');
    // the link is written once in the PROSE (the JSON head is data and keeps its own copies)
    expect(t).toContain('**the plans that include the full answer** → ' + relay);
    expect(t.split(relay).length - 1).toBe(3);   // _upgrade.upgrade_url + _upgrade.message (data) + the rung (prose)
    expect(t).not.toMatch(/\*\*Developer\*\*/);
    const head = JSON.parse(t.split('\n')[0]);
    expect(head._upgrade.developer_url).toBeUndefined();
    expect(head._upgrade.upgrade_url).toBe(relay);
    expect(head._upgrade.message).toBe('pay → ' + relay);
    const sc = out.structuredContent;
    expect(sc.upgrade).toEqual({ upgrade_url: relay });
    expect(sc.pricing).toEqual({});
    expect(sc.machine_pay).toBeUndefined();
    expect(sc.plans).toEqual([{ id: 'credits' }]);
    expect(sc.provenance.source).toBe('https://dchub.cloud/grid/large-load-queue');   // provenance kept
    expect(sc.citation.url).toBe('https://dchub.cloud');
    expect(sc.facility).toBeUndefined();                                              // a pointer object goes with its link
    expect(sc.email_capture).toBeUndefined();                                         // not left as a request with no address
    expect(sc.rows).toEqual([{ id: 1234567, name: 'Site', lat: 39.9223, mw: 48.7 }]);   // a data row keeps its figures, loses its page url
    expect(sc.agent_action.url).toBe('https://dchub.cloud/api/v1/keys/claim');        // an endpoint stays
    // the only other page link left is the provenance keeper, by design
    expect(pageLinks(out).sort()).toEqual([relay, 'https://dchub.cloud/grid/large-load-queue'].sort());
  });

  it('a Developer seat is not touched (no wall to converge)', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' },
      seat({ tier: 'developer', api_key: 'dch_live_hygiene_1008_dev_' + n }));
    expect(isGatedResult(r)).toBe(false);
    expect(r.structuredContent.human_url).toBeUndefined();
  });
});

// ── 2. the pack is capacity ───────────────────────────────────────────────────
describe('item 2: the $10 pack is API capacity, never depth', () => {
  it('_packOpensTool: no depth-tease tool, no Pro-only tool; a rationed paid-class tool still', () => {
    for (const t of ['get_interconnection_queue', 'get_grid_intelligence', 'get_fiber_intel', 'get_market_intel', 'list_transactions']) {
      expect(S._packOpensTool(t), t).toBe(false);
    }
    for (const t of ['analyze_site', 'compare_sites', 'get_dchub_recommendation']) expect(S._packOpensTool(t), t).toBe(false);
    for (const t of ['get_grid_data', 'compare_isos', 'rank_markets', 'get_water_risk']) expect(S._packOpensTool(t), t).toBe(true);
  });
  it('the seat predicates agree: a pack balance opens no depth-tease rows; Developer does', () => {
    const pack = { keyed: true, tier: 'free', credits: 1000 };
    const dev = { keyed: true, tier: 'developer', credits: 0 };
    expect(S._anonTrimOpensForSeat('get_interconnection_queue', pack)).toBe(false);
    expect(S._rowsOpenForSeat('get_interconnection_queue', pack)).toBe(false);
    expect(S._tierGateOpensForSeat('get_interconnection_queue', pack)).toBe(false);
    expect(S._anonTrimOpensForSeat('get_interconnection_queue', dev)).toBe(true);
    expect(S._rowsOpenForSeat('get_interconnection_queue', dev)).toBe(true);
    // the rung the missed-upgrade line names for a depth-tease tool is Developer, not the pack
    expect(S._rowsTotalSet('get_interconnection_queue')).toBe('developer');
  });
  it('no code line sells "full depth" within 120 characters of a $10 mention', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const code = noBlock.split('\n').map((l) => l.replace(/(^|[^:\\'"`])\/\/.*$/, '$1')).join('\n');
    const bad = [];
    const rx = /\$10/g;
    for (let m; (m = rx.exec(code));) {
      const win = code.slice(Math.max(0, m.index - 120), m.index + 120);
      if (/full depth/i.test(win)) bad.push('server.mjs:' + code.slice(0, m.index).split('\n').length + ' «' + win.replace(/\s+/g, ' ').trim().slice(0, 160) + '»');
    }
    expect(bad).toEqual([]);
  });
});

// ── 3. wall kind in the token ─────────────────────────────────────────────────
describe('item 3: the relay token is stamped with the wall kind at mint', () => {
  it('_wallKindFor: capacity markers, the free-key rule for a keyless caller, nothing on Pro-only', () => {
    expect(S._wallKindFor({ error: 'anon_hard_wall' }, {}, 'get_grid_data')).toBe(S.WALL_KIND_CAPACITY);
    expect(S._wallKindFor({ _upgrade: { tier: 'anon_daily_cap' } }, {}, 'search_facilities')).toBe(S.WALL_KIND_CAPACITY);
    expect(S._wallKindFor({ credits_depleted: true }, { api_key: 'k' }, 'get_grid_data')).toBe(S.WALL_KIND_CAPACITY);
    expect(S._wallKindFor({ trial_preview: true }, {}, 'get_energy_prices')).toBe(S.WALL_KIND_FREEKEY);
    expect(S._wallKindFor({ trial_preview: true }, { api_key: 'k' }, 'get_energy_prices')).toBe('');
    expect(S._wallKindFor({ trial_preview: true }, {}, 'get_interconnection_queue')).toBe('');
    expect(S._wallKindFor({ error: 'anon_hard_wall' }, {}, 'analyze_site')).toBe('');
  });

  it('a depth wall carries no marker (four fields, keyless)', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, seat());
    const f = tokenFields(r.structuredContent.human_url);
    expect(f).toHaveLength(4);
    expect(S._relayTokenKind(r.structuredContent.human_url)).toBe('');
  });

  it('a keyless get_energy_prices wall (a free key returns it) carries w-freekey', async () => {
    const r = await call('get_energy_prices', { iso: 'ERCOT' }, seat());
    expect(isGatedResult(r), textOf(r).slice(0, 600)).toBe(true);
    const url = r.structuredContent.human_url;
    expect(url).toMatch(RELAY);
    const f = tokenFields(url);
    expect(f[f.length - 1]).toBe('w-freekey');
    expect(f.length).toBeLessThanOrEqual(6);
    // every copy of the token in the response is the stamped one
    const tokens = [...new Set(JSON.stringify(r).match(/https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/g))];
    expect(tokens).toEqual([base(url)]);
  });

  it('a daily-cap wall (free key, third full answer of the day) carries w-capacity beside pk-', async () => {
    // get_fiber_intel: still on the free key's daily allowance (#833 made the three decision tools
    // previews on every non-paid seat, so they no longer reach a capacity wall).
    const s = seat({ tier: 'free', api_key: 'dch_live_hygiene_1008_cap_' + n, client_ip: '203.0.113.250' });
    let r;
    for (let i = 0; i < 3; i++) r = await call('get_fiber_intel', { metro: 'ashburn' }, s, { fresh: false });
    expect(isGatedResult(r), textOf(r).slice(0, 800)).toBe(true);
    const url = r.structuredContent.human_url;
    expect(url).toMatch(RELAY);
    const f = tokenFields(url);
    expect(f).toContain('w-capacity');
    expect(f.some((x) => /^pk-[0-9a-f]{64}$/.test(x))).toBe(true);
    expect(f).toHaveLength(6);   // sid | tool | tier | ts | pk- | w-capacity — the backend parses 4-6
  });

  it('CONTROL — DCHUB_WALL_KIND_STAMP=0: the same free-key wall is minted without a marker', async () => {
    process.env.DCHUB_WALL_KIND_STAMP = '0';
    const r = await call('get_energy_prices', { iso: 'ERCOT' }, seat());
    expect(isGatedResult(r)).toBe(true);
    expect(S._relayTokenKind(r.structuredContent.human_url)).toBe('');
  });
});

// ── 4. the QA header on its own ───────────────────────────────────────────────
describe('item 4: X-DCHub-QA: 1 is a QA caller whatever clientInfo says', () => {
  it('header alone → QA; host clientInfo alone → not QA; the UA / clientInfo forms still count', () => {
    expect(S._isQaCaller({ qa_marker: true, client_name_raw: 'grok', user_agent: 'Mozilla/5.0' })).toBe(true);
    expect(S._isQaCaller({ qa_marker: true, client_name_raw: 'claude-ai' })).toBe(true);
    expect(S._isQaCaller({ client_name_raw: 'grok', user_agent: 'Mozilla/5.0' })).toBe(false);
    expect(S._isQaCaller({ qa_marker: false, client_name_raw: 'grok' })).toBe(false);
    expect(S._isQaCaller({ client_name_raw: 'dchub-qa-readonly' })).toBe(true);
    expect(S._isQaCaller({ user_agent: 'dchub-qa/1.0 (nightly - exclude)' })).toBe(true);
    expect(S._isQaCaller(null)).toBe(false);
  });
  it('callAPI forwards the marker for a header-only QA caller with a host clientInfo', async () => {
    const seen = [];
    const f = globalThis.fetch;
    globalThis.fetch = async (input, init) => { seen.push((init && init.headers) || {}); return f(input, init); };
    try {
      await S._ctxALS.run({ qa_marker: true, client_name_raw: 'grok', platform: 'grok' }, () => S._callAPIForTest('/api/v1/facilities', {}));
      await S._ctxALS.run({ client_name_raw: 'grok', platform: 'grok' }, () => S._callAPIForTest('/api/v1/facilities', {}));
    } finally { globalThis.fetch = f; }
    expect(seen[0][S.QA_MARKER_HEADER]).toBe('1');
    expect(seen[1][S.QA_MARKER_HEADER]).toBeUndefined();
  });
});

// ── 5. partner_inbox ──────────────────────────────────────────────────────────
describe('item 5: partner notes ride the first result and get_changes, no new tool', () => {
  it('partner key: block on the first result, not the second ordinary call, again on get_changes', async () => {
    inbox.mode = 'partner'; inbox.notes = [NOTE];
    const s = seat({ tier: 'free', api_key: 'dchub_pro_partner_fixture_' + n, platform: 'grok', client_name_raw: 'grok' });
    const first = await call('search_facilities', { limit: 3 }, s);
    expect(first.structuredContent.partner_inbox).toBeTruthy();
    expect(first.structuredContent.partner_inbox.notes.map((x) => x.title)).toEqual(['hello']);
    expect(first.structuredContent.partner_inbox.notes[0]).toMatchObject({ body: 'note body', created_at: NOTE.created_at });
    expect(first.structuredContent.partner_inbox.marked_read).toBe(true);
    expect(textOf(first)).toContain('partner_inbox');
    const second = await call('search_facilities', { limit: 3 }, s);
    expect(second.structuredContent.partner_inbox).toBeUndefined();
    expect(textOf(second)).not.toContain('partner_inbox');
    inbox.notes = [{ ...NOTE, id: 8, title: 'again' }];
    const poll = await call('get_changes', { since: '24h' }, s);
    expect(poll.structuredContent.partner_inbox.notes.map((x) => x.title)).toEqual(['again']);
    // two reads, each with the session's own key, JSON, and the default (marking) mode
    expect(inbox.hits).toHaveLength(2);
    for (const h of inbox.hits) {
      expect(h.key).toBe(s.api_key);
      expect(h.accept).toBe('application/json');
      expect(h.peek).toBeNull();
    }
  });

  it('non-partner key (403): no block, exactly one probe across the session', async () => {
    const s = seat({ tier: 'free', api_key: 'dch_live_hygiene_1008_plain_' + n });
    const a = await call('search_facilities', { limit: 3 }, s);
    const b = await call('search_facilities', { limit: 3 }, s);
    const c = await call('get_changes', { since: '24h' }, s);
    for (const r of [a, b, c]) expect(r.structuredContent.partner_inbox).toBeUndefined();
    expect(inbox.hits).toHaveLength(1);
  });

  it('no key: no probe at all', async () => {
    const s = seat();
    await call('search_facilities', { limit: 3 }, s);
    await call('get_interconnection_queue', { iso: 'PJM' }, s);
    expect(inbox.hits).toHaveLength(0);
  });

  it('the block is short: at most 20 notes, a body cut at 8 KB with a note', async () => {
    inbox.mode = 'partner';
    inbox.notes = Array.from({ length: 25 }, (_, i) => ({ ...NOTE, id: i, title: 'n' + i, body: i === 0 ? 'x'.repeat(9000) : 'short' }));
    const s = seat({ tier: 'free', api_key: 'dchub_pro_partner_long_' + n });
    const r = await call('search_facilities', { limit: 3 }, s);
    const pi = r.structuredContent.partner_inbox;
    expect(pi.notes).toHaveLength(20);
    expect(pi.notes[0].body).toHaveLength(8192);
    expect(pi.notes[0].truncated).toBe(true);
    expect(pi.notes[1].truncated).toBeUndefined();
  });

  it('CONTROL — default (unset): dormant, a partner key gets no block and no probe', async () => {
    delete process.env.DCHUB_PARTNER_INBOX;
    inbox.mode = 'partner'; inbox.notes = [NOTE];
    const s = seat({ tier: 'free', api_key: 'dchub_pro_partner_off_' + n });
    const r = await call('search_facilities', { limit: 3 }, s);
    expect(r.structuredContent.partner_inbox).toBeUndefined();
    expect(inbox.hits).toHaveLength(0);
  });

  it('no tool was added for it: the catalog is exactly what mcp#831 left (94)', () => {
    expect(Object.keys(TOOLS)).toHaveLength(94);
    expect(Object.keys(TOOLS)).not.toContain('partner_inbox');
  });
});
