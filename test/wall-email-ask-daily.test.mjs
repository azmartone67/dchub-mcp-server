// The session-based keyless cap wall carries the daily-habit email ask (owner 2026-11-17, mcp#1539).
//
//   * structured: email_ask = {tool: CLAIM_TOOL, arguments: {email, market?}, copy}: the ONE call that mints the
//     key, binds the email and follows the market.
//   * text: the new copy ("Give your email to keep this answer and get daily changes for <Market>."), and on the
//     day's first wall (option C, owner 2026-10-26) the text never names the key tool.
//   * the claim's `following` passes the backend's double opt-in `confirmation` through; pending adds
//     "Check your email to confirm."
//
// test/keyless-wall-email-first.test.mjs pins the rest of these walls; this file only adds.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { keylessCapEmailResult, keylessSoftCapEmailUpgrade, _resetCapWallDay } from '../lib/keyless-wall.mjs';
import { CLAIM_TOOL } from '../lib/claim-handoff.mjs';
import { KEY_TOOL_LISTED } from '../lib/key-tool-name.mjs';
import * as D from '../lib/daily-habit.mjs';

process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
process.env.DCHUB_KEYLESS_SITE_FULL = '0';
process.env.DCHUB_LEAN_RESPONSES = '0';

const LINK = 'https://dchub.cloud/u/abcdef';
const COPY_M = 'Give your email to keep this answer and get daily changes for Dallas.';
const COPY = 'Give your email to keep this answer and get daily changes.';
const EMAIL = '<your human’s email>';

describe('builders: email_ask on the session cap walls', () => {
  it('hard wall, first of the day: structured one call with the market; text has the copy, never the key tool', () => {
    const r = keylessCapEmailResult({ name: 'find_sites', link: LINK, exitShown: false, askMarket: 'dallas' });
    expect(r.structuredContent.email_ask).toEqual({ tool: CLAIM_TOOL, arguments: { email: EMAIL, market: 'dallas' }, copy: COPY_M });
    const text = r.content.map((b) => b.text).join('\n');
    expect(text).toContain(COPY_M);
    expect(text).not.toContain(CLAIM_TOOL);          // option C
    expect(text).not.toContain('claim_free_key');
    expect(r.structuredContent.next_tool).toBeUndefined();
    expect(r.structuredContent.next_step).toBe('human_url');
  });
  it('hard wall with no market: arguments carry the email only, the copy drops "for <Market>"', () => {
    const r = keylessCapEmailResult({ name: 'find_sites', link: LINK, exitShown: false });
    expect(r.structuredContent.email_ask).toEqual({ tool: CLAIM_TOOL, arguments: { email: EMAIL }, copy: COPY });
    expect(r.content[0].text).toContain(COPY);
    const bad = keylessCapEmailResult({ name: 'find_sites', link: LINK, exitShown: false, askMarket: 'Not A Slug!' });
    expect(bad.structuredContent.email_ask.arguments).toEqual({ email: EMAIL });
  });
  it('a later wall keeps its no-email exit last; the copy sits before it', () => {
    const r = keylessCapEmailResult({ name: 'find_sites', link: LINK, exitShown: true, askMarket: 'dallas' });
    const t = r.content[0].text;
    expect(r.structuredContent.email_ask.arguments.market).toBe('dallas');
    expect(t.indexOf(COPY_M)).toBeGreaterThan(-1);
    expect(t.indexOf(COPY_M)).toBeLessThan(t.indexOf('claim_free_key'));
    expect(t.split('\n').filter((l) => l.includes('claim_free_key'))).toHaveLength(1);
  });
  it('soft cap: _upgrade carries email_ask and the copy, never the key tool on the first wall', () => {
    const s = keylessSoftCapEmailUpgrade({ rows: [1], _upgrade: {} },
      { name: 'search_facilities', link: LINK, exitShown: false, askMarket: 'dallas' });
    expect(s._upgrade.email_ask).toEqual({ tool: CLAIM_TOOL, arguments: { email: EMAIL, market: 'dallas' }, copy: COPY_M });
    expect(s._upgrade.message).toContain(COPY_M);
    expect(s._upgrade.message).not.toContain(CLAIM_TOOL);
    expect(s.rows).toEqual([1]);
  });
  it('no allowance or plan wording in the copy', () => {
    for (const c of [COPY, COPY_M, D.wallEmailAsk('northern-virginia').copy]) {
      expect(c).not.toMatch(/free (tier|key)|\d+\s+(free\s+)?(calls|answers)|\$|\bPro\b|Developer|per day|a day/i);
    }
  });
});

