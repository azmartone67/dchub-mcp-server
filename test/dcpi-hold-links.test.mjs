// DCPI hold #117162 (Grok QA 2026-11-25): no tool answer hands an agent a /dcpi/<slug> link that 404s.
// lib/dcpi-hold-links.mjs rewrites a held market's /dcpi/<slug> link to /markets/<slug>; links only.
// Part 1 pins the rule against the backend's util/dcpi_coverage.out_of_scope; part 2 runs real tool handlers
// (find_sites, analyze_site, site_selection_canvas, get_market_dcpi_rank, rank_markets) over a fixture backend that
// returns held links, and proves each link reaches the agent with the kill switch on (so the check is not vacuous)
// and never with the step on.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as H from '../lib/dcpi-hold-links.mjs';

const KILL = 'DCHUB_DCPI_HOLD_LINKS';
const HELD_LINK = /dchub\.cloud\/dcpi\/(gilbert|goodyear|tucson|phoenix|dallas|west-des-moines|des-moines|houston|newmarket-az)(?![a-z0-9-])/i;

describe('config/dcpi-hold.json (copy of dchub-backend config/dcpi-hold.json)', () => {
  it('has the backend shape and the hold as of 2026-11-25', () => {
    const cfg = JSON.parse(readFileSync(H.HOLD_PATH, 'utf8'));
    expect(cfg.hold_id).toBe('117162');
    expect(cfg.held_isos).toEqual(['ERCOT', 'MISO']);
    expect(cfg.held_states).toEqual(['AZ']);
  });
  it('a missing or empty file keeps the hold (fallback), never lifts it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hold-'));
    expect(H.loadHold(join(dir, 'missing.json')).held_states).toEqual(['AZ']);
    const empty = join(dir, 'empty.json');
    writeFileSync(empty, JSON.stringify({ held_isos: [], held_states: [] }));
    expect(H.loadHold(empty).held_isos).toEqual(['ERCOT', 'MISO']);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(H.loadHold(bad).held_isos).toEqual(['ERCOT', 'MISO']);
  });
});

describe('isHeldMarket mirrors util/dcpi_coverage.out_of_scope', () => {
  it.each([
    ['gilbert', {}, true],            // AZ, WECC: held by state (catalog)
    ['goodyear', {}, true],
    ['tucson', {}, true],
    ['phoenix', {}, true],
    ['dallas', {}, true],             // ERCOT by ISO
    ['west-des-moines', {}, true],    // MISO by ISO
    ['columbus', {}, false],          // PJM, OH
    ['ashburn', {}, false],
    ['chicago', {}, false],
    ['newmarket-az', { state: 'AZ' }, true],   // not in the catalog: the row's own state decides
    ['newmarket-x', { iso: 'ERCOT' }, true],
    ['newmarket-y', { state: 'OH', iso: 'PJM' }, false],
    ['columbus', { state: 'AZ', iso: 'ERCOT' }, false],   // a catalog market keeps its own row, whatever encloses it
    ['phoenix-west', {}, true],       // name pattern (the state's DCPI anchor), as the backend
    ['ercot-north', {}, true],
  ])('%s %j -> %s', (slug, ctx, want) => {
    expect(H.isHeldMarket(slug, ctx)).toBe(want);
  });
  it('the hold comes from the JSON: lifting AZ there un-holds Gilbert', () => {
    try {
      H._setHoldForTest({ hold_id: 'x', held_isos: ['ERCOT'], held_states: [] });
      expect(H.isHeldMarket('gilbert')).toBe(false);
      expect(H.isHeldMarket('dallas')).toBe(true);
    } finally { H._setHoldForTest(null); }
  });
});

