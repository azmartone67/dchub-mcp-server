// gdl-plan-cite-1125.test.mjs — Grok daily head-to-head 2026-11-25 (planner 5.64), items A, B, D, E and F, as pure
// units. The real-server checks (every plan output, get_site_context, the Ohio and Phoenix-Los Angeles plans end to
// end) are in test/gdl-plan-cite-e2e-1125.test.mjs.
//   A  cite_as read "DC Hub (dchub.cloud) — PARTIAL preview, 3 of 5 shown, as of ..."; the owner line is
//      "Source: DC Hub (dchub.cloud), as of <YYYY-MM-DD>"; the preview wording lives in completeness.
//   B  a fiber answer carried as_of 2026-03-17 beside cite_as "as of 2026-11-24": the cite says the answer's own day.
//   D  the PJM capacity trim dropped 2026/27 (the delivery year in force) and the DOM LDA row.
//   E  "land for 100 MW in Ohio with any local restrictions" read no permitting records; the land lead opened with the
//      AVOID caveat before naming any area.
//   F  "connect Phoenix to Los Angeles" read Phoenix alone (routePair knew only "from X to Y" / "between X and Y").
// Fixtures are shaped like live responses; names and figures are test values, not DC Hub data.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planCiteLine, planCompletenessNote, stampPlanCite, PLAN_CITE_RE } from '../lib/plan-cite-line.mjs';
import { stampOutreach } from '../lib/agent-outreach.mjs';
import { buildCitation } from '../lib/attribution.mjs';
import { currentWholesaleFigures, trimWholesaleContext, wholesaleContextLead, currentDeliveryYear } from '../lib/energy-answers.mjs';
import { permitCheckStep, permitCheckLine, withPermitLine } from '../lib/plan-permit-check.mjs';
import { withSitingCaveat } from '../lib/siting-caveat.mjs';
import { routePair, fiberKind } from '../lib/plan-routing.mjs';
import { _planQuery } from '../server.mjs';

const NOW = Date.parse('2026-11-26T03:30:00Z');   // 20:30 on 2026-11-25 in Phoenix: the UTC day is already the 26th
const PREVIEW_PROV = { as_of: '2026-11-25', completeness: 'partial_preview', preview: { shown: 3, total: 5 } };
const planSc = (over = {}) => {
  const prov = { ...PREVIEW_PROV, ...(over.provenance || {}) };
  return { _entity: 'plan_execution', ok: true, intent: 'x', provenance: prov, citation: buildCitation({}, {}, prov), ...over, provenance: prov };
};
const res = (sc) => ({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc });

describe('A: the plan is cited by the owner line, the preview wording is in completeness', () => {
  it('the old citation carried the preview inside cite_as (the defect, as the input here)', () => {
    expect(planSc().citation.cite_as).toMatch(/PARTIAL preview, 3 of 5 shown/);
  });
  it('stampOutreach on execute_plan: cite_as and citation.cite_as are the owner line, no PARTIAL / preview', () => {
    const out = stampOutreach(res(planSc()), 'execute_plan', { intent: 'x' }).structuredContent;
    for (const c of [out.cite_as, out.citation.cite_as]) {
      expect(c).toMatch(PLAN_CITE_RE);
      expect(c).toMatch(/^Source: DC Hub \(dchub\.cloud\), as of \d{4}-\d{2}-\d{2}/);
      expect(c).not.toMatch(/PARTIAL|preview/i);
    }
    expect(out.cite_as).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-25');
    expect(out.completeness).toEqual({ status: 'partial', note: 'partial preview, 3 of 5 shown' });
    expect(out.citation.completeness).toBe('partial_preview');   // the machine value readers branch on
    expect(out.citation.completeness_note).toBe('partial preview, 3 of 5 shown');
  });
  it('a full plan gets the same line and no completeness note', () => {
    const prov = { as_of: '2026-11-20' };
    const sc = { _entity: 'plan_execution', provenance: prov, citation: buildCitation({}, {}, prov) };
    const out = stampOutreach(res(sc), 'execute_plan', {}).structuredContent;
    expect(out.cite_as).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-20');
    expect(out.completeness).toBeUndefined();
    expect(out.citation.completeness_note).toBeUndefined();
    // the visible sentence keeps its "Cite as: DC Hub ..." shape
    expect(stampOutreach(res(sc), 'execute_plan', {}).content.at(-1).text).toBe('Cite as: DC Hub (dchub.cloud), as of 2026-11-20.');
  });
  it('a plan no step dated says so after the date; an upstream the cite named is appended', () => {
    const prov = { as_of: '2026-11-26T03:00:00.000Z', as_of_kind: 'generated_at' };
    const sc = { provenance: prov, citation: buildCitation({}, {}, prov) };
    expect(planCiteLine(sc, NOW)).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-25 (plan run; no source date stated)');
    const up = { ...sc, cite_as: 'Source: DC Hub (dchub.cloud), as of 2026-10-07; upstream EPA Green Book' };
    expect(planCiteLine(up, NOW)).toMatch(/; upstream EPA Green Book$/);
  });
  it('the note carries each preview shape the citation used to say', () => {
    const note = (preview) => planCompletenessNote(planSc({ provenance: { preview } }));
    expect(note({ shown: 3, total: 188 })).toBe('partial preview, 3 of 188 shown');
    expect(note({ scope: 'row_fields' })).toBe('partial: every row shown; some row fields are not in this preview');
    expect(note({})).toBe('partial preview (not the full dataset)');
  });
  it('other tools keep their cite_as unchanged', () => {
    const sc = planSc();
    const out = stampOutreach(res(sc), 'get_fiber_intel', {}).structuredContent;
    expect(out.cite_as).toMatch(/^DC Hub \(dchub\.cloud\) — PARTIAL preview, 3 of 5 shown/);
  });
});

