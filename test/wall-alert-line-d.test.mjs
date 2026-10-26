// Wall email option D (owner 2026-10-26): the market in the relay link, and C's first-wall line
// names the alert. Switch DCHUB_WALL_ALERT_LINE, default OFF (only 1/on/true/yes enable it).
//
//   1. switch off: no token gains an m- field and the copy is C's, byte for byte;
//   2. switch on + a market arg: the signed token ends |m-<slug> (signature valid) and C's
//      first-wall line is "Your human can get the full answer and an alert when <Market> moves: <link>";
//   3. switch on, no market: C's current line;
//   4. a bad slug: no field, C's line;
//   5. the wall-kind re-stamp keeps m- (last);
//   6. the per-request relay memo never shares a token across two markets.
//
// Real server.mjs app on loopback, stub backend (test/helpers/claude-directory-harness.mjs); no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import {
  _resetCapWallDay, wallAlertLineOn, wallMarketSlug, marketDisplayName, keylessCapEmailOnlyLine,
  keylessCapEmailResult, keylessSoftCapEmailUpgrade,
} from '../lib/keyless-wall.mjs';

process.env.DCHUB_LEAN_RESPONSES = '0';   // same as keyless-wall-email-first: test the inner wall steps

const INTERNAL = 'test-internal-key-not-a-real-secret';
const UA = { 'user-agent': 'Claude-User' };
const SHORT = 'https://dchub.cloud/u/abcdef';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// C's first-wall line as it was before D (keyless-wall-email-first.test.mjs FIRST_LINE).
const C_FIRST_LINE = (link) => new RegExp('^Keep going free: show your human this link → '
  + esc(link) + '\\. One email unlocks \\d+ calls a day and the full answer to this question\\.$');
const D_LINE = (market, link) => 'Your human can get the full answer and an alert when ' + market + ' moves: ' + link;

let H, fence, anonCount = 0, ipN = 0;
const shortReqs = [];

async function settle(quietMs = 250, maxMs = 5000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call(name, args, { extraHdr = {} } = {}) {
  const hdr = { ...UA, 'x-dc-client-ip': `198.51.100.${++ipN}`, ...extraHdr };
  const init = await H.init('/mcp', 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  H.S._anonUsageCounts.clear();
  shortReqs.length = 0;
  const r = await H.call('/mcp', name, args, { ...hdr, 'mcp-session-id': sid });
  await settle();
  const res = (r.msg && r.msg.result) || {};
  const relays = shortReqs.map((b) => relayFields(b && b.relay_url)).filter(Boolean);
  return { sid, res, sc: res.structuredContent || {}, text: (res.content || []).map((x) => x.text || '').join('\n'), relays };
}
function relayFields(url) {
  const m = /\/upgrade\/h\/([A-Za-z0-9_-]+)\.([0-9a-f]{32})/.exec(url || '');
  if (!m) return null;
  const sig = createHmac('sha256', INTERNAL).update(m[1]).digest('hex').slice(0, 32);
  return { fields: Buffer.from(m[1], 'base64url').toString().split('|'), sigOk: sig === m[2] };
}
const mFields = (rel) => rel.fields.filter((f) => f.startsWith('m-'));
// The session id and provenance.retrieved_at are the only per-call bytes in a walled response here
// (the short-link stub returns one constant link); everything else must match exactly.
const norm = (r) => JSON.stringify(r.res).split(r.sid).join('<sid>')
  .replace(/"retrieved_at":"[^"]*"/g, '"retrieved_at":"<t>"');
function copyViolations(v) {
  const s = JSON.stringify(v);
  const out = [];
  if (/\bPro\b|Developer|Starter|Founding/.test(s)) out.push('plan name');
  if (/\$\s?\d|USD\s?\d/.test(s)) out.push('price');
  if (/\/mo\b|per month/i.test(s)) out.push('/mo');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) out.push('emoji');
  return out;
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_ANON_DAILY_CAP: '30', DCHUB_ANON_HARD_WALL_MULT: '10' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/mcp/anon-usage') return { ok: true, count: anonCount };
      if (p === '/api/v1/relay/short') {
        shortReqs.push(body);
        return (body && body.relay_url) ? { ok: true, url: SHORT } : { status: 500, body: { error: 'no' } };
      }
      return undefined;
    },
  });
  H.S._readDeadline.signal = () => AbortSignal.timeout(120_000);
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); delete process.env.DCHUB_WALL_ALERT_LINE; });
beforeEach(() => {
  anonCount = 0;
  for (const k of ['DCHUB_WALL_ALERT_LINE', 'DCHUB_KEYLESS_EMAIL_FIRST', 'DCHUB_WALL_NO_EMAIL_EXIT_DELAY',
                   'DCHUB_KEYLESS_EMAIL_FIRST_ALL', 'DCHUB_WALL_KIND_STAMP']) delete process.env[k];
  _resetCapWallDay();
});

