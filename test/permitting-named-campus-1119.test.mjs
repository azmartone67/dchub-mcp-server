// permitting-named-campus-1119.test.mjs — Grok's daily MCP leadership note (2026-11-18 evening, planner 5.41).
// Planner 5.42.
//   item 1 (LAND L3)  a moratorium / land-use ask routes to permitting, never discover_tools alone, and the lead names
//                     the moratorium count and five jurisdictions, each with a stage and a date said as what it is
//   item 5            a named-campus answer leads with the name lookup's best match, or says no record matched, and a
//                     lookup step that did not read by name passes none of its rows on
import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { permittingAsk, buildPermittingAnswer, BILLS_NOT_LOADED } from '../lib/permitting-answer.mjs';
import { buildNamedCampusAnswer } from '../lib/named-project-facts.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const L3 = 'Which US states, counties or cities have data center moratoriums or restrictive land-use rules right now?';

it('is planner 5.42', () => { expect(PLANNER_VERSION).toBe('5.48'); });

describe('item 1: permitting routing', () => {
  it('the L3 intent routes to permitting and reads moratorium, legislation and zoning records', () => {
    const p = _planQuery(L3);
    expect(p.intent_class).toBe('permitting');
    const seq = p.recommended_sequence;
    expect(seq.map((s) => s.tool)).toEqual(['get_permitting_intel', 'get_permitting_intel', 'get_permitting_intel']);
    expect(seq.map((s) => s.args_hint.class)).toEqual(['moratorium', 'legislation', 'zoning']);
    expect(seq.some((s) => s.tool === 'discover_tools')).toBe(false);
  });
  it('a named state holds every step to it', () => {
    const p = _planQuery('Is there a data center moratorium anywhere in Wisconsin?');
    expect(p.intent_class).toBe('permitting');
    expect(p.recommended_sequence.every((s) => s.args_hint.state === 'WI')).toBe(true);
  });
  it('a ban on new data centers is a permitting ask', () => {
    expect(_planQuery('Which counties have passed a ban on new data centers?').intent_class).toBe('permitting');
  });
  it('zoning wording about data centers with nothing else named routes to permitting', () => {
    expect(_planQuery('What zoning ordinances restrict data centers?').intent_class).toBe('permitting');
  });
  it('an air-permit ask keeps air_permits', () => {
    expect(permittingAsk('Air permits for gas turbines near Midland, TX')).toBe(null);
    expect(_planQuery('Air permits for gas turbines near Midland, TX').intent_class).toBe('air_permits');
  });
  it('a site screen with coordinates that names zoning keeps its site class', () => {
    const p = _planQuery('Screen 21571 Beaumeade Circle, Ashburn, VA for flood zone, zoning and parcel', { lat: 39.0186, lon: -77.458 });
    expect(p.intent_class).not.toBe('permitting');
  });
  it('a named campus and a power-timing ask are untouched', () => {
    expect(_planQuery('status and power plan of the Stargate Abilene data center campus').intent_class).toBe('named_campus');
    expect(_planQuery('how soon can a 100 MW load get power in ERCOT').intent_class).not.toBe('permitting');
  });
  it('zoning without data-center wording is not a permitting ask', () => {
    expect(permittingAsk('what is the zoning of this parcel')).toBe(null);
  });
});

const MOR = (n) => ({ ok: true, class: 'moratorium', count: n, records: [
  { class: 'moratorium', jurisdiction: 'Howell Township', state: 'MI', stage: 'enacted', effective_date: null, as_of: null, updated_at: '2026-10-24 17:08:26+00' },
  { class: 'moratorium', jurisdiction: 'Colfax County', state: 'NM', stage: 'enacted', effective_date: null, as_of: null, updated_at: '2026-10-24 17:08:31+00' },
  { class: 'moratorium', jurisdiction: 'West Seneca', state: 'NY', stage: 'proposed', effective_date: '2026-11-01', as_of: null, updated_at: '2026-10-20 10:00:00+00' },
  { class: 'moratorium', jurisdiction: "Prince George's County", state: 'MD', stage: 'enacted', effective_date: null, as_of: '2026-10-25', updated_at: '2026-10-24 17:08:28+00' },
  { class: 'moratorium', jurisdiction: 'Town of Beloit', state: 'WI', stage: 'enacted', effective_date: null, as_of: null, updated_at: '2026-10-24 17:08:25+00' },
  { class: 'moratorium', jurisdiction: 'Milwaukee', state: 'WI', stage: 'enacted', effective_date: null, as_of: null, updated_at: '2026-10-23 17:08:25+00' },
] });

