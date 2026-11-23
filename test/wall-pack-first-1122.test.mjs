// wall-pack-first-1122.test.mjs — DCHUB_WALL_PACK_FIRST (lib/wall-pack-first.mjs, server.mjs _wallPackFirstStep) and
// DCHUB_FREE_TIGHTEN (lib/free-tighten.mjs, clamping the three keyless full-answer caps). Both default OFF.
//
// Asserted:
//   * flag off (unset, '0'): the step returns the very same object; every keyless cap reads what it read before;
//   * flag on: a capacity wall and a last-full answer get one line right after content[0] plus pack_offer; the
//     price comes from canon; the link is the /go/c link tagged ?via=pack_first;
//   * never: a tool a credit does not open, a depth wall, a paid tier, a key holding credits, a ChatGPT client,
//     a loopback step; once per (session, tool);
//   * the inline per-call payment is reported, never created;
//   * free-tighten clamps (never raises) each cap and a 0 ceiling closes the lane's seat.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as P from '../lib/wall-pack-first.mjs';
import * as T from '../lib/free-tighten.mjs';
import { offersShown } from '../lib/offers-shown.mjs';
import { PACK_PRICE, PACK_PRICE_USD, PACK_CREDITS } from '../lib/canon.mjs';
import { keylessFullTrialCap, keylessSiteFullCap, keylessFullTrialSeat } from '../lib/keyless-full-trial.mjs';
import { keylessFirstFullCap, keylessFirstFullSeat } from '../lib/keyless-first-full.mjs';

let S;
beforeAll(async () => {
  process.env.DCHUB_INTERNAL_KEY = process.env.DCHUB_INTERNAL_KEY || 'test-internal-key-pack-first';
  S = await import('../server.mjs');
});
const ENV_KEYS = ['DCHUB_WALL_PACK_FIRST', 'DCHUB_FREE_TIGHTEN', 'DCHUB_FREE_TIGHTEN_CAP'];
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; vi.restoreAllMocks(); });

let n = 0;
const ctx = (o = {}) => ({ session_id: 'sess-pf-' + (++n), platform: 'claude-code', tier: 'anonymous', ...o });
// A capacity wall: a preview whose daily full answers ran out.
const capWall = () => ({
  content: [{ type: 'text', text: 'Preview of the answer.' }, { type: 'text', text: 'Source: DC Hub' }],
  structuredContent: { _gated: true, trial_preview: true, quota: { full_answers_remaining_today: 0 }, _upgrade: { remaining_today: 0 } },
});
// The last full answer of the day: not gated, the meter reads 0.
const lastFull = () => ({
  content: [{ type: 'text', text: 'Full answer.' }],
  structuredContent: { data: [1, 2, 3], quota: { full_answers_remaining_today: 0 } },
});
const OPEN_TOOL = 'get_tax_incentives';   // a tool a credit opens (_packOpensTool)
const DEPTH_TOOL = 'get_fiber_intel';     // a tool a credit does not open