describe('B: the plan cite says the answer\'s own day', () => {
  it('fb-a shape: intent_answer as_of 2026-03-17, citation newest 2026-11-24 -> cite_as "as of 2026-03-17"', () => {
    const prov = { as_of: '2026-03-17', as_of_range: { oldest: '2026-03-17', newest: '2026-11-25T02:10:00.000Z' } };
    const sc = { intent_answer: { kind: 'fiber', as_of: '2026-03-17' }, provenance: prov, citation: buildCitation({}, {}, prov) };
    expect(sc.citation.cite_as).toMatch(/as of 2026-11-24/);   // the defect: the newest input's Phoenix day
    const out = stampPlanCite(sc, NOW);
    expect(out.cite_as).toBe('Source: DC Hub (dchub.cloud), as of 2026-03-17');
    expect(out.citation.cite_as).toBe(out.cite_as);
  });
  it('an intent_answer as_of that is a timestamp is said as its Phoenix day', () => {
    const sc = { intent_answer: { as_of: '2026-11-26T01:15:00Z' }, provenance: { as_of: '2026-11-26' } };
    expect(planCiteLine(sc, NOW)).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-25');
  });
});

const PJM_CTX = JSON.parse(readFileSync(new URL('./fixtures/pjm-wholesale-context-1124.json', import.meta.url), 'utf8'));
const DOM_2627 = { name: 'Base Residual Auction (capacity) clearing price', value: 329.17, unit: '$/MW-day (UCAP)', period: '2026/2027 delivery year',
  area: 'Dominion (DOM) LDA', source: 'PJM Interconnection, 2026/2027 Base Residual Auction Report', published: '2025-07-22', basis: 'published report figure, quoted' };
const bra = (rows) => rows.filter((g) => /Base Residual/.test(g.name));
const NOV25 = Date.parse('2026-11-25T19:00:00Z');

describe('D: the PJM capacity rows keep the delivery year in force and the next two', () => {
  it('the delivery year runs June 1 to May 31', () => {
    expect(currentDeliveryYear(Date.parse('2026-11-25T19:00:00Z'))).toBe(2026);
    expect(currentDeliveryYear(Date.parse('2026-05-31T19:00:00Z'))).toBe(2025);
    expect(currentDeliveryYear(Date.parse('2026-06-01T19:00:00Z'))).toBe(2026);
  });
  it('2026/27 ($329.17) is kept beside 2027/28 and 2028/29; 2025/26 is not', () => {
    const { kept } = currentWholesaleFigures(PJM_CTX.figures, { now: NOV25 });
    expect(bra(kept).map((g) => g.period)).toEqual(['2028/2029 delivery year', '2027/2028 delivery year', '2026/2027 delivery year']);
    expect(bra(kept).some((g) => g.value === 329.17)).toBe(true);
    expect(bra(kept).some((g) => /2025\/2026/.test(g.period))).toBe(false);
  });
  it('the DOM LDA row of the delivery year in force is kept', () => {
    const t = trimWholesaleContext({ wholesale_context: { ...PJM_CTX, figures: [...PJM_CTX.figures, DOM_2627] } }, NOV25);
    expect(t.wholesale_context.figures.some((g) => /\bDOM\b/.test(g.area) && /2026\/2027/.test(g.period))).toBe(true);
    // its oldest kept input is the 2026/27 report, never older than 2025
    expect(t.wholesale_context.figures.map((g) => g.published).sort()[0] >= '2025-01-01').toBe(true);
  });
  it('the headline clause is unchanged: the latest two auction years', () => {
    const l = wholesaleContextLead({ args: { iso: 'PJM' }, p: { wholesale_context: { ...PJM_CTX, figures: [...PJM_CTX.figures, DOM_2627] } } });
    expect(l.short).toBe('PJM wholesale: real-time load-weighted LMP $74.98/MWh (Jan-Sep 2026, IMM); capacity $325-333.44/MW-day (2027/28 to 2028/29)');
  });
  it('a block with no auction in the window keeps its latest two, never none', () => {
    const old = PJM_CTX.figures.filter((g) => !/2026\/2027|2027\/2028|2028\/2029/.test(g.period));
    expect(bra(currentWholesaleFigures(old, { now: NOV25 }).kept).length).toBeGreaterThan(0);
  });
});

