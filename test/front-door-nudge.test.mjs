// r-front-door-inband (2026-07-21): the in-band front-door nudge surfaces
// plan_query on the FIRST workflow-entry tool of a session, so agents whose
// cached instructions never learned the front door still discover it mid-
// session. These tests pin the behavior contract: fires on the right tools,
// once per session, never on the wrong ones, and NEVER breaks a response.
import { describe, it, expect } from 'vitest';
import { withFrontDoorNudge } from '../server.mjs';

// Fresh, minimal DC Hub envelope result. Unique session per test so the
// module-level once-per-session dedupe never leaks across cases.
const mkResult = () => ({
  content: [{ type: 'text', text: JSON.stringify({ _entity: 'market', ok: true }) }],
  structuredContent: { _entity: 'market', ok: true },
});
const NUDGE = '`plan_query`';

describe('withFrontDoorNudge', () => {
  it('fires on a workflow-entry tool for a fresh session (text + structured)', () => {
    const r = withFrontDoorNudge(mkResult(), 'rank_markets', { session_id: 'fd-s1' });
    expect(r.content.length).toBe(2);
    expect(r.content[1].text).toContain(NUDGE);
    expect(r.structuredContent._front_door).toBeTruthy();
    expect(r.structuredContent._front_door.next_tool).toBe('plan_query');
    // must not clobber content[0] — downstream JSON.parse of the payload survives
    expect(() => JSON.parse(r.content[0].text)).not.toThrow();
  });

  it('does NOT fire on non-entry tools (terminal / identity / meta)', () => {
    for (const t of ['get_changes', 'claim_free_key', 'plan_query', 'get_facility', 'why_dchub']) {
      const r = withFrontDoorNudge(mkResult(), t, { session_id: 'fd-non-' + t });
      expect(r.content.length, `${t} should not be nudged`).toBe(1);
      expect(r.structuredContent._front_door).toBeUndefined();
    }
  });

  it('fires at most once per session', () => {
    const c = { session_id: 'fd-once' };
    const first = withFrontDoorNudge(mkResult(), 'rank_markets', c);
    expect(first.content.length).toBe(2);
    const second = withFrontDoorNudge(mkResult(), 'get_market_intel', c); // same session, different entry tool
    expect(second.content.length).toBe(1);
    expect(second.structuredContent._front_door).toBeUndefined();
  });

  it('dedupes on api_key when no session_id is present', () => {
    const c = { api_key: 'dch_live_fd_key' };
    expect(withFrontDoorNudge(mkResult(), 'rank_markets', c).content.length).toBe(2);
    expect(withFrontDoorNudge(mkResult(), 'compare_isos', c).content.length).toBe(1);
  });

  it('is idempotent — never double-adds if plan_query is already mentioned', () => {
    const r = mkResult();
    r.content.push({ type: 'text', text: 'see `plan_query` for the plan' });
    const out = withFrontDoorNudge(r, 'search_facilities', { session_id: 'fd-idem' });
    // one pre-existing mention + original payload = 2, and NOT a third pushed
    expect(out.content.length).toBe(2);
  });

  it('skips error results', () => {
    const r = { isError: true, content: [{ type: 'text', text: 'boom' }] };
    const out = withFrontDoorNudge(r, 'rank_markets', { session_id: 'fd-err' });
    expect(out.content.length).toBe(1);
  });

  it('is fail-soft on malformed input (never throws)', () => {
    expect(() => withFrontDoorNudge(null, 'rank_markets', {})).not.toThrow();
    expect(withFrontDoorNudge(null, 'rank_markets', {})).toBeNull();
    expect(() => withFrontDoorNudge({}, 'rank_markets', {})).not.toThrow();
    expect(() => withFrontDoorNudge(mkResult(), 'rank_markets', null)).not.toThrow();
  });
});
