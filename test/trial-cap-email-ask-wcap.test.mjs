import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _trialCapAsksEmail, _wallKindFor, WALL_KIND_CAPACITY } from '../server.mjs';
import { markEmailAsk, quotaWallEventBody } from '../lib/keyless-wall.mjs';

describe('trial_cap_exceeded email_ask (option E)', () => {
  it('asks only for an unbound, non-paid caller', () => {
    expect(_trialCapAsksEmail(false, false)).toBe(true);
    expect(_trialCapAsksEmail(false, true)).toBe(false);
    expect(_trialCapAsksEmail(true, false)).toBe(false);
    expect(_trialCapAsksEmail(true, true)).toBe(false);
  });
  it('unbound wall row carries bind_field; bound row carries none', () => {
    const unbound = {}; if (_trialCapAsksEmail(false, false)) markEmailAsk(unbound, 'bind_field');
    expect(quotaWallEventBody({ c: unbound, name: 'get_market_intel', status: 'trial_cap_exceeded' }).email_ask).toBe('bind_field');
    const bound = {}; if (_trialCapAsksEmail(false, true)) markEmailAsk(bound, 'bind_field');
    expect(quotaWallEventBody({ c: bound, name: 'get_market_intel', status: 'trial_cap_exceeded' }).email_ask).toBeUndefined();
  });
  it('a stronger mark already set is kept', () => {
    const c = { _emailAsk: 'link' }; markEmailAsk(c, 'bind_field');
    expect(c._emailAsk).toBe('link');
  });
  it('the over-cap branch calls the mark', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(_trialCapAsksEmail\(_paidTaste, _bound\)\) _markEmailAsk\(c, 'bind_field'\);/);
  });
});

describe('trial_cap_exceeded wall kind', () => {
  const sc = { preview_is_partial: true, _upgrade: { tier: 'trial',
    message: "You've used your 3 full `get_tax_incentives` answers today (tier trial/free) — you're now on the trimmed preview." } };
  it('capacity wall on a pack-openable tool is stamped w-capacity', () => {
    expect(_wallKindFor(sc, {}, 'get_tax_incentives')).toBe(WALL_KIND_CAPACITY);
  });
  it('Pro-only tool is never stamped w-capacity', () => {
    expect(_wallKindFor(sc, {}, 'analyze_site')).toBe('');
  });
});
