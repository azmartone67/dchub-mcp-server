// provenance-basis-class-every-tool.test.mjs: CM-1 "provenance on every number"
//
// The backend envelope (provenance_version 1) gains additive v1.1 fields:
// `basis_class` (measured | derived | estimated | published | cited | unknown),
// `provenance_revision: "1.1"` and an optional per-field `fields` map. This
// server must:
//   1. pass a valid backend class through untouched, and keep `fields`;
//   2. replace a missing or off-enum class with a conservative one ("unknown"
//      unless a backend block names it), never inventing an as_of;
//   3. carry structuredContent.provenance with a valid class and a non-empty
//      source on EVERY tool, including error, wall and preview results.
//
// Drives every registered tool in-process (createServer()._registeredTools)
// against a stubbed fetch that never leaves the process, at three seats:
// a keyed caller with a healthy backend, the same caller with a failing
// backend, and an anonymous caller (the gated / preview paths).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  BASIS_CLASSES, isBasisClass, stampEnvelopeAttribution, mergeProvenance, buildProvenance,
} from '../lib/attribution.mjs';
import { provenanceFooterLine } from '../lib/result-shaping.mjs';

const BASE = 'http://127.0.0.1:1';
const AS_OF = '2026-10-02T12:00:00Z';

// The helper every assertion below goes through. Returns the list of problems
// (empty = valid), so the must-fail controls can prove it rejects bad blocks.
function provenanceProblems(result) {
  const out = [];
  const sc = result && result.structuredContent;
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return ['no structuredContent'];
  const p = sc.provenance;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['no structuredContent.provenance'];
  if (!BASIS_CLASSES.includes(p.basis_class)) out.push(`basis_class ${JSON.stringify(p.basis_class)} not in enum`);
  if (typeof p.source !== 'string' || !p.source.trim()) out.push('source missing or empty');
  return out;
}

// ── must-fail controls for the helper itself ────────────────────────────────
describe('provenanceProblems rejects bad blocks (controls)', () => {
  const ok = { structuredContent: { provenance: { basis_class: 'measured', source: 'DC Hub' } } };
  it('accepts a valid block', () => { expect(provenanceProblems(ok)).toEqual([]); });
  it('rejects an off-enum class', () => {
    expect(provenanceProblems({ structuredContent: { provenance: { basis_class: 'guess', source: 'DC Hub' } } }))
      .toContain('basis_class "guess" not in enum');
  });
  it('rejects a missing class', () => {
    expect(provenanceProblems({ structuredContent: { provenance: { source: 'DC Hub' } } })).toHaveLength(1);
  });
  it('rejects a missing or empty source', () => {
    expect(provenanceProblems({ structuredContent: { provenance: { basis_class: 'unknown' } } }))
      .toContain('source missing or empty');
    expect(provenanceProblems({ structuredContent: { provenance: { basis_class: 'unknown', source: '  ' } } }))
      .toContain('source missing or empty');
  });
  it('rejects a result with no provenance or no structuredContent', () => {
    expect(provenanceProblems({ structuredContent: {} })).toEqual(['no structuredContent.provenance']);
    expect(provenanceProblems({ content: [] })).toEqual(['no structuredContent']);
  });
});

