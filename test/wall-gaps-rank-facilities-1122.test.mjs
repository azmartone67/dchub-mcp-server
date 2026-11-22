// Wall gaps measured on keyless /mcp 2026-11-22 (owner: "fix the market rank and search_facilities wall gaps").
//   search_facilities VA: content[0] was "Withheld here: the detail rows of this answer." with no dated headline.
//   get_market_dcpi_rank northern-virginia: the withheld list read column names ("avg kwh cents", "top risks json").
// Fixtures below are the live structuredContent, trimmed to the fields these rules read.
import { describe, it, expect } from 'vitest';
import * as WC from '../lib/withheld-copy.mjs';
import * as VF from '../lib/wall-value-first.mjs';
import { LINE_BANNED } from '../lib/preview-scope.mjs';

const ROW = (name, provider, as_of) => ({ name, provider, as_of, as_of_kind: 'last_written', city: 'Ashburn', state: 'VA',
  country: 'US', v: 'verified', verification: 'verified' });

// Live 2026-11-22 02:56Z, search_facilities {state: VA, limit: 5}, after the reconcile step wrote the fallback back.
const FAC_VA = {
  _entity: 'facility', tier: 'anonymous', count: null, total_matching: null, _data_total_available: 5,
  data: [ROW('Ashburn III, VA, United States', 'Vantage Data Centers', '2026-03-30'),
    ROW('Ashburn Campus, VA', 'Equinix', '2026-05-02'), ROW('IAD39', 'Digital Realty', '2026-04-11')],
  provenance: { as_of: null, completeness: 'partial_preview' },
  preview_scope: { shown: 3, total: 5, withheld_fields: ['the detail rows of this answer'] },
};

// Live 2026-11-22, get_market_dcpi_rank {market_slug: northern-virginia}.
const RANK_LOCKED = ['avg_kwh_cents', 'constraint_score', 'curtailment_pct', 'emergency_count_30d', 'excess_power_score',
  'forecast', 'gen_additions_12mo_mw', 'quality_score', 'queue_capacity_mw', 'queue_wait_months', 'reserve_margin_pct',
  'time_to_power_months', 'top_opportunities_json', 'top_risks_json'];
const RANK_NOVA = {
  _gated: true, _preview_only: true, _locked_fields: RANK_LOCKED, verdict: 'AVOID', market_name: 'ASHBURN',
  composite_score: 20, computed_at: '2026-11-22T00:10:00Z',
  // what preview-scope.mjs already wrote (underscores to spaces)
  preview_scope: { shown: null, total: null, withheld_fields: ['avg kwh cents', 'DCPI sub-scores', 'curtailment pct',
    'emergency count 30d', 'forecast', 'gen additions 12mo mw', 'quality score', 'queue capacity mw', 'queue wait months',
    'reserve margin pct', 'time to power', 'top opportunities json', 'top risks json'] },
};

