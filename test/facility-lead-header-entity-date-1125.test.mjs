// facility-lead-header-entity-date-1125.test.mjs -- four more defects read off the live enterprise execute_plan of
// 2026-11-25 ("which data centers are in Ashburn and who operates them"). Pure functions, no network.
//   A. the header SUMMARY was cut inside the fact's dated parenthetical: "... (DC Hub, row..." then ".." in the lead;
//   B. ENTITY read "PJM (ISO)" only, for an Ashburn facility search;
//   C. "Some steps came back as previews" was printed because the Deal Desk Brief link rode the plan;
//   D. a date read from the rows' update stamp was said as "row as_of".
import { describe, it, expect, afterEach } from 'vitest';
import { facilityLeadSummary, facilitySearchPlace } from '../lib/plan-facility-lead.mjs';
import { buildPlanFactHeader } from '../lib/plan-fact-header.mjs';
import { planLeadText, reportLinkOnly } from '../lib/plan-lead-text.mjs';
import { searchFacilitiesFacts } from '../lib/plan-step-facts.mjs';
import * as VF from '../lib/wall-value-first.mjs';

const FLAG = 'DCHUB_PLAN_FACILITY_LEAD_V1';
const prev = process.env[FLAG];
const on = () => { process.env[FLAG] = '1'; };
const off = () => { delete process.env[FLAG]; };
afterEach(() => { if (prev === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev; });

const LIVE = '50 facilities in Ashburn in this read (the total matching was not served), e.g. RagingWire VA1 - NTT, '
  + 'Equinix DC13, Digital Realty IAD (43791 Devin Shafron) (DC Hub, row as_of 2026-05-23).';
const LONG = '50 of 229 matching rows shown (preview), in Ashburn, e.g. '
  + Array.from({ length: 12 }, (_, i) => `Example Operator Campus ${i + 1} North Hall`).join(', ') + ' (DC Hub, row as_of 2026-05-23).';
const plan = (text = LIVE, extra = {}) => ({
  _entity: 'plan_execution', ok: true, intent: 'which data centers are in Ashburn and who operates them',
  intent_class: 'facility_search', constraint_iso: ['PJM'],
  executed: [
    { step: 1, tool: 'search_facilities', args: { city: 'Ashburn', state: 'VA' }, status: 'executed', result: { data: [] } },
    { step: 2, tool: 'get_grid_intelligence', args: { iso: 'PJM' }, status: 'executed', result: {} },
  ],
  intent_answer: { kind: 'facility_search', geography: 'Ashburn', headline: text, evidence: [text], as_of: '2026-05-23',
    facts: [{ tool: 'search_facilities', as_of: '2026-05-23', entity: 'Ashburn', text }] },
  ...extra,
});
const DEAL_DESK = { message: 'Your Deal Desk Brief for this analysis is ready', url: 'https://dchub.cloud/reports/deal-desk/dd-example.pdf' };

describe('A. the header SUMMARY', () => {
  it('leaves the dated parenthetical out and is never cut inside it', () => {
    const s = facilityLeadSummary(plan());
    expect(s).not.toMatch(/DC Hub/);
    expect(s.endsWith('Digital Realty IAD (43791 Devin Shafron)')).toBe(true);
  });
  it('a list too long for the header is cut after a whole name', () => {
    const s = facilityLeadSummary(plan(LONG));
    expect(s.length).toBeLessThanOrEqual(173);
    expect(s).toMatch(/Example Operator Campus \d+ North Hall\.\.\.$/);
  });
  it('the header carries the summary and the value-first lead keeps an ellipsis whole', () => {
    on();
    const h = buildPlanFactHeader(plan(LONG));
    expect(h).toMatch(/SUMMARY: 50 of 229 matching rows shown/);
    // This fixture's steps carry no dated input, so the header has no AS_OF; the live one does.
    const dated = h.replace('SOURCE: DC Hub (dchub.cloud)', 'SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-05-23');
    expect(dated).not.toBe(h);
    const head = VF.headlineOf({ fact_header: dated });
    expect(head.text).toMatch(/[^.]\.\.\.$/);
    expect(head.when).toBe('as of 2026-05-23');
  });
});

describe('B. ENTITY names the searched city', () => {
  it('facilitySearchPlace: the city and state of the ran search step', () => {
    expect(facilitySearchPlace(plan())).toBe('Ashburn, VA');
    expect(facilitySearchPlace({ ...plan(), intent_class: 'market_ranking' })).toBe(null);
    const p = plan(); p.executed[0] = { ...p.executed[0], args: { query: 'Northern Virginia' } };
    expect(facilitySearchPlace(p)).toBe(null);
    const q = plan(); q.executed[0] = { ...q.executed[0], status: 'not_run' };
    expect(facilitySearchPlace(q)).toBe(null);
  });
  it('flag on: the city leads the ENTITY line, the grid follows', () => {
    on();
    expect(buildPlanFactHeader(plan())).toContain('ENTITY: Ashburn, VA (city) | PJM (ISO)');
  });
  it('flag off: the ENTITY line is as before', () => {
    off();
    const h = buildPlanFactHeader(plan());
    expect(h).toContain('ENTITY: PJM (ISO)');
    expect(h).not.toContain('(city)');
  });
});

describe('C. a report link alone is not a preview', () => {
  const SENT = 'Some steps came back as previews';
  const gated = () => { const g = plan(LIVE, { for_your_human: DEAL_DESK }); g.executed[0] = { ...g.executed[0], status: 'gated_preview' }; return g; };
  it('reportLinkOnly: the Deal Desk link, every step executed, no other relay', () => {
    expect(reportLinkOnly(plan(LIVE, { for_your_human: DEAL_DESK }))).toBe(true);
    expect(reportLinkOnly(plan(LIVE, { for_your_human: DEAL_DESK, human_message: 'x' }))).toBe(false);
    expect(reportLinkOnly(plan(LIVE, { for_your_human: { url: 'https://dchub.cloud/upgrade/h/abc.def' } }))).toBe(false);
    expect(reportLinkOnly(plan(LIVE, { for_your_human: { url: 'https://dchub.cloud/u/bxty5p' } }))).toBe(false);
    expect(reportLinkOnly(gated())).toBe(false);
    expect(reportLinkOnly(plan())).toBe(false);
  });
  it('the lead leaves the sentence out for a report link, and keeps it for a wall relay or a preview step', () => {
    on();
    expect(planLeadText(plan(LIVE, { for_your_human: DEAL_DESK }))).not.toContain(SENT);
    expect(planLeadText(plan(LIVE, { for_your_human: { url: 'https://dchub.cloud/upgrade/h/abc.def' } }))).toContain(SENT);
    expect(planLeadText(gated())).toContain(SENT);
    expect(planLeadText(plan(LIVE, { human_message: 'see https://dchub.cloud/u/x' }))).toContain(SENT);
  });
});

describe('D. a row update stamp is not said as as_of', () => {
  const row = (extra) => ({ id: 1, name: 'Example Operator ASH1', provider: 'Example Operator', city: 'Ashburn', state: 'VA', ...extra });
  const p = (rows) => ({ data: rows, pagination: { total: rows.length } });
  it('flag on, rows carry only last_updated: "newest row update"', () => {
    on();
    const t = searchFacilitiesFacts(p([row({ last_updated: '2026-01-01T03:16:47' }), row({ id: 2, last_updated: '2026-05-23T00:00:00' })]), { city: 'Ashburn' })[0];
    expect(t.text).toContain('(DC Hub, newest row update 2026-05-23).');
    expect(t.text).not.toContain('row as_of');
    expect(t.as_of).toBe('2026-05-23');
  });
  it('flag on, a row states as_of: "row as_of" stays', () => {
    on();
    const t = searchFacilitiesFacts(p([row({ as_of: '2026-11-20' })]), { city: 'Ashburn' })[0];
    expect(t.text).toContain('(DC Hub, row as_of 2026-11-20).');
  });
  it('flag off: the wording is unchanged', () => {
    off();
    const t = searchFacilitiesFacts(p([row({ last_updated: '2026-05-23T00:00:00' })]), { city: 'Ashburn' })[0];
    expect(t.text).toContain('(DC Hub, row as_of 2026-05-23).');
  });
});
