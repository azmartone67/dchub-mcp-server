// lib/keyless-wall.mjs, unit level (2026-10-16). The e2e file is keyless-wall-email-first.test.mjs.
import { describe, it, expect } from 'vitest';
import {
  QUOTA_WALL_STATUSES, LAND_SITE_TOOLS, nextUtcMonthStart, keylessWallQuota, withKeylessWallQuota,
  keylessCapEmailResult, keylessSoftCapEmailUpgrade, quotaWallEventBody, markEmailAsk, WALL_ASK_KINDS, sessionIdentity, realSession,
  keylessEmailFirstOn, quotaWallEventOn, keylessTrialOfferOn,
} from '../lib/keyless-wall.mjs';

describe('the mirrored lists', () => {
  it('QUOTA_WALL_STATUSES equals dchub-backend routes/mcp_funnel_events.QUOTA_WALL_STATUSES', () => {
    // The backend pins the same literal (tests/test_mcp_funnel_events.py). Change both together.
    expect([...QUOTA_WALL_STATUSES].sort()).toEqual(['anon_daily_cap', 'anon_hard_wall', 'blocked_paid_only',
      'credits_depleted', 'lp_free_spent', 'lp_wall', 'metered_enforced', 'monthly_quota_blocked',
      'pro_wall', 'trial_cap_exceeded', 'trial_used']);
  });
  it('the land/site tools are the five the brief names', () => {
    expect([...LAND_SITE_TOOLS].sort()).toEqual(['analyze_parcel', 'analyze_site', 'execute_plan',
      'find_sites', 'site_selection_canvas']);
  });
});

describe('resets_at is the next UTC month start', () => {
  it('mid-month, last instant of a month, December', () => {
    expect(nextUtcMonthStart(new Date('2026-10-16T12:00:00Z'))).toBe('2026-11-01T00:00:00Z');
    expect(nextUtcMonthStart(new Date('2026-10-31T23:59:59Z'))).toBe('2026-11-01T00:00:00Z');
    expect(nextUtcMonthStart(new Date('2026-12-15T00:00:00Z'))).toBe('2027-01-01T00:00:00Z');
    // 2026-11-01T02:00 in UTC-7 is still Oct 31 locally: the UTC month decides
    expect(nextUtcMonthStart(new Date('2026-11-01T02:00:00Z'))).toBe('2026-12-01T00:00:00Z');
  });
  it('keylessWallQuota: 0 left, the reset, a basis', () => {
    const q = keylessWallQuota(new Date('2026-10-16T00:00:00Z'));
    expect(q.remaining_this_month).toBe(0);
    expect(q.resets_at).toBe('2026-11-01T00:00:00Z');
    expect(q.quota_basis).toMatch(/keyless/);
  });
  it('withKeylessWallQuota writes structuredContent and a JSON block 0, leaves prose alone', () => {
    const now = new Date('2026-10-16T00:00:00Z');
    const j = withKeylessWallQuota({ content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 1 } }, now);
    expect(j.structuredContent).toMatchObject({ a: 1, remaining_this_month: 0, resets_at: '2026-11-01T00:00:00Z' });
    expect(JSON.parse(j.content[0].text).resets_at).toBe('2026-11-01T00:00:00Z');
    const p = withKeylessWallQuota({ content: [{ type: 'text', text: 'Unlock → x' }], structuredContent: {} }, now);
    expect(p.content[0].text).toBe('Unlock → x');
    expect(withKeylessWallQuota(null)).toBe(null);
  });
});

