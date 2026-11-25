// facility-lead-total-scope-preview-1125.test.mjs -- three defects read off one live enterprise execute_plan
// (2026-11-25, "which data centers are in Ashburn and who operates them"). Pure functions, no network.
//   1. the lead said "the total matching was not served" while the step carried pagination.total 229;
//   2. the step's submarket_scope said kept 1 (counted on the slimmed copy) beside a lead that counted 50;
//   3. a provenance.preview that records only a size trim made the answer "gated": "Withheld here: the detail rows".
import { describe, it, expect, afterEach } from 'vitest';
import { _planSignals, _execSubmarketOut, _slimStepResult, _gatedAnswer } from '../server.mjs';
import { searchFacilitiesFacts } from '../lib/plan-step-facts.mjs';
import { totalAvailable } from '../lib/plan-facility-lead.mjs';
import { isPreviewAnswer, sizeTrimOnlyPreview } from '../lib/preview-scope.mjs';
import { withheldFields } from '../lib/withheld-copy.mjs';

const FLAG = 'DCHUB_PLAN_FACILITY_LEAD_V1';
const prev = process.env[FLAG];
afterEach(() => { if (prev === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev; });

const rows = (n) => Array.from({ length: n }, (_, i) => ({
  id: 1000 + i, name: `Example Operator ASH${i + 1}`, provider: 'Example Operator', city: 'Ashburn', state: 'VA',
  lat: 39.0438, lon: -77.4874, last_updated: '2026-05-23T00:00:00', notes: 'x'.repeat(400),
}));
const keyedPayload = (n = 50, total = 229) => ({ _entity: 'facility', data: rows(n), pagination: { limit: 50, page: 1, pages: 5, total }, success: true });

describe('1. the total a keyed search states as pagination.total', () => {
  it('totalAvailable reads pagination.total when no top-level total is served', () => {
    expect(totalAvailable(keyedPayload())).toBe(229);
    expect(totalAvailable({ data: [], pagination: { total: 'many' } })).toBe(null);
    expect(totalAvailable({ data: [] })).toBe(null);
  });
  it('a top-level total still wins over pagination.total', () => {
    expect(totalAvailable({ total_matching: 228, pagination: { total: 229 } })).toBe(228);
  });
  it('the lead says N of the total, never "the total matching was not served"', () => {
    process.env[FLAG] = '1';
    const o = { ok: true, result: keyedPayload(), full: keyedPayload() };
    _execSubmarketOut('search_facilities', o, _planSignals('which data centers are in Ashburn'), { city: 'Ashburn', state: 'VA' });
    const text = searchFacilitiesFacts(o.full, { city: 'Ashburn', state: 'VA' })[0].text;
    expect(text).toContain('50 of 229 matching rows shown (preview), in Ashburn');
    expect(text).not.toContain('was not served');
  });
});

describe('2. the scope block counts the full step, not its slimmed copy', () => {
  const run = () => {
    const full = keyedPayload();
    const slim = _slimStepResult(full, 'search_facilities');
    expect(slim.truncated).toBe(true);
    expect(slim.data.length).toBeLessThan(50);
    const o = { ok: true, result: slim, full };
    const scope = _execSubmarketOut('search_facilities', o, _planSignals('which data centers are in Ashburn'), { city: 'Ashburn', state: 'VA' });
    return { o, scope };
  };
  it('the step scope is the full step\'s: kept 50', () => {
    const { scope } = run();
    expect(scope).toMatchObject({ submarket: 'Ashburn', kept: 50, dropped_outside_submarket: 0 });
  });
  it('the shown (slimmed) copy carries the same block, and the full copy keeps its rows', () => {
    const { o, scope } = run();
    expect(o.result.submarket_scope).toEqual(scope);
    expect(o.full.submarket_scope.kept).toBe(50);
    expect(o.full.data.length).toBe(50);
  });
  it('a step that was not slimmed is unchanged: one object, its own scope', () => {
    const small = { _entity: 'facility', data: rows(2).map((r) => ({ ...r, notes: '' })), pagination: { total: 2 } };
    const o = { ok: true, result: small, full: small };
    const scope = _execSubmarketOut('search_facilities', o, _planSignals('which data centers are in Ashburn'), { city: 'Ashburn', state: 'VA' });
    expect(scope.kept).toBe(2);
    expect(o.result.submarket_scope.kept).toBe(2);
  });
});

describe('3. a size trim alone is not a preview', () => {
  const SIZE = { reasons: ['step result truncated'], withheld_fields: [], withholding_proven: false, size_trimmed: true, unlock_tool: 'unlock_more_data' };
  const sc = (preview, extra = {}) => ({ _entity: 'plan_execution', ok: true, provenance: { completeness: 'unrestricted', preview }, ...extra });
  it('sizeTrimOnlyPreview: only the size reason, nothing withheld, nothing proven', () => {
    expect(sizeTrimOnlyPreview(SIZE)).toBe(true);
    expect(sizeTrimOnlyPreview({ ...SIZE, reasons: ['step result truncated', 'facilities: 5 of 229 shown'] })).toBe(false);
    expect(sizeTrimOnlyPreview({ ...SIZE, withheld_fields: ['power_mw'] })).toBe(false);
    expect(sizeTrimOnlyPreview({ ...SIZE, withholding_proven: true })).toBe(false);
    expect(sizeTrimOnlyPreview({ ...SIZE, reasons: [] })).toBe(false);
    expect(sizeTrimOnlyPreview(null)).toBe(false);
  });
  it('the licensed answer with only a size trim is not a preview and names nothing withheld', () => {
    expect(isPreviewAnswer(sc(SIZE))).toBe(false);
    expect(withheldFields(sc(SIZE))).toEqual([]);
    const result = { content: [{ type: 'text', text: '50 of 229 matching rows shown (preview), in Ashburn.' }], structuredContent: sc(SIZE) };
    expect(_gatedAnswer(result, 'execute_plan', {})).toBe(false);
  });
  it('every real preview marker still reads as a preview', () => {
    expect(isPreviewAnswer(sc({ ...SIZE, reasons: ['facilities: 5 of 229 shown'] }))).toBe(true);
    expect(isPreviewAnswer(sc({ ...SIZE, withheld_fields: ['power_mw'] }))).toBe(true);
    expect(isPreviewAnswer(sc({ reasons: ['unlock offer present'] }))).toBe(true);
    expect(isPreviewAnswer(sc(SIZE, { free_preview_only: true }))).toBe(true);
    expect(isPreviewAnswer(sc(SIZE, { _locked_fields: ['power_mw'] }))).toBe(true);
    expect(isPreviewAnswer({ provenance: { completeness: 'partial_preview', preview: SIZE } })).toBe(true);
    expect(withheldFields(sc(SIZE, { free_preview_only: true })).length).toBeGreaterThan(0);
  });
});
