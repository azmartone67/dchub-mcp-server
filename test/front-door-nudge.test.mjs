// r-front-door-inband (2026-07-21): the in-band front-door nudge surfaces
// execute_plan on the FIRST workflow-entry tool of a session, so agents whose
// cached instructions never learned the front door still discover it mid-
// session. These tests pin the behavior contract: fires on the right tools,
// once per session, never on the wrong ones, and NEVER breaks a response.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withFrontDoorNudge } from '../server.mjs';

// Fresh, minimal DC Hub envelope result. Unique session per test so the
// module-level once-per-session dedupe never leaks across cases.
const mkResult = () => ({
  content: [{ type: 'text', text: JSON.stringify({ _entity: 'market', ok: true }) }],
  structuredContent: { _entity: 'market', ok: true },
});
// ★ 2026-07-27: was `plan_query`. execute_plan replaced it as the front door;
// plan_query only SHOWS the plan, so a nudged agent still chained every step by
// hand — the exact work the front door removes.
const NUDGE = '`execute_plan`';

describe('withFrontDoorNudge', () => {
  it('fires on a workflow-entry tool for a fresh session (text + structured)', () => {
    const r = withFrontDoorNudge(mkResult(), 'rank_markets', { session_id: 'fd-s1' });
    expect(r.content.length).toBe(2);
    expect(r.content[1].text).toContain(NUDGE);
    expect(r.structuredContent._front_door).toBeTruthy();
    expect(r.structuredContent._front_door.next_tool).toBe('execute_plan');
    // must not clobber content[0] — downstream JSON.parse of the payload survives
    expect(() => JSON.parse(r.content[0].text)).not.toThrow();
  });

  it('does NOT fire on non-entry tools (terminal / identity / meta)', () => {
    for (const t of ['get_changes', 'claim_free_key', 'plan_query', 'execute_plan', 'get_facility', 'why_dchub']) {
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

  it('is idempotent — never double-adds if execute_plan is already mentioned', () => {
    const r = mkResult();
    r.content.push({ type: 'text', text: 'see `execute_plan` to run it' });
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


// ── the channel that reaches agents with stale instructions ──────────
// Measured 2026-07-27 across all 80 live tool descriptions: `execute_plan`
// appeared exactly once (its own) and key reuse zero times, while the funnel
// showed 2,586 redemptions from 169 distinct agents (~15 re-mints each) and
// 37.9% of keyed agents never making a single call. Tool descriptions are the
// one channel every MCP client reads, so the guidance has to live here too.
describe('front-door + key guidance live in the tool-description channel', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const claim = src.slice(src.indexOf('Mint a FREE DC Hub dev key'),
                          src.indexOf('Returns {api_key', src.indexOf('Mint a FREE DC Hub dev key')));

  it('the nudge routes to the tool that ANSWERS, not the one that only plans', () => {
    const i = src.indexOf('Starting a multi-step task?');
    const line = src.slice(i, i + 420);
    expect(line).toContain('`execute_plan`');
    expect(line).toMatch(/RUNS|runs/);
  });

  it('claim_free_key tells the agent to keep and reuse the key', () => {
    expect(claim).toMatch(/SAVE THE KEY AND REUSE IT/);
    expect(claim).toMatch(/Do NOT call this again/);
    expect(claim).toContain('recover_my_key');
  });

  it('claim_free_key tells the agent to actually use it next', () => {
    expect(claim).toMatch(/THEN ACTUALLY USE IT/);
    expect(claim).toContain('execute_plan');
  });
});
