// get_site_context (Brain 2026-11-25): the neighborhood around a point as its own tool, behind
// DCHUB_MCP_GET_SITE_CONTEXT (default OFF). It returns exactly what analyze_site embeds as
// `site_context` (same helper, same preview-vs-full choice); execute_plan routes "what is around
// this point" to it and keeps a score / "should I build here" ask on analyze_site. The facility
// ownership trio from the backend passes through get_facility / search_facilities / get_pipeline.
// Real server.mjs app on loopback, stub backend; no network, no disk writes.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const FLAG = 'DCHUB_MCP_GET_SITE_CONTEXT';
const TOOL = 'get_site_context';
const FREE_KEY = 'dch_trial_SITECTXtool0123456789abcdef';
const UA = { 'user-agent': 'Claude-User' };
const PT = { lat: 39.0438, lon: -77.4874 };
const SECRETS = ['LOUDOUN 500', 'Dominion Energy', 'Zayo Group'];
const FULL_SC = {
  ok: true, lat: PT.lat, lng: PT.lon, as_of: '2026-11-25T12:00:00Z', errors: {},
  substation: { name: 'LOUDOUN 500', voltage: '500 kV', distance_km: 1.2, source: 'HIFLD', as_of: '2026-10-14' },
  transmission_line: { available: true, distance_km: 1.8, voltage_kv: 500, owner: 'Dominion Energy', source: 'HIFLD', as_of: '2026-10-14' },
  carriers_in_building: { carriers: ['Zayo Group'], source: 'PeeringDB' },
};
const PREVIEW_SC = {
  ok: true, view: 'preview', as_of: '2026-11-25T12:00:00Z',
  blocks: [
    { key: 'substation', title: 'Substation and queue', status: 'answered', sources: ['HIFLD Electric Substations'] },
    { key: 'transmission_line', title: 'Nearest transmission line', status: 'answered', sources: ['HIFLD'] },
    { key: 'rail', title: 'Rail', status: 'not_available', reason: 'not covered here', sources: [] },
  ],
  answered_count: 2, blocks_count: 3,
};
const OWNERSHIP = {
  operator: { value: 'Equinix', status: 'in_record', source_url: 'https://example.test/equinix', as_of: '2026-03-30' },
  owner: { value: null, status: 'not_in_record', source_url: null, as_of: null },
  developer: { value: 'Example Developer', status: 'in_record', source_url: 'https://example.test/dev', as_of: '2026-02-01' },
  basis: 'operator is the provider on the row; developer is a developer alias with its own source.',
};
const FAC_ROW = { id: 7, name: 'Equinix DC99', slug: 'equinix-dc99-ashburn', city: 'Ashburn', state: 'VA', country: 'US',
  operator: 'Equinix', power_mw: 40, ownership: OWNERSHIP };
const SCORE = { success: true, location: { lat: PT.lat, lon: PT.lon, state: 'VA' }, overall_score: 81.5, verdict: 'BUILD' };

let H, fence, S;
const scAsks = [];
let scoreAsks = 0;
let scMode = 'honest';

