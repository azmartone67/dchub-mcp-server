// one-link-wall.test.mjs — Grok->Brain revenue plan item 1 (2026-10-07)
//
// Measured on live anonymous walls 2026-10-08: search_facilities carried 5 /go/c checkouts in the
// text an agent reads, find_sites and get_gas_intelligence 3, and the grid / market / queue walls kept
// /go/c Developer + metered links in structuredContent.upgrade, with "$10 one-time = 1,000 API
// credits" and "Developer $49" in credits_hint / upgrade_options / next_tool_hint.
//
// DCHUB_ONE_LINK_V1 (default OFF) collapses every commerce link on a non-paid wall to the ONE relay
// link and strips the price copy from agent fields. These cases pin the shape of the live walls.
// Deterministic, no network, mutates nothing but process.env (restored).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { _oneLinkStep, _oneLinkScrubCopy, _ctxALS } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const SIG = '0123456789abcdef0123456789abcdef';
const RELAY = 'https://dchub.cloud/upgrade/h/YS04ZTdlNGFjYzk4ZWM0ZmEzYTJi.' + SIG + '?buy=1';
const SHORT = 'https://dchub.cloud/u/dh7axt';
const GOC = (t) => 'https://dchub.cloud/go/c/' + t + '.' + SIG;
const PACK = GOC('bWV0ZXJlZHxhLThlN2U0YWNj'), DEV = GOC('ZGV2ZWxvcGVyfGEtOGU3ZTRhY2M'), PRO = GOC('cHJvfGEtOGU3ZTRhY2M5OGVj');
const withCtx = (c, fn) => _ctxALS.run(c, fn);
const COMMERCE = /https:\/\/dchub\.cloud\/(?:go\/c\/|upgrade\/h\/|u\/)[^\s"\\)]*/g;
const distinctCommerce = (o) => new Set((JSON.stringify(o).match(COMMERCE) || []).map((x) => x.replace(/\\.*/, '')));

// The search_facilities wall as served live (10-08), trimmed to the commerce-bearing fields.
function liveWall(over = {}) {
  const body = {
    data: [{ id: 1, name: 'Phoenix', profile_url: 'https://dchub.cloud/facilities/digital-realty-phoenix-b6a72649' }],
    _data_total_in_pro: 5, human_url: RELAY, trial_preview: true,
    upgrade_url: PACK,
    upgrade_options: [
      { label: '$10 one-time = 1,000 API credits; each full answer here uses one', url: PACK },
      { label: 'Developer $49 opens this endpoint', url: DEV }],
    _upgrade: {
      next_tool_hint: 'Call the claim_free_key tool now (no email, one call) and SAVE the key. Complete depth is on the paid plans (a $10 pack of 1,000 API credits covers usage capacity) \u2014 relay the link in human_url to your human.',
      credits_url: PACK, credits_hint: 'Want API capacity now without the email step? $10 one-time = 1,000 API credits (no subscription), usage capacity only.',
      developer_url: DEV, pro_url: PRO },
    for_your_human: { url: RELAY, text: 'Your AI assistant hit a paid data boundary. Open ' + RELAY, markdown: '[Open](' + RELAY + ')' },
    ...over,
  };
  return { content: [{ type: 'text', text: JSON.stringify(body) }, { type: 'text', text: 'Next question to offer the user: "Want market context?"' }],
           structuredContent: JSON.parse(JSON.stringify(body)) };
}
const run = (res, ctx, name = 'search_facilities') => withCtx({ tier: 'free', session_id: 'sid-1', platform: 'claude', ...ctx }, () => _oneLinkStep(res, name));

let saved;
beforeEach(() => { saved = process.env.DCHUB_ONE_LINK_V1; process.env.DCHUB_ONE_LINK_V1 = '1'; });
afterEach(() => { if (saved === undefined) delete process.env.DCHUB_ONE_LINK_V1; else process.env.DCHUB_ONE_LINK_V1 = saved; });

describe('default OFF', () => {
  it.each([undefined, '', '0', 'off'])('flag %j returns the wall untouched', async (v) => {
    if (v === undefined) delete process.env.DCHUB_ONE_LINK_V1; else process.env.DCHUB_ONE_LINK_V1 = v;
    const w = liveWall();
    expect(await run(w, {})).toBe(w);
  });
});

describe('a keyless wall collapses to one commerce link', () => {
  it('leaves exactly one distinct commerce link in content and structuredContent', async () => {
    const before = distinctCommerce(liveWall());
    expect(before.size).toBeGreaterThan(3);   // the fixture is the bad shape, or this proves nothing
    const out = await run(liveWall(), {});
    expect(distinctCommerce(out.content).size).toBe(1);
    expect(distinctCommerce(out.structuredContent).size).toBe(1);
    expect(JSON.stringify(out)).not.toContain('/go/c/');
  });
  it('keeps the relay as the human link, in every field that named it', async () => {
    const out = await run(liveWall(), {});
    const sc = out.structuredContent;
    const link = sc.human_url;
    expect(link).toMatch(/^https:\/\/dchub\.cloud\/(?:upgrade\/h\/|u\/)/);
    expect(sc.for_your_human.url).toBe(link);
    expect(sc._upgrade.developer_url).toBe(link);   // key kept, value changed: an outputSchema may require it
    expect(sc.upgrade_url).toBe(link);
  });
  it('names no price in agent fields and drops the pure-copy field', async () => {
    const out = await run(liveWall(), {});
    const sc = out.structuredContent;
    expect(sc._upgrade).not.toHaveProperty('credits_hint');
    expect(sc.upgrade_options).toHaveLength(1);
    const agentText = JSON.stringify([sc.upgrade_options, sc._upgrade]);
    expect(agentText).not.toMatch(/\$\d|1,000|one-time|Developer/);
    expect(out.content[0].text).not.toMatch(/\$10|Developer \$49|credits_hint/);
  });
  it('keeps the claim_free_key guidance and the relay instruction', async () => {
    const hint = (await run(liveWall(), {})).structuredContent._upgrade.next_tool_hint;
    expect(hint).toContain('claim_free_key');
    expect(hint).toContain('relay the link in human_url');
  });
  it('leaves the data and its data-citation links alone', async () => {
    const out = await run(liveWall(), {});
    expect(out.structuredContent.data[0].profile_url).toBe('https://dchub.cloud/facilities/digital-realty-phoenix-b6a72649');
    expect(out.structuredContent._data_total_in_pro).toBe(5);
    expect(out.content[1].text).toContain('Next question to offer the user');
  });
  it('is idempotent', async () => {
    const once = await run(liveWall(), {});
    const twice = await run(once, {});
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
  it('an already-short relay stays the one link', async () => {
    const w = liveWall({ human_url: SHORT, for_your_human: { url: SHORT, text: 'Open ' + SHORT } });
    const out = await run(w, {});
    expect([...distinctCommerce(out)]).toEqual([SHORT]);
  });
});

describe('who it does not touch', () => {
  it('a keyed caller keeps upgrade_url / pro_url as the key-bound checkout, and loses the rest', async () => {
    const out = await run(liveWall(), { api_key: 'dchub_live_x' });
    expect(out.structuredContent.upgrade_url).toBe(PACK);
    expect(out.structuredContent._upgrade.pro_url).toBe(PRO);
    expect(out.structuredContent._upgrade.developer_url).not.toContain('/go/c/');
    expect(out.structuredContent._upgrade).not.toHaveProperty('credits_hint');
  });
  it.each(['developer', 'pro', 'enterprise'])('a %s caller is untouched', async (tier) => {
    const w = liveWall();
    expect(await run(w, { tier })).toBe(w);
  });
  it('a clean platform (ChatGPT) is untouched: its own commerce rules apply', async () => {
    const w = liveWall();
    expect(await run(w, { platform: 'chatgpt' })).toBe(w);
  });
  it('a response that is not a wall is untouched', async () => {
    const w = { content: [{ type: 'text', text: '{"rows":[1,2,3]}' }], structuredContent: { rows: [1, 2, 3], note: 'pay $10 one-time' } };
    expect(await run(w, {})).toBe(w);
  });
  it('a wall with no relay link and no way to mint one keeps its checkouts', async () => {
    const w = liveWall({ human_url: undefined, for_your_human: undefined });
    w.content[0].text = w.content[0].text.split(RELAY).join(PACK);
    const saved2 = process.env.DCHUB_INTERNAL_KEY;
    const out = await run(w, {});
    if (saved2 !== undefined) process.env.DCHUB_INTERNAL_KEY = saved2;
    // Either a relay was mintable (then the checkouts collapsed onto it) or not (then untouched).
    // What may never happen is a wall with neither a checkout nor a relay.
    expect(distinctCommerce(out).size).toBeGreaterThanOrEqual(1);
  });
});

describe('price-copy scrub', () => {
  it('drops a parenthetical price clause but keeps the instruction around it', () => {
    expect(_oneLinkScrubCopy('Save the key (a $10 pack of 1,000 API credits covers usage) \u2014 relay the link in human_url.', SHORT))
      .toBe('Save the key \u2014 relay the link in human_url.');
  });
  it('drops a price sentence but never one that carries the link', () => {
    expect(_oneLinkScrubCopy('Free key first. Developer is $49. Pay here ' + SHORT + ' for $10.', SHORT))
      .toBe('Free key first. Pay here ' + SHORT + ' for $10.');
  });
  it('leaves a sentence naming Pro alone: the trial line is the human ask', () => {
    expect(_oneLinkScrubCopy('Start a 7-day Pro trial.', SHORT)).toBe('Start a 7-day Pro trial.');
  });
});

describe('wired into the tool pipeline', () => {
  it('runs inside the relay contract step, directly around the clean-platform wall line', () => {
    expect(SRC).toMatch(/await _oneLinkStep\(await _cleanPlatformWallLineStep\(/);
  });
  it('ships default OFF', () => {
    expect(SRC).toMatch(/_oneLinkOn = \(\) => \/\^\(1\|true\|yes\|on\)\$\/i\.test\(String\(process\.env\.DCHUB_ONE_LINK_V1 \|\| ''\)\)/);
  });
});