describe('lib/wall-pack-first', () => {
  it('flag reads on only for 1/true/yes/on', () => {
    for (const v of ['', '0', 'false', 'off', 'nope']) expect(P.wallPackFirstOn({ DCHUB_WALL_PACK_FIRST: v })).toBe(false);
    for (const v of ['1', 'true', 'YES', 'on']) expect(P.wallPackFirstOn({ DCHUB_WALL_PACK_FIRST: v })).toBe(true);
  });
  it('tags only a dchub.cloud /go/ link', () => {
    expect(P.tagPackUrl('https://dchub.cloud/go/c/abc.def')).toBe('https://dchub.cloud/go/c/abc.def?via=pack_first');
    expect(P.tagPackUrl('https://dchub.cloud/go/c/abc?x=1')).toBe('https://dchub.cloud/go/c/abc?x=1&via=pack_first');
    expect(P.tagPackUrl('https://buy.stripe.com/abc')).toBe('https://buy.stripe.com/abc');
  });
  it('the line names the canon price and no "free"; empty with no link', () => {
    expect(PACK_PRICE_USD).not.toBeNull();
    const l = P.packFirstLine({ kind: P.KIND_WALL, tool: 'x', url: 'https://dchub.cloud/go/c/a' });
    expect(l).toContain(PACK_PRICE);
    expect(l).toContain(PACK_CREDITS.toLocaleString('en-US'));
    expect(l).not.toMatch(/\bfree\b/i);
    expect(P.packFirstLine({ kind: P.KIND_LAST_FULL, tool: 'x', url: 'u' })).toMatch(/^That was the last full `x` answer today/);
    expect(P.packFirstLine({ url: '' })).toBe('');
  });
  it('reports an inline per-call challenge, never makes one', () => {
    expect(P.packOffer({ url: 'u' }).per_call_payment_inline).toBe(false);
    const o = P.packOffer({ url: 'u', agentPayment: { price_usd: '0.50', challenges: [{ id: 'c' }] } });
    expect(o.per_call_payment_inline).toBe(true);
    expect(o.per_call_price_usd).toBe('0.50');
  });
});

describe('server _wallPackFirstStep', () => {
  it('flag off: the same object back', async () => {
    for (const v of [undefined, '0']) {
      if (v === undefined) delete process.env.DCHUB_WALL_PACK_FIRST; else process.env.DCHUB_WALL_PACK_FIRST = v;
      const r = capWall();
      expect(await S._wallPackFirstStep(r, OPEN_TOOL, ctx())).toBe(r);
      const f = lastFull();
      expect(await S._wallPackFirstStep(f, OPEN_TOOL, ctx())).toBe(f);
    }
  });
  it('flag on: a capacity wall leads with the pack after content[0]', async () => {
    process.env.DCHUB_WALL_PACK_FIRST = '1';
    const r = capWall();
    const out = await S._wallPackFirstStep(r, OPEN_TOOL, ctx());
    expect(out).not.toBe(r);
    expect(out.content).toHaveLength(3);
    expect(out.content[0]).toEqual(r.content[0]);
    expect(out.content[1].text).toMatch(/^Quickest way to the full `get_tax_incentives` answer/);
    expect(out.content[2]).toEqual(r.content[1]);
    expect(out.structuredContent.pack_offer).toMatchObject({ kind: 'credit_pack', shown_on: 'wall', price_usd: PACK_PRICE_USD, one_time: true });
    expect(out.structuredContent.pack_offer.checkout_url).toMatch(/via=pack_first$/);
    expect(out.content[1].text).toContain(out.structuredContent.pack_offer.checkout_url);
    // the wall row's offers_shown records it as a credit_pack offer
    expect(offersShown(r, '')).not.toContain('credit_pack');
    expect(offersShown(out, '')).toContain('credit_pack');
  });
  it('flag on: the last full answer gets the last_full line', async () => {
    process.env.DCHUB_WALL_PACK_FIRST = '1';
    const out = await S._wallPackFirstStep(lastFull(), OPEN_TOOL, ctx());
    expect(out.content[1].text).toMatch(/^That was the last full/);
    expect(out.structuredContent.pack_offer.shown_on).toBe('last_full');
  });
  it('flag on: an answer with full answers left is untouched', async () => {
    process.env.DCHUB_WALL_PACK_FIRST = '1';
    const r = lastFull(); r.structuredContent.quota.full_answers_remaining_today = 1;
    expect(await S._wallPackFirstStep(r, OPEN_TOOL, ctx())).toBe(r);
  });
  it('never on a tool a credit does not open, a paid tier, ChatGPT, a loopback step', async () => {
    process.env.DCHUB_WALL_PACK_FIRST = '1';
    let r = capWall(); expect(await S._wallPackFirstStep(r, DEPTH_TOOL, ctx())).toBe(r);
    r = capWall(); expect(await S._wallPackFirstStep(r, OPEN_TOOL, ctx({ tier: 'pro' }))).toBe(r);
    r = capWall(); expect(await S._wallPackFirstStep(r, OPEN_TOOL, ctx({ platform: 'chatgpt' }))).toBe(r);
    r = capWall(); expect(await S._wallPackFirstStep(r, OPEN_TOOL, ctx({ loopback_step: true }))).toBe(r);
  });
  it('never for a key that already holds credits', async () => {
    process.env.DCHUB_WALL_PACK_FIRST = '1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ credits: 250, had_pack: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const r = capWall();
    expect(await S._wallPackFirstStep(r, OPEN_TOOL, ctx({ api_key: 'dch_live_PFcredits' + n, tier: 'free' }))).toBe(r);
  });
  it('once per (session, tool)', async () => {
    process.env.DCHUB_WALL_PACK_FIRST = '1';
    const c = ctx();
    expect((await S._wallPackFirstStep(capWall(), OPEN_TOOL, c)).structuredContent.pack_offer).toBeTruthy();
    const r = capWall();
    expect(await S._wallPackFirstStep(r, OPEN_TOOL, c)).toBe(r);
  });
});

