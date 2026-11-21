// Wall identity v2, device match (owner relay 2026-11-20, item 3): lib/wall-device-match.mjs, the pure half.
// The pair (client name + IP /24 or /48), who is ignored, both flags, the cache that never waits, the record rule,
// the key scrub + the one welcome line, and the latency added to the keyless hot path (< 20 ms p95 on a hit and on
// a miss behind a slow lookup). The real-server half is test/wall-device-match-server.test.mjs.
import { describe, it, expect } from 'vitest';
import * as W from '../lib/wall-device-match.mjs';

const ON = { DCHUB_WALL_IDENTITY_V2: '1', DCHUB_WALL_IDENTITY_V2_DEVICE_MATCH: 'on' };
const KEY = 'dch_live_0123456789abcdef0123456789abcdef';
const flush = () => new Promise((r) => setTimeout(r, 5));
const p95 = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
const ctx = (over = {}) => ({ client_name_raw: 'Claude Code', client_ip: '198.51.100.23', ...over });
function rig({ known = new Map(), delayMs = 0, fail = false, now } = {}) {
  const calls = [];
  const lookup = (p) => {
    calls.push(p);
    if (fail) return Promise.reject(new Error('boom'));
    const v = known.get(p.ip_prefix + '|' + p.client_name) || null;
    return delayMs ? new Promise((r) => setTimeout(() => r(v), delayMs)) : Promise.resolve(v);
  };
  const cache = W.createMatchCache({ lookup, ...(now ? { now } : {}) });
  return { calls, cache, match: (c, name = 'get_market_intel', env = ON, o = {}) => W.matchFor(c, name, { env, cache, ...o }) };
}
const knownPair = () => new Map([['198.51.100.0/24|Claude Code', KEY]]);

