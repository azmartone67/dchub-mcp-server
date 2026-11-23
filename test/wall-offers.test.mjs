// wall-offers.test.mjs — the one entitlement-driven wall-offer builder (owner 2026-11-14, E3; lib/wall-offers.mjs).
//
// Rules asserted:
//   1. Byte-identical where eligibility did not change: over the full input matrix, wallOffers() returns exactly the
//      lines, in exactly the places, the floor step composed before (sign-in lead, floor email / digest line, depth
//      trial), and the email-ask tag it marked.
//   2. Entitlements are what the caller HOLDS: a key past its daily allowance (served as an anonymous call, with
//      api_key / email / tier blanked) still holds its key and email (identified) or its paid plan (developer).
//   3. Real /mcp handler: an email-bound key over its day is never asked for an email, a key or a sign-in it already
//      has, and a Developer key over its day is not offered the trial; the wall row records the offers it got
//      (offers_shown) and the tag of the email ask it carried (email_ask). CONTROL: the same walls keyless still
//      carry the email ask, so the assertions can fail.
//   4. Links: an offer line may name only the wall's server-minted link or the fixed connector URLs.
//   5. Limits: a line that states a calls / full-answers figure states canon's.
//   6. Every kind the builder declares is one the wall row's offers_shown recorder detects on that line.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { wallEntitlements, wallOffers, mintedOnly, statesOnlyCanonLimits, offerKinds, HELD_DAILY_QUOTA } from '../lib/wall-offers.mjs';
import { floorOfferKind, floorOfferLine } from '../lib/wall-offer-floor.mjs';
import { wallOauthLeadEligible, wallOauthLeadLine, OAUTH_SIGNIN_URL } from '../lib/wall-oauth-lead.mjs';
import { depthTrialEligible, depthTrialLine, DEPTH_TRIAL_TOOLS } from '../lib/wall-depth-trial.mjs';
import { offersShown, OFFER_KINDS } from '../lib/offers-shown.mjs';
import { TIER_CANON } from '../lib/tier-canon.mjs';
import { keyLine } from '../lib/wall-key-line.mjs';
// Note K item 8 (2026-11-15): a wall now carries ONE route (lib/wall-offers.mjs oneRoute). This file pins the stacked
// offers (sign-in lead + floor + depth trial) that the kill switch DCHUB_WALL_ONE_ROUTE=0 keeps;
// test/wall-one-route.test.mjs pins the one-route default.
process.env.DCHUB_WALL_ONE_ROUTE = '0';

// These tests pin the keyless wall a caller meets AFTER its first full answer of the day
// (lib/keyless-first-full.mjs, #1438). With that grant on, a keyless first call to
// get_interconnection_queue is no longer walled, so section 3 runs with it off.
process.env.DCHUB_KEYLESS_FIRST_FULL = '0';

const LINK = 'https://dchub.cloud/u/abcdef';
const ENV = { DCHUB_WALL_ONE_ROUTE: '0' };   // every offer on; the stacked composition (note K item 8 kill switch)

// The composition the floor step ran before the builder (server.mjs _wallOfferFloorStep / _oauthLead / _depthTrial
// on origin/main 2026-11-14), from the same primitives, keyed on the identity THIS call is served with.
function legacy({ keyed, bound, signedIn, paid }, { tool, depth, proOnly, link, workosEnabled, grok, freeOfferShown }) {
  const deep = proOnly || depth;
  const out = [];
  if (wallOauthLeadEligible({ walled: true, workosEnabled, signedIn, bound, env: ENV })) {
    out.push({ place: 'lead', line: wallOauthLeadLine({ grok, depth: deep }), ask: null });
  }
  if (grok) return out;
  if (!freeOfferShown) {
    const kind = floorOfferKind({ proOnly, depth, bound });
    out.push({ place: 'floor', line: floorOfferLine(kind, { keyed, bound, depth: deep }), ask: kind === 'email' ? 'line' : 'digest_line' });
  }
  if (depthTrialEligible({ tool, walled: true, depth: deep, paid, link, env: ENV })) {
    out.push({ place: 'below_link', line: depthTrialLine(), ask: null });
  }
  return out;
}
const bools = [false, true];
function* matrix() {
  for (const keyed of bools) for (const bound of bools) for (const signedIn of bools) for (const paid of bools)
    for (const tool of ['list_transactions', 'rank_markets', 'analyze_site']) for (const depth of bools) for (const proOnly of bools)
      for (const link of ['', LINK]) for (const workosEnabled of bools) for (const grok of bools) for (const freeOfferShown of bools) {
        yield [{ keyed, bound, signedIn, paid, held: '' }, { tool, depth, proOnly, link, workosEnabled, grok, freeOfferShown }];
      }
}

