// pro-trial-second-pro-wall-1121.test.mjs — Brain upgrade-funnel item 5 (owner 2026-11-21: "Go on
// item 5"). The 2nd walled call to a decision-layer tool in 7 days decides the Pro trial offer arm,
// counted by key or transport session, never by IP. Pure: no network (the decider is a stub).
//
// Pinned here:
//   * off unless BOTH DCHUB_PRO_TRIAL_OFFER and DCHUB_PRO_TRIAL_OFFER_PRO_WALL are on (the first is
//     on in production, so the new one is what keeps a merge inert);
//   * the identity is pk-<sha256(free key)> or sk-<sha256(real session)>; a paid key, a keyless
//     caller with no session, the keyless kill switch, a tool outside the five and a non-wall
//     result never reach the backend;
//   * the decider is asked with trigger "pro_wall", and the request body carries it;
//   * on the decided call the offer arm's wall link carries ?offer=pro_trial_7d and the holdout's
//     carries none, in every channel, with no trace of the old link; an undecided call is untouched;
//   * the wiring: the stamp site runs it on a stamped wall, before the wall-link hash is taken.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  _withProWallTrialOffer, _proWallTrialIdentity, proWallTrialOn, _stampProWall, _proTrialOfferDecide,
  PRO_TRIAL_OFFER, _relayEverywhereStep,
} from '../server.mjs';
import { rewriteText, wallCopyV2 } from '../lib/wall-copy-v2.mjs';

// Hard-gate file: stay on loopback. Item 1's relay step mints a /u/ link from the backend; here every
// off-loopback fetch fails exactly as a refused connect would, without opening a socket.
let realFetch;
const offLoopback = [];
beforeAll(() => {
  process.env.DCHUB_INTERNAL_KEY = process.env.DCHUB_INTERNAL_KEY || 'test-internal';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input, init);
    offLoopback.push(u.hostname);
    throw new TypeError('fetch failed');
  };
});
afterAll(() => { globalThis.fetch = realFetch; });

const ON = { DCHUB_PRO_TRIAL_OFFER: '1', DCHUB_PRO_TRIAL_OFFER_PRO_WALL: '1' };
const FREE = { api_key: 'dch_live_prowall0000000000000', tier: 'free', session_id: 'sess-pw-1', platform: 'claude-desktop' };
const KEYLESS = { tier: 'free', session_id: 'sess-pw-keyless', platform: 'grok' };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const LONG = async (u) => u;                              // the /u/ mint failed open: the long link stays
const SHORT = async () => 'https://dchub.cloud/u/pw7abc';  // the /u/ mint answered

// link: a wall that already carries a link (item 1's /u/ relay link); without one, _stampProWall mints
// an offer relay itself.
function wall(tool = 'compare_sites', c = FREE, link = '') {
  const body = { tool, required_plan: 'pro', _gated: true, preview: { sites: 2 },
                 ...(link ? { for_your_human: { url: link, text: 'This preview leaves out the ranking. Open ' + link + ' to see what your agent found.' } } : {}) };
  const { result, wall: w } = _stampProWall(
    { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: { ...body } }, tool, c);
  expect(w).toBe(true);
  return result;
}
const decider = (arm) => {
  const calls = [];
  const fn = async (c, tool, opts) => { calls.push({ tool, ...opts }); return arm ? { fire: true, arm } : null; };
  fn.calls = calls;
  return fn;
};

