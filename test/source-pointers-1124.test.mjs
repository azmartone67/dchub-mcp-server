// source-pointers-1124.test.mjs — Grok spec item 7 (DCHUB_SOURCE_POINTERS_V1, default OFF): dated public source
// pointers for flood, broadband and water in the execute_plan lead, and the weekly link check that keeps them dated.
// Pure; no network (the link check runs on a stubbed fetch). End to end on a real server.mjs:
// test/source-pointers-e2e-1124.test.mjs.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planLeadText, planLeadStep } from '../lib/plan-lead-text.mjs';
import { pointerSentences, usablePointers, sourcePointersOn, loadSourcePointers, POINTERS_FILE,
  _resetSourcePointersCache } from '../lib/source-pointers.mjs';
import { checkUrl, applyResults, main as linkCheck } from '../scripts/check-source-pointers.mjs';

const ON = { DCHUB_SOURCE_POINTERS_V1: '1' };
const OFF = {};
const DEAD_END = /no figure in them could be summarised/;
const LIST = [
  { topic: 'flood', label: 'FEMA National Flood Hazard Layer', url: 'https://msc.fema.gov/portal/search', publisher: 'FEMA', checked_on: '2026-11-24', fail_count: 0 },
  { topic: 'broadband', label: 'FCC National Broadband Map', url: 'https://broadbandmap.fcc.gov/', publisher: 'FCC', checked_on: '2026-11-24', fail_count: 0 },
  { topic: 'water', label: 'USGS Water Data for the Nation', url: 'https://waterdata.usgs.gov/', publisher: 'USGS', checked_on: '2026-11-24', fail_count: 0 },
];
const P = () => usablePointers(LIST);
const step = (tool, args = { lat: 39.0127, lon: -77.4615 }) => ({ tool, args, status: 'executed', result: {} });
const plan = (intent, tools, extra = {}) => ({ _entity: 'plan_execution', intent, executed: tools.map((t) => step(t)), ...extra });
const LOUDOUN = 'Loudoun County VA';
const ADDR = '21155 Smith Switch Rd, Ashburn, Loudoun County VA (39.0127, -77.4615)';

afterEach(() => { vi.restoreAllMocks(); _resetSourcePointersCache(); });

describe('the flag', () => {
  it('default OFF; on only for 1/true/yes/on', () => {
    expect(sourcePointersOn({})).toBe(false);
    expect(sourcePointersOn({ DCHUB_SOURCE_POINTERS_V1: '0' })).toBe(false);
    for (const v of ['1', 'true', 'ON', 'yes']) expect(sourcePointersOn({ DCHUB_SOURCE_POINTERS_V1: v })).toBe(true);
  });
});

describe('flag on: no figure -> the dated pointer, never the dead-end line', () => {
  const CASES = [
    ['flood', `flood zone at ${ADDR}`, ['get_disaster_risk'],
      "Flood zone not summarised here. Check FEMA's National Flood Hazard Layer for this location: https://msc.fema.gov/portal/search?AddressQuery=39.0127%2C-77.4615 (FEMA, public data; pointer checked 2026-11-24)."],
    ['broadband', `broadband availability at ${ADDR}`, ['discover_tools'],
      'Fixed broadband availability: FCC National Broadband Map, https://broadbandmap.fcc.gov/ (FCC, public data; pointer checked 2026-11-24).'],
    ['water', `surface water and groundwater in ${LOUDOUN}`, ['get_water_risk'],
      'Surface and groundwater data: USGS Water Data for the Nation, https://waterdata.usgs.gov/ (USGS, public data; pointer checked 2026-11-24).'],
  ];
  for (const [topic, intent, tools, sentence] of CASES) {
    it(`${topic}: the lead opens with the pointer sentence`, () => {
      const pl = plan(intent, tools);
      const off = planLeadText(pl, { env: OFF, pointers: P() });
      expect(off).toMatch(DEAD_END);                      // the defect, flag off
      const on = planLeadText(pl, { env: ON, pointers: P() });
      expect(on).not.toMatch(DEAD_END);
      expect(on.startsWith(sentence)).toBe(true);
      expect(on.length).toBeLessThanOrEqual(600);
      expect(on).not.toMatch(/\b(partner|integrated with|powered by)\b/i);
    });
  }
  it('a county ask (no point given) links the FEMA search page bare, never a minted centroid', () => {
    const pl = { _entity: 'plan_execution', intent: `Is ${LOUDOUN} in a FEMA flood zone?`, executed: [step('get_disaster_risk', { lat: 39.09, lon: -77.64 })] };
    const on = planLeadText(pl, { env: ON, pointers: P() });
    expect(on).toContain('this location: https://msc.fema.gov/portal/search (FEMA');
    expect(on).not.toContain('AddressQuery');
  });
});

