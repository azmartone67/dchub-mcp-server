// serc-charlotte-1124.test.mjs — QA note 2026-11-24 (Charlotte NC, Duke / SERC, 200 MW / 30 months). Pure, no network.
//
// A. Keyed execute_plan said "Charlotte DCPI time-to-power 13.2 months ... within the 30-month deadline" with no word
//    that the figure is a modeled estimate. "within" now always carries that caveat in the same sentence, and off the
//    seven ISO/RTOs it names the utility territory.
// B. Keyless execute_plan cited "NC: 32 active generation requests ... (PJM queue rows)" for a SERC / Duke market. The
//    timeline's state rows are read for the named market's own grid (stampServingGrid); none from it says so.
// C. Keyless analyze_site said "AVOID ... time to power under 24 months" with no reason; the backend's verdict_reason
//    (the /dcpi banner clause, be#9313) is relayed.
import { describe, it, expect } from 'vitest';
import { _scrubDcpiProse } from '../server.mjs';
import { buildIntentAnswer, deadlineSentence, DEADLINE_WITHIN_CAVEAT } from '../lib/intent-answers.mjs';
import { factsFromStep } from '../lib/plan-step-facts.mjs';
import { servingGridQueue, stampServingGrid } from '../lib/state-queue-coverage.mjs';
import { marketVerdictFromSiteScore, withSiteScoreMarket, verdictContext } from '../lib/site-verdict.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const NOW = Date.parse('2026-11-24T20:00:00Z');
const INTENT = 'how soon can I get 200 MW of power in Charlotte, Duke territory, 30-month deadline';

// ── A ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A: "within the deadline" never stands without the modeled-estimate caveat', () => {
  it('SERC: caveat and utility territory in the same sentence', () => {
    const s = deadlineSentence(30, 13.2, 'SERC');
    expect(s).toBe(`That is within the 30-month deadline asked ${DEADLINE_WITHIN_CAVEAT} (SERC is a utility territory, not an ISO/RTO queue).`);
  });

  it.each([['ERCOT'], ['PJM'], [null], ['SERC'], ['TVA'], ['WECC']])('%s: within carries the caveat', (g) => {
    const s = deadlineSentence(30, 13.2, g);
    expect(s).toMatch(/^That is within the 30-month deadline asked on DC Hub's modeled estimate, which the serving utility has to confirm[ .]/);
    expect(s.split('. ').length).toBe(1);                 // one sentence
    expect(/utility territory/.test(s)).toBe(!!g && !['ERCOT', 'PJM'].includes(g));
  });

  it('past the deadline is unchanged', () => {
    expect(deadlineSentence(30, 37.9, 'SERC')).toBe('That is past the 30-month deadline asked, by ~8 months.');
  });

  it.each([['SERC'], ['ERCOT']])('below Pro the scrub takes the whole caveated sentence (%s)', (g) => {
    const s = _scrubDcpiProse(`Charlotte DCPI time-to-power 13.2 months (x). ${deadlineSentence(30, 13.2, g)} Next.`);
    expect(s).not.toMatch(/within|13\.2|utility territory|modeled estimate/);
    expect(s).toContain('The 30-month deadline check is withheld at this access level. Next.');
  });

  it('the keyed Charlotte power-timing lead names SERC from the DCPI card', () => {
    const card = ex(1, 'get_market_dcpi_rank', { market_slug: 'charlotte' },
      { market_slug: 'charlotte', iso: 'SERC', verdict: 'AVOID', composite_score: 30.2, time_to_power_months: 13.2,
        computed_at: '2026-11-24T18:28:55Z' });
    // Two grids in the plan: the SERC label has to come from the Charlotte card itself.
    const ctx = { intent: INTENT, intent_class: 'power_timeline', constraint_iso: ['PJM', 'SERC'], requested_mw: 200,
      deadline_months: 30, named_markets: ['charlotte'], state: 'NC', states: ['NC'] };
    const a = buildIntentAnswer(ctx, [card], null, NOW);
    expect(a.headline).toContain('Charlotte DCPI time-to-power 13.2 months');
    expect(a.headline).toContain(`within the 30-month deadline asked ${DEADLINE_WITHIN_CAVEAT} (SERC is a utility territory`);
    expect(a.headline).not.toMatch(/within the 30-month deadline asked\./);
  });
});

// ── B ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tl = (over = {}) => ({ state: 'NC', queue_context: { active_projects: 32, active_mw: 5321.4, as_of: '2026-07-16',
  by_iso: [{ iso: 'PJM', active_projects: 32, active_mw: 5321.4 }], ...over } });

