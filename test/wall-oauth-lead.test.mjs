// OAuth sign-in leads the wall (owner 2026-11-12, 12:53 PM Phoenix: "Make OAuth sign-in the lead wall offer and add a
// free-key offer to Grok's wall"; lib/wall-oauth-lead.mjs, server.mjs _wallOfferFloorStep).
// Rules asserted:
//   · a walled /mcp answer carries the sign-in line (naming https://dchub.cloud/mcp/oauth) BEFORE the email ask / digest
//     line, and both of those stay on the wall as secondary offers;
//   · Grok keeps its wall copy byte for byte; one extra block after it names /mcp/grok/oauth as the free key, with no
//     header / config / tool-name copy, no price and no plan name;
//   · never when WorkOS validation is off (nothing to sign in to), when the caller is already signed in or email-bound,
//     on a non-wall, on a clean platform / directory profile / plan step, or with the kill switch set;
//   · offers_shown reads it as 'oauth_signin' (lib/offers-shown.mjs OFFER_KINDS).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { FLOOR_EMAIL_LEAD, FLOOR_DIGEST_LEAD } from '../lib/wall-offer-floor.mjs';
import { OAUTH_LEAD, GROK_OAUTH_LEAD, OAUTH_SIGNIN_URL, GROK_OAUTH_SIGNIN_URL, wallOauthLeadEligible, wallOauthLeadLine,
  withOauthLeadLine, wallOauthLeadOn } from '../lib/wall-oauth-lead.mjs';
import { offersShown, OFFER_KINDS } from '../lib/offers-shown.mjs';

