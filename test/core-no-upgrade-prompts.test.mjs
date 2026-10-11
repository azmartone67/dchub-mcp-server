// /mcp/core must never carry upgrade, sales or payment prompts addressed to the
// user. Regression: get_grid_intelligence (behind core grid_power) returned a
// free-preview `user_message` with `show_to_user: true` that the core scrub
// passed through unchanged (live run 2026-10-10).
import { describe, it, expect } from 'vitest';
import * as C from '../lib/core-profile.mjs';

const GRID_PREVIEW = {
  ok: true, iso: 'ERCOT', load_mw: 61234,
  completeness: { status: 'partial', kind: 'taste', withheld: ['capacity', 'price'] },
  next_ask: { derived_from: 'rank_markets', question: 'Which data-center markets on this grid rank best for available power?' },
  user_message: 'This free DC Hub preview of ERCOT hides queue depth, time to power, the constraint and excess power scores, 30-day grid emergencies and retail power price.',
  show_to_user: true,
};

const SALES_SHAPES = {
  user_message: 'Get the full picture with a paid plan.',
  message_to_user: 'Upgrade to see all rows.',
  display_message: 'Premium subscribers see more.',
  banner: 'Go Pro today', promo_code: 'SAVE20', sales_note: 'Talk to sales',
  marketing_copy: 'Best data in the industry', nudge: 'Come back tomorrow', cta: 'Buy now',
  upgrade_hint: 'x', nested: { deeper: [{ user_message: 'Paid tier unlocks capacity.', show_to_user: true, value: 7 }] },
};

const SALES_RE = /user_message|show_to_user|\bfree( DC Hub)? preview\b|\bpaid (plan|tier)\b|\bupgrade\b|\bpremium subscribers?\b|\bgo pro\b|\bbuy now\b|promo|sales|marketing/i;

describe('core scrub removes user-facing upgrade prompts', () => {
  it('strips the grid_power free-preview user_message and keeps data', () => {
    const out = C.coreScrub(GRID_PREVIEW);
    const txt = JSON.stringify(out);
    expect(txt).not.toMatch(SALES_RE);
    expect(out.iso).toBe('ERCOT');
    expect(out.load_mw).toBe(61234);
  });

  it('strips banner/cta/user_message shapes generically, at any depth', () => {
    const out = C.coreScrub(SALES_SHAPES);
    expect(JSON.stringify(out)).not.toMatch(SALES_RE);
    expect(out.nested.deeper[0].value).toBe(7);
  });

  it('drops free/paid-preview sales sentences from prose but keeps the rest', () => {
    const t = C.scrubText('ERCOT load is 61 GW. This free DC Hub preview hides queue depth. Paid tier customers see price.');
    expect(t).toContain('ERCOT load is 61 GW.');
    expect(t).not.toMatch(SALES_RE);
  });

  it('a finished core tool result never contains an upgrade prompt, for every delegated section', () => {
    const delegated = { content: [{ type: 'text', text: JSON.stringify(GRID_PREVIEW) }] };
    for (const tool of C.CORE_TOOL_NAMES) {
      const sec = C.toSection('get_grid_intelligence', delegated);
      const env = C.buildEnvelope(tool, { q: 'ERCOT' }, [sec], {});
      const res = C.toToolResult(env);
      expect(res.content[0].text).not.toMatch(/user_message|show_to_user|free( DC Hub)? preview/i);
      expect(JSON.stringify(res.structuredContent)).not.toMatch(/user_message|show_to_user/i);
    }
  });

  it('the last-line content check flags a leaked user_message', () => {
    expect(C.findForbidden(JSON.stringify({ user_message: 'x', show_to_user: true })).length).toBeGreaterThan(0);
  });
});