describe('claim following: double opt-in passthrough', () => {
  const ok = { structuredContent: { api_key: 'dch_x' }, content: [{ type: 'text', text: 'key' }] };
  it('confirmation:"pending" passes through and adds "Check your email to confirm."', () => {
    const r = D.withClaimFollowing(ok, { following: { market: 'dallas', daily_url: 'https://dchub.cloud/daily/dallas', confirmation: 'pending' } }, 'dallas');
    expect(r.structuredContent.following).toEqual({ market: 'dallas', daily_url: 'https://dchub.cloud/daily/dallas', confirmation: 'pending' });
    expect(r.content[r.content.length - 1].text).toMatch(/Check your email to confirm\.$/);
  });
  it('a top-level confirmation is read too; confirmed adds no line; junk is dropped', () => {
    expect(D.claimFollowing({ following: { market: 'dallas' }, confirmation: 'pending' }).confirmation).toBe('pending');
    const c = D.withClaimFollowing(ok, { following: { market: 'dallas', confirmation: 'confirmed' } }, 'dallas');
    expect(c.structuredContent.following.confirmation).toBe('confirmed');
    expect(c.content.map((b) => b.text).join('\n')).not.toContain('Check your email');
    expect(D.claimFollowing({ following: { market: 'dallas', confirmation: '<script>' } })).toEqual({ market: 'dallas' });
  });
});

describe('server: the anonymous hard wall with a session carries email_ask', () => {
  let H, fence, anonCount = 0, ipN = 0;
  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({
      env: { DCHUB_ANON_DAILY_CAP: '30', DCHUB_ANON_HARD_WALL_MULT: '10' },
      extraRoutes: (p, req, body) => {
        if (p === '/api/v1/mcp/anon-usage') return { ok: true, count: anonCount };
        if (p === '/api/v1/relay/short') return (body && body.relay_url) ? { ok: true, url: LINK } : { status: 500, body: {} };
        return undefined;
      },
    });
  }, 120_000);
  afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
  beforeEach(() => { anonCount = 0; _resetCapWallDay(); });
  it('find_sites over the hard wall: email_ask in structuredContent, copy in text, no key tool in text', async () => {
    anonCount = 999;
    const hdr = { 'user-agent': 'Claude-User', 'x-dc-client-ip': `203.0.113.${50 + (++ipN)}` };
    const init = await H.init('/mcp', 'claude-ai', hdr);
    const sid = init.headers.get('mcp-session-id');
    H.S._anonUsageCounts.clear();
    const r = await H.call('/mcp', 'find_sites', { state: 'TX', min_mw: 50 }, { ...hdr, 'mcp-session-id': sid });
    const res = (r.msg && r.msg.result) || {};
    const sc = res.structuredContent || {};
    expect(sc.unlock_kind).toBe('email_cap');
    // the served /mcp result names the key tool by its listed name (lib/key-tool-name.mjs); the lib builds CLAIM_TOOL
    expect(sc.email_ask).toEqual({ tool: KEY_TOOL_LISTED, arguments: { email: EMAIL }, copy: COPY });
    const text = (res.content || []).map((b) => b.text || '').join('\n');
    expect(text).toContain(COPY);
    expect(text).not.toContain(CLAIM_TOOL);
  });
});
