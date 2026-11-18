// planner-540-wholesale-context.test.mjs — planner 5.40 follow-up for be#8996 (owner 2026-11-18 ~08:30Z: "want to
// share with citation covers us"). get_energy_prices {iso} carries one of:
//   * wholesale_lmp {iso, hub, real_time, day_ahead, source} where the ISO's terms allow (ERCOT, CAISO, NYISO, ISO-NE);
//   * wholesale_lmp null + wholesale_lmp_withheld {iso, reason} (MISO, SPP), and for PJM also wholesale_context
//     {iso, label, figures: [{name, value, unit, period, area, source, source_url, published, basis}], live_prices};
//   * no wholesale field at all (a backend before be#8996), where the old "not real-time LMP" line stays true.
// The answers lead with what the response holds and never say "DC Hub has no LMP" when an ISO serves one.
// Payload shapes follow be#8996 util/wholesale_lmp.py; the figure VALUES below are round test numbers, not quotes.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { _planQuery } from '../server.mjs';
import { buildCrossDomainAnswer, WHOLESALE_SCOPE_NOTE } from '../lib/cross-domain-answer.mjs';
import { buildPriceNowAnswer, NOT_LMP_NOTE, wholesaleContextFacts, noLmpNote } from '../lib/energy-answers.mjs';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/xd-energy-1118/${n}.json`, import.meta.url), 'utf8'));
const ex = (n, tool, args, result) => ({ step: n, tool, args, status: 'executed', result });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));
const noUnderscore = (facts) => facts.every((f) => !Object.keys(f).some((k) => k.startsWith('_') || k === 'short'));

const RETAIL = fx('energy-prices-tx');
const PJM_REASON = 'PJM does not permit republishing its LMP data';
const PJM_CONTEXT = {
  iso: 'PJM', label: 'published PJM price figures (not live)',
  figures: [
    { name: 'Capacity auction clearing price', value: 100, unit: '$/MW-day', period: '2027/2028 delivery year', area: 'RTO',
      source: 'PJM Base Residual Auction report', source_url: 'https://www.pjm.com/', published: '2026-07-01', basis: 'auction result' },
    { name: 'Load-weighted average LMP', value: 50, unit: '$/MWh', period: '2025', area: 'PJM',
      source: 'Independent Market Monitor State of the Market', source_url: 'https://www.monitoringanalytics.com/', published: '2026-03-01', basis: 'annual average' },
  ],
  live_prices: { label: 'Live PJM prices', url: 'https://dataminer2.pjm.com/', note: 'PJM Data Miner' },
};
const PJM_EP = { ...RETAIL, filter: { iso: 'PJM' }, wholesale_lmp: null,
  wholesale_lmp_withheld: { iso: 'PJM', reason: PJM_REASON }, wholesale_context: PJM_CONTEXT };
const ERCOT_LMP = { ...RETAIL, filter: { iso: 'ERCOT' }, wholesale_lmp: { iso: 'ERCOT', hub: 'HB_HUBAVG', source: 'ERCOT',
  real_time: { lmp_usd_mwh: 30, interval_ending: '2026-11-18T08:15:00Z', as_of: '2026-11-18T08:16:00Z', stale: false },
  day_ahead: { lmp_usd_mwh: 31, delivery_date: '2026-11-18', hour_ending: 9, as_of: '2026-11-17T18:00:00Z', market: 'DAM' } } };
const MISO_EP = { ...RETAIL, filter: { iso: 'MISO' }, wholesale_lmp: null,
  wholesale_lmp_withheld: { iso: 'MISO', reason: "MISO's terms bar republishing" } };

describe('price_now reads the be#8996 wholesale block', () => {
  const run = (iso, ep) => {
    const rows = [ex(1, 'get_energy_prices', { iso }, ep)];
    return buildPriceNowAnswer({ intent_class: 'price_now' }, rows, asMap(rows));
  };
  it('ERCOT: the real-time hub LMP leads; no "not LMP" line', () => {
    const a = run('ERCOT', ERCOT_LMP);
    expect(a.headline).toMatch(/^ERCOT HB_HUBAVG real-time LMP: \$30\/MWh/);
    expect(a.headline).not.toContain(NOT_LMP_NOTE);
    expect(a.not_established).not.toContain(NOT_LMP_NOTE);
  });
  it('PJM: the published figures lead with their periods and the live-price link, then why no LMP is served', () => {
    const a = run('PJM', PJM_EP);
    expect(a.headline).toMatch(/^PJM: PJM Capacity auction clearing price: \$100\/MW-day \(2027\/2028 delivery year; RTO; PJM Base Residual Auction report; published 2026-07-01; auction result\)\./);
    expect(a.headline).toContain('Load-weighted average LMP: $50/MWh (2025;');
    expect(a.headline).toContain('Live PJM prices: https://dataminer2.pjm.com/.');
    expect(a.headline).toContain(`PJM wholesale LMP is not served: ${PJM_REASON}.`);
    expect(a.headline).not.toContain(NOT_LMP_NOTE);
    expect(a.facts.filter((f) => f.as_of === '2026-07-01' || f.as_of === '2026-03-01')).toHaveLength(2);
    expect(noUnderscore(a.facts)).toBe(true);
  });
  it('MISO: the retail rate leads with MISO\'s own reason, not the generic line', () => {
    const a = run('MISO', MISO_EP);
    expect(a.headline).toMatch(/^MISO: .*7\.68 cents\/kWh/);
    expect(a.headline).toContain("MISO wholesale LMP is not served: MISO's terms bar republishing.");
    expect(a.headline).not.toContain(NOT_LMP_NOTE);
  });
  it('a response with no wholesale field (backend before be#8996) keeps the old line, which is true of it', () => {
    const a = run('ERCOT', { ...RETAIL, filter: { iso: 'ERCOT' } });
    expect(a.headline).toContain(NOT_LMP_NOTE);
    expect(noLmpNote({ p: {} }, 'ERCOT')).toBe(NOT_LMP_NOTE);
  });
  it('a day-ahead note on a served block goes to not_established', () => {
    const ep = { ...ERCOT_LMP, wholesale_lmp: { ...ERCOT_LMP.wholesale_lmp, day_ahead: null, day_ahead_note: 'NYISO day-ahead is not ingested yet' } };
    expect(run('ERCOT', ep).not_established).toContain('NYISO day-ahead is not ingested yet.');
  });
  it('figures without a value or a name are skipped; a non-https live link is never said', () => {
    const bad = { p: { wholesale_context: { iso: 'PJM', figures: [{ name: 'x', value: null }, { value: 3 }], live_prices: { url: 'javascript:alert(1)' } } }, args: {}, tool: 'get_energy_prices', step: 1 };
    expect(wholesaleContextFacts(bad)).toEqual([]);
    const a = run('PJM', { ...PJM_EP, wholesale_context: { ...PJM_CONTEXT, live_prices: { label: 'x', url: 'http://plain.example/' } } });
    expect(a.headline).not.toContain('plain.example');
  });
});

describe('dc_power_place reads the ISO wholesale block when wholesale is asked', () => {
  const QB = 'For new data center capacity in Northern Virginia, how do wholesale power prices, grid headroom and the PJM queue affect it?';
  it('routes NoVA with both price steps: the VA retail rate and the PJM wholesale block', () => {
    const p = _planQuery(QB, {});
    expect(p.intent_class).toBe('dc_power_place');
    const eps = p.recommended_sequence.filter((s) => s.tool === 'get_energy_prices').map((s) => s.args_hint);
    expect(eps).toEqual([{ state: 'VA' }, { iso: 'PJM' }]);
    expect(p.recommended_sequence.length).toBeLessThanOrEqual(8);
  });
  it('no wholesale words: no ISO price step', () => {
    const p = _planQuery('What do electricity prices look like for a 50 MW data center in Dallas, and how soon could it get power?', {});
    expect(p.recommended_sequence.filter((s) => s.tool === 'get_energy_prices').map((s) => s.args_hint)).toEqual([{ state: 'TX' }]);
  });

  const INTEL = { success: true, market: { id: 'northern-virginia', name: 'Northern Virginia' }, as_of: '2026-11-03T00:00:00',
    stats: { facility_count: 587, total_power_mw: 11313, mw_reporting_count: 200 }, siting: { dcpi: { verdict: 'AVOID', as_of: '2026-11-18T00:34:29Z' } } };
  const base = [ex(1, 'get_market_intel', { market: 'northern-virginia' }, INTEL),
    ex(2, 'get_energy_prices', { state: 'VA' }, { ...RETAIL, filter: { state: 'VA' } })];
  const place = { label: 'Northern Virginia', state: 'VA', iso: 'PJM', market: 'northern-virginia' };
  const answerWith = (ws) => {
    const rows = [...base, ex(3, 'get_energy_prices', { iso: ws.filter.iso }, ws)];
    return buildCrossDomainAnswer({ intent: QB, intent_class: 'dc_power_place', place }, rows, asMap(rows));
  };
  it('PJM: the published figure and the live link are on the power side, ahead of retail; the reason is the gap', () => {
    const a = answerWith(PJM_EP);
    expect(a.headline).toContain('Capacity auction clearing price $100/MW-day (2027/2028 delivery year); Live PJM prices: https://dataminer2.pjm.com/');
    expect(a.not_established).toContain(`PJM wholesale LMP is not served: ${PJM_REASON}.`);
    expect(a.not_established).not.toContain(WHOLESALE_SCOPE_NOTE);
    expect(a.headline).not.toMatch(/has no wholesale/);
    expect(noUnderscore(a.facts)).toBe(true);
  });
  it('an LMP-serving ISO: the LMP is on the power side and no scope line says there is none', () => {
    const a = answerWith(ERCOT_LMP);
    expect(a.headline).toContain('ERCOT HB_HUBAVG real-time LMP: $30/MWh');
    expect(a.not_established).not.toContain(WHOLESALE_SCOPE_NOTE);
  });
  it('a pre-be#8996 response (no wholesale field) keeps the scope line', () => {
    const a = answerWith({ ...RETAIL, filter: { iso: 'PJM' } });
    expect(a.not_established).toContain(WHOLESALE_SCOPE_NOTE);
  });
});