describe('the email-first cap wall', () => {
  const r = keylessCapEmailResult({ name: 'find_sites', link: 'https://dchub.cloud/u/abcdef',
    base: { error: 'anon_hard_wall', limit: 300, credits_url: 'https://dchub.cloud/go/c/x.y', signup_url: 'https://dchub.cloud/signup' } });
  it('one offer line first, claim_free_key last, human_url = the one link', () => {
    const lines = r.content[0].text.split('\n\n');
    expect(lines[0]).toBe('Keep going free by email → https://dchub.cloud/u/abcdef');
    expect(lines[lines.length - 1]).toMatch(/claim_free_key/);
    expect(lines.filter((l) => /claim_free_key/.test(l)).length).toBe(1);
    expect(r.structuredContent.human_url).toBe('https://dchub.cloud/u/abcdef');
    expect(r.structuredContent.for_your_human.url).toBe('https://dchub.cloud/u/abcdef');
  });
  it('keeps the limit facts, drops the checkout and sign-up links', () => {
    expect(r.structuredContent).toMatchObject({ error: 'anon_hard_wall', limit: 300, unlock_kind: 'email_cap' });
    expect(r.structuredContent.credits_url).toBeUndefined();
    expect(r.structuredContent.signup_url).toBeUndefined();
    const urls = JSON.stringify(r).match(/https:\/\/dchub\.cloud\/[A-Za-z0-9/_.-]+/g);
    expect([...new Set(urls)]).toEqual(['https://dchub.cloud/u/abcdef']);
  });
  it('no plan name, price or "/mo" anywhere', () => {
    const s = JSON.stringify(r);
    expect(s).not.toMatch(/\bPro\b|Developer|Starter|\$\s?\d|\/mo\b|per month/);
  });
  it('no link, no wall', () => {
    expect(keylessCapEmailResult({ name: 'find_sites', link: '' })).toBe(null);
  });
  it('soft cap: data kept, _upgrade email first', () => {
    const t = keylessSoftCapEmailUpgrade({ data: [1, 2], _upgrade: { message: 'claim_free_key first', remaining_today: 0 } },
      { name: 'find_sites', link: 'https://dchub.cloud/u/abcdef' });
    expect(t.data).toEqual([1, 2]);
    expect(t._upgrade.message.startsWith('Keep going free by email → https://dchub.cloud/u/abcdef')).toBe(true);
    expect(t._upgrade.message.indexOf('claim_free_key')).toBeGreaterThan(0);
    expect(t.human_url).toBe('https://dchub.cloud/u/abcdef');
  });
});

describe('quota_wall_hit body', () => {
  it('a wall status or a paid_tool_blocked call makes one; anything else makes none', () => {
    expect(quotaWallEventBody({ c: { session_id: 's1' }, name: 'find_sites', status: 'anon_hard_wall' }))
      .toMatchObject({ event: 'quota_wall_hit', wall_status: 'anon_hard_wall', session_id: 's1', paid_blocked: false });
    expect(quotaWallEventBody({ c: {}, name: 'x', status: 'lp_preview', paidBlocked: true }))
      .toMatchObject({ wall_status: 'other', paid_blocked: true });
    expect(quotaWallEventBody({ c: {}, name: 'x', status: 'ok' })).toBe(null);
    expect(quotaWallEventBody({ c: {}, name: 'x', status: 'error' })).toBe(null);
  });
  it("'no-session' is not a session", () => {
    expect(quotaWallEventBody({ c: { session_id: 'no-session' }, name: 'x', status: 'pro_wall' }).session_id).toBe('');
  });
});

describe('identity and switches', () => {
  it('sk-<sha256(session)>; empty without a real session', () => {
    expect(sessionIdentity('abc')).toBe('sk-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sessionIdentity('')).toBe('');
    expect(sessionIdentity('no-session')).toBe('');
    expect(realSession(' no-session ')).toBe('');
  });
  it('every behaviour has its own kill switch, default on', () => {
    for (const f of [keylessEmailFirstOn, quotaWallEventOn, keylessTrialOfferOn]) expect(f({})).toBe(true);
    expect(keylessEmailFirstOn({ DCHUB_KEYLESS_EMAIL_FIRST: '0' })).toBe(false);
    expect(quotaWallEventOn({ DCHUB_QUOTA_WALL_EVENT: 'off' })).toBe(false);
    expect(keylessTrialOfferOn({ DCHUB_PRO_TRIAL_OFFER_KEYLESS: 'false' })).toBe(false);
  });
});

describe('option E: markEmailAsk + the email_ask field (owner 2026-10-26)', () => {
  it('kinds equal dchub-backend routes/mcp_funnel_events.WALL_ASK_KINDS', () => {
    expect([...WALL_ASK_KINDS].sort()).toEqual(['bind_field', 'line', 'link', 'link_exit']);
  });
  it('bind_field never replaces a stronger mark; a stronger mark replaces bind_field; junk is ignored', () => {
    const c = {};
    markEmailAsk(c, 'bind_field'); expect(c._emailAsk).toBe('bind_field');
    markEmailAsk(c, 'link_exit'); expect(c._emailAsk).toBe('link_exit');
    markEmailAsk(c, 'bind_field'); expect(c._emailAsk).toBe('link_exit');
    markEmailAsk(c, 'no_email'); expect(c._emailAsk).toBe('link_exit');
    expect(() => markEmailAsk(null, 'line')).not.toThrow();
  });
  it('quotaWallEventBody carries email_ask only for a known kind', () => {
    const base = { name: 'find_sites', status: 'anon_daily_cap' };
    expect(quotaWallEventBody({ ...base, c: { _emailAsk: 'line' } }).email_ask).toBe('line');
    expect(quotaWallEventBody({ ...base, c: {} })).not.toHaveProperty('email_ask');
    expect(quotaWallEventBody({ ...base, c: { _emailAsk: 'x' } })).not.toHaveProperty('email_ask');
  });
});
