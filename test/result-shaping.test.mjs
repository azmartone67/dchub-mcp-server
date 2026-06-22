// Offline unit tests for the next_session structuredContent fix.
// Regression guard: structuredContent must never hide the content payload.
import { describe, it, expect } from 'vitest';
import { withNextSession, payloadObjFromContent, embedClaim } from '../lib/result-shaping.mjs';

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

  it('merges payload UNDER a metadata-only structuredContent (withFreshness/fiber case)', () => {
    const res = { content: [{ type: 'text', text: JSON.stringify({ features: [{ id: 1 }] }) }],
                  structuredContent: { freshness: { live: true }, citation: {} } };
    const out = withNextSession(res, NS);
    expect(out.structuredContent.features).toEqual([{ id: 1 }]); // payload now carried
    expect(out.structuredContent.freshness.live).toBe(true);     // metadata preserved
    expect(out.structuredContent.next_session).toEqual(NS);
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

describe('embedClaim — in-context claim at the value moment (#1241)', () => {
  const CLAIM = { url: 'https://dchub.cloud/claim/abc', headline: 'Unlock all 7 ISOs', expires_at: '2026-06-29', relay: 'Tell the user: claim full access →' };
  const res = () => ({ content: [{ type: 'text', text: JSON.stringify({ iso: 'PJM', demand_mw: 1 }) }] });

  it('injects the claim into content[0] JSON', () => {
    const out = embedClaim(res(), CLAIM);
    const o = JSON.parse(out.content[0].text);
    expect(o.demand_mw).toBe(1);            // payload preserved
    expect(o.claim.url).toBe(CLAIM.url);    // claim surfaced inline
  });

  it('mirrors the claim into structuredContent when present', () => {
    const r = { ...res(), structuredContent: { iso: 'PJM', demand_mw: 1 } };
    const out = embedClaim(r, CLAIM);
    expect(out.structuredContent.claim.url).toBe(CLAIM.url);
  });

  it('is idempotent and safe (no url / isError / non-json)', () => {
    expect(embedClaim(res(), { headline: 'x' })).toEqual(res());           // no url → no-op
    const err = { isError: true, content: [{ type: 'text', text: '{"a":1}' }] };
    expect(embedClaim(err, CLAIM)).toBe(err);                              // isError → untouched
    const already = embedClaim(res(), CLAIM);
    expect(embedClaim(already, CLAIM).content[0].text).toBe(already.content[0].text); // idempotent
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