describe('item 5: the 2nd walled decision-layer call decides the trial offer arm', () => {
  it('is off unless both flags are on; DCHUB_PRO_TRIAL_OFFER alone (production today) changes nothing', async () => {
    for (const env of [{}, { DCHUB_PRO_TRIAL_OFFER: '1' }, { DCHUB_PRO_TRIAL_OFFER_PRO_WALL: '1' }]) {
      const d = decider('offer');
      const w = wall();
      expect(await _withProWallTrialOffer(w, 'compare_sites', FREE, env, d, LONG)).toBe(w);
      expect(d.calls).toEqual([]);
      expect(proWallTrialOn(env)).toBe(false);
    }
    expect(proWallTrialOn(ON)).toBe(true);
  });

  it('a free key is counted by its key ref, a keyless caller by its transport session', () => {
    expect(_proWallTrialIdentity(FREE, 'compare_sites', ON)).toBe('pk-' + sha(FREE.api_key));
    expect(_proWallTrialIdentity(KEYLESS, 'export_dataset', ON)).toBe('sk-' + sha(KEYLESS.session_id));
  });

  it.each([
    ['a paid key', { ...FREE, tier: 'developer' }, 'compare_sites', ON],
    ['a keyless caller with no session', { tier: 'free', session_id: 'no-session' }, 'compare_sites', ON],
    ['a keyless caller with an empty session', { tier: 'free', session_id: '' }, 'compare_sites', ON],
    ['the keyless kill switch', KEYLESS, 'compare_sites', { ...ON, DCHUB_PRO_TRIAL_OFFER_KEYLESS: '0' }],
    ['a tool outside the five', FREE, 'get_market_intel', ON],
  ])('never asks the backend for %s', async (_label, c, tool, env) => {
    expect(_proWallTrialIdentity(c, tool, env)).toBe('');
    const d = decider('offer');
    const w = wall('compare_sites', c);
    expect(await _withProWallTrialOffer(w, tool, c, env, d, LONG)).toBe(w);
    expect(d.calls).toEqual([]);
  });

  it('each of the five decision-layer tools is in the audience', () => {
    for (const t of ['analyze_site', 'compare_sites', 'get_dchub_recommendation', 'generate_site_analysis', 'export_dataset']) {
      expect(_proWallTrialIdentity(FREE, t, ON), t).not.toBe('');
    }
  });

  it('a result that is not a stamped wall is never sent', async () => {
    const d = decider('offer');
    const data = { content: [{ type: 'text', text: '{"ok":1}' }], structuredContent: { ok: 1 } };
    expect(await _withProWallTrialOffer(data, 'compare_sites', FREE, ON, d, LONG)).toBe(data);
    expect(d.calls).toEqual([]);
  });

  it('asks with trigger "pro_wall" and the identity; an undecided call is returned untouched', async () => {
    const d = decider(null);
    const w = wall();
    expect(await _withProWallTrialOffer(w, 'compare_sites', FREE, ON, d, LONG)).toBe(w);
    expect(d.calls).toEqual([{ tool: 'compare_sites', trigger: 'pro_wall', identity: 'pk-' + sha(FREE.api_key) }]);
  });

  it('the decide request body carries trigger=pro_wall and the session identity', async () => {
    let body = null;
    const fetchImpl = async (_u, o) => { body = JSON.parse(o.body); return { status: 200, json: async () => ({ fire: false }) }; };
    await _proTrialOfferDecide(KEYLESS, 'export_dataset', { fetchImpl, trigger: 'pro_wall', identity: 'sk-' + sha(KEYLESS.session_id) });
    expect(body).toMatchObject({ trigger: 'pro_wall', tool: 'export_dataset', identity: 'sk-' + sha(KEYLESS.session_id), session_id: KEYLESS.session_id });
  });

  it('offer arm: the wall link carries ?offer=pro_trial_7d in every channel and the old link is gone', async () => {
    const w = wall('compare_sites', FREE, 'https://dchub.cloud/u/Pw5Ab12');
    const old = w.structuredContent.for_your_human.url;
    const r = await _withProWallTrialOffer(w, 'compare_sites', FREE, ON, decider('offer'), LONG);
    const url = r.structuredContent.for_your_human.url;
    expect(url).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\/[^?]+\?offer=pro_trial_7d$/);
    expect(url).not.toBe(old);
    const all = JSON.stringify(r);
    expect(all.includes(old)).toBe(false);
    expect(r.structuredContent.user_message).toContain(url);
    expect(r.content[0].text).toContain(url);
  });

  it('offer arm on a wall that already carries an offer link: untouched when the mint matches, else one fresh link', async () => {
    // Whether the decided mint equals the stamped wall's link depends on the token format (the mint second, the
    // seal): equal -> the wall is returned untouched; different -> exactly one fresh offer link, in every channel,
    // and the context keeps that one. Both are correct; anything else is not.
    const c = { ...FREE };
    const w = wall('compare_sites', c);
    const before = w.structuredContent.for_your_human.url;
    expect(before).toContain('?offer=' + PRO_TRIAL_OFFER);
    const r = await _withProWallTrialOffer(w, 'compare_sites', c, ON, decider('offer'), LONG);
    const after = r.structuredContent.for_your_human.url;
    expect(after).toContain('?offer=' + PRO_TRIAL_OFFER);
    if (after === before) {
      expect(r).toBe(w);
    } else {
      expect(c._proWallTrialLink).toBe(after);
      expect(JSON.stringify(r)).not.toContain(before);
    }
  });

  it('holdout arm: a plain link, so the arms differ only in ?offer (a stamped wall can already carry it)', async () => {
    const w = wall();
    const old = w.structuredContent.for_your_human.url;
    const r = await _withProWallTrialOffer(w, 'compare_sites', FREE, ON, decider('holdout'), LONG);
    const url = r.structuredContent.for_your_human.url;
    expect(url).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\/[^?]+$/);
    expect(JSON.stringify(r)).not.toContain('offer=' + PRO_TRIAL_OFFER);
    expect(JSON.stringify(r).includes(old)).toBe(false);
    expect(r.structuredContent.user_message).toContain(url);
  });

  it('the decided link is minted short when the /u/ mint answers, and the context remembers it', async () => {
    const c = { api_key: FREE.api_key, tier: 'free', session_id: FREE.session_id, platform: FREE.platform };
    const w = wall('compare_sites', c, 'https://dchub.cloud/u/Pw5Ab12');
    const r = await _withProWallTrialOffer(w, 'compare_sites', c, ON, decider('offer'), SHORT);
    expect(r.structuredContent.for_your_human.url).toBe('https://dchub.cloud/u/pw7abc');
    expect(r.structuredContent.user_message).toContain('https://dchub.cloud/u/pw7abc');
    expect(c._proWallTrialLink).toBe('https://dchub.cloud/u/pw7abc');
    expect(JSON.stringify(r)).not.toContain('Pw5Ab12');
  });

  it('an undecided call leaves the context without a kept link', async () => {
    // a fresh context: earlier decided calls in this file set FREE._proWallTrialLink, as they should
    const c = { api_key: FREE.api_key, tier: 'free', session_id: FREE.session_id, platform: FREE.platform };
    await _withProWallTrialOffer(wall('compare_sites', c), 'compare_sites', c, ON, decider(null), SHORT);
    expect(c._proWallTrialLink).toBeUndefined();
  });

  it('the v2 copy keeps exactly the decided link and still rewrites every other relay link', () => {
    const keep = 'https://dchub.cloud/u/pw7abc';
    const t = 'Open ' + keep + '. Or https://dchub.cloud/u/zz2abc or https://dchub.cloud/upgrade/h/abc.0123456789abcdef0123456789abcdef';
    const out = rewriteText(t, { keyless: true, keepLink: keep });
    expect(out).toContain('Open ' + keep + '.');
    expect(out).not.toContain('zz2abc');
    expect(out).not.toContain('/upgrade/h/');
    expect(rewriteText(t, { keyless: true })).not.toContain(keep);   // without keepLink: today's rewrite
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const i = src.indexOf('export function _wallCopyV2Step(');
    expect(src.slice(i, i + 2400)).toContain("keepLink: typeof c._proWallTrialLink === 'string' ? c._proWallTrialLink : ''");
  });

  it('the whole v2 copy keeps the decided link in the text and in structuredContent', () => {
    const keep = 'https://dchub.cloud/u/pw7abc';
    const r = { content: [{ type: 'text', text: JSON.stringify({ human_url: keep }) }, { type: 'text', text: 'Open ' + keep + ' now.' }],
                structuredContent: { human_url: keep, for_your_human: { url: keep } } };
    const out = wallCopyV2(r, { keyless: true, keepLink: keep });
    expect(out.structuredContent.human_url).toBe(keep);
    expect(out.structuredContent.for_your_human.url).toBe(keep);
    expect(out.content[1].text).toContain(keep);
    expect(JSON.parse(out.content[0].text).human_url).toBe(keep);
    expect(wallCopyV2(r, { keyless: true }).structuredContent.human_url).not.toBe(keep);
  });

  it("item 1's relay link step leaves the decided answer alone, and only that one", async () => {
    const prev = process.env.DCHUB_WALL_RELAY_EVERYWHERE;
    process.env.DCHUB_WALL_RELAY_EVERYWHERE = '1';
    try {
      const kept = { ...KEYLESS, _proWallTrialLink: 'https://dchub.cloud/u/pw7abc' };
      const w1 = wall('compare_sites', kept);
      expect(await _relayEverywhereStep(w1, 'compare_sites', {}, kept)).toBe(w1);
      const plain = { ...KEYLESS };
      const w2 = wall('compare_sites', plain);
      expect(await _relayEverywhereStep(w2, 'compare_sites', {}, plain)).not.toBe(w2);
    } finally {
      if (prev === undefined) delete process.env.DCHUB_WALL_RELAY_EVERYWHERE; else process.env.DCHUB_WALL_RELAY_EVERYWHERE = prev;
    }
  });

  it('wiring: the stamp site runs it on a stamped wall, before the wall-link hash is read', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const i = src.indexOf('const _pw = _stampProWall(_proWallRaw, name, c);');
    const j = src.indexOf('if (_pw.wall) _pw.result = await _withProWallTrialOffer(_pw.result, name, c);', i);
    const k = src.indexOf('_wallLinkTokenHash(_pw.result)', i);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(j);
  });
});