describe('flag on: a figure held -> the figure leads, the pointer follows as "Verify at"', () => {
  it('water figure first, then "Verify at https://waterdata.usgs.gov/"', () => {
    // The step's own headline figure (lib/plan-step-facts.mjs tasteFacts), as a full-depth get_water_risk returns it.
    const pl = plan(`water risk at ${ADDR}`, []);
    pl.executed = [{ ...step('get_water_risk'), result: { taste: { headline: { name: 'water_stress', value: 'Low', as_of: '2026-11-20' } } } }];
    const on = planLeadText(pl, { env: ON, pointers: P() });
    const off = planLeadText(pl, { env: OFF, pointers: P() });
    const figure = off.slice(0, off.indexOf(' Source: DC Hub'));
    expect(figure).toMatch(/Low/);
    expect(on.startsWith(figure)).toBe(true);
    expect(on).toContain(`${figure} Verify at https://waterdata.usgs.gov/ (USGS, public data; pointer checked 2026-11-24).`);
    expect(on).not.toContain('Surface and groundwater data:');
  });
  it('a headline with no flood figure keeps its figure and adds the flood pointer after it', () => {
    const pl = plan(`flood zone at ${ADDR}`, ['analyze_site', 'get_disaster_risk'],
      { intent_answer: { headline: 'Site read at 39.0127, -77.4615 (analyze_site): BUILD (as of 2026-11-24)' } });
    const on = planLeadText(pl, { env: ON, pointers: P() });
    expect(on.startsWith('Site read at 39.0127, -77.4615 (analyze_site): BUILD')).toBe(true);
    expect(on).toContain('Flood zone not summarised here.');
    expect(on).toContain('pointer checked 2026-11-24');
  });
});

describe('flag off = unchanged', () => {
  it('planLeadText with the flag off equals the call without options (byte for byte), on every case', () => {
    for (const pl of [plan(`flood zone at ${ADDR}`, ['get_disaster_risk']), plan('broadband in Loudoun County VA', ['discover_tools']),
      plan(`water risk at ${ADDR}`, ['get_water_risk'], { facts: [{ tool: 'get_water_risk', text: 'x water stress: Low (DC Hub, as of 2026-11-20).' }] })]) {
      const prev = process.env.DCHUB_SOURCE_POINTERS_V1;
      delete process.env.DCHUB_SOURCE_POINTERS_V1;
      try {
        const base = planLeadText(pl);
        expect(planLeadText(pl, { env: OFF, pointers: P() })).toBe(base);
        expect(base).not.toMatch(/pointer checked|Verify at/);
      } finally { if (prev !== undefined) process.env.DCHUB_SOURCE_POINTERS_V1 = prev; }
    }
  });
  it('planLeadStep passes its env through', () => {
    const pl = plan(`flood zone at ${ADDR}`, ['get_disaster_risk']);
    const res = { content: [{ type: 'text', text: JSON.stringify(pl) }], structuredContent: pl };
    expect(planLeadStep(res, { env: OFF }).content[0].text).toMatch(DEAD_END);
    expect(planLeadStep(res, { env: ON }).content[0].text).toMatch(/^Flood zone not summarised here\./);
  });
});