describe('unit: switch, slug, display name, line', () => {
  it('the switch is OFF by default and only 1/on/true/yes enable it', () => {
    expect(wallAlertLineOn({})).toBe(false);
    for (const v of ['', '0', 'off', 'false', 'no', 'enabled', 'y', '2']) expect(wallAlertLineOn({ DCHUB_WALL_ALERT_LINE: v })).toBe(false);
    for (const v of ['1', 'on', 'true', 'yes', 'TRUE', ' Yes ']) expect(wallAlertLineOn({ DCHUB_WALL_ALERT_LINE: v })).toBe(true);
  });
  it('slug: market, else market_slug; trimmed, lowercased, spaces to hyphens; anything else is none', () => {
    expect(wallMarketSlug({ market: '  Northern Virginia ' })).toBe('northern-virginia');
    expect(wallMarketSlug({ market_slug: 'dallas' })).toBe('dallas');
    expect(wallMarketSlug({ market: 'phoenix', market_slug: 'dallas' })).toBe('phoenix');
    for (const bad of [{}, null, [], { market: 42 }, { market: '' }, { market: '-dallas' }, { market: 'São Paulo' },
                       { market: 'a|b' }, { market: 'dallas|m-x' }, { market: 'x'.repeat(49) }, { market_slug: 'a_b' }]) {
      expect(wallMarketSlug(bad)).toBe('');
    }
    expect(wallMarketSlug({ market: 'x'.repeat(48) })).toBe('x'.repeat(48));
  });
  it('display name title-cases the slug', () => {
    expect(marketDisplayName('northern-virginia')).toBe('Northern Virginia');
    expect(marketDisplayName('dallas')).toBe('Dallas');
  });
  it('the line names the alert only with a valid market; C\'s line otherwise', () => {
    expect(keylessCapEmailOnlyLine(SHORT, 50, 'northern-virginia')).toBe(D_LINE('Northern Virginia', SHORT));
    expect(keylessCapEmailOnlyLine(SHORT, 50)).toMatch(C_FIRST_LINE(SHORT));
    expect(keylessCapEmailOnlyLine(SHORT, 50, 'Bad Slug')).toMatch(C_FIRST_LINE(SHORT));
    // the second wall of the day (the exit shown) never changes
    const r = keylessCapEmailResult({ name: 'find_sites', link: SHORT, exitShown: true, perDay: 50, market: 'dallas' });
    expect(r.structuredContent.user_message).toBe('Keep going free by email → ' + SHORT);
    const u = keylessSoftCapEmailUpgrade({ a: 1 }, { name: 'x', link: SHORT, exitShown: false, perDay: 50, market: 'dallas' });
    expect(u.user_message).toBe(D_LINE('Dallas', SHORT));
    expect(copyViolations(D_LINE('Northern Virginia', SHORT))).toEqual([]);
  });
});

describe('1. switch off: no m- field, the copy is unchanged', () => {
  it('hard wall, market named: token has no m-, line is C\'s, and the response equals the no-market one', async () => {
    anonCount = 999;
    const withM = await call('execute_plan', { intent: 'compare power for a 100 MW campus', market: 'northern-virginia' });
    _resetCapWallDay();
    const noM = await call('execute_plan', { intent: 'compare power for a 100 MW campus' });
    for (const r of [withM, noM]) {
      expect(r.sc.unlock_kind).toBe('email_cap');
      expect(r.sc.user_message).toMatch(C_FIRST_LINE(SHORT));
      expect(r.text.split('\n')[0]).toMatch(C_FIRST_LINE(SHORT));
      expect(r.relays.length).toBeGreaterThan(0);
      for (const rel of r.relays) {
        expect(rel.sigOk).toBe(true);
        expect(rel.fields).toEqual([r.sid, 'execute_plan', expect.any(String), expect.stringMatching(/^\d+$/), 'w-freekey']);
      }
    }
    expect(norm(withM)).toBe(norm(noM));
  });
  it('a value that is not 1/on/true/yes leaves it off ("enabled", "0")', async () => {
    anonCount = 999;
    for (const v of ['enabled', '0']) {
      process.env.DCHUB_WALL_ALERT_LINE = v;
      _resetCapWallDay();
      const r = await call('execute_plan', { intent: 'x', market: 'dallas' });
      expect(r.sc.user_message).toMatch(C_FIRST_LINE(SHORT));
      for (const rel of r.relays) expect(mFields(rel)).toEqual([]);
    }
  });
});

