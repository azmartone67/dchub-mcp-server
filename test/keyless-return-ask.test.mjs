// Owner 2026-11-17: the continuity ask for a KEYLESS caller who comes back (lib/keyless-return-ask.mjs).
// Pure half: the decision, the per-IP cache, the once-a-week clock and the latency budget (< 20 ms p95
// added to the request path, on a cache hit and on a miss behind a stubbed slow lookup). The real-server
// half (wiring in _returnNudgeStep, the backend read, the kill switch end to end) is in
// test/retention-email-ask.test.mjs.
import { describe, it, expect } from 'vitest';
import * as K from '../lib/keyless-return-ask.mjs';
import * as CA from '../lib/continuity-ask.mjs';

const LINE = CA.continuityReturnLine() + '\n' + CA.CONTINUITY_RETURN_AGENT;
const answer = () => ({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } });
const flush = () => new Promise((r) => setTimeout(r, 5));   // lets a 0 ms lookup settle

// A per-IP answer the test controls: which IPs have a row on an earlier UTC day.
function world(seenBefore = new Set(), delayMs = 0) {
  const calls = [];
  const lookup = (ip) => {
    calls.push(ip);
    return delayMs ? new Promise((r) => setTimeout(() => r(seenBefore.has(ip)), delayMs)) : Promise.resolve(seenBefore.has(ip));
  };
  return { calls, lookup };
}
function rig({ seenBefore = [], delayMs = 0, now } = {}) {
  const w = world(new Set(seenBefore), delayMs);
  const clock = now || (() => Date.now());
  const cache = K.createReturningCache({ lookup: w.lookup, now: clock });
  const once = K.createOncePerWeek({ now: clock });
  const step = (ip, env = {}, extra = {}) => K.keylessReturnAsk(answer(), { c: { client_ip: ip, ...extra }, env, cache, once });
  return { ...w, cache, once, step };
}
const asked = (r) => r.content[r.content.length - 1].text.endsWith(LINE);
const p95 = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };

describe('who is asked', () => {
  it('an IP seen on an earlier UTC day: asked once, at the END of the answer; the next call in the 7 days is not', async () => {
    const r = rig({ seenBefore: ['198.51.100.7'] });
    expect(asked(r.step('198.51.100.7'))).toBe(false);   // miss: lookup started, this call skips the ask
    await flush();
    const first = r.step('198.51.100.7');
    expect(asked(first)).toBe(true);
    expect(first.content[0].text.startsWith('{"ok":true}')).toBe(true);   // the data stays first
    expect(asked(r.step('198.51.100.7'))).toBe(false);   // second call, same window: no ask
    expect(r.calls).toEqual(['198.51.100.7']);            // one backend read for all three calls
  });

  it('an IP seen only today (no row on an earlier UTC day): never asked', async () => {
    const r = rig({ seenBefore: [] });
    r.step('192.0.2.10');
    await flush();
    for (let i = 0; i < 5; i++) expect(asked(r.step('192.0.2.10'))).toBe(false);
  });

  it('the 7-day clock: asked again only after 7 days', async () => {
    let t = Date.parse('2026-11-17T10:00:00Z');
    const r = rig({ seenBefore: ['198.51.100.8'], now: () => t });
    r.step('198.51.100.8'); await flush();
    expect(asked(r.step('198.51.100.8'))).toBe(true);
    t += 3 * 86400000;
    r.step('198.51.100.8'); await flush();               // a new UTC day: a fresh lookup
    expect(asked(r.step('198.51.100.8'))).toBe(false);
    t += 4 * 86400000;
    r.step('198.51.100.8'); await flush();
    expect(asked(r.step('198.51.100.8'))).toBe(true);
  });

  it('never: a keyed caller, no IP, an execute_plan loopback step, an ineligible caller, a wall, an error result', async () => {
    const r = rig({ seenBefore: ['198.51.100.9'] });
    r.step('198.51.100.9'); await flush();
    const opts = (c, more = {}) => ({ c: { client_ip: '198.51.100.9', ...c }, env: {}, cache: r.cache, once: r.once, ...more });
    const a = answer();
    expect(K.keylessReturnAsk(a, opts({ api_key: 'dch_live_x' }))).toBe(a);
    expect(K.keylessReturnAsk(a, opts({ client_ip: '' }))).toBe(a);
    expect(K.keylessReturnAsk(a, opts({ loopback_step: true }))).toBe(a);
    expect(K.keylessReturnAsk(a, opts({}, { eligible: () => false }))).toBe(a);
    expect(K.keylessReturnAsk(a, opts({}, { isWall: () => true }))).toBe(a);
    const err = { isError: true, content: [{ type: 'text', text: 'x' }] };
    expect(K.keylessReturnAsk(err, opts({}))).toBe(err);
    expect(asked(K.keylessReturnAsk(answer(), opts({})))).toBe(true);    // the positive control
  });

  it('a failing or throwing lookup reads as "not returning"', async () => {
    const cache = K.createReturningCache({ lookup: () => Promise.reject(new Error('503')) });
    const cache2 = K.createReturningCache({ lookup: () => { throw new Error('sync'); } });
    expect(cache.peek('203.0.113.1')).toBe(null);
    expect(cache2.peek('203.0.113.2')).toBe(null);
    await flush();
    expect(cache.peek('203.0.113.1')).toBe(false);
    expect(cache2.peek('203.0.113.2')).toBe(false);
  });

  it('the line is the #1524 continuity line, unchanged, and passes the note-F word check', () => {
    expect(LINE).toBe(CA.continuityReturnLine() + '\n' + CA.CONTINUITY_RETURN_AGENT);
    expect(LINE).not.toMatch(CA.NOTE_F_WORDS);
  });
});

