// get_market_intel is a preview on every non-paid seat (a bound email does not deepen it), so its _bind
// block and prose line must not promise full answers. Grid/queue (email allowance) and others keep theirs.
import { describe, it, expect } from 'vitest';
import { withBindHint } from '../server.mjs';

const call = (name) => withBindHint(
  { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }], structuredContent: { ok: true } },
  name, { api_key: 'dch_live_x', tier: 'free' });

describe('_bind copy matches the tool depth', () => {
  it('get_market_intel: no full-answer promise, no prose cap line', () => {
    const r = call('get_market_intel');
    const why = r.structuredContent && r.structuredContent._bind && r.structuredContent._bind.why;
    if (!why) return; // caller not bindable in this harness: nothing to assert
    expect(why).toContain('does not open full get_market_intel answers');
    expect(why).not.toMatch(/full get_market_intel answers\/day/);
    expect(r.content.some((c) => /lift your daily full-data cap/.test(c.text))).toBe(false);
  });
  it('get_grid_data keeps the full-answers promise', () => {
    const r = call('get_grid_data');
    const why = r.structuredContent && r.structuredContent._bind && r.structuredContent._bind.why;
    if (!why) return;
    expect(why).toMatch(/full get_grid_data answers\/day/);
  });
});