describe('1. wallOffers is the old composition, byte for byte, where eligibility did not change', () => {
  it('every input combination: same lines, same places, same email-ask tags, same order', () => {
    let n = 0;
    const places = { lead: 0, floor: 0, below_link: 0 };
    for (const [ent, f] of matrix()) {
      // The free-key line (Grok note N item 1) is the one deliberate change; off here, pinned with it on below.
      const got = wallOffers(ent, { ...f, walled: true, env: { ...ENV, DCHUB_WALL_KEY_LINE: '0' } }).map((o) => ({ place: o.place, line: o.line, ask: o.ask }));
      expect(got, JSON.stringify({ ent, f })).toEqual(legacy(ent, f));
      n += 1; for (const o of got) places[o.place] += 1;
    }
    expect(n).toBe(2 ** 10 * 3);
    // The comparison is over real offers of every kind, not empty lists.
    expect(places.lead).toBeGreaterThan(100);
    expect(places.floor).toBeGreaterThan(100);
    expect(places.below_link).toBeGreaterThan(10);
  });
  // Grok note N item 1: with the free-key line on, the ONLY difference from that composition is on a digest floor for
  // a caller with no email on file: the key line first, then the digest line (without its own claim_free_key clause),
  // tagged key_line. Every other offer, every place and every other tag is byte for byte the same.
  it('with the free-key line on: the same, except a digest floor for a caller with no email on file', () => {
    let changed = 0;
    for (const [ent, f] of matrix()) {
      const got = wallOffers(ent, { ...f, walled: true, env: ENV }).map((o) => ({ place: o.place, line: o.line, ask: o.ask }));
      const want = legacy(ent, f).map((o) => {
        const digestFloor = o.place === 'floor' && o.ask === 'digest_line' && !ent.bound && !ent.paid;   // not a paid key
        if (!digestFloor) return o;
        changed += 1;
        const kind = floorOfferKind({ proOnly: f.proOnly, depth: f.depth, bound: ent.bound });
        return { place: 'floor', ask: 'key_line', line: keyLine({ keyed: ent.keyed }) + '\n\n'
          + floorOfferLine(kind, { keyed: true, bound: ent.bound, depth: f.proOnly || f.depth }) };
      });
      expect(got, JSON.stringify({ ent, f })).toEqual(want);
    }
    expect(changed).toBeGreaterThan(100);
  });
  it('not a wall: no offers at all', () => {
    expect(wallOffers({ keyed: false, bound: false, signedIn: false, paid: false }, { tool: 'rank_markets', walled: false, workosEnabled: true, link: LINK })).toEqual([]);
  });
  it('the trial is scoped to the seven depth tools (pinned so the matrix covers both sides)', () => {
    expect(DEPTH_TRIAL_TOOLS.has('list_transactions')).toBe(true);
    expect(DEPTH_TRIAL_TOOLS.has('rank_markets')).toBe(false);
  });
});

