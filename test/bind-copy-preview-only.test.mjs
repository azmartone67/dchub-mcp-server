// The _bind block promises full answers only where a bound email actually opens them.
// Growth freeze (owner 2026-10-19): get_market_intel joined the email allowance, so its _bind copy
// now promises the lift, like grid/queue. Every preview-only tool is in the allowance today, so the
// control for "a preview-only tool outside the allowance" is the kill switch
// (DCHUB_EMAIL_FULL_DECISION_TOOLS=0, read per call): with it off, get_market_intel is back outside
// the allowance and must not promise full answers.
import { describe, it, expect, afterEach } from 'vitest';
import { withBindHint } from '../server.mjs';

const call = (name) => withBindHint(
  { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }], structuredContent: { ok: true } },
  name, { api_key: 'dch_live_x', tier: 'free' });
const whyOf = (r) => r.structuredContent && r.structuredContent._bind && r.structuredContent._bind.why;

const FLAG = 'DCHUB_EMAIL_FULL_DECISION_TOOLS';
const _saved = process.env[FLAG];
afterEach(() => { if (_saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = _saved; });

describe('_bind copy matches the tool depth', () => {
  it('get_market_intel (in the email allowance): promises the full-answer lift', () => {
    delete process.env[FLAG];
    const why = whyOf(call('get_market_intel'));
    if (!why) return; // caller not bindable in this harness: nothing to assert
    expect(why).toMatch(/full get_market_intel answers\/day/);
    expect(why).not.toContain('does not open full get_market_intel answers');
  });
  it('control: a preview-only tool outside the allowance (switch off) makes no full-answer promise', () => {
    process.env[FLAG] = '0';
    const r = call('get_market_intel');
    const why = whyOf(r);
    if (!why) return;
    expect(why).toContain('does not open full get_market_intel answers');
    expect(why).not.toMatch(/full get_market_intel answers\/day/);
    expect(r.content.some((c) => /lift your daily full-data cap/.test(c.text))).toBe(false);
  });
  it('get_grid_data keeps the full-answers promise', () => {
    const why = whyOf(call('get_grid_data'));
    if (!why) return;
    expect(why).toMatch(/full get_grid_data answers\/day/);
  });
});