describe('withHeldDcpiLinks', () => {
  const sample = () => ({
    content: [{ type: 'text', text: 'Gilbert: https://dchub.cloud/dcpi/gilbert. Columbus: https://dchub.cloud/dcpi/columbus?via=agent. New: dchub.cloud/dcpi/newmarket-az' }],
    structuredContent: {
      candidates: [{ anchor: { state: 'AZ' }, market: { slug: 'gilbert', iso: 'WECC', source_url: 'https://dchub.cloud/dcpi/gilbert' } }],
      market_verdict: { slug: 'goodyear', source_url: 'https://dchub.cloud/dcpi/goodyear' },
      shortlist: [
        { slug: 'newmarket-az', state: 'AZ', dcpi_url: 'https://dchub.cloud/dcpi/newmarket-az?ref=1#v' },
        { slug: 'columbus', state: 'OH', dcpi_url: 'https://dchub.cloud/dcpi/columbus' },
        { slug: 'dallas', state: 'TX', dcpi_url: 'https://www.dchub.cloud/dcpi/dallas/history' },
      ],
      other: ['https://dchub.cloud/dcpi/methodology', 'https://dchub.cloud/dcpi/leaderboard'],
    },
  });
  it('rewrites held links to /markets/<slug> in structured fields and prose; leaves the rest', () => {
    const out = H.withHeldDcpiLinks(sample(), { env: {} });
    const s = JSON.stringify(out);
    expect(s).not.toMatch(HELD_LINK);
    expect(out.structuredContent.candidates[0].market.source_url).toBe('https://dchub.cloud/markets/gilbert');
    expect(out.structuredContent.market_verdict.source_url).toBe('https://dchub.cloud/markets/goodyear');
    expect(out.structuredContent.shortlist[0].dcpi_url).toBe('https://dchub.cloud/markets/newmarket-az?ref=1#v');
    expect(out.structuredContent.shortlist[1].dcpi_url).toBe('https://dchub.cloud/dcpi/columbus');
    expect(out.structuredContent.shortlist[2].dcpi_url).toBe('https://dchub.cloud/markets/dallas');
    expect(out.structuredContent.other).toEqual(['https://dchub.cloud/dcpi/methodology', 'https://dchub.cloud/dcpi/leaderboard']);
    // prose: a catalog-held slug, and an uncatalogued one held by its row elsewhere in the same answer
    expect(out.content[0].text).toBe('Gilbert: https://dchub.cloud/markets/gilbert. Columbus: https://dchub.cloud/dcpi/columbus?via=agent. New: dchub.cloud/markets/newmarket-az');
  });
  it('kill switch DCHUB_DCPI_HOLD_LINKS=0 returns the answer untouched', () => {
    const r = sample();
    expect(H.withHeldDcpiLinks(r, { env: { [KILL]: '0' } })).toBe(r);
  });
  it('no held link: the same object comes back (no copy)', () => {
    const r = { structuredContent: { url: 'https://dchub.cloud/dcpi/columbus' } };
    expect(H.withHeldDcpiLinks(r, { env: {} })).toBe(r);
  });
  it('execute_plan: held links inside step bodies and the JSON text block are rewritten', () => {
    // In-process plan steps run over loopback HTTP, which the fixture harness below does not serve, so the plan's
    // shape is pinned here: executed[].result carries each step's answer; content[1] is the same JSON as text.
    const body = { executed: [{ step: 1, tool: 'site_selection_canvas', result: { shortlist: [{ slug: 'gilbert', state: 'AZ', dcpi_url: 'https://dchub.cloud/dcpi/gilbert' }] } },
      { step: 2, tool: 'get_market_dcpi_rank', result: { market_slug: 'tucson', source_url: 'https://dchub.cloud/dcpi/tucson' } }] };
    const r = { content: [{ type: 'text', text: 'Gilbert leads.' }, { type: 'text', text: JSON.stringify(body) }], structuredContent: body };
    const s = JSON.stringify(H.withHeldDcpiLinks(r, { env: {} }));
    expect(JSON.stringify(r)).toMatch(HELD_LINK);
    expect(s).not.toMatch(HELD_LINK);
    expect(s).toContain('https://dchub.cloud/markets/tucson');
  });
  it('the cite_url_template points at /markets/{market_slug} when the answer names a held market, not otherwise', () => {
    const tpl = 'https://dchub.cloud/dcpi/{market_slug}';
    const held = H.withHeldDcpiLinks({ structuredContent: { market_slug: 'gilbert', provenance: { cite_url_template: tpl } } }, { env: {} });
    expect(held.structuredContent.provenance.cite_url_template).toBe('https://dchub.cloud/markets/{market_slug}');
    const open = { structuredContent: { market_slug: 'columbus', provenance: { cite_url_template: tpl } } };
    expect(H.withHeldDcpiLinks(open, { env: {} })).toBe(open);
  });
  it('never throws on odd input', () => {
    const cyc = { a: 1 }; cyc.self = cyc;
    expect(() => H.withHeldDcpiLinks(cyc, { env: {} })).not.toThrow();
    expect(H.withHeldDcpiLinks(null, { env: {} })).toBe(null);
  });
});