async function settle(quietMs = 300, maxMs = 8000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call(name, args, key) {
  const hdr = { ...UA, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init('/mcp', 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  const before = scAsks.length;
  const r = await H.call('/mcp', name, args, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const res = (r.msg && r.msg.result) || {};
  let body = null;
  try { body = JSON.parse(((res.content || [])[0] || {}).text || 'null'); } catch (_) { body = null; }
  return { res, body, text: (res.content || []).map((x) => x.text || '').join('\n'), asks: scAsks.slice(before) };
}
// The server stamps its own envelope keys (provenance, _source, cite_as ...) on every result; the
// backend body is the rest, compared key for key.
const pick = (o, ref) => Object.fromEntries(Object.keys(ref).map((k) => [k, o ? o[k] : undefined]));
const leaks = (r) => SECRETS.filter((s) => JSON.stringify(r.res || {}).includes(s));
async function listTools(flag) {
  if (flag === undefined) delete process.env[FLAG]; else process.env[FLAG] = flag;
  try {
    const srv = S.createServer();
    const client = new Client({ name: 'site-context-list-test', version: '0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([srv.connect(st), client.connect(ct)]);
    const { tools } = await client.listTools();
    await client.close();
    return tools;
  } finally { process.env[FLAG] = '1'; }
}
// Every ownership object anywhere in a value.
function ownershipsIn(x, out = []) {
  if (Array.isArray(x)) { for (const v of x) ownershipsIn(v, out); return out; }
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) { if (k === 'ownership') out.push(v); else ownershipsIn(v, out); }
  }
  return out;
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { [FLAG]: '1' },
    extraRoutes: (p, req, body, u) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/mcp/lp-free-runs') return { ok: true, allowed: false, used: 3, limit: 3, remaining: 0 };
      if (p === '/api/v1/land-power/site-context') {
        const view = u.searchParams.get('view');
        scAsks.push({ view, lat: u.searchParams.get('lat'), lng: u.searchParams.get('lng') });
        if (scMode === 'down') return { status: 503, body: { error: 'down' } };
        if (scMode === 'always_full') return { ...FULL_SC };
        return view === 'preview' ? { ...PREVIEW_SC } : { ...FULL_SC };
      }
      if (p === '/api/site-score') { scoreAsks += 1; return { ...SCORE }; }
      if (p === '/api/v1/facilities') return { facilities: [{ ...FAC_ROW }], count: 1 };
      if (p.startsWith('/api/v1/facilities/')) return { data: { ...FAC_ROW } };
      if (p.startsWith('/api/v1/facility/')) return { data: { name: FAC_ROW.name } };
      if (p === '/api/v1/pipeline') {
        return { projects: [{ name: 'Stargate Abilene', developer: 'Example Developer', state: 'TX', status: 'construction', ownership: OWNERSHIP }],
          name_lookup: { matched: true } };
      }
      return undefined;
    },
  });
  S = H.S;
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); delete process.env[FLAG]; });
beforeEach(() => { scMode = 'honest'; process.env[FLAG] = '1'; delete process.env.DCHUB_SITE_CONTEXT; });

describe('registration follows DCHUB_MCP_GET_SITE_CONTEXT', () => {
  it('reads the flag strictly (default OFF)', () => {
    expect(S._getSiteContextToolOn({})).toBe(false);
    expect(S._getSiteContextToolOn({ [FLAG]: '0' })).toBe(false);
    expect(S._getSiteContextToolOn({ [FLAG]: 'off' })).toBe(false);
    expect(S._getSiteContextToolOn({ [FLAG]: '1' })).toBe(true);
    expect(S._getSiteContextToolOn({ [FLAG]: 'on' })).toBe(true);
    // the site-context kill switch takes the tool away with the read
    expect(S._getSiteContextToolOn({ [FLAG]: '1', DCHUB_SITE_CONTEXT: '0' })).toBe(false);
  });

  it('flag off: the tool is absent, and tools/list is the flag-on list minus that one entry, byte for byte', async () => {
    const off = await listTools(undefined);
    const on = await listTools('1');
    expect(off.map((t) => t.name)).not.toContain(TOOL);
    expect(on.map((t) => t.name)).toContain(TOOL);
    expect(off.length).toBeGreaterThan(50);
    expect(JSON.stringify(off)).toBe(JSON.stringify(on.filter((t) => t.name !== TOOL)));
    // and '0' is off too
    expect((await listTools('0')).map((t) => t.name)).not.toContain(TOOL);
  });

  it('flag on: lat/lon plus the lng / longitude / latitude aliases are declared; the description names no plan or price', async () => {
    const t = (await listTools('1')).find((x) => x.name === TOOL);
    expect(Object.keys(t.inputSchema.properties)).toEqual(expect.arrayContaining(['lat', 'lon', 'lng', 'longitude', 'latitude']));
    expect(t.annotations.readOnlyHint).toBe(true);
    expect(t.description).toMatch(/not a score/);
    expect(t.description).toContain('analyze_site');
    expect(t.description).not.toMatch(/\$\d|\bprice|\bpricing|\b(Pro|Developer|Starter|Enterprise|Founding)\b|\bplan\b|subscri|upgrade|trial/i);
  });
});