describe('2. switch on + a market arg', () => {
  it('hard wall: signed token ends |m-<slug>; the first wall names the alert; the second wall is C\'s exit wall', async () => {
    process.env.DCHUB_WALL_ALERT_LINE = '1';
    anonCount = 999;
    const ip = { 'x-dc-client-ip': '203.0.113.41' };
    const f = await call('execute_plan', { intent: 'compare power for a 100 MW campus', market: 'Northern Virginia' }, { extraHdr: ip });
    expect(f.sc.unlock_kind).toBe('email_cap');
    expect(f.sc.user_message).toBe(D_LINE('Northern Virginia', SHORT));
    expect(f.text.split('\n')[0]).toBe(D_LINE('Northern Virginia', SHORT));
    expect(f.sc.for_your_human.text).toBe(D_LINE('Northern Virginia', SHORT));
    expect(f.relays.length).toBeGreaterThan(0);
    for (const rel of f.relays) {
      expect(rel.sigOk).toBe(true);
      expect(rel.fields.length).toBe(6);
      expect(rel.fields[1]).toBe('execute_plan');
      expect(rel.fields[4]).toBe('w-freekey');
      expect(rel.fields[rel.fields.length - 1]).toBe('m-northern-virginia');
    }
    expect(copyViolations({ l: f.sc.user_message, t: f.text.split('\n')[0] })).toEqual([]);
    const s = await call('execute_plan', { intent: 'x', market: 'northern-virginia' }, { extraHdr: ip });
    expect(s.sc.user_message).toBe('Keep going free by email → ' + SHORT);   // exit wall: unchanged copy
    for (const rel of s.relays) expect(rel.fields[rel.fields.length - 1]).toBe('m-northern-virginia');
  });
  // (market_slug is covered at unit level: execute_plan's inputSchema has `market` only, and the SDK
  // drops an argument the schema does not declare before the handler sees it.)
  it('soft cap (preview kept): the nudge names the alert', async () => {
    process.env.DCHUB_WALL_ALERT_LINE = 'true';
    anonCount = 50;
    const r = await call('execute_plan', { intent: 'rank sites for a 200 MW campus', market: 'dallas' });
    const up = r.sc._upgrade || {};
    expect(up.unlock_kind).toBe('email_cap');
    expect(r.sc.user_message).toBe(D_LINE('Dallas', SHORT));
    expect(up.message.startsWith(D_LINE('Dallas', SHORT) + ' ')).toBe(true);
    expect(r.relays.length).toBeGreaterThan(0);
    for (const rel of r.relays) { expect(rel.sigOk).toBe(true); expect(rel.fields[rel.fields.length - 1]).toBe('m-dallas'); }
    expect(copyViolations({ l: r.sc.user_message })).toEqual([]);
  });
});

describe('3/4. switch on, no market or a bad slug: no field, C\'s line', () => {
  it('no market', async () => {
    process.env.DCHUB_WALL_ALERT_LINE = 'yes';
    anonCount = 999;
    const r = await call('execute_plan', { intent: 'compare power for a 100 MW campus' });
    expect(r.sc.user_message).toMatch(C_FIRST_LINE(SHORT));
    expect(r.relays.length).toBeGreaterThan(0);
    for (const rel of r.relays) { expect(rel.sigOk).toBe(true); expect(rel.fields.length).toBe(5); expect(mFields(rel)).toEqual([]); }
  });
  it('bad slugs (pipe, leading hyphen, non-ascii, too long)', async () => {
    process.env.DCHUB_WALL_ALERT_LINE = 'on';
    anonCount = 999;
    for (const market of ['dallas|w-capacity', '-dallas', 'São Paulo', 'x'.repeat(49)]) {
      _resetCapWallDay();
      const r = await call('execute_plan', { intent: 'x', market });
      expect(r.sc.user_message).toMatch(C_FIRST_LINE(SHORT));
      expect(r.relays.length).toBeGreaterThan(0);
      for (const rel of r.relays) { expect(rel.fields.length).toBe(5); expect(mFields(rel)).toEqual([]); }
    }
  });
});

describe('per call: the market is reset for every call sharing one request context', () => {
  it('a market-named wall then an unnamed wall in one ctx: the second is C\'s line with no m-', async () => {
    process.env.DCHUB_WALL_ALERT_LINE = '1';
    anonCount = 999;
    const T = H.S.createServer()._registeredTools.execute_plan;
    const store = { tier: 'anonymous', platform: 'claude', client_name_raw: 'claude-ai', client_ip: '198.51.100.250',
                    session_id: 'sess-d-percall' };
    const run = async (args) => {
      H.S._anonUsageCounts.clear();
      shortReqs.length = 0;
      const parsed = await T.inputSchema.safeParseAsync(args);
      const r = await H.S._ctxALS.run(store, () => T.handler(parsed.data, { signal: new AbortController().signal }));
      return { sc: r.structuredContent || {}, relays: shortReqs.map((x) => relayFields(x && x.relay_url)).filter(Boolean) };
    };
    const a = await run({ intent: 'x', market: 'dallas' });
    expect(a.sc.user_message).toBe(D_LINE('Dallas', SHORT));
    _resetCapWallDay();
    const b = await run({ intent: 'x' });
    expect(b.sc.user_message).toMatch(C_FIRST_LINE(SHORT));
    expect(b.relays.length).toBeGreaterThan(0);
    for (const rel of b.relays) expect(mFields(rel)).toEqual([]);
  });
});