// ── the lib contract ────────────────────────────────────────────────────────
describe('basis_class in lib/attribution.mjs', () => {
  const wrap = (payload, extra = {}) => ({
    content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: { ...payload }, ...extra,
  });

  it('the enum is frozen and exactly the six contract values', () => {
    expect(Object.isFrozen(BASIS_CLASSES)).toBe(true);
    expect([...BASIS_CLASSES].sort()).toEqual(['cited', 'derived', 'estimated', 'measured', 'published', 'unknown']);
    expect(isBasisClass('guess')).toBe(false);
    expect(isBasisClass('measured')).toBe(true);
  });

  it('a valid backend class, as_of and fields survive into structuredContent.provenance', () => {
    const fields = { demand_mw: { basis_class: 'measured', source: 'ERCOT', as_of: AS_OF },
      reserve_mw: { basis_class: 'guess', source: 'ERCOT' } };
    const r = stampEnvelopeAttribution(wrap({ demand_mw: 61234.5,
      provenance: { provenance_version: 1, provenance_revision: '1.1', basis_class: 'measured',
        source: 'ERCOT via DC Hub', as_of: AS_OF, fields } }));
    const p = r.structuredContent.provenance;
    expect(p.basis_class).toBe('measured');
    expect(p.as_of).toBe(AS_OF);
    expect(p.provenance_version).toBe(1);
    expect(p.source).toBe('ERCOT via DC Hub');
    expect(p.fields.demand_mw).toEqual(fields.demand_mw);
    // an off-enum per-field class reads "unknown"; its as_of is not invented
    expect(p.fields.reserve_mw.basis_class).toBe('unknown');
    expect(p.fields.reserve_mw.as_of).toBeUndefined();
    // the content[] JSON carries the same block
    expect(JSON.parse(r.content[0].text).provenance.basis_class).toBe('measured');
  });

  it('an off-enum backend class is replaced with "unknown" and named, not kept', () => {
    const r = stampEnvelopeAttribution(wrap({ provenance: { basis_class: 'guess', source: 'x', as_of: AS_OF } }));
    expect(r.structuredContent.provenance.basis_class).toBe('unknown');
    expect(r.structuredContent.provenance.basis_class_rejected).toBe('guess');
  });

  it('no backend block and no timestamp: "unknown", as_of stays null (analyze_site anon shape)', () => {
    const r = stampEnvelopeAttribution(wrap({ _entity: 'site_analysis', score: 71.2, preview_is_partial: true }));
    const p = r.structuredContent.provenance;
    expect(p.as_of).toBeNull();
    expect(p.as_of_basis).toMatch(/UNMEASURED/);
    expect(p.basis_class).toBe('unknown');
    expect(p.provenance_revision).toBe('1.1');
  });

  it('a timestamp alone does not upgrade the class', () => {
    expect(buildProvenance({ as_of: AS_OF, value: 3 }).basis_class).toBe('unknown');
  });

  it('nested backend blocks: one class is read, disagreeing classes give "unknown"', () => {
    const step = (c) => ({ result: { provenance: { basis_class: c, source: 's', as_of: AS_OF } } });
    expect(buildProvenance({ executed: [step('published'), step('published')] }).basis_class).toBe('published');
    expect(buildProvenance({ executed: [step('measured'), step('estimated')] }).basis_class).toBe('unknown');
  });

  it('an empty backend source falls back to the attribution source', () => {
    const merged = mergeProvenance({ source: '', basis_class: 'cited' }, buildProvenance({}));
    expect(merged.source).toBe('DC Hub');
    expect(merged.basis_class).toBe('cited');
  });

  it('an isError result gets provenance on structuredContent, content text unchanged', () => {
    const text = 'Unknown ISO "XYZ". Valid: PJM, ERCOT, CAISO.';
    const r = stampEnvelopeAttribution({ isError: true, content: [{ type: 'text', text }] });
    expect(r.content[0].text).toBe(text);
    expect(r.structuredContent.error).toBe(text);
    expect(provenanceProblems(r)).toEqual([]);
    expect(r.structuredContent.provenance.basis_class).toBe('unknown');
    // an existing error structuredContent keeps its keys
    const r2 = stampEnvelopeAttribution({ isError: true, content: [{ type: 'text', text: '{"error":"API 500"}' }],
      structuredContent: { error: 'API 500', _error_mitigation: { retry: true } } });
    expect(r2.structuredContent.error).toBe('API 500');
    expect(r2.structuredContent._error_mitigation).toEqual({ retry: true });
    expect(provenanceProblems(r2)).toEqual([]);
  });

  it('the footer names the class only when the backend gave a valid one', () => {
    expect(provenanceFooterLine({ as_of: '2026-10-02', basis_class: 'measured' }))
      .toBe('\u{1F4CE} provenance: as_of 2026-10-02 · basis measured');
    expect(provenanceFooterLine({ as_of: '2026-10-02', basis_class: 'guess' }))
      .toBe('\u{1F4CE} provenance: as_of 2026-10-02');
  });
});

// ── every tool, through the real registered handler chain ──────────────────
let S, TOOLS, realFetch;
let mode = 'ok';                 // 'ok' | 'fail'
let backendClass = 'measured';   // class the stub's provenance block carries
const BLOCKED = [];

const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: `fac_${i}`, name: `Site ${i}`, market: 'dallas', iso: 'ERCOT', state: 'TX', capacity_mw: 100 + i,
  power_mw: 50 + i, score: 70 + i, dcpi_score: 60 + i, lat: 32.7 + i / 100, lon: -96.8, lng: -96.8,
}));
function okBody() {
  return {
    ok: true, success: true, count: ROWS.length, total: ROWS.length, data: ROWS, results: ROWS, markets: ROWS,
    facilities: ROWS, projects: ROWS, items: ROWS, iso: 'ERCOT', demand_mw: 61234.5, as_of: AS_OF,
    provenance: { provenance_version: 1, provenance_revision: '1.1', basis_class: backendClass,
      source: 'DC Hub backend', as_of: AS_OF },
  };
}
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