describe('2. wallEntitlements: what the caller holds', () => {
  const paidTier = (t) => ['starter', 'developer', 'pro'].includes(t);
  it('with no held identity it is the served identity, field for field', () => {
    for (const api_key of [null, 'k']) for (const email of [null, 'a@b.co']) for (const auth_oauth of [false, true]) for (const tier of ['free', 'pro']) {
      expect(wallEntitlements({ api_key, email, auth_oauth, tier }, { paidTier }))
        .toEqual({ keyed: !!api_key, bound: !!email, signedIn: auth_oauth, paid: tier === 'pro', held: '' });
    }
  });
  it('an identified key past its day (served anonymously) still holds its key and email', () => {
    const c = { api_key: null, email: null, tier: 'free', daily_quota: { tier: 'identified', used: 50, quota: 50 } };
    expect(wallEntitlements(c, { paidTier })).toEqual({ keyed: true, bound: true, signedIn: false, paid: false, held: 'daily_quota' });
  });
  it('a Developer key past its day still holds its paid plan', () => {
    const c = { api_key: null, email: null, tier: 'free', daily_quota: { tier: 'developer', used: 500, quota: 500 } };
    expect(wallEntitlements(c, { paidTier })).toMatchObject({ keyed: true, bound: true, paid: true, held: 'daily_quota' });
  });
  it('a daily-quota tier the backend never meters per day adds nothing (fail closed to the served identity)', () => {
    expect(Object.keys(HELD_DAILY_QUOTA).sort()).toEqual(['developer', 'identified']);
    expect(wallEntitlements({ daily_quota: { tier: 'pro' } }, { paidTier })).toEqual({ keyed: false, bound: false, signedIn: false, paid: false, held: '' });
    expect(wallEntitlements(null)).toEqual({ keyed: false, bound: false, signedIn: false, paid: false, held: '' });
  });
});

// ── 3. the real /mcp handler ────────────────────────────────────────────────────────────────────────────────────
const KEY = 'dch_live_heldidentity0123456789abcd';
const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i, score: 50 + i }));
const OVER = (tier, quota) => ({ allowed: true, blocked: false, used: quota, quota: quota * 30, remaining: quota * 29, tier, quota_tier: tier,
  daily: { allowed: false, blocked: true, reason: 'over_daily_quota', day: '2026-11-14', used: quota, quota, remaining: 0, quota_tier: tier,
           message: 'Daily quota reached.' } });
let H, fence, TIER = 'identified';
const events = [];
const CLIENT_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
const prevWorkos = process.env.DCHUB_WORKOS_OAUTH_ENABLED;