describe('5/6. the payload parser, the re-stamp and the memo', () => {
  const inCall = (store, fn) => H.S._ctxALS.run({ session_id: 'sess-d-1', ...store }, fn);
  it('a seven-field token parses; the re-stamp keeps pk- and m- (m- last) and re-signs', () => {
    const kref = 'pk-' + 'a'.repeat(64);
    const raw = `sess-d-1|get_market_intel|free|1700000000|${kref}|w-depth|m-dallas`;
    const p = Buffer.from(raw).toString('base64url');
    const url = 'https://dchub.cloud/upgrade/h/' + p + '.' + createHmac('sha256', INTERNAL).update(p).digest('hex').slice(0, 32);
    expect(H.S._relayTokenFields(url)).toEqual(raw.split('|'));
    const fresh = H.S._restampRelayUrl(url, 'w-capacity');
    const rel = relayFields(fresh);
    expect(rel.sigOk).toBe(true);
    expect(rel.fields[0]).toBe('sess-d-1');
    expect(rel.fields.slice(4)).toEqual([kref, 'w-capacity', 'm-dallas']);
    // no m- in, no m- out
    const raw5 = 'sess-d-1|get_market_intel|free|1700000000|w-depth';
    const p5 = Buffer.from(raw5).toString('base64url');
    const u5 = 'https://dchub.cloud/upgrade/h/' + p5 + '.' + createHmac('sha256', INTERNAL).update(p5).digest('hex').slice(0, 32);
    expect(relayFields(H.S._restampRelayUrl(u5, 'w-capacity')).fields.slice(4)).toEqual(['w-capacity']);
  });
  it('mint: on, the token carries m- from the call\'s ctx; off, it never does', () => {
    process.env.DCHUB_WALL_ALERT_LINE = '1';
    const on = inCall({ _wallMarket: 'dallas' }, () => H.S.buildHumanRelay('get_market_context', 'free', 'sess-d-1', { wall: 'depth' }));
    expect(relayFields(on.url).fields.slice(4)).toEqual(['w-depth', 'm-dallas']);
    delete process.env.DCHUB_WALL_ALERT_LINE;
    const off = inCall({ _wallMarket: 'dallas' }, () => H.S.buildHumanRelay('get_market_context', 'free', 'sess-d-1', { wall: 'depth' }));
    expect(relayFields(off.url).fields.slice(4)).toEqual(['w-depth']);
  });
  it('one request, two markets: two tokens; the same market twice: one token', () => {
    process.env.DCHUB_WALL_ALERT_LINE = '1';
    const store = { session_id: 'sess-d-1' };
    const [a, b, a2, n] = H.S._ctxALS.run(store, () => {
      store._wallMarket = 'dallas';
      const x = H.S.buildHumanRelay('get_market_context', 'free', 'sess-d-1');
      store._wallMarket = 'phoenix';
      const y = H.S.buildHumanRelay('get_market_context', 'free', 'sess-d-1');
      store._wallMarket = 'dallas';
      const x2 = H.S.buildHumanRelay('get_market_context', 'free', 'sess-d-1');
      store._wallMarket = '';
      const z = H.S.buildHumanRelay('get_market_context', 'free', 'sess-d-1');
      return [x, y, x2, z];
    });
    expect(a.url).not.toBe(b.url);
    expect(mFields(relayFields(a.url))).toEqual(['m-dallas']);
    expect(mFields(relayFields(b.url))).toEqual(['m-phoenix']);
    expect(a2).toBe(a);
    expect(mFields(relayFields(n.url))).toEqual([]);
    expect(n.url).not.toBe(a.url);
  });
  it('a stamped entry for one market is not reused by a kind-blind mint for another', () => {
    process.env.DCHUB_WALL_ALERT_LINE = '1';
    const store = { session_id: 'sess-d-1' };
    const [st, blind] = H.S._ctxALS.run(store, () => {
      store._wallMarket = 'dallas';
      const s = H.S.buildHumanRelay('get_market_context', 'free', 'sess-d-1', { wall: 'depth' });
      store._wallMarket = 'phoenix';
      const k = H.S.buildHumanRelay('get_market_context', 'free', 'sess-d-1');
      return [s, k];
    });
    expect(blind.url).not.toBe(st.url);
    expect(mFields(relayFields(blind.url))).toEqual(['m-phoenix']);
  });
});