const SAMPLE = {
  iso: 'ERCOT', region_iso: 'ERCOT', market: 'dallas', market_slug: 'dallas', metro: 'dallas', state: 'TX',
  country: 'US', lat: 32.78, lon: -96.8, lng: -96.8, latitude: 32.78, longitude: -96.8,
  query: 'data center dallas', q: 'data center dallas', question: 'best market for 100MW',
  intent: 'find a site for 100MW in Texas', topic: 'power', goal: 'find power for 100MW',
  email: 'provenance-test@example.com', facility_id: 'fac_1', id: 'fac_1', site_id: 'site_1', name: 'Sweep',
  capacity_mw: 100, target_mw: 200, mw: 100, horizon_months: 18, url: 'https://dchub.cloud/facility/1',
  text: 'sample text', dataset: 'facilities', format: 'json', scenario: 'add 500MW', tool: 'get_grid_scoreboard',
  listing_id: 'lst_1', intent_id: 'int_1', shortlist_id: 'sl_1', market_a: 'dallas', market_b: 'phoenix',
  address: '1 Main St, Dallas TX', company: 'Equinix', operator: 'Equinix', city: 'Dallas', fuel: 'gas',
};
function sampleFor(name, prop) {
  if (prop && prop.enum && prop.enum.length) return prop.enum[0];
  if (name in SAMPLE) return (prop && prop.type === 'array') ? [SAMPLE[name]] : SAMPLE[name];
  if (!prop) return 'x';
  if (prop.type === 'number' || prop.type === 'integer') return 1;
  if (prop.type === 'boolean') return false;
  if (prop.type === 'array') {
    const it2 = prop.items || {};
    if (it2.type === 'object') {
      const o = {}; for (const [k, p] of Object.entries(it2.properties || {})) o[k] = sampleFor(k, p);
      return [o, { ...o, lat: 33.45, lon: -112.07, lng: -112.07, name: 'B', market: 'phoenix' }];
    }
    if (/site|market|iso/i.test(name)) return /iso/i.test(name) ? ['PJM', 'ERCOT'] : ['dallas', 'phoenix'];
    return ['a', 'b'];
  }
  if (prop.type === 'object') {
    const o = {};
    for (const [k, p] of Object.entries(prop.properties || {})) if ((prop.required || []).includes(k)) o[k] = sampleFor(k, p);
    return o;
  }
  return 'dallas';
}
function argsFor(name, json) {
  const props = json.properties || {};
  const a = {};
  for (const k of json.required || []) a[k] = sampleFor(k, props[k]);
  for (const k of ['iso', 'market', 'state', 'lat', 'lon']) {
    if (props[k] && !(k in a)) a[k] = sampleFor(k, props[k]);
  }
  if (name === 'get_facility') a.facility_id = 'fac_1';
  if (name === 'compare_isos') a.isos = 'PJM,ERCOT,CAISO';
  if (name === 'compare_sites') { a.locations = '33.45,-112.07;39.04,-77.48'; delete a.sites; }
  return a;
}

const KEYED = { api_key: 'dch_live_provenance_cm1_test', tier: 'pro', platform: 'claude',
  client_name_raw: 'claude-ai', session_id: 'sess-cm1-keyed', client_ip: '203.0.113.21' };
const ANON = { api_key: null, tier: 'anonymous', platform: 'claude',
  client_name_raw: 'claude-ai', session_id: 'sess-cm1-anon', client_ip: '203.0.113.22' };