describe('get_site_context: same body and same gating as analyze_site.site_context', () => {
  it('Pro gets the full body; the backend is asked without view, at the point', async () => {
    const r = await call(TOOL, PT, PRO_KEY);
    expect(r.asks).toEqual([{ view: null, lat: String(PT.lat), lng: String(PT.lon) }]);
    // GDL 2026-11-26 item 3: as_of is the Phoenix data day; the read stamp moves to retrieved_at.
    const FULL_DAY = { ...FULL_SC, view: 'full', as_of: '2026-11-25', retrieved_at: '2026-11-25T12:00:00Z' };
    expect(pick(r.body, FULL_DAY)).toEqual(FULL_DAY);
    expect(r.body.as_of).not.toMatch(/Z$/);
  });

  it('lng and longitude aliases reach the backend as the same point', async () => {
    for (const args of [{ lat: PT.lat, lng: PT.lon }, { latitude: PT.lat, longitude: PT.lon }]) {
      const r = await call(TOOL, args, PRO_KEY);
      expect(r.asks).toHaveLength(1);
      expect(Number(r.asks[0].lat)).toBeCloseTo(PT.lat, 4);
      expect(Number(r.asks[0].lng)).toBeCloseTo(PT.lon, 4);
      expect(r.body && r.body.view).toBe('full');
    }
  });

  it('a free key and a keyless caller get only the preview, with a line that names no plan or price', async () => {
    for (const key of [FREE_KEY, null]) {
      const r = await call(TOOL, PT, key);
      expect(r.asks.map((a) => a.view)).toEqual(['preview']);
      const PREVIEW_DAY = { ...PREVIEW_SC, as_of: '2026-11-25', retrieved_at: '2026-11-25T12:00:00Z' };
      expect(pick(r.body, PREVIEW_DAY)).toEqual(PREVIEW_DAY);
      expect(r.text).not.toMatch(/\$\d|\bpric(?:e|ing)\b|\b(Pro|Developer|Starter|Enterprise|Founding)\b|\bplan\b|upgrade|subscri/i);
      expect(r.text).toContain(S.SITE_CONTEXT_PREVIEW_NOTE);
      expect(leaks(r)).toEqual([]);
    }
    expect(S.SITE_CONTEXT_PREVIEW_NOTE).not.toMatch(/\$\d|\bprice|\b(Pro|Developer|Starter|Enterprise|Founding)\b|\bplan\b|upgrade/i);
  });

  it('the view matches analyze_site\'s embedded site_context for the same caller', async () => {
    for (const key of [PRO_KEY, FREE_KEY]) {
      const a = await call('analyze_site', PT, key);
      const g = await call(TOOL, PT, key);
      const embedded = (a.res.structuredContent && a.res.structuredContent.site_context) || (a.body && a.body.site_context);
      expect(embedded, `analyze_site embedded site_context for ${key}`).toBeDefined();
      expect(pick(g.body, embedded)).toEqual(embedded);
      expect(g.asks.map((x) => x.view)).toEqual(a.asks.map((x) => x.view));
    }
  });

  it('a full body sent to a preview caller is dropped, never served', async () => {
    scMode = 'always_full';
    const r = await call(TOOL, PT, FREE_KEY);
    expect(r.body && r.body.available).toBe(false);
    expect(leaks(r)).toEqual([]);
  });

  it('a backend failure is a stated gap, not an invented answer', async () => {
    scMode = 'down';
    const r = await call(TOOL, PT, PRO_KEY);
    expect(r.body).toMatchObject({ available: false });
    expect(r.body.reason).toMatch(/did not answer/);
  });

  it('a call without a point is refused, the backend not asked', async () => {
    const r = await call(TOOL, { lat: PT.lat }, PRO_KEY);
    expect(r.res.isError).toBe(true);
    expect(r.asks).toHaveLength(0);
  });
});