describe('search_facilities wall: dated headline and named withheld fields', () => {
  it('names power capacity and the rows the preview cut, never the placeholder', () => {
    const f = WC.withheldFields(FAC_VA);
    expect(f).toEqual(['power capacity (MW)', 'the other 2 of the 5 facilities in this answer']);
    expect(f).not.toContain(WC.DETAIL_ROWS_FALLBACK);
  });

  it('is stable when its own list is read back from preview_scope', () => {
    const once = WC.reconcilePreviewScope(FAC_VA);
    expect(once.preview_scope.withheld_fields).toEqual(WC.withheldFields(FAC_VA));
    expect(WC.withheldFields(once)).toEqual(WC.withheldFields(FAC_VA));
    expect(WC.reconcilePreviewScope(once)).toBe(once);
  });

  it('names no row count when the preview cut no rows', () => {
    expect(WC.withheldFields({ ...FAC_VA, preview_scope: { shown: 3, total: 3, withheld_fields: [] } }))
      .toEqual(['power capacity (MW)']);
  });

  it('leads with the first shown row, dated by the oldest shown row date', () => {
    const h = VF.headlineOf(FAC_VA);
    expect(h).toEqual({ text: 'Ashburn III, VA, United States (Vantage Data Centers) and 2 more facilities shown',
      when: 'as of 2026-03-30' });
    const lines = VF.valueFirstLines({ headline: h, fields: WC.withheldFields(FAC_VA), link: 'https://dchub.cloud/u/87neje' });
    expect(lines).toEqual([
      'Ashburn III, VA, United States (Vantage Data Centers) and 2 more facilities shown (DC Hub, as of 2026-03-30).',
      'Withheld here: power capacity (MW) and the other 2 of the 5 facilities in this answer.',
      'See the full answer: https://dchub.cloud/u/87neje',
    ]);
    // never a registry total: the answer's count is cut by limit
    expect(lines.join(' ')).not.toMatch(/\bmatch(?:es|ing)?\b/);
  });

  it('shows no headline when any shown row is undated', () => {
    const undated = { ...FAC_VA, data: [...FAC_VA.data.slice(0, 2), { ...FAC_VA.data[2], as_of: null }] };
    expect(VF.headlineOf(undated)).toBe(null);
  });

  it('says "facility" for one more row and nothing for none', () => {
    expect(VF.headlineOf({ ...FAC_VA, data: FAC_VA.data.slice(0, 2) }).text).toMatch(/and 1 more facility shown$/);
    expect(VF.headlineOf({ ...FAC_VA, data: FAC_VA.data.slice(0, 1) }).text).toBe('Ashburn III, VA, United States (Vantage Data Centers)');
  });

  it('leaves a non-facility answer with a data array alone', () => {
    expect(VF.headlineOf({ data: FAC_VA.data })).toBe(null);
    expect(WC.withheldFields({ _gated: true, data: FAC_VA.data })).toEqual([WC.DETAIL_ROWS_FALLBACK]);
  });
});

describe('get_market_dcpi_rank wall: withheld fields read as words', () => {
  const WANT = ['average retail electricity rate', 'DCPI sub-scores', 'curtailment share',
    'grid emergencies in the last 30 days', 'forecast', 'generation added in the last 12 months', 'data quality score',
    'queued capacity', 'queue wait', 'reserve margin', 'time to power', 'top opportunities', 'top risks'];

  it('labels the live list (spaced form, as preview_scope serves it)', () => {
    expect(WC.withheldFields(RANK_NOVA)).toEqual(WANT);
  });

  it('labels the raw column names the same way', () => {
    const { preview_scope: _p, ...raw } = RANK_NOVA;
    expect(WC.withheldFields(raw)).toEqual(WANT);
  });

  it('no list item is a column name or a banned word, and the list is stable on read-back', () => {
    const f = WC.withheldFields(RANK_NOVA);
    for (const x of f) {
      expect(x).not.toMatch(/\bjson\b|\bpct\b|\bkwh cents\b|\b12mo\b|\b30d\b/);
      expect(LINE_BANNED.test(x)).toBe(false);
    }
    expect(WC.withheldFields(WC.reconcilePreviewScope(RANK_NOVA))).toEqual(f);
  });

  it('keeps its dated DCPI headline', () => {
    expect(VF.headlineOf(RANK_NOVA)).toEqual({
      text: 'ASHBURN Data Center Power Index (DCPI) verdict AVOID, composite 20', when: 'as of 2026-11-22' });
  });

  it('every label passes the line ban', () => {
    for (const v of Object.values(WC.WITHHELD_LABELS)) expect(LINE_BANNED.test(v)).toBe(false);
    for (const v of WC.FACILITY_FULL_ACCESS_FIELDS) expect(LINE_BANNED.test(v)).toBe(false);
  });
});

describe('the relay page copy of the list fits its 200-character store at an item boundary', () => {
  it('keeps a short list whole', () => {
    expect(WC.withheldListFit(WC.withheldFields(FAC_VA), 200)).toBe(WC.withheldList(WC.withheldFields(FAC_VA)));
  });
  it('cuts the long DCPI list between items and counts the rest', () => {
    const f = WC.withheldFields(RANK_NOVA);
    expect(WC.withheldList(f).length).toBeGreaterThan(200);
    const s = WC.withheldListFit(f, 200);
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s).toMatch(/^average retail electricity rate, DCPI sub-scores, .* and \d+ more fields$/);
    // every named item is a whole label
    const named = s.replace(/ and \d+ more fields$/, '').split(', ');
    for (const n of named) expect(f).toContain(n);
    expect(named.length + Number(/(\d+) more/.exec(s)[1])).toBe(f.length);
  });
});