describe('3. /mcp: a key past its daily allowance is offered only what it does not already hold', () => {
  beforeAll(async () => {
    // An outside peer, so no call reads as an execute_plan loopback step (the floor skips those).
    net.Socket.prototype._getpeername = function _getpeername() {
      const p = _peer.call(this);
      return H && this.server && this.localPort === H.PORT && p && CLIENT_PORTS.has(p.port) ? { ...p, address: '203.0.113.9' } : p;
    };
    process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1';   // sign-in exists, so its absence below is eligibility, not config
    fence = fenceNetwork();
    H = await startHarness({
      env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0' },
      extraRoutes: (p, req, body) => {
        if (p === '/api/v1/keys/validate' && body && body.api_key === KEY) {
          return { valid: true, tier: TIER, email: 'owner@acme-dc.com', developer_id: 7, tier_detail: { users_plan: TIER === 'developer' ? 'developer' : null } };
        }
        if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
        if (p === '/api/v1/relay/short') return { ok: true, url: LINK };
        if (p === '/api/v1/mcp/credits/balance') return { credits: 0, had_pack: false };
        if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
        return { success: true, count: 12, total_count: 12, data: ROWS, results: ROWS, items: ROWS, markets: ROWS, rows: ROWS };
      },
    });
    H.S._setQuotaFetchImpl(async () => OVER(TIER, TIER === 'developer' ? 500 : 50));
  }, 120_000);
  afterAll(async () => {
    net.Socket.prototype._getpeername = _peer;
    if (prevWorkos === undefined) delete process.env.DCHUB_WORKOS_OAUTH_ENABLED; else process.env.DCHUB_WORKOS_OAUTH_ENABLED = prevWorkos;
    if (H) { H.S._setQuotaFetchImpl(null); await H.stop(); }
    if (fence) fence.restore();
  });

  let ip = 10, rid = 1;
  const ARGS = { get_water_risk: { state: 'VA' }, get_renewable_energy: { state: 'VA' } };
  function rpc(headers, body) {
    const data = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: H.PORT, path: '/mcp', method: 'POST', agent: false,
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
        let raw = '';
        res.on('data', (ch) => { raw += ch; });
        res.on('end', () => {
          const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
          try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
        });
      });
      req.on('socket', (s) => { const note = () => CLIENT_PORTS.add(s.localPort); if (s.localPort) note(); else s.once('connect', note); });
      req.on('error', reject);
      req.end(data);
    });
  }
  async function call(tool, { keyed = true, args = ARGS[tool] || { market: 'dallas', iso: 'ERCOT' } } = {}) {
    const before = events.length;
    const hdr = { 'x-forwarded-for': '198.51.100.' + (ip++), ...(keyed ? { 'x-api-key': KEY } : {}) };
    const m = await rpc(hdr, { jsonrpc: '2.0', id: rid++, method: 'tools/call',
      params: { name: tool, arguments: args } });
    for (let i = 0; i < 50 && !events.slice(before).some((e) => e.tool === tool); i++) await new Promise((r) => setTimeout(r, 10));
    const content = (m.result && m.result.content) || [];
    const prose = content.filter((b) => b.type === 'text' && !/^\s*[{[]/.test(b.text)).map((b) => b.text).join('\n');
    return { prose, sc: (m.result && m.result.structuredContent) || {}, row: events.slice(before).find((e) => e.tool === tool) || null };
  }
  // walls whose floor offer is the email ask. rank_markets and get_interconnection_queue were these until owner
  // 2026-11-23 made them paid-only (lib/paid-full-only.mjs: an email no longer opens them; pinned below).
  const EMAIL_WALLS = ['get_water_risk', 'get_renewable_energy'];
  const PAID_ONLY_WALLS = ['rank_markets', 'get_interconnection_queue'];

  it('paid-only walls (owner 2026-11-23), keyless: no email-unlock ask, the wall says an email does not open them', async () => {
    for (const t of PAID_ONLY_WALLS) {
      const { prose, row } = await call(t, { keyed: false });
      expect(row, t + ': the call walled').toBeTruthy();
      expect(['line', 'link', 'link_exit', 'bind_field'], t).not.toContain(row.email_ask);
      expect(row.offers_shown || [], t).not.toContain('email_unlock');
      expect(prose, t).not.toMatch(/email (on this page )?opens the full answer|shows all \d+ markets/i);
    }
  }, 120_000);

  it('CONTROL: keyless, the same walls carry the email ask, the free key path and the sign-in', async () => {
    for (const t of EMAIL_WALLS) {
      const { prose, row } = await call(t, { keyed: false });
      expect(prose, t).toContain('`bind_email`');
      expect(prose, t).toContain(OAUTH_SIGNIN_URL);
      expect(['line', 'link', 'link_exit', 'bind_field'], t).toContain(row && row.email_ask);
      expect(row && row.offers_shown, t).toContain('email_unlock');
    }
  }, 120_000);

  // Owner 2026-11-23: these two are paid-only now; an identified key over its day still reads only the digest offer
  // (rank_markets the depth wording, queue the bound wording: see the report on _depthWallTool), never an email ask.
  it('identified key over its day: no email ask, no key ask, no sign-in; the digest offer, tagged', async () => {
    TIER = 'identified'; H.S._dropQuotaCache(KEY);
    for (const t of PAID_ONLY_WALLS) {
      const { prose, sc, row } = await call(t);
      expect((sc.identity || {}).daily_quota_reached, t).toBeTruthy();   // it really is the over-quota path
      expect(prose, t).not.toContain('Share your email');
      expect(prose, t).not.toMatch(/`bind_email`|`claim_free_key`/);
      expect(prose, t).not.toContain(OAUTH_SIGNIN_URL);
      // 2026-11-19 (Grok item 13, owner go-ahead): the digest ask carries no "free" (lib/neutral-connect.mjs rewrites)
      expect(prose, t).toContain('call `subscribe_digest` with');
      expect(prose, t).toContain('source "depth_wall"');
      expect(prose, t).not.toMatch(/\bfree\b/i);
      expect(row && row.email_ask, t).toBe('digest_line');
      expect(row && row.offers_shown, t).toEqual(expect.arrayContaining(['digest']));
      expect(row && row.offers_shown, t).not.toEqual(expect.arrayContaining(['email_unlock']));
    }
  }, 120_000);

  it('Developer key over its day: no trial line on a depth wall, no free-key ask', async () => {
    TIER = 'developer'; H.S._dropQuotaCache(KEY);
    const { prose, sc } = await call('list_transactions');
    expect((sc.identity || {}).daily_quota_reached).toBeTruthy();
    expect(prose).not.toContain('What opens the fields held back here: a 7-day trial.');
    expect(prose).not.toMatch(/`claim_free_key`/);
    TIER = 'identified'; H.S._dropQuotaCache(KEY);
    const id = await call('list_transactions');   // CONTROL: an identified key is not paid, so the trial stays
    expect(id.prose).toContain('What opens the fields held back here: a 7-day trial.');
  }, 120_000);
});