describe('execute_plan routing', () => {
  const NEIGHBORHOOD = [
    "What's around this site at 39.0438,-77.4874?",
    'neighborhood around 39.0438, -77.4874',
    'nearby infrastructure at 39.0438,-77.4874',
    'What infrastructure is near 39.0438,-77.4874?',
  ];
  const SCORING = ['Score 39.0438,-77.4874 for 100 MW', 'Should I build a data center at 39.0438,-77.4874?',
    "What's around 39.0438,-77.4874 and should I build here?"];

  it('flag on: a neighborhood ask plans get_site_context alone; a score ask keeps analyze_site', () => {
    for (const q of NEIGHBORHOOD) {
      const p = S._planQuery(q);
      expect(p.recommended_sequence.map((s) => s.tool), q).toEqual([TOOL]);
      expect(p.recommended_sequence[0].args_hint).toEqual({ lat: 39.0438, lon: -77.4874 });
      expect(p.alternatives[0].tool).toBe('analyze_site');
    }
    for (const q of SCORING) {
      const p = S._planQuery(q);
      expect(p.recommended_sequence[0].tool, q).toBe('analyze_site');
      expect(JSON.stringify(p.recommended_sequence)).not.toContain(TOOL);
    }
    // No user point (a county centroid only): not the neighborhood of their site.
    expect(S._planQuery('nearby infrastructure for a site in Loudoun County VA').recommended_sequence[0].tool).not.toBe(TOOL);
  });

  it('a directory surface that does not list the tool keeps the plan it had', () => {
    const base = S._planQuery(NEIGHBORHOOD[0]);
    expect(base.recommended_sequence[0].tool).toBe(TOOL);
    for (const profile of ['claude_directory', 'chatgpt_directory']) {
      expect(S._execStepAllowed(TOOL, profile), profile).toBe(false);
      const p = S._ctxALS.run({ profile }, () => S._planQuery(NEIGHBORHOOD[0]));
      expect(p.recommended_sequence[0].tool, profile).toBe('analyze_site');
      expect(JSON.stringify(p.recommended_sequence), profile).not.toContain(TOOL);
    }
  });

  it('flag off: every plan is the one it was (analyze_site leads, get_site_context nowhere)', () => {
    const on = NEIGHBORHOOD.map((q) => S._planQuery(q));
    delete process.env[FLAG];
    try {
      for (const q of [...NEIGHBORHOOD, ...SCORING]) {
        const p = S._planQuery(q);
        expect(p.recommended_sequence[0].tool, q).toBe('analyze_site');
        expect(JSON.stringify(p)).not.toContain(TOOL);
      }
      expect(S._execStepAllowed(TOOL, undefined)).toBe(false);
    } finally { process.env[FLAG] = '1'; }
    expect(on.length).toBe(NEIGHBORHOOD.length);
    expect(S._execStepAllowed(TOOL, undefined)).toBe(true);
  });

  it('execute_plan runs get_site_context for a neighborhood ask and analyze_site for a score ask', async () => {
    const before = scoreAsks;
    const n = await call('execute_plan', { intent: NEIGHBORHOOD[0] }, PRO_KEY);
    expect(n.asks.length, 'the site-context backend was read').toBeGreaterThanOrEqual(1);
    expect(n.asks.map((a) => a.view)).toContain(null);
    expect(scoreAsks - before, 'no site score for a neighborhood ask').toBe(0);
    const exec = (n.body && n.body.executed) || (n.res.structuredContent && n.res.structuredContent.executed) || [];
    const ran = exec.find((e) => e.tool === TOOL);
    expect(ran, JSON.stringify(exec).slice(0, 400)).toBeDefined();
    expect(ran.status).not.toBe('not_allowed');

    const s0 = scoreAsks;
    await call('execute_plan', { intent: SCORING[0] }, PRO_KEY);
    expect(scoreAsks - s0, 'the score ask read the site score').toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe('ownership passes through untouched', () => {
  it('search_facilities, get_facility and get_pipeline name= keep the backend ownership trio on every seat', async () => {
    for (const key of [null, FREE_KEY, PRO_KEY]) {
      const runs = [
        await call('search_facilities', { query: 'Equinix Ashburn' }, key),
        await call('get_facility', { slug: FAC_ROW.slug }, key),
        await call('get_pipeline', { name: 'Stargate Abilene' }, key),
      ];
      for (const [i, r] of runs.entries()) {
        const found = ownershipsIn([r.body, r.res.structuredContent]);
        expect(found.length, `tool ${i} seat ${key}`).toBeGreaterThan(0);
        for (const o of found) expect(o, `tool ${i} seat ${key}`).toEqual(OWNERSHIP);
      }
    }
  }, 60_000);
});