describe('lib/free-tighten', () => {
  it('off: every keyless cap unchanged', () => {
    for (const env of [{}, { DCHUB_FREE_TIGHTEN: '0' }, { DCHUB_FREE_TIGHTEN: 'off', DCHUB_FREE_TIGHTEN_CAP: '0' }]) {
      expect(T.freeTightenCeiling(env)).toBeNull();
      expect(keylessFullTrialCap(env)).toBe(2);
      expect(keylessSiteFullCap(env)).toBe(2);
      expect(keylessFirstFullCap(env)).toBe(1);
      expect(keylessFullTrialCap({ ...env, DCHUB_KEYLESS_FULL_TRIAL_CAP: '7' })).toBe(7);
    }
  });
  it('on: clamps each cap, default ceiling 0, never raises', () => {
    const on = { DCHUB_FREE_TIGHTEN: '1' };
    expect(keylessFullTrialCap(on)).toBe(0);
    expect(keylessSiteFullCap(on)).toBe(0);
    expect(keylessFirstFullCap(on)).toBe(0);
    const one = { ...on, DCHUB_FREE_TIGHTEN_CAP: '1' };
    expect(keylessFullTrialCap(one)).toBe(1);
    expect(keylessSiteFullCap(one)).toBe(1);
    expect(keylessFirstFullCap(one)).toBe(1);
    expect(keylessFirstFullCap({ ...on, DCHUB_FREE_TIGHTEN_CAP: '50' })).toBe(1);   // never raises
    expect(keylessFullTrialCap({ ...on, DCHUB_FREE_TIGHTEN_CAP: 'junk' })).toBe(0);
    expect(keylessFullTrialCap({ ...on, DCHUB_KEYLESS_FULL_TRIAL_CAP: 'junk', DCHUB_FREE_TIGHTEN_CAP: '1' })).toBe(1);
  });
  it('on at 0: the first-full and trial lanes give no seat', () => {
    const c = { client_ip: '203.0.113.9', session_id: 's1', platform: 'claude-code' };
    const base = { DCHUB_KEYLESS_FULL_TRIAL: '1' };
    expect(keylessFirstFullSeat('get_grid_intelligence', c, { env: base })).not.toBeNull();
    expect(keylessFullTrialSeat('get_facility', c, { env: base })).not.toBeNull();
    const tight = { ...base, DCHUB_FREE_TIGHTEN: '1' };
    expect(keylessFirstFullSeat('get_grid_intelligence', c, { env: tight })).toBeNull();
    expect(keylessFullTrialSeat('get_facility', c, { env: tight })).toBeNull();
  });
});
