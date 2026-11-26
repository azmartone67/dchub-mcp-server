// plan-handoff-link-1125.test.mjs — the plan-step handoff token and the limit-hit labels (2026-11-25).
// End to end (a linked keyless caller's plan past the per-IP wall): test/commercial-wall-p02-1122.test.mjs.
import { describe, it, expect } from 'vitest';
import { mintPlanHandoffLinkToken, consumePlanHandoffLinkToken, linkedPlanTierNote } from '../lib/plan-handoff-link.mjs';
import { limitHitOf, limitBlocker, limitSkip } from '../lib/plan-limit-hit.mjs';
import { LIMIT_HIT_STATUSES } from '../server.mjs';

const TOK = 'dchl1.x1' + 'Q'.repeat(40) + '.' + 'f'.repeat(32);

describe('plan handoff-link token', () => {
  it('carries the tier and linked token once', () => {
    const t = mintPlanHandoffLinkToken('pro', TOK);
    expect(typeof t).toBe('string');
    expect(consumePlanHandoffLinkToken(t)).toEqual({ tier: 'pro', linked_token: TOK });
    expect(consumePlanHandoffLinkToken(t)).toBeNull();   // single use
  });
  it('is refused when expired, unknown or empty, and never minted without a tier and token', () => {
    const now = 1_000_000;
    const t = mintPlanHandoffLinkToken('developer', TOK, now);
    expect(consumePlanHandoffLinkToken(t, now + 120_001)).toBeNull();
    expect(consumePlanHandoffLinkToken('x'.repeat(72))).toBeNull();
    expect(consumePlanHandoffLinkToken('')).toBeNull();
    expect(mintPlanHandoffLinkToken('', TOK)).toBeNull();
    expect(mintPlanHandoffLinkToken('pro', '')).toBeNull();
  });
});

describe('plan limit-hit labels', () => {
  it('reads a limit wall body, nothing else', () => {
    expect(limitHitOf({ error: 'anon_hard_wall' }, LIMIT_HIT_STATUSES)).toBe('anon_hard_wall');
    expect(limitHitOf({ error: 'not_found' }, LIMIT_HIT_STATUSES)).toBeNull();
    expect(limitHitOf({ shortlist: [] }, LIMIT_HIT_STATUSES)).toBeNull();
    expect(limitHitOf(null, LIMIT_HIT_STATUSES)).toBeNull();
  });
  it('finds the dependency that hit a limit and words the skip as an access limit', () => {
    const ex = [{ step: 1, tool: 'site_selection_canvas', status: 'executed', limit_hit: 'anon_hard_wall' }];
    const dep = limitBlocker({ step: 2, depends_on: [1] }, ex);
    expect(dep).toBe(ex[0]);
    expect(limitBlocker({ step: 2, depends_on: [] }, ex)).toBeNull();
    expect(limitBlocker({ step: 2, depends_on: [1] }, [{ step: 1, tool: 'x', status: 'executed' }])).toBeNull();
    const s = limitSkip(dep, 'iso', '2026-11-26T00:00:00Z');
    expect(s.blocked_by).toEqual({ step: 1, tool: 'site_selection_canvas', limit: 'anon_hard_wall' });
    expect(s.note).toMatch(/^step 1 site_selection_canvas hit this caller's DC Hub limit \(anon_hard_wall\) \(it resets at 2026-11-26T00:00:00Z\), so it returned no rows to take <iso> from\. This is an access limit, not missing data/);
  });
});

describe('linked plan tier_note (2026-11-25)', () => {
  const L = 'no key \u2014 linked DC Hub access (agent handoff): ';
  const ok = (tool) => ({ tool, status: 'executed', result: { rows: [1] } });
  it('says full depth when every data step came back full', () => {
    expect(linkedPlanTierNote([ok('site_selection_canvas'), ok('get_grid_intelligence')])).toBe(L + 'steps ran at full depth');
  });
  it('names a step that came back at preview depth or hit a limit', () => {
    const ex = [ok('site_selection_canvas'), { ...ok('get_grid_intelligence'), depth: 'preview' },
      { ...ok('get_interconnection_queue'), limit_hit: 'anon_hard_wall' }];
    expect(linkedPlanTierNote(ex)).toBe(L + 'steps ran at full depth except get_grid_intelligence, get_interconnection_queue (preview depth or a limit)');
  });
  it('a tool full for one ISO and walled for another is held, not full', () => {
    const ex = [ok('site_selection_canvas'), ok('get_interconnection_queue'), { ...ok('get_interconnection_queue'), limit_hit: 'anon_hard_wall' }];
    expect(linkedPlanTierNote(ex)).toBe(L + 'steps ran at full depth except get_interconnection_queue (preview depth or a limit)');
  });
  it('does not claim full depth when no data step returned anything', () => {
    expect(linkedPlanTierNote([{ tool: 'get_grid_intelligence', status: 'failed' }, { tool: 'get_interconnection_queue', status: 'skipped_unresolved' }])).toBe(L + 'no data step returned results');
  });
  it('says so when nothing came back full', () => {
    expect(linkedPlanTierNote([{ tool: 'site_selection_canvas', status: 'gated_preview' }])).toBe(L + 'every step came back at preview depth or hit a limit');
  });
});