describe('B: state queue rows are read for the market\'s own grid', () => {
  it('a SERC market never borrows PJM\'s NC count', () => {
    const [f] = factsFromStep('get_power_availability_timeline', tl({ serving_grid: 'SERC' }), { state: 'NC' });
    expect(f.text).toMatch(/^No interconnection-queue data for the operator serving this market \(SERC: Duke Energy\)/);
    expect(f.text).toContain('PJM queue rows, from the part of NC that PJM serves');
    expect(f.text).not.toMatch(/\b32\b|active generation requests/);
  });

  it('a SERC market with no per-ISO breakdown still says no data', () => {
    const p = tl({ serving_grid: 'SERC' }); delete p.queue_context.by_iso;
    expect(factsFromStep('get_power_availability_timeline', p, { state: 'NC' })[0].text).toMatch(/^No interconnection-queue data/);
  });

  it('a PJM market in NC keeps the PJM rows, and only them', () => {
    const p = tl({ serving_grid: 'PJM', by_iso: [{ iso: 'PJM', active_projects: 30, active_mw: 5000 }, { iso: 'MISO', active_projects: 2, active_mw: 10 }] });
    const [f] = factsFromStep('get_power_availability_timeline', p, { state: 'NC' });
    expect(f.text).toContain('NC: 30 active generation requests');
    expect(f.text).toContain('(PJM queue rows; MISO rows in NC left out)');
  });

  it('no stamp: the state line is as before', () => {
    expect(factsFromStep('get_power_availability_timeline', tl(), { state: 'NC' })[0].text).toContain('NC: 32 active generation requests');
    expect(servingGridQueue('NC', [], null)).toBe(null);
  });

  it('stampServingGrid reads the named market\'s DCPI card iso onto the timeline step', () => {
    const card = ex(1, 'get_market_dcpi_rank', { market_slug: 'charlotte-nc' }, { market_slug: 'charlotte', iso: 'SERC', verdict: 'AVOID' });
    const t = ex(2, 'get_power_availability_timeline', { state: 'NC' }, JSON.stringify(tl()));
    const full = new Map([[t, tl()]]);
    expect(stampServingGrid([card, t], full, { citySlug: 'charlotte-nc', constraintIso: ['SERC', 'PJM'] })).toBe('SERC');
    expect(JSON.parse(t.result).queue_context.serving_grid).toBe('SERC');
    expect(full.get(t).queue_context.serving_grid).toBe('SERC');
  });

  it('stampServingGrid: no named market, nothing stamped; one constraint grid is the fallback', () => {
    const t = () => ex(2, 'get_power_availability_timeline', { state: 'NC' }, tl());
    const a = t();
    expect(stampServingGrid([a], null, { constraintIso: ['SERC'] })).toBe(null);
    expect(a.result.queue_context.serving_grid).toBeUndefined();
    const b = t();
    expect(stampServingGrid([b], null, { citySlug: 'charlotte-nc', constraintIso: ['SERC'] })).toBe('SERC');
    expect(stampServingGrid([t()], null, { citySlug: 'charlotte-nc', constraintIso: ['SERC', 'PJM'] })).toBe(null);
  });
});

// ── C ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const REASON = 'did not clear the excess-power scoring band';
const body = (mv = {}) => ({ market_verdict: { market: 'Charlotte', slug: 'charlotte', verdict: 'AVOID', as_of: '2026-11-24',
  verdict_reason: REASON, ...mv }, time_to_power: { time_to_power_band: 'under_24_months' } });

describe('C: the AVOID wall says why, from the backend\'s verdict_reason', () => {
  it('the site-score market carries it and the sentence says it', () => {
    const m = marketVerdictFromSiteScore(body());
    expect(m.verdict_reason).toBe(REASON);
    expect(verdictContext(m)).toContain(`Market verdict (DCPI): AVOID for Charlotte (${REASON}), time to power under 24 months`);
  });

  it('merged onto the DCPI row the location lookup read', () => {
    const cur = { market: 'Charlotte', slug: 'charlotte', verdict: 'AVOID', composite_score: 30.2, as_of: '2026-11-24' };
    const m = withSiteScoreMarket(cur, body());
    expect(verdictContext(m)).toContain(`AVOID (30.2) for Charlotte (${REASON}), time to power under 24 months`);
  });

  it('never relayed on a non-AVOID verdict, or when it carries a figure', () => {
    expect(marketVerdictFromSiteScore(body({ verdict: 'BUILD' })).verdict_reason).toBeUndefined();
    expect(marketVerdictFromSiteScore(body({ verdict_reason: 'excess-power 30.2 below 50' })).verdict_reason).toBeUndefined();
  });
});
