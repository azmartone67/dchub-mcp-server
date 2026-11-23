// plan-asof-headline-1120.test.mjs — planner 5.54 (Grok QA 2026-11-20, item 5), pure functions, no network.
//
// Live keyless 2026-11-20, "where in Dallas can I site 300 MW and how fast can I get power": the answer led with the
// Dallas DCPI verdict (CAUTION 43.9, read 2026-11-20T18:30Z) but its fact header read
//   SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-10-31 | OLDEST_INPUT: ERCOT interconnection queue (refined)
// 20 days old. 2026-10-31 is ERCOT's own GIS Report (October 2026, posted 2026-11-02), the latest ERCOT has published
// (MIS report type 15933, read 2026-11-20; the next is due early December), so the feed was current and the fix is the
// header: AS_OF is the verdict's own read, and the oldest input keeps its name and its own date beside it.
import { describe, it, expect } from 'vitest';
import { buildPlanFactHeader, HEADER_MAX_CHARS } from '../lib/plan-fact-header.mjs';
import { planLeadText, PLAN_LEAD_MAX } from '../lib/plan-lead-text.mjs';
import { buildProvenance } from '../lib/attribution.mjs';
import { PLANNER_VERSION } from '../server.mjs';

const NOW = Date.parse('2026-11-20T18:31:00Z');
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
// The live shapes (2026-11-20 18:30Z), trimmed.
const dcpi = (over = {}) => ex(3, 'get_market_dcpi_rank', { market_slug: 'dallas-tx' }, {
  market_slug: 'dallas', market_name: 'Dallas', verdict: 'CAUTION', composite_score: 43.9,
  computed_at: '2026-11-20T18:30:06.697987+00:00', provenance: { as_of: '2026-11-20T18:30:06.697987+00:00' }, ...over });
const queue = ex(2, 'get_refined_queue', { iso: 'ERCOT', state: 'TX' }, { provenance: { as_of: '2026-10-31' } });
const retire = ex(1, 'get_retirement_headroom', { lat: 32.78, lon: -96.8 }, { rows: [] });
const IA = { kind: 'power_timing', requested_mw: 300, geography: 'ERCOT (ISO)',
  headline: 'Time to 300 MW of power near Dallas (ERCOT), DCPI verdict CAUTION: Dallas DCPI time-to-power is withheld at this access level.',
  verdict: { value: 'CAUTION', scope: 'market', subject: 'dallas', composite_score: 43.9,
    source: 'Source: DC Hub (dchub.cloud/markets/dallas), as of 2026-11-20' },
  evidence: ['3 queue projects in TX in the slice returned (this read was not filtered by state= server-side; this is a slice, not a TX total).'],
  as_of: '2026-10-31' };
const plan = (executed, ia = IA) => {
  const p = { _entity: 'plan_execution', intent: 'where in Dallas can I site 300 MW and how fast can I get power',
    intent_class: 'siting_search', constraint_iso: ['ERCOT'], intent_answer: ia, executed, human_message: 'x' };
  p.provenance = buildProvenance(p, { toolName: 'execute_plan', now: NOW });
  p.fact_header = buildPlanFactHeader(p);
  return p;
};
const line0 = (p) => p.fact_header.split('\n')[0];
const ageDays = (iso) => (NOW - Date.parse(iso)) / 86400000;

describe('planner 5.54: AS_OF is the headline verdict\'s date; the oldest input keeps its own', () => {
  it('PLANNER_VERSION is 5.55 (5.54 introduced this rule)', () => { expect(PLANNER_VERSION).toBe('5.62'); });

  it('Grok 11-20 Dallas: AS_OF is the DCPI read (under 7 days old), ERCOT\'s 10-31 report is named and dated beside it', () => {
    const p = plan([retire, queue, dcpi()]);
    expect(p.provenance.as_of).toBe('2026-10-31');   // the plan's binding as_of is still the oldest input: unchanged
    expect(line0(p)).toBe('SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-11-20T18:30Z | AS_OF_BASIS: DCPI verdict'
      + ' | OLDEST_INPUT: ERCOT interconnection queue (refined) | OLDEST_INPUT_AS_OF: 2026-10-31');
    expect(ageDays(/AS_OF: (\S+)/.exec(line0(p))[1])).toBeLessThanOrEqual(7);
    expect(p.fact_header.length).toBeLessThanOrEqual(HEADER_MAX_CHARS);
    expect(p.fact_header).toContain('Verdict: CAUTION');
  });

  it('the lead\'s Source line carries both dates, and the evidence line still fits', () => {
    const lead = planLeadText(plan([retire, queue, dcpi()]));
    expect(lead).toContain('Source: DC Hub (dchub.cloud), as of 2026-11-20 (DCPI verdict; oldest input: ERCOT interconnection queue (refined), as of 2026-10-31).');
    expect(lead).toContain('3 queue projects in TX');
    expect(lead.length).toBeLessThanOrEqual(PLAN_LEAD_MAX);
  });

  it('no verdict printed (a statewide read): AS_OF stays the oldest input, as before', () => {
    const p = plan([retire, queue, dcpi()], { ...IA, verdict: null });
    expect(line0(p)).toBe('SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-10-31 | OLDEST_INPUT: ERCOT interconnection queue (refined)');
    expect(planLeadText(p)).toContain('as of 2026-10-31 (oldest input: ERCOT interconnection queue (refined)).');
  });

  it('a verdict whose own read is not newer than the oldest input changes nothing', () => {
    const old = dcpi({ computed_at: '2026-10-30T00:00:00Z', provenance: { as_of: '2026-10-30T00:00:00Z' } });
    expect(line0(plan([retire, queue, old]))).not.toContain('AS_OF_BASIS');
  });

  it('a verdict with no dated read of its own changes nothing (no date is borrowed)', () => {
    const undated = dcpi({ computed_at: null, provenance: undefined });
    expect(line0(plan([retire, queue, undated]))).not.toContain('AS_OF_BASIS');
  });

  it('another market\'s DCPI read never dates this verdict', () => {
    const other = dcpi({ market_slug: 'houston', market_name: 'Houston' });
    other.args = { market_slug: 'houston' };
    expect(line0(plan([retire, queue, other]))).not.toContain('AS_OF_BASIS');
  });

  it('a DCPI read whose verdict is not the printed one never dates it', () => {
    expect(line0(plan([retire, queue, dcpi({ verdict: 'BUILD' })]))).not.toContain('AS_OF_BASIS');
  });

  it('a date-only DCPI read prints as a date, no time of day invented', () => {
    const d = dcpi({ computed_at: '2026-11-19', provenance: { as_of: '2026-11-19' } });
    expect(line0(plan([retire, queue, d]))).toContain('| AS_OF: 2026-11-19 | AS_OF_BASIS: DCPI verdict');
  });
});