describe('item 1: the permitting answer', () => {
  const ctx = { intent: L3, intent_class: 'permitting' };
  it('leads with the count and five jurisdictions, each with a stage and a date', () => {
    const a = buildPermittingAnswer(ctx, [
      ex(1, 'get_permitting_intel', { class: 'moratorium' }, MOR(54)),
      ex(2, 'get_permitting_intel', { class: 'legislation' }, { ok: true, class: 'legislation', loaded: false, count: null, bills: [] }),
      ex(3, 'get_permitting_intel', { class: 'zoning' }, { ok: true, count: 0, records: [] }),
    ]);
    expect(a.kind).toBe('permitting');
    expect(a.headline).toMatch(/^54 data-center moratorium records on record \(6 shown\)/);
    // 5.46 (Grok daily 11-19 item 2): only a row with its own source date (as_of) is ranked; the bulk-load
    // updated_at and an effective date alone never make a row "most recent" (test/grok-daily-1119b.test.mjs).
    const most = a.headline.split('Most recent by source date: ')[1].split(' (')[0];
    expect(most).toBe("Prince George's County, MD");
    expect(a.headline).toMatch(/Prince George's County, MD \(enacted, as of 2026-10-25\) \(5 undated records not ranked\)\./);
    expect(a.headline).not.toMatch(/record updated|Milwaukee|Colfax|West Seneca/);
    expect(a.headline).toMatch(/No zoning-restriction record is published for the US/);
    expect(a.headline).toContain(BILLS_NOT_LOADED);
    expect(a.headline).not.toMatch(/\b0 data-center bills?\b/);
  });
  it('a state with no records says so, and a loaded bill feed is counted with its date', () => {
    const a = buildPermittingAnswer(ctx, [
      ex(1, 'get_permitting_intel', { class: 'moratorium', state: 'TX' }, { ok: true, count: 0, records: [] }),
      ex(2, 'get_permitting_intel', { class: 'legislation', state: 'TX' }, { ok: true, loaded: true, count: 3, as_of: '2026-11-15', bills: [{}, {}, {}] }),
    ]);
    expect(a.headline).toMatch(/^No data-center moratorium is published in DC Hub's permitting records in TX\./);
    expect(a.headline).toMatch(/3 data-center bills tracked in TX \(Open States, as of 2026-11-15\)\./);
  });
  it('records with no source date are not ranked, and say so', () => {
    const recs = MOR(2); recs.records = recs.records.slice(0, 2);
    const a = buildPermittingAnswer(ctx, [ex(1, 'get_permitting_intel', { class: 'moratorium' }, recs)]);
    expect(a.not_established.join(' ')).toMatch(/2 of the 2 moratorium records shown carry no source date/);
    expect(a.headline).toMatch(/None of the records shown carries a source date, so none is listed as most recent\./);
  });
  it('another class is not answered here', () => {
    expect(buildPermittingAnswer({ intent_class: 'site_analysis' }, [ex(1, 'get_permitting_intel', { class: 'moratorium' }, MOR(54))])).toBe(null);
  });
});

const NL_MATCH = { success: true, count: 3, name_lookup: { query: 'Stargate Abilene', matched: true, best_match_index: 0 },
  data: [{ name: 'Stargate Abilene Phase 1', developer: 'Stargate (OpenAI/SoftBank/Oracle)', city: 'Abilene', county: 'Taylor County',
    state: 'TX', status: 'Under Construction', stated_mw: 1200, expected_cod: null, expected_cod_basis: 'no completion date: the source row states none',
    source_url: 'https://openai.com/index/announcing-the-stargate-project/', as_of: '2026-03-30' }, {}, {}] };
const DCPI = { market_name: 'Abilene', verdict: 'CAUTION', composite_score: 42.7, computed_at: '2026-11-19T05:20:02Z' };
// What a backend that ignores name= returned on 2026-11-18: other projects, no name_lookup block.
const IGNORED = { success: true, count: 3, data: [{ name: 'Louisiana AI Campus', developer: 'Meta' }, { name: 'Frontier Campus', developer: 'Vantage' }, { name: 'Colossus 2 Expansion', developer: 'xAI' }] };

describe('item 5: the named-campus answer', () => {
  const ctx = { intent: 'status and power plan of the Stargate Abilene data center campus', intent_class: 'named_campus', campus: 'Stargate Abilene' };
  it('leads with the best match, then the market verdict', () => {
    const a = buildNamedCampusAnswer(ctx, [
      ex(1, 'get_pipeline', { name: 'Stargate Abilene' }, NL_MATCH),
      ex(2, 'search_facilities', { name: 'Stargate Abilene' }, NL_MATCH),
      ex(4, 'get_market_dcpi_rank', { market_slug: 'abilene' }, DCPI),
    ]);
    expect(a.headline).toMatch(/^"Stargate Abilene": best match Stargate Abilene Phase 1 \(developer Stargate/);
    expect(a.headline).toMatch(/1,200 MW stated/);
    expect(a.headline).toMatch(/record as of 2026-03-30/);
    expect(a.headline).toMatch(/Abilene Data Center Power Index \(DCPI\) verdict for the market: CAUTION, 42\.7\/100 \(as of 2026-11-19\)\.$/);
    expect(a.headline.indexOf('best match')).toBeLessThan(a.headline.indexOf('DCPI'));
  });
  it('a backend that ignored name= gives "No DC Hub record matched" and names no other project', () => {
    const a = buildNamedCampusAnswer(ctx, [
      ex(1, 'get_pipeline', { name: 'Stargate Abilene' }, IGNORED),
      ex(2, 'search_facilities', { name: 'Stargate Abilene' }, IGNORED),
      ex(4, 'get_market_dcpi_rank', { market_slug: 'abilene' }, DCPI),
    ]);
    expect(a.headline).toMatch(/^No DC Hub record matched "Stargate Abilene" in this read\./);
    for (const other of ['Louisiana', 'Frontier', 'Colossus', 'Meta', 'Vantage', 'xAI']) {
      expect(a.headline).not.toContain(other);
      expect(JSON.stringify(a.facts)).not.toContain(other);
    }
  });
  it('a lookup that matched nothing says so in its own words', () => {
    const none = { success: true, count: 0, data: [], name_lookup: { query: 'Project Zed', matched: false, message: 'No record matches "Project Zed".' } };
    const a = buildNamedCampusAnswer({ ...ctx, campus: 'Project Zed' }, [ex(1, 'get_pipeline', { name: 'Project Zed' }, none)]);
    expect(a.headline).toMatch(/^No record matches "Project Zed" \(DC Hub name lookup\)\./);
  });
});