// ── 2. through the real tool handlers ─────────────────────────────────────────
const BASE = 'http://127.0.0.1:1';
const FIXTURE = {
  ok: true, success: true,
  candidates: [{ anchor: { state: 'AZ', display_name: 'Mesa 230kV' }, verdict: 'BUILD', lat: 33.4, lon: -111.8,
    market: { slug: 'gilbert', market: 'Gilbert', iso: 'WECC', verdict: 'BUILD', source_url: 'https://dchub.cloud/dcpi/gilbert' } }],
  market_verdict: { slug: 'goodyear', market: 'Goodyear', verdict: 'BUILD', source_url: 'https://dchub.cloud/dcpi/goodyear' },
  shortlist: [
    { slug: 'gilbert', market: 'Gilbert', state: 'AZ', iso: 'WECC', verdict: 'BUILD', dcpi_url: 'https://dchub.cloud/dcpi/gilbert' },
    { slug: 'dallas', market: 'Dallas', state: 'TX', iso: 'ERCOT', verdict: 'CAUTION', dcpi_url: 'https://dchub.cloud/dcpi/dallas' },
  ],
  markets: [{ slug: 'west-des-moines', market: 'West Des Moines', state: 'IA', iso: 'MISO', dcpi_url: 'https://dchub.cloud/dcpi/west-des-moines' }],
  results: [{ rank: 1, market: 'phoenix', state: 'AZ', url: 'https://dchub.cloud/dcpi/phoenix' }],
  market_slug: 'tucson', market_name: 'Tucson', state: 'AZ', verdict: 'BUILD', source_url: 'https://dchub.cloud/dcpi/tucson',
};
const CALLS = [
  ['find_sites', { state: 'AZ' }],
  ['analyze_site', { lat: 33.43, lon: -112.53, state: 'AZ' }],
  ['site_selection_canvas', { region: 'AZ' }],
  ['get_market_dcpi_rank', { market_slug: 'tucson' }],
  ['rank_markets', {}],
];
let S; let TOOLS; let realFetch;
const SEAT = { api_key: 'dch_live_hold_links_test', tier: 'pro', platform: 'claude', client_name_raw: 'claude-ai',
  session_id: 'sess-hold-links', client_ip: '203.0.113.9' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (p === '/api/v1/keys/validate') return json(200, { valid: true, tier: 'paid', developer_id: 'dev_hold', email: null, tier_detail: { users_plan: 'pro' } });
    if (p.startsWith('/api/')) return json(200, FIXTURE);
    return json(200, { ok: true });
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; });
afterEach(() => { delete process.env[KILL]; });

async function call(name, args) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}`);
  return S._ctxALS.run(SEAT, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}

describe('tool answers never carry a held /dcpi link', () => {
  it.each(CALLS)('%s', async (name, args) => {
    process.env[KILL] = '0';
    const off = JSON.stringify(await call(name, args));
    delete process.env[KILL];
    const on = JSON.stringify(await call(name, args));
    // Non-vacuous: with the step off, this tool passes at least one held link through to the agent.
    expect(off, `${name} off`).toMatch(HELD_LINK);
    expect(on, `${name} on`).not.toMatch(HELD_LINK);
    expect(on, `${name} on`).toMatch(/dchub\.cloud\/markets\/[a-z-]+/);
  });
  it('the step runs in the tool wrapper after every other output step', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const i = src.indexOf('_final = _withHeldDcpiLinks(_final);');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 80)).toMatch(/_withHeldDcpiLinks\(_final\);\s*return _final;/);
  });
});