describe('the pair', () => {
  it('IPv4 is cut to /24 and IPv6 to /48; mapped IPv4 is IPv4', () => {
    expect(W.ipPrefix('198.51.100.23')).toBe('198.51.100.0/24');
    expect(W.ipPrefix('::ffff:198.51.100.9')).toBe('198.51.100.0/24');
    expect(W.ipPrefix('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(W.ipPrefix('[2001:db8:1:2::9]:443')).toBe('2001:db8:1::/48');
    expect(W.ipPrefix('2001:DB8::1')).toBe('2001:db8:0::/48');
  });
  it('garbage, loopback, private, CGNAT and link-local addresses are not a pair', () => {
    for (const ip of ['', null, 'x', '1.2.3', '999.1.1.1', '127.0.0.1', '10.1.2.3', '192.168.0.4', '172.16.9.9',
      '100.64.1.1', '169.254.1.1', '::1', '::', 'fe80::1', 'fd12::1', '1:2:3:4:5:6:7:8:9', '2001::db8::1']) {
      expect(W.ipPrefix(ip), String(ip)).toBe(null);
    }
  });
  it('empty, generic HTTP-library and QA client names are ignored; product names are kept', () => {
    for (const n of ['', '   ', 'curl', 'curl/8.4.0', 'python-requests', 'python-requests/2.31', 'node', 'node 20',
      'undici', 'Go-http-client/1.1', 'axios/1.6', 'mcp-agent', 'unknown', 'dchub-qa-readonly/1', 'probe (x - exclude)']) {
      expect(W.pairNameEligible(n), JSON.stringify(n)).toBe(false);
    }
    for (const n of ['Claude Code', 'claude-ai', 'cursor-vscode', 'mcp-remote', 'goose', 'Windsurf']) {
      expect(W.pairNameEligible(n), n).toBe(true);
    }
  });
  it('pairOf: a bot / QA caller (server.mjs isBot) is not a pair; the hash covers prefix AND name', () => {
    expect(W.pairOf(ctx(), { isBot: () => true })).toBe(null);
    const a = W.pairOf(ctx()), b = W.pairOf(ctx({ client_ip: '198.51.100.200' }));
    const c = W.pairOf(ctx({ client_name_raw: 'Claude Desktop' })), d = W.pairOf(ctx({ client_ip: '198.51.101.23' }));
    expect(a.k).toBe(b.k);            // same /24
    expect(a.k).not.toBe(c.k);        // other client name
    expect(a.k).not.toBe(d.k);        // other /24
    expect(JSON.stringify(a)).not.toContain('198.51.100.23');   // never the raw address
  });
});

describe('flags: both are required, both default off', () => {
  it('deviceMatchOn / recordOn', () => {
    expect(W.deviceMatchOn({})).toBe(false);
    expect(W.deviceMatchOn({ DCHUB_WALL_IDENTITY_V2: '1' })).toBe(false);
    expect(W.deviceMatchOn({ DCHUB_WALL_IDENTITY_V2_DEVICE_MATCH: '1' })).toBe(false);
    expect(W.deviceMatchOn({ DCHUB_WALL_IDENTITY_V2: 'yes', DCHUB_WALL_IDENTITY_V2_DEVICE_MATCH: 'off' })).toBe(false);
    expect(W.deviceMatchOn(ON)).toBe(true);
    expect(W.recordOn({ DCHUB_WALL_IDENTITY_V2: '1' })).toBe(false);
    expect(W.recordOn(ON)).toBe(true);
  });
  it('off: no match and no backend read is started', async () => {
    const r = rig({ known: knownPair() });
    for (const env of [{}, { DCHUB_WALL_IDENTITY_V2: '1' }, { DCHUB_WALL_IDENTITY_V2_DEVICE_MATCH: '1' }]) {
      expect(r.match(ctx(), 'get_market_intel', env)).toBe(null);
    }
    await flush();
    expect(r.calls).toEqual([]);
  });
});

describe('matching', () => {
  it('a miss serves keyless and starts ONE background read; the next call from the pair is matched', async () => {
    const r = rig({ known: knownPair() });
    expect(r.match(ctx())).toBe(null);
    expect(r.match(ctx())).toBe(null);          // still in flight: no second read
    await flush();
    const m = r.match(ctx({ client_ip: '198.51.100.99' }));   // same /24, same name
    expect(m && m.key).toBe(KEY);
    expect(r.calls.length).toBe(1);
    expect(r.calls[0]).toMatchObject({ client_name: 'Claude Code', ip_prefix: '198.51.100.0/24' });
  });
  it('exact pair only: another client name or another /24 is not matched', async () => {
    const r = rig({ known: knownPair() });
    for (const c of [ctx({ client_name_raw: 'Claude Desktop' }), ctx({ client_ip: '198.51.101.23' })]) {
      r.match(c); await flush();
      expect(r.match(c)).toBe(null);
    }
  });
  it('a keyed call, an identity tool, an excluded surface (ChatGPT) and a bot are never matched', async () => {
    const r = rig({ known: knownPair() });
    r.match(ctx()); await flush();
    expect(r.match(ctx())).not.toBe(null);
    expect(r.match(ctx({ api_key: 'dch_live_other0000000000' }))).toBe(null);
    for (const t of ['claim_free_key', 'get_api_key', 'bind_email', 'recover_my_key']) expect(r.match(ctx(), t)).toBe(null);
    expect(r.match(ctx(), 'get_market_intel', ON, { excluded: () => true })).toBe(null);
    expect(r.match(ctx(), 'get_market_intel', ON, { isBot: () => true })).toBe(null);
  });
  it('fail closed: a read error, an empty answer or a non-free-key answer is "no match"', async () => {
    for (const known of [null, new Map([['198.51.100.0/24|Claude Code', 'dch_trial_abcdef0123456789']]),
                         new Map([['198.51.100.0/24|Claude Code', '']])]) {
      const r = known ? rig({ known }) : rig({ fail: true });
      r.match(ctx()); await flush();
      expect(r.match(ctx())).toBe(null);
    }
  });
  it('the cache expires (10 min) and forget() drops a pair at once', async () => {
    let t = 1_000_000;
    const r = rig({ known: knownPair(), now: () => t });
    r.match(ctx()); await flush();
    expect(r.match(ctx())).not.toBe(null);
    t += 11 * 60_000;
    expect(r.match(ctx())).toBe(null);      // stale: a fresh read
    await flush();
    expect(r.calls.length).toBe(2);
    r.cache.forget(W.pairOf(ctx()));
    expect(r.match(ctx())).toBe(null);
    await flush();
    expect(r.calls.length).toBe(3);
  });
});

describe('recording a wall mint', () => {
  const memo = () => W.createWallPairMemo();
  it('both flags, a free durable key and a walled caller (session OR pair) are required', () => {
    const wp = memo();
    expect(W.recordFor(ctx(), KEY, { env: ON, walledSession: true })).toMatchObject({ ip_prefix: '198.51.100.0/24' });
    expect(W.recordFor(ctx(), KEY, { env: ON, walledSession: false, wallPairs: wp })).toBe(null);
    wp.note(W.pairOf(ctx({ client_ip: '198.51.100.4' })));
    expect(W.recordFor(ctx(), KEY, { env: ON, wallPairs: wp })).not.toBe(null);
    expect(W.recordFor(ctx(), KEY, { env: { DCHUB_WALL_IDENTITY_V2: '1' }, walledSession: true })).toBe(null);
    expect(W.recordFor(ctx(), 'dch_trial_abc0000000000', { env: ON, walledSession: true })).toBe(null);
    expect(W.recordFor(ctx({ client_name_raw: 'curl/8' }), KEY, { env: ON, walledSession: true })).toBe(null);
    expect(W.recordFor(ctx(), KEY, { env: ON, walledSession: true, excluded: () => true })).toBe(null);
  });
  it('the wall-pair memo lasts 30 minutes', () => {
    let t = 0;
    const wp = W.createWallPairMemo({ now: () => t });
    const p = W.pairOf(ctx());
    wp.note(p);
    t += 29 * 60_000; expect(wp.recent(p)).toBe(true);
    t += 2 * 60_000; expect(wp.recent(p)).toBe(false);
  });
});

describe('the served answer', () => {
  const ans = () => ({
    content: [{ type: 'text', text: `{"ok":true,"connect_url":"https://dchub.cloud/mcp?key=${KEY}"}` },
              { type: 'text', text: 'Your key: ' + KEY.slice(0, 14) + '…' },
              { type: 'text', text: 'Source: DC Hub (dchub.cloud), as of 2026-11-20' }],
    structuredContent: { ok: true, api_key: KEY, nested: [{ k: 'x ' + KEY }], key_prefix: KEY.slice(0, 13) },
  });
  it('the key and any prefix of it are gone from every string; ONE welcome line before the Source footer', () => {
    const out = W.finishMatchedAnswer(ans(), KEY);
    const all = JSON.stringify(out);
    expect(all).not.toContain('dch_live_');
    expect(all).not.toContain(KEY.slice(9, 20));
    expect(all.split(W.WELCOME_BACK_LINE).length - 1).toBe(1);
    expect(out.content[out.content.length - 1].text.startsWith('Source: DC Hub (')).toBe(true);
    const again = W.finishMatchedAnswer(out, KEY);
    expect(JSON.stringify(again).split(W.WELCOME_BACK_LINE).length - 1).toBe(1);   // never twice
  });
  it('showLine:false scrubs only; an error envelope gets no line but is still scrubbed', () => {
    expect(JSON.stringify(W.finishMatchedAnswer(ans(), KEY, { showLine: false }))).not.toContain(W.WELCOME_BACK_LINE);
    const err = W.finishMatchedAnswer({ isError: true, content: [{ type: 'text', text: 'bad ' + KEY }] }, KEY);
    expect(JSON.stringify(err)).not.toContain(W.WELCOME_BACK_LINE);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });
});

describe('latency budget: < 20 ms p95 added to the keyless hot path', () => {
  const N = 2000;
  it('miss behind a 2 s lookup, and hit', async () => {
    const r = rig({ known: knownPair(), delayMs: 2000 });
    const miss = [];
    for (let i = 0; i < N; i++) {
      const c = ctx({ client_ip: `203.0.${i % 250}.${(i % 200) + 1}`, client_name_raw: 'Claude Code ' + i });
      const t0 = performance.now(); r.match(c); miss.push(performance.now() - t0);
    }
    const fast = rig({ known: knownPair() });
    fast.match(ctx()); await flush();
    const hit = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now(); const m = fast.match(ctx()); hit.push(performance.now() - t0);
      expect(m && m.key).toBe(KEY);
    }
    const off = rig({ known: knownPair() });
    const offMs = [];
    for (let i = 0; i < N; i++) { const t0 = performance.now(); off.match(ctx(), 'get_market_intel', {}); offMs.push(performance.now() - t0); }
    console.log(`[wall-device-match] p95 miss(2s lookup)=${p95(miss).toFixed(4)} ms hit=${p95(hit).toFixed(4)} ms flags-off=${p95(offMs).toFixed(4)} ms n=${N}`);
    expect(p95(miss)).toBeLessThan(20);
    expect(p95(hit)).toBeLessThan(20);
    expect(p95(offMs)).toBeLessThan(20);
  });
});