let S, fence;
const prev = {};
const ENV = ['DCHUB_WALL_OFFER_FLOOR', 'DCHUB_API_BASE', 'DCHUB_WORKOS_OAUTH_ENABLED', 'DCHUB_WALL_OAUTH_LEAD'];
beforeAll(async () => {
  fence = fenceNetwork();
  for (const k of ENV) prev[k] = process.env[k];
  delete process.env.DCHUB_WALL_OFFER_FLOOR;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:9';
  S = await import('../server.mjs');
}, 60_000);
afterAll(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (fence) fence.restore();
});
beforeEach(() => { process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1'; delete process.env.DCHUB_WALL_OAUTH_LEAD; });
afterEach(() => { delete process.env.DCHUB_WORKOS_OAUTH_ENABLED; delete process.env.DCHUB_WALL_OAUTH_LEAD; });

const wall = () => ({ content: [{ type: 'text', text: '{"preview":true}' }, { type: 'text', text: 'Source: DC Hub (dchub.cloud)' }] });
const ctx = (o = {}, tool = 'rank_markets') => ({ session_id: 's-oauth', platform: 'cursor', auth_source: 'none', tier: 'anonymous',
  _pendingWallHits: [{ name: tool, status: 'anon_hard_wall', sent: false }], ...o });
const blocks = (r) => r.content.map((b) => b.text || '');
const textOf = (r) => blocks(r).join('\n');
const idx = (r, needle) => blocks(r).findIndex((t) => t.includes(needle));
const FORBIDDEN = /\$\s?\d|\bper month\b|\b(?:developer|pro|enterprise|credit[_ ]pack|starter)\b plan|\bpricing\b/i;

describe('a walled /mcp answer leads with the OAuth sign-in', () => {
  it('the sign-in line comes right after block 0, ahead of the email ask / digest line, which stay', () => {
    const c = ctx();
    const out = S._wallOfferFloorStep(wall(), 'rank_markets', c);
    const lead = idx(out, OAUTH_LEAD);
    const floor = Math.max(idx(out, FLOOR_EMAIL_LEAD), idx(out, FLOOR_DIGEST_LEAD));
    expect(lead).toBe(1);
    expect(floor).toBeGreaterThan(lead);
    expect(textOf(out)).toContain(OAUTH_SIGNIN_URL);
    expect(textOf(out)).toMatch(/`(?:bind_email|subscribe_digest)`|share your email/i);
    expect(blocks(out)[0]).toBe('{"preview":true}');
    expect(blocks(out).at(-1)).toBe('Source: DC Hub (dchub.cloud)');
    expect(c._offerFloor).toBe('allowed');
  });
  it('a trial-key caller (not signed in, not email-bound) still gets one-click OAuth first, then the email ask', () => {
    const c = ctx({ api_key: 'dch_trial_walloauth1', tier: 'trial', auth_source: 'trial' });
    const out = S._wallOfferFloorStep(wall(), 'rank_markets', c);
    const lead = idx(out, OAUTH_LEAD);
    const floor = Math.max(idx(out, FLOOR_EMAIL_LEAD), idx(out, FLOOR_DIGEST_LEAD));
    expect(lead).toBe(1);
    expect(floor).toBeGreaterThan(lead);
    expect(blocks(out)[lead]).toMatch(/^One-click sign-in, free:/);
    expect(textOf(out)).toContain(OAUTH_SIGNIN_URL);
    expect(textOf(out)).toMatch(/`(?:bind_email|subscribe_digest)`|share your email/i);
    expect(textOf(out)).not.toMatch(FORBIDDEN);
  });
  it('an anonymous keyless caller gets the same one-click OAuth line as the first offer', () => {
    const out = S._wallOfferFloorStep(wall(), 'rank_markets', ctx({ auth_source: 'none', tier: 'anonymous' }));
    expect(idx(out, OAUTH_LEAD)).toBe(1);
    expect(idx(out, OAUTH_LEAD)).toBeLessThan(Math.max(idx(out, FLOOR_EMAIL_LEAD), idx(out, FLOOR_DIGEST_LEAD)));
    expect(blocks(out)[1].startsWith(OAUTH_LEAD)).toBe(true);
    expect(blocks(out)[1]).toContain(OAUTH_SIGNIN_URL);
  });
  it('a wall that already carries an email ask keeps it and still gets the lead', () => {
    const c = ctx();
    const input = wall();
    input.content.splice(1, 0, { type: 'text', text: 'Ask your human for their email and call `bind_email`.' });
    const out = S._wallOfferFloorStep(input, 'rank_markets', c);
    expect(idx(out, OAUTH_LEAD)).toBe(1);
    expect(textOf(out)).toContain('Ask your human for their email');
    expect(textOf(out)).not.toContain(FLOOR_EMAIL_LEAD);   // the floor line was not doubled
  });
  it('a depth wall claims no more than the sign-in gives', () => {
    const out = S._wallOfferFloorStep(wall(), 'list_transactions', ctx({}, 'list_transactions'));
    expect(textOf(out)).toContain(OAUTH_SIGNIN_URL);
    expect(wallOauthLeadLine({ depth: true })).toMatch(/does not open the fields held back/);
    expect(wallOauthLeadLine({ depth: false })).not.toMatch(/held back/);
  });
  it('free path: no price, no plan name', () => {
    for (const l of [wallOauthLeadLine({}), wallOauthLeadLine({ depth: true }), wallOauthLeadLine({ grok: true }), wallOauthLeadLine({ grok: true, depth: true })]) {
      expect(l).not.toMatch(FORBIDDEN);
    }
  });
  it.each([
    ['WorkOS validation off', () => { delete process.env.DCHUB_WORKOS_OAUTH_ENABLED; }, {}],
    ['kill switch', () => { process.env.DCHUB_WALL_OAUTH_LEAD = '0'; }, {}],
    ['already signed in', () => {}, { auth_oauth: true }],
    ['email-bound', () => {}, { email: 'a@example.com' }],
  ])('no sign-in line: %s (the floor line is unchanged)', (_l, set, o) => {
    set();
    const out = S._wallOfferFloorStep(wall(), 'rank_markets', ctx(o));
    expect(textOf(out)).not.toContain(OAUTH_SIGNIN_URL);
    expect(textOf(out)).toMatch(new RegExp(FLOOR_EMAIL_LEAD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|' + FLOOR_DIGEST_LEAD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
  it('a non-wall answer is untouched', () => {
    const input = wall();
    expect(S._wallOfferFloorStep(input, 'rank_markets', ctx({ _pendingWallHits: [] }))).toBe(input);
  });
  it.each([
    ['profile', { profile: 'claude_directory' }],
    ['profile', { profile: 'chatgpt_directory' }],
    ['plan_step', { loopback_step: true }],
  ])('%s (%j): left as it was', (_w, o) => {
    const input = wall();
    expect(S._wallOfferFloorStep(input, 'rank_markets', ctx(o))).toBe(input);
  });
});

describe('Grok: contract copy untouched, one free-key block added', () => {
  it.each(['grok', 'connectors-manager'])('%s: the wall blocks are byte for byte; one block after them names /mcp/grok/oauth', (platform) => {
    const input = wall();
    const c = ctx({ platform });
    const out = S._wallOfferFloorStep(input, 'rank_markets', c);
    expect(c._offerFloor).toBe('grok');
    const b = blocks(out);
    expect(b).toHaveLength(blocks(input).length + 1);
    expect(b.filter((t) => !t.startsWith(GROK_OAUTH_LEAD))).toEqual(blocks(input));
    expect(b[1].startsWith(GROK_OAUTH_LEAD)).toBe(true);
    expect(b[1]).toContain(GROK_OAUTH_SIGNIN_URL);
    // G3: no header, config, reconnect or tool-name copy; Grok's tools/list is eleven tools.
    expect(b[1]).not.toMatch(/X-API-Key|header|claim_free_key|bind_email|subscribe_digest|persist|reconnect|config/i);
    expect(b[1]).not.toMatch(FORBIDDEN);
    expect(textOf(out)).not.toContain(FLOOR_EMAIL_LEAD);
    expect(textOf(out)).not.toContain(FLOOR_DIGEST_LEAD);
  });
  it('not on a Grok answer that did not wall, not with WorkOS off, signed in, or the kill switch', () => {
    const input = wall();
    expect(S._wallOfferFloorStep(input, 'rank_markets', ctx({ platform: 'grok', _pendingWallHits: [] }))).toBe(input);
    delete process.env.DCHUB_WORKOS_OAUTH_ENABLED;
    expect(S._wallOfferFloorStep(input, 'rank_markets', ctx({ platform: 'grok' }))).toBe(input);
    process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1';
    expect(S._wallOfferFloorStep(input, 'rank_markets', ctx({ platform: 'grok', auth_oauth: true }))).toBe(input);
    process.env.DCHUB_WALL_OAUTH_LEAD = '0';
    expect(S._wallOfferFloorStep(input, 'rank_markets', ctx({ platform: 'grok' }))).toBe(input);
  });
});

describe('lib/wall-oauth-lead.mjs and offers_shown', () => {
  it('eligibility is pure and fail-closed', () => {
    const base = { walled: true, workosEnabled: true, signedIn: false, bound: false, env: {} };
    expect(wallOauthLeadEligible(base)).toBe(true);
    for (const k of ['walled', 'workosEnabled']) expect(wallOauthLeadEligible({ ...base, [k]: false })).toBe(false);
    for (const k of ['signedIn', 'bound']) expect(wallOauthLeadEligible({ ...base, [k]: true })).toBe(false);
    expect(wallOauthLeadEligible({ ...base, env: { DCHUB_WALL_OAUTH_LEAD: 'off' } })).toBe(false);
    expect(wallOauthLeadOn({})).toBe(true);
  });
  it('withOauthLeadLine puts one block at index 1 and tolerates junk', () => {
    const r = withOauthLeadLine(wall(), 'x');
    expect(blocks(r)[1]).toBe('x');
    expect(withOauthLeadLine(null, 'x')).toBe(null);
    const w = wall();
    expect(withOauthLeadLine(w, '')).toBe(w);
  });
  it('offers_shown names the sign-in offer, for /mcp and Grok, and keeps the list sorted and mirrored', () => {
    expect(OFFER_KINDS).toContain('oauth_signin');
    expect(offersShown(withOauthLeadLine(wall(), wallOauthLeadLine({})), '')).toContain('oauth_signin');
    expect(offersShown(withOauthLeadLine(wall(), wallOauthLeadLine({ grok: true })), '')).toContain('oauth_signin');
    expect(offersShown(wall(), '')).not.toContain('oauth_signin');
    expect([...OFFER_KINDS]).toEqual([...OFFER_KINDS].slice().sort());
  });
});
