// r-portfolio (2026-07-11) — offline unit tests for the personalized
// next_session retention nudge: when the payload carries the backend's
// `portfolio` block, the nudge must reference the caller's ACTUAL saved
// state; otherwise the generic block must pass through byte-identical.
import { describe, it, expect } from 'vitest';
import { withNextSession, personalizeNextSession } from '../lib/result-shaping.mjs';

const BASE = {
  tool: 'get_changes',
  call: 'get_changes since=24h',
  why: 'generic copy',
  retention_tools: ['get_changes', 'save_site'],
};
const textResult = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

describe('personalizeNextSession', () => {
  it('returns base unchanged when there is no portfolio', () => {
    expect(personalizeNextSession({ diff: {} }, BASE)).toBe(BASE);
    expect(personalizeNextSession(null, BASE)).toBe(BASE);
    expect(personalizeNextSession({ portfolio: { saved_sites: 0 } }, BASE)).toBe(BASE);
  });

  it('references actual saved state when sites exist', () => {
    const out = personalizeNextSession({
      portfolio: {
        saved_sites: 3, alerts_armed: 2, moved_count: 1,
        since: '2026-07-04T10:00:00+00:00',
        moved: [{ id: 9, name: 'Phoenix parcel', market: 'phoenix',
                  verdict_was: 'CAUTION', verdict_now: 'BUILD', verdict_changed: true }],
      },
    }, BASE);
    expect(out).not.toBe(BASE);
    expect(out.your_state).toContain('3 saved sites');
    expect(out.your_state).toContain('1 moved since 2026-07-04');
    expect(out.your_state).toContain('Phoenix parcel');
    expect(out.your_state).toContain('CAUTION → BUILD');
    expect(out.your_state).toContain('2 alerts armed');
    // static keys survive
    expect(out.retention_tools).toEqual(BASE.retention_tools);
    expect(out.tool).toBe('get_changes');
  });

  it('nudges set_site_alert when no alerts are armed', () => {
    const out = personalizeNextSession(
      { portfolio: { saved_sites: 1, alerts_armed: 0, moved_count: 0 } }, BASE);
    expect(out.your_state).toContain('none moved');
    expect(out.your_state).toContain('set_site_alert');
  });

  it('is fail-soft on malformed portfolio shapes', () => {
    expect(personalizeNextSession({ portfolio: 'junk' }, BASE)).toBe(BASE);
    expect(personalizeNextSession({ portfolio: { saved_sites: 'NaN-ish' } }, BASE)).toBe(BASE);
    const out = personalizeNextSession(
      { portfolio: { saved_sites: 2, moved: 'not-an-array', moved_count: 1 } }, BASE);
    expect(out.your_state).toContain('2 saved sites');
  });
});

describe('withNextSession — factory form', () => {
  it('passes the merged payload to the factory and stamps its result', () => {
    const out = withNextSession(
      textResult({ portfolio: { saved_sites: 2, moved_count: 0, alerts_armed: 1 } }),
      (sc) => personalizeNextSession(sc, BASE));
    expect(out.structuredContent.next_session.your_state).toContain('2 saved sites');
    expect(out.structuredContent.portfolio.saved_sites).toBe(2);
  });

  it('stamps the generic block via factory when no portfolio', () => {
    const out = withNextSession(
      textResult({ diff: { dcpi_movers: [] } }),
      (sc) => personalizeNextSession(sc, BASE));
    expect(out.structuredContent.next_session).toEqual(BASE);
  });

  it('sees portfolio arriving via structuredContent (not just content[0])', () => {
    const res = {
      content: [{ type: 'text', text: 'plain text' }],
      structuredContent: { portfolio: { saved_sites: 5, moved_count: 0, alerts_armed: 5 } },
    };
    const out = withNextSession(res, (sc) => personalizeNextSession(sc, BASE));
    expect(out.structuredContent.next_session.your_state).toContain('5 saved sites');
  });

  it('a throwing factory never breaks the response', () => {
    const res = textResult({ a: 1 });
    const out = withNextSession(res, () => { throw new Error('boom'); });
    expect(out.content[0].text).toContain('"a":1');
    expect(out.structuredContent && out.structuredContent.next_session).toBeFalsy();
  });

  it('object form still works exactly as before (regression)', () => {
    const out = withNextSession(textResult({ x: 1 }), BASE);
    expect(out.structuredContent.next_session).toEqual(BASE);
    expect(out.structuredContent.x).toBe(1);
  });
});
