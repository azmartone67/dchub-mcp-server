// Offline unit tests for the next_session structuredContent fix.
// Regression guard: structuredContent must never hide the content payload.
import { describe, it, expect } from 'vitest';
import { withNextSession, payloadObjFromContent } from '../lib/result-shaping.mjs';

const NS = { tool: 'get_changes', call: 'get_changes since=24h' };
const textResult = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

describe('withNextSession — payload must survive into structuredContent', () => {
  it('mirrors a content-only object payload into structuredContent (THE BUG)', () => {
    const out = withNextSession(textResult({ avg_rate_kwh: 0.095, caller_tier: 'pro' }), NS);
    // structuredContent now carries the DATA, not just the nudge
    expect(out.structuredContent.avg_rate_kwh).toBe(0.095);
    expect(out.structuredContent.caller_tier).toBe('pro');
    expect(out.structuredContent.next_session).toEqual(NS);
    // content is still intact for content-reading clients
    expect(JSON.parse(out.content[0].text).avg_rate_kwh).toBe(0.095);
  });

  it('does NOT produce a structuredContent that only has next_session', () => {
    const out = withNextSession(textResult({ features: [{ id: 1 }] }), NS);
    const keys = Object.keys(out.structuredContent);
    expect(keys).toContain('features');
    expect(keys).not.toEqual(['next_session']);
  });

  it('preserves a handler-provided structuredContent (grid/compare path) + adds next_session', () => {
    const res = { content: [{ type: 'text', text: '{"comparison":{}}' }], structuredContent: { isos: ['PJM'], comparison: { PJM: { demand_mw: 1 } } } };
    const out = withNextSession(res, NS);
    expect(out.structuredContent.isos).toEqual(['PJM']);
    expect(out.structuredContent.comparison.PJM.demand_mw).toBe(1);
    expect(out.structuredContent.next_session).toEqual(NS);
  });

  it('skips the "Source: DC Hub" attribution block and mirrors the real payload', () => {
    const res = { content: [
      { type: 'text', text: JSON.stringify({ deals: [{ id: 9 }] }) },
      { type: 'text', text: 'Source: DC Hub (dchub.cloud) — live …' },
    ] };
    const out = withNextSession(res, NS);
    expect(out.structuredContent.deals).toEqual([{ id: 9 }]);
  });

  it('is idempotent — never stamps twice', () => {
    const once = withNextSession(textResult({ a: 1 }), NS);
    const twice = withNextSession(once, NS);
    expect(twice).toBe(once);
  });

  it('leaves isError results untouched', () => {
    const res = { isError: true, content: [{ type: 'text', text: '{"x":1}' }] };
    expect(withNextSession(res, NS)).toBe(res);
  });

  it('does not fabricate structuredContent for a bare-array or non-JSON payload', () => {
    const arr = { content: [{ type: 'text', text: '[1,2,3]' }] };
    expect(withNextSession(arr, NS).structuredContent).toBeUndefined();
    const prose = { content: [{ type: 'text', text: 'not json' }] };
    expect(withNextSession(prose, NS).structuredContent).toBeUndefined();
  });
});

describe('payloadObjFromContent', () => {
  it('returns the parsed object', () => {
    expect(payloadObjFromContent([{ type: 'text', text: '{"a":1}' }])).toEqual({ a: 1 });
  });
  it('returns null for arrays / non-json / empty', () => {
    expect(payloadObjFromContent([{ type: 'text', text: '[1]' }])).toBeNull();
    expect(payloadObjFromContent([{ type: 'text', text: 'x' }])).toBeNull();
    expect(payloadObjFromContent([])).toBeNull();
    expect(payloadObjFromContent(null)).toBeNull();
  });
});