describe('4. links: only the server-minted one, or the fixed connector URLs', () => {
  const o = (line) => ({ kind: 'digest', kinds: ['digest'], place: 'floor', ask: 'digest_line', line });
  it('a hand-built URL drops the offer; the minted link and the connector URL keep it', () => {
    expect(mintedOnly([o('open https://dchub.cloud/pricing?x=1 now')], LINK)).toEqual([]);
    expect(mintedOnly([o('open https://dchub.cloud/u/zzzzzz now')], LINK)).toEqual([]);   // a link, but not this wall's
    expect(mintedOnly([o(`open ${LINK}.`)], LINK)).toHaveLength(1);
    expect(mintedOnly([o(`add ${OAUTH_SIGNIN_URL} as the connector`)], '')).toHaveLength(1);
    expect(mintedOnly([o('no link at all')], '')).toHaveLength(1);
  });
  it('every offer the builder makes passes it', () => {
    for (const [ent, f] of matrix()) {
      const got = wallOffers(ent, { ...f, walled: true, env: ENV });
      expect(mintedOnly(got, f.link)).toEqual(got);
    }
  });
});

describe('5. limits come from canon', () => {
  it('a stated calls figure must be canon\'s', () => {
    const id = TIER_CANON.calls_per_day.identified;
    expect(Number.isFinite(id)).toBe(true);
    expect(statesOnlyCanonLimits(`An email gives ${id} calls a day.`)).toBe(true);
    expect(statesOnlyCanonLimits(`An email gives ${id + 7} calls a day.`)).toBe(false);
    expect(statesOnlyCanonLimits('Up to 9999 full answers per tool.')).toBe(false);
  });
  it('no offer the builder makes states a figure outside canon', () => {
    for (const [ent, f] of matrix()) for (const x of wallOffers(ent, { ...f, walled: true, env: ENV })) expect(statesOnlyCanonLimits(x.line)).toBe(true);
  });
});

describe('6. the kinds the builder declares are the ones offers_shown records', () => {
  it('each offer line, alone on a wall, is read back as (at least) its declared kinds', () => {
    let n = 0;
    for (const [ent, f] of matrix()) {
      for (const x of wallOffers(ent, { ...f, walled: true, env: ENV })) {
        for (const k of x.kinds) expect(OFFER_KINDS).toContain(k);
        const seen = offersShown({ content: [{ type: 'text', text: '{}' }, { type: 'text', text: x.line }] }, x.ask || '');
        expect(seen, x.line.slice(0, 80)).toEqual(expect.arrayContaining(x.kinds));
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(offerKinds([{ kinds: ['trial'] }, { kinds: ['digest', 'free_key'] }, { kinds: ['nope'] }])).toEqual(['digest', 'free_key', 'trial']);
  });
});