describe('placement', () => {
  it('ends the last DATA block: never glued onto a trailing Source / Cite footer (a later step rewrites those)', () => {
    const r = { content: [{ type: 'text', text: '{"ok":true}' }, { type: 'text', text: 'Source: DC Hub (dchub.cloud) - live' },
      { type: 'text', text: 'Cite as: DC Hub (dchub.cloud), as of 2026-11-18.' }] };
    const out = K.appendBeforeFooter(r, 'ASK');
    expect(out.content.map((b) => b.text)).toEqual(['{"ok":true}\n\nASK', r.content[1].text, r.content[2].text]);
    expect(r.content[0].text).toBe('{"ok":true}');   // input untouched
    const noFooter = { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] };
    expect(K.appendBeforeFooter(noFooter, 'ASK').content.map((b) => b.text)).toEqual(['a', 'b\n\nASK']);
    const onlyFooter = { content: [{ type: 'text', text: 'Source: DC Hub (x)' }] };
    expect(K.appendBeforeFooter(onlyFooter, 'ASK').content.map((b) => b.text)).toEqual(['ASK', 'Source: DC Hub (x)']);
  });
});

describe('kill switch DCHUB_KEYLESS_RETURN_ASK=0 (default on)', () => {
  it('off / 0 / false / no: the same result object and no lookup; DCHUB_CONTINUITY_ASK=0 also turns it off', async () => {
    expect(K.keylessReturnAskOn({})).toBe(true);
    for (const v of ['0', 'off', 'false', 'no', ' OFF ']) expect(K.keylessReturnAskOn({ DCHUB_KEYLESS_RETURN_ASK: v }), v).toBe(false);
    const r = rig({ seenBefore: ['198.51.100.20'] });
    for (const env of [{ DCHUB_KEYLESS_RETURN_ASK: '0' }, { DCHUB_CONTINUITY_ASK: '0' }]) {
      for (let i = 0; i < 3; i++) {
        const a = answer();
        expect(K.keylessReturnAsk(a, { c: { client_ip: '198.51.100.20' }, env, cache: r.cache, once: r.once })).toBe(a);
        await flush();
      }
    }
    expect(r.calls).toEqual([]);
  });
});

describe('cache', () => {
  it('LRU: holds at most cap IPs and evicts the least recently used', async () => {
    const w = world(new Set(['a', 'b', 'c']));
    const cache = K.createReturningCache({ lookup: w.lookup, cap: 2 });
    cache.peek('a'); cache.peek('b'); await flush();
    expect(cache.peek('a')).toBe(true);    // touch a: b is now the oldest
    cache.peek('c'); await flush();
    expect(cache.size()).toBe(2);
    expect(cache.peek('a')).toBe(true);
    expect(cache.peek('b')).toBe(null);    // evicted: a fresh miss
  });

  it('TTL: a "not returning" answer is re-read after the TTL', async () => {
    let t = Date.parse('2026-11-17T10:00:00Z');
    const w = world(new Set());
    const cache = K.createReturningCache({ lookup: w.lookup, ttlMs: 60_000, now: () => t });
    cache.peek('x'); await flush();
    expect(cache.peek('x')).toBe(false);
    t += 61_000;
    expect(cache.peek('x')).toBe(null);
    await flush();
    expect(w.calls).toEqual(['x', 'x']);
  });

  it('one lookup per IP while it is in flight', () => {
    const w = world(new Set(), 10_000);
    const cache = K.createReturningCache({ lookup: w.lookup });
    for (let i = 0; i < 50; i++) expect(cache.peek('slow')).toBe(null);
    return flush().then(() => expect(w.calls).toEqual(['slow']));
  });

  it('keys by a hash, never the raw IP', () => {
    expect(K.ipKey('198.51.100.7')).toMatch(/^[0-9a-f]{24}$/);
    expect(K.ipKey('198.51.100.7')).not.toContain('198');
  });
});

describe('latency budget: < 20 ms p95 added to the request path', () => {
  const N = 400;
  it('cache MISS behind a lookup that takes 2 s: skip, never stall', async () => {
    const r = rig({ seenBefore: [], delayMs: 2000 });
    const ms = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const out = r.step('203.0.113.' + (i % 250) + '.' + i);   // every call a distinct IP: every call a miss
      ms.push(performance.now() - t0);
      expect(asked(out)).toBe(false);
    }
    const v = p95(ms);
    console.log(`[keyless-return-ask] miss (2 s lookup) p95=${v.toFixed(3)} ms max=${Math.max(...ms).toFixed(3)} ms n=${N}`);
    expect(v).toBeLessThan(20);
    expect(Math.max(...ms)).toBeLessThan(2000);   // nothing waited on the 2 s lookup
  });

  it('cache HIT (returning and not returning)', async () => {
    const ips = Array.from({ length: 200 }, (_, i) => '198.51.100.' + i);
    const r = rig({ seenBefore: ips.slice(0, 100) });
    for (const ip of ips) r.step(ip);
    await flush();
    const ms = [];
    for (let k = 0; k < 2; k++) {
      for (const ip of ips) {
        const t0 = performance.now();
        r.step(ip);
        ms.push(performance.now() - t0);
      }
    }
    const v = p95(ms);
    console.log(`[keyless-return-ask] hit p95=${v.toFixed(3)} ms max=${Math.max(...ms).toFixed(3)} ms n=${ms.length}`);
    expect(v).toBeLessThan(20);
    expect(r.calls.length).toBe(ips.length);   // the hits made no further lookups
  });
});