// A fresh session and IP per call: one session sweeping every tool is exactly
// what the anonymous scraper block refuses, and that refusal would then stand
// in for every tool's real answer.
let CALL_N = 0;
async function call(name, args, seat) {
  CALL_N += 1;
  seat = { ...seat, session_id: `${seat.session_id}-${CALL_N}`, client_ip: `198.51.100.${CALL_N % 250 + 1}` };
  const T = TOOLS[name];
  let parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues).slice(0, 300)}`);
  return S._ctxALS.run({ ...seat }, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    if (!url.startsWith(BASE)) {
      // loopback self-calls (execute_plan's own /mcp) fail closed; anything
      // else is a fence breach
      if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) BLOCKED.push(url.slice(0, 120));
      return json(503, { ok: false, error: 'fenced' });
    }
    let pathname = '';
    try { pathname = new URL(url).pathname; } catch { /* not a URL */ }
    if (pathname === '/api/v1/keys/validate') return json(200, { valid: true, tier: 'pro', developer_id: 'dev_cm1' });
    if (pathname.startsWith('/api/v1/mcp/') && !pathname.startsWith('/api/v1/mcp/tools/')) return json(200, { ok: true });
    if (mode === 'fail') return json(500, { ok: false, error: 'upstream fixture failure' });
    return json(200, okBody());
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);

afterAll(() => { globalThis.fetch = realFetch; });

async function sweep(seat) {
  const { z } = await import('zod');
  const rows = [];
  for (const name of Object.keys(TOOLS).sort()) {
    const json = z.toJSONSchema(TOOLS[name].inputSchema, { io: 'input', unrepresentable: 'any' });
    let r;
    try { r = await call(name, argsFor(name, json), seat); } catch (e) { r = { threw: String(e && e.message || e) }; }
    rows.push({ name, r, problems: r.threw ? [`threw: ${r.threw}`] : provenanceProblems(r) });
  }
  return rows;
}

describe('every registered tool carries structuredContent.provenance (CM-1)', () => {
  it('the manifest is the full tool surface, not a handful', () => {
    expect(Object.keys(TOOLS).length).toBeGreaterThanOrEqual(80);
  });

  it('normal results: keyed caller, healthy backend', async () => {
    mode = 'ok'; backendClass = 'measured';
    const rows = await sweep(KEYED);
    expect(rows.filter((x) => x.problems.length).map((x) => `${x.name}: ${x.problems.join('; ')}`)).toEqual([]);
    // floor: the backend class really reaches most tools, so the sweep is not
    // passing on "unknown" alone
    const passed = rows.filter((x) => x.r.structuredContent?.provenance?.basis_class === 'measured').length;
    expect(passed).toBeGreaterThanOrEqual(40);
  }, 180_000);

  it('error results: keyed caller, every backend answers 500', async () => {
    mode = 'fail';
    const rows = await sweep(KEYED);
    mode = 'ok';
    expect(rows.filter((x) => x.problems.length).map((x) => `${x.name}: ${x.problems.join('; ')}`)).toEqual([]);
    expect(rows.filter((x) => x.r.isError === true).length).toBeGreaterThanOrEqual(20);
  }, 180_000);

  it('gated / preview results: anonymous caller', async () => {
    mode = 'ok'; backendClass = 'estimated';
    const rows = await sweep(ANON);
    backendClass = 'measured';
    expect(rows.filter((x) => x.problems.length).map((x) => `${x.name}: ${x.problems.join('; ')}`)).toEqual([]);
    const gated = rows.filter((x) => x.r.isError === true
      || x.r.structuredContent?.provenance?.completeness === 'partial_preview').length;
    expect(gated).toBeGreaterThanOrEqual(10);
  }, 180_000);

  it('nothing tried to leave the process', () => { expect(BLOCKED).toEqual([]); });
});

describe('acceptance targets', () => {
  it('get_interconnection_queue (ERCOT) keeps the backend class and as_of', async () => {
    mode = 'ok'; backendClass = 'published';
    const r = await call('get_interconnection_queue', { iso: 'ERCOT' }, KEYED);
    backendClass = 'measured';
    expect(provenanceProblems(r)).toEqual([]);
    expect(r.structuredContent.provenance.basis_class).toBe('published');
    expect(r.structuredContent.provenance.as_of).toBe(AS_OF);
  });

  it('get_grid_data keeps the backend class', async () => {
    mode = 'ok'; backendClass = 'measured';
    const r = await call('get_grid_data', { iso: 'ERCOT' }, KEYED);
    expect(provenanceProblems(r)).toEqual([]);
    expect(r.structuredContent.provenance.basis_class).toBe('measured');
  });

  it('get_market_dcpi_rank carries a valid class on the keyed and anonymous paths', async () => {
    mode = 'ok'; backendClass = 'derived';
    const keyed = await call('get_market_dcpi_rank', { market_slug: 'dallas' }, KEYED);
    const anon = await call('get_market_dcpi_rank', { market_slug: 'dallas' }, ANON);
    backendClass = 'measured';
    expect(provenanceProblems(keyed)).toEqual([]);
    expect(keyed.structuredContent.provenance.basis_class).toBe('derived');
    expect(provenanceProblems(anon)).toEqual([]);
  });

  it('analyze_site (anon) never drops provenance and never claims a class it was not given', async () => {
    mode = 'ok';
    const r = await call('analyze_site', { lat: 32.78, lon: -96.8, state: 'TX' }, ANON);
    expect(provenanceProblems(r)).toEqual([]);
    const p = r.structuredContent.provenance;
    if (p.as_of === null) expect(p.basis_class).toBe('unknown');
    else expect(['measured', 'unknown']).toContain(p.basis_class);
  });

  it('a backend "guess" is rejected end to end', async () => {
    mode = 'ok'; backendClass = 'guess';
    const r = await call('get_grid_data', { iso: 'ERCOT' }, KEYED);
    backendClass = 'measured';
    expect(provenanceProblems(r)).toEqual([]);
    expect(r.structuredContent.provenance.basis_class).toBe('unknown');
  });
});