describe('the pointer list', () => {
  it('a pointer that failed twice in a row is dropped from answers and logged; once is kept', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = usablePointers(LIST.map((p) => (p.topic === 'water' ? { ...p, fail_count: 2 } : p.topic === 'flood' ? { ...p, fail_count: 1 } : p)));
    expect(m.has('water')).toBe(false);
    expect(m.has('flood')).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/dropped the water pointer \(https:\/\/waterdata\.usgs\.gov\/\): it failed 2 link checks/));
    const on = planLeadText(plan(`water risk at ${ADDR}`, ['get_water_risk']), { env: ON, pointers: m });
    expect(on).not.toContain('waterdata.usgs.gov');
  });
  it('an undated or non-https pointer is never used', () => {
    expect(usablePointers([{ ...LIST[0], checked_on: '' }]).size).toBe(0);
    expect(usablePointers([{ ...LIST[0], checked_on: 'last week' }]).size).toBe(0);
    expect(usablePointers([{ ...LIST[0], url: 'http://msc.fema.gov/portal/search' }]).size).toBe(0);
  });
  it('no topic named and no topic step ran: no pointer ("disaster recovery" is not a hazard)', () => {
    expect(pointerSentences(plan('power prices in PJM', ['get_energy_prices']), [], { pointers: P() })).toEqual([]);
    expect(pointerSentences(plan('disaster recovery data center sites near Ashburn', ['search_facilities']), [], { pointers: P() })).toEqual([]);
    expect(pointerSentences(plan('natural disaster risk near Ashburn', ['search_facilities']), [], { pointers: P() })[0].topic).toBe('flood');
  });
  it('config/source-pointers.json: flood, broadband, water, each dated, https, a publisher, fail_count a count', () => {
    const list = JSON.parse(readFileSync(POINTERS_FILE, 'utf8'));
    expect(list.map((p) => p.topic).sort()).toEqual(['broadband', 'flood', 'water']);
    for (const p of list) {
      expect(Object.keys(p)).toEqual(expect.arrayContaining(['topic', 'label', 'url', 'publisher', 'checked_on', 'fail_count']));
      expect(p.url).toMatch(/^https:\/\//);
      expect(p.checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // The weekly link check may raise fail_count; a dropped pointer must not turn its own PR red.
    expect(loadSourcePointers().size).toBe(list.filter((p) => Number(p.fail_count) < 2).length);
  });
});

describe('scripts/check-source-pointers.mjs', () => {
  it('HEAD refused -> GET; a pass moves checked_on and resets fail_count', async () => {
    const calls = [];
    const fetchOne = async (url, method) => { calls.push(method); return { status: method === 'HEAD' ? 403 : 200 }; };
    const r = await checkUrl('https://broadbandmap.fcc.gov/', { fetchOne });
    expect(calls).toEqual(['HEAD', 'GET']);
    expect(r).toMatchObject({ ok: true, method: 'GET', status: 200, head_status: 403 });
    const [p] = applyResults([{ ...LIST[1], fail_count: 1, last_error: 'x' }], [r], '2026-12-01');
    expect(p).toEqual({ ...LIST[1], checked_on: '2026-12-01', fail_count: 0 });
  });
  it('HEAD and GET both fail -> fail_count + 1, checked_on kept; the second failure crosses the drop line', async () => {
    const fetchOne = async () => ({ status: 404 });
    const r = await checkUrl('https://waterdata.usgs.gov/', { fetchOne });
    expect(r.ok).toBe(false);
    const once = applyResults([LIST[2]], [r], '2026-12-01');
    expect(once[0]).toMatchObject({ checked_on: '2026-11-24', fail_count: 1 });
    const twice = applyResults(once, [r], '2026-12-08');
    expect(twice[0].fail_count).toBe(2);
    expect(usablePointers(twice).has('water')).toBe(false);
  });
  it('main() writes the file and warns on a dropped pointer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'srcptr-'));
    const f = join(dir, 'p.json');
    writeFileSync(f, JSON.stringify([LIST[0], { ...LIST[2], fail_count: 1 }], null, 2) + '\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchOne = async (url) => ({ status: url.includes('usgs') ? 500 : 200 });
    expect(await linkCheck(['--file', f], { fetchOne })).toBe(0);
    const out = JSON.parse(readFileSync(f, 'utf8'));
    expect(out[0].fail_count).toBe(0);
    expect(out[1].fail_count).toBe(2);
    expect(log.mock.calls.flat().join('\n')).toMatch(/::warning::water pointer .* dropped from answers/);
  });
});