const OHIO = 'land for 100 MW in Ohio with any local restrictions';
describe('E: a siting plan reads the state\'s permitting records', () => {
  it('the Ohio land plan runs get_permitting_intel {state: OH}', () => {
    const p = _planQuery(OHIO, {});
    const s = p.recommended_sequence.filter((x) => x.tool === 'get_permitting_intel');
    expect(p.recommended_sequence.some((x) => x.tool === 'find_sites')).toBe(true);
    expect(s).toHaveLength(1);
    expect(s[0].args_hint).toEqual({ state: 'OH' });
  });
  it('restriction / moratorium / zoning / permit wording, or a find_sites plan, adds the read once', () => {
    expect(permitCheckStep('100 MW in Ohio', [{ tool: 'find_sites' }], 'capacity_search', 'OH')).toMatchObject({ args_hint: { state: 'OH' } });
    expect(permitCheckStep('zoning near Columbus', [{ tool: 'get_pipeline' }], 'dc_capacity', 'OH')).toMatchObject({ args_hint: { state: 'OH' } });
    expect(permitCheckStep('100 MW in Ohio', [{ tool: 'get_pipeline' }], 'dc_capacity', 'OH')).toBeNull();
    expect(permitCheckStep('moratorium in Ohio', [{ tool: 'find_sites' }], 'permitting', 'OH')).toBeNull();
    expect(permitCheckStep('100 MW', [{ tool: 'find_sites' }, { tool: 'get_permitting_intel' }], 'capacity_search', 'OH')).toBeNull();
    expect(permitCheckStep('100 MW somewhere', [{ tool: 'find_sites' }], 'capacity_search', null)).toBeNull();
  });
  it('no OH record: an explicit "no OH permitting record on file" line', () => {
    const e = { step: 6, tool: 'get_permitting_intel', args: { state: 'OH' }, status: 'executed', result: { count: 0, records: [], as_of: '2026-11-20' } };
    const pl = permitCheckLine([e], new Map([[e, e.result]]));
    expect(pl.line).toMatch(/^No OH permitting record on file in DC Hub/);
    const a = withPermitLine({ headline: 'find_sites: 3 search areas in OH.', evidence: [] }, pl);
    expect(a.headline).toMatch(/^find_sites: 3 search areas in OH\. No OH permitting record on file/);
    expect(a.evidence).toContain(pl.line);
  });
  it('the land answer names its areas first, then the AVOID caveat', () => {
    const lead = 'find_sites: 12 search areas in OH (3 shown), top 3: 1) near 40.1, -83.0 (WORTHINGTON 138 kV substation).';
    const cav = { line: 'Every area listed reads AVOID on the Data Center Power Index (DCPI) (Worthington; PJM).' };
    const a = withSitingCaveat({ headline: `${lead} Siting read for 100 MW, PJM (ISO).` }, cav, { after: lead });
    expect(a.headline.startsWith(lead)).toBe(true);
    expect(a.headline).toBe(`${lead} ${cav.line} Siting read for 100 MW, PJM (ISO).`);
    // with no land lead the caveat still leads, as before
    expect(withSitingCaveat({ headline: 'Other.' }, cav).headline.startsWith(cav.line)).toBe(true);
  });
});

describe('F: a route ask between two metros reads both, whatever joins them', () => {
  const PAIR = ['Phoenix', 'Los Angeles'];
  for (const t of ['connect Phoenix to Los Angeles', 'connect Phoenix to Los Angeles with fiber', 'Phoenix to Los Angeles fiber',
    'fiber Phoenix↔Los Angeles', 'fiber Phoenix <-> Los Angeles', 'fiber between Phoenix and Los Angeles',
    'fiber routes and latency from Phoenix to Los Angeles']) {
    it(t, () => {
      const r = routePair(t);
      expect(r && [r.a.label, r.b.label]).toEqual(PAIR);
      expect(fiberKind(t, {})).toBe('route');
    });
  }
  it('fb-d: "connect Phoenix to Los Angeles" plans both ends and the latency floor, no lead-in step', () => {
    for (const t of ['connect Phoenix to Los Angeles', 'connect Phoenix to Los Angeles with fiber']) {
      const p = _planQuery(t, {});
      expect(p.intent_class).toBe('fiber');
      const fi = p.recommended_sequence.filter((s) => s.tool === 'get_fiber_intel').map((s) => s.args_hint.market);
      expect(fi).toEqual(expect.arrayContaining(['phoenix', 'los-angeles']));
      expect(p.recommended_sequence.some((s) => s.tool === 'plan_fiber_leadin')).toBe(false);
      expect(p.recommended_sequence.some((s) => s.tool === 'cluster_sites_by_latency')).toBe(true);
    }
  });
  it('one metro, or a grid connection, is not a route', () => {
    expect(routePair('how do I connect 100 MW in Phoenix to the grid')).toBeNull();
    expect(routePair('fiber in Chicago')).toBeNull();
    expect(routePair('lead-in fiber route to Phoenix from Dallas')).toBeNull();
  });
});
