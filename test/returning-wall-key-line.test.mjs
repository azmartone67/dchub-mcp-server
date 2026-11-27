// Grok -> Brain 2026-11-27 (owner-approved): wall and key retention for returning keyless callers.
//   Change 1 (lib/wall-key-line.mjs RETURNING_KEY_LINE, lib/wall-offers.mjs `returning`, server.mjs
//            _returningKeylessWall): a keyless caller with no email on file, seen in an earlier week (the cached
//            anon-returning read), on a digest-class wall reads ONE offer, the key line naming what a key keeps; no
//            digest line. A cache miss / not returning: today's wall.
//   Change 2 (lib/keep-this-line.mjs, server.mjs _keylessReturnStep): a keyless full answer from get_market_dcpi_rank
//            or analyze_site ends its last data block with the keep-this line, once per session.
// Pure half first, then the real /mcp handler (lean on, the plain stub).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork, GUESS_ARGS } from './helpers/claude-directory-harness.mjs';
import { RETURNING_KEY_LINE, RETURNING_KEY_LINE_RE, returningKeyLineEligible, withReturningKeyLineForDigest,
  keyLine, KEY_LINE_RE } from '../lib/wall-key-line.mjs';
import { wallOffers, offerKinds } from '../lib/wall-offers.mjs';
import { offersShown } from '../lib/offers-shown.mjs';
import { KEY_KEEPS, NOTE_F_WORDS, createOncePerWeek } from '../lib/continuity-ask.mjs';
import { KEEP_THIS_LINE, keepThisLineStep } from '../lib/keep-this-line.mjs';

process.env.DCHUB_KEYLESS_FIRST_FULL = '0';   // the walled preview on the wall half (the keep half turns it on per call)

const keyless = (over = {}) => ({ keyed: false, bound: false, signedIn: false, paid: false, held: '', ...over });
// One human link per wall: distinct URLs (value-first repeats the same link in its headline).
const linkCount = (t) => new Set((String(t).match(/https?:\/\/[^\s)"'`\]]+/g) || []).map((u) => u.replace(/[.,;:]+$/, ''))).size;

describe('change 1: the returning key line (pure)', () => {
  it('names KEY_KEEPS, says DCHUB_API_KEY is optional, bind_email is the one action, passes NOTE_F_WORDS', () => {
    expect(RETURNING_KEY_LINE).toContain(KEY_KEEPS);
    expect(RETURNING_KEY_LINE).toContain('DCHUB_API_KEY is optional.');
    expect(RETURNING_KEY_LINE).toContain('`bind_email`');
    expect(RETURNING_KEY_LINE).toMatch(/Only use an address they gave you\.$/);
    expect(NOTE_F_WORDS.test(RETURNING_KEY_LINE)).toBe(false);
    expect(RETURNING_KEY_LINE).not.toMatch(/subscribe_digest|claim_free_key|https?:\/\/|[{}]/);
    expect(RETURNING_KEY_LINE).not.toMatch(/open|withheld|held back/i);   // an email opens nothing on a digest-class wall
    expect(RETURNING_KEY_LINE).not.toMatch(KEY_LINE_RE);                  // V2's KEY_LINE_RE rewrite leaves it alone
  });
  it('eligible only for returning, keyless, unbound, unpaid, digest-class walls with no email ask yet', () => {
    const base = { returning: true, floorKind: 'digest' };
    expect(returningKeyLineEligible(base)).toBe(true);
    expect(returningKeyLineEligible({ ...base, returning: false })).toBe(false);
    expect(returningKeyLineEligible({ ...base, returning: null })).toBe(false);   // a cache miss
    expect(returningKeyLineEligible({ ...base, keyed: true })).toBe(false);
    expect(returningKeyLineEligible({ ...base, bound: true })).toBe(false);
    expect(returningKeyLineEligible({ ...base, paid: true })).toBe(false);
    expect(returningKeyLineEligible({ ...base, floorKind: 'email' })).toBe(false);
    expect(returningKeyLineEligible({ ...base, unlock: true })).toBe(false);
    expect(returningKeyLineEligible({ ...base, env: { DCHUB_WALL_RETURNING_KEY_LINE: '0' } })).toBe(false);
    expect(returningKeyLineEligible({ ...base, env: { DCHUB_WALL_KEY_LINE: '0' } })).toBe(false);
  });
  const f = { tool: 'compare_sites', walled: true, proOnly: true, depth: true, link: 'https://dchub.cloud/u/abcdef' };
  it('wallOffers, no free offer yet: ONE floor offer, the key line alone, key_line / email_key, no digest', () => {
    const o = wallOffers(keyless(), { ...f, returning: true });
    expect(o).toEqual([{ kind: 'email_key', kinds: ['email_key'], place: 'floor', ask: 'key_line', line: RETURNING_KEY_LINE }]);
    expect(offerKinds(o)).toEqual(['email_key']);
  });
  it('wallOffers, the answer already carries the digest: ONE offer that replaces it', () => {
    const o = wallOffers(keyless(), { ...f, returning: true, freeOfferShown: true, shownOffers: ['digest'] });
    expect(o).toEqual([{ kind: 'email_key', kinds: ['email_key'], place: 'replace_digest', ask: 'key_line', line: RETURNING_KEY_LINE }]);
  });
  it('not returning / a miss / keyed / bound / an unlock ask already: today\'s offers, byte for byte', () => {
    for (const [ent, extra] of [[keyless(), {}], [keyless({ keyed: true }), {}], [keyless({ keyed: true, bound: true }), {}],
      [keyless(), { freeOfferShown: true, shownOffers: ['digest'] }], [keyless(), { freeOfferShown: true, shownOffers: ['digest', 'email_unlock'] }],
      [keyless(), { keyAsked: true }]]) {
      const today = wallOffers(ent, { ...f, ...extra });
      expect(wallOffers(ent, { ...f, ...extra, returning: false })).toEqual(today);
      expect(wallOffers(ent, { ...f, ...extra, returning: null })).toEqual(today);
      if (ent.keyed || extra.keyAsked || (extra.shownOffers || []).includes('email_unlock')) {
        expect(wallOffers(ent, { ...f, ...extra, returning: true })).toEqual(today);
      }
    }
    // An email-class wall (an email does open it) is untouched for a returning caller too.
    const emailWall = { tool: 'get_grid_data', walled: true, link: f.link };
    expect(wallOffers(keyless(), { ...emailWall, returning: true })).toEqual(wallOffers(keyless(), emailWall));
  });
  it('withReturningKeyLineForDigest: the digest paragraph becomes the line; other paragraphs stay; no digest block = unchanged', () => {
    const r = { content: [{ type: 'text', text: '{"x":1}' },
      { type: 'text', text: 'Next step: call `subscribe_digest` with that email.\n\nOpen this link: https://dchub.cloud/u/abcdef' }] };
    const out = withReturningKeyLineForDigest(r);
    expect(out.content[1].text).toBe(RETURNING_KEY_LINE + '\n\nOpen this link: https://dchub.cloud/u/abcdef');
    expect(out.content[0]).toBe(r.content[0]);
    const none = { content: [{ type: 'text', text: 'nothing' }] };
    expect(withReturningKeyLineForDigest(none)).toBe(none);
  });
  it('offers_shown: the line is email_key, and its bind_email is not an email unlock', () => {
    const r = { content: [{ type: 'text', text: RETURNING_KEY_LINE }] };
    expect(offersShown(r, 'key_line')).toEqual(['email_key']);
    expect(offersShown(r, '')).toEqual(['email_key']);
  });
});

describe('change 2: the keep-this line (pure)', () => {
  const c = { client_ip: '203.0.113.5' };
  const ans = () => ({ content: [{ type: 'text', text: '{"ok":true}' }, { type: 'text', text: 'Source: DC Hub (dchub.cloud), as of 2026-11-27' }] });
  const step = (over = {}) => keepThisLineStep(ans(), { name: 'get_market_dcpi_rank', c, once: createOncePerWeek(), onceKey: 'k',
    isWall: () => false, ...over });
  it('copy: KEY_KEEPS, DCHUB_API_KEY optional, NOTE_F_WORDS clean', () => {
    expect(KEEP_THIS_LINE).toContain(KEY_KEEPS);
    expect(KEEP_THIS_LINE).toContain('DCHUB_API_KEY is optional.');
    expect(NOTE_F_WORDS.test(KEEP_THIS_LINE)).toBe(false);
  });
  it('appended to the last data block, before the Source footer, for both tools only', () => {
    for (const name of ['get_market_dcpi_rank', 'analyze_site']) {
      const out = step({ name });
      expect(out.content).toHaveLength(2);
      expect(out.content[0].text.endsWith('\n\n' + KEEP_THIS_LINE)).toBe(true);
      expect(out.content[1].text.startsWith('Source: DC Hub (')).toBe(true);
    }
    const other = ans();
    expect(keepThisLineStep(other, { name: 'get_market_intel', c, once: createOncePerWeek(), onceKey: 'k', isWall: () => false })).toBe(other);
  });
  it('once per key; never on a wall, a keyed caller, a step, a ChatGPT client, an answer that already asks, no onceKey', () => {
    const once = createOncePerWeek();
    expect(step({ once }).content[0].text).toContain(KEEP_THIS_LINE);
    expect(step({ once }).content[0].text).not.toContain(KEEP_THIS_LINE);
    expect(step({ isWall: () => true }).content[0].text).not.toContain(KEEP_THIS_LINE);
    expect(step({ c: { ...c, api_key: 'k' } }).content[0].text).not.toContain(KEEP_THIS_LINE);
    expect(step({ c: { ...c, loopback_step: true } }).content[0].text).not.toContain(KEEP_THIS_LINE);
    expect(step({ c: { ...c, platform: 'chatgpt' } }).content[0].text).not.toContain(KEEP_THIS_LINE);
    expect(step({ eligible: () => false }).content[0].text).not.toContain(KEEP_THIS_LINE);
    expect(step({ onceKey: '' }).content[0].text).not.toContain(KEEP_THIS_LINE);
    const asks = { content: [{ type: 'text', text: 'call `bind_email`' }] };
    expect(keepThisLineStep(asks, { name: 'analyze_site', c, once: createOncePerWeek(), onceKey: 'k', isWall: () => false })).toBe(asks);
  });
  it('kill switch DCHUB_KEEP_THIS_LINE=0', () => {
    expect(step({ env: { DCHUB_KEEP_THIS_LINE: '0' } }).content[0].text).not.toContain(KEEP_THIS_LINE);
  });
});

describe('through the real /mcp handler', () => {
  let H, fence;
  const events = [];
  const RETURNING = new Set();
  const anonHits = [];
  let anonDelayMs = 0;
  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({
      env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0' },
      extraRoutes: async (p, req, body) => {
        if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
        if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
        if (p === '/api/v1/mcp/anon-returning') {
          anonHits.push(body && body.ip);
          if (anonDelayMs) await new Promise((r) => setTimeout(r, anonDelayMs));
          return { ok: true, returning: RETURNING.has(body && body.ip) };
        }
        if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
        if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
        return { success: true, count: 12, total_count: 12, data: ROWS, results: ROWS, items: ROWS, markets: ROWS, rows: ROWS };
      },
    });
  }, 60_000);
  afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
  afterEach(() => { delete process.env.DCHUB_WALL_RETURNING_KEY_LINE; delete process.env.DCHUB_KEEP_THIS_LINE; anonDelayMs = 0; });

  const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i, score: 50 + i }));
  const CLIENT_PORTS = new Set();
  const _peer = net.Socket.prototype._getpeername;
  beforeAll(() => {
    net.Socket.prototype._getpeername = function _getpeername() {
      const p = _peer.call(this);
      if (H && this.server && this.localPort === H.PORT && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.9' };
      return p;
    };
  });
  afterAll(() => { net.Socket.prototype._getpeername = _peer; });
  let rid = 1;
  function rpc(headers, body) {
    const data = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: H.PORT, path: '/mcp', method: 'POST', agent: false,
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
          'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
        let raw = '';
        res.on('data', (ch) => { raw += ch; });
        res.on('end', () => {
          const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
          let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
          resolve({ msg });
        });
      });
      req.on('socket', (sock) => {
        const note = () => { const lp = sock.localPort; CLIENT_PORTS.add(lp); sock.once('close', () => CLIENT_PORTS.delete(lp)); };
        if (sock.localPort) note(); else sock.once('connect', note);
      });
      req.on('error', reject);
      req.end(data);
    });
  }
  async function call(name, ip, args = GUESS_ARGS, headers = {}) {
    const before = events.length;
    const r = await rpc({ 'user-agent': 'node', 'x-dc-client-ip': ip, ...headers },
      { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } });
    for (let i = 0; i < 40 && !events.slice(before).some((e) => e.tool === name); i++) await new Promise((res) => setTimeout(res, 10));
    const result = (r.msg && r.msg.result) || {};
    const blocks = (result.content || []).filter((b) => b && b.type === 'text');
    const prose = blocks.filter((b) => !/^\s*[{[]/.test(b.text)).map((b) => b.text).join('\n');
    return { result, blocks, prose, all: blocks.map((b) => b.text).join('\n'), rows: events.slice(before).filter((e) => e.tool === name) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 60));
  let n = 1;
  const freshIp = () => `198.51.90.${n++}`;

  it.each(['get_pipeline', 'compare_sites', 'list_transactions'])('%s, returning keyless: ONE key offer naming KEY_KEEPS, no digest, key_line', async (name) => {
    const ip = freshIp();
    RETURNING.add(ip);
    const first = await call(name, ip);   // the miss: today's wall, the read starts in the background
    expect(first.rows.length, 'the call walled').toBeGreaterThan(0);
    await settle();
    const { prose, rows } = await call(name, ip);
    expect(rows.length, 'the call walled').toBeGreaterThan(0);
    const got = prose.match(new RegExp(RETURNING_KEY_LINE_RE.source, 'g')) || [];
    expect(got, 'the returning key line, once').toHaveLength(1);
    expect(prose).not.toMatch(/subscribe_digest/);
    expect(prose).not.toMatch(new RegExp(KEY_LINE_RE.source));      // not also today's digest-ahead key line
    expect(prose).not.toContain(KEEP_THIS_LINE);                      // not also change 2's line
    expect(linkCount(prose)).toBeLessThanOrEqual(1);
    expect(NOTE_F_WORDS.test(got[0])).toBe(false);
    for (const e of rows) {
      expect(e.email_ask).toBe('key_line');
      expect(e.offers_shown).toContain('email_key');
      expect(e.offers_shown).not.toContain('email_unlock');
    }
  });

  // The wall flags production runs with (Railway dchub-mcp-server, read 2026-11-27): V2 renames `bind_email` to
  // `get_api_key` in the prose, value-first leads with the link. The line must still arrive, once, alone.
  const PROD_FLAGS = ['DCHUB_ASK_PAGES', 'DCHUB_EXP_UPGRADE_BLOCK', 'DCHUB_KEYLESS_FULL_TRIAL', 'DCHUB_WALL_ALERT_LINE',
    'DCHUB_WALL_COPY_V2', 'DCHUB_WALL_EMAIL_TELL', 'DCHUB_WALL_IDENTITY_V2', 'DCHUB_WALL_IDENTITY_V2_DEVICE_MATCH',
    'DCHUB_WALL_OFFER_FLOOR_V2', 'DCHUB_WALL_PACK_FIRST', 'DCHUB_WALL_PAID_LINE', 'DCHUB_WALL_RELAY_EVERYWHERE',
    'DCHUB_WALL_VALUE_FIRST'];
  it.each(['get_pipeline', 'compare_sites'])('%s under the production wall flags: the returning line, once, no digest', async (name) => {
    const saved = Object.fromEntries(PROD_FLAGS.map((k) => [k, process.env[k]]));
    for (const k of PROD_FLAGS) process.env[k] = '1';
    try {
      const ip = freshIp();
      RETURNING.add(ip);
      await call(name, ip);
      await settle();
      const { prose, rows } = await call(name, ip);
      expect(rows.length).toBeGreaterThan(0);
      expect(prose.match(new RegExp(RETURNING_KEY_LINE_RE.source, 'g')) || []).toHaveLength(1);
      expect(prose).not.toMatch(/subscribe_digest/);
      for (const e of rows) { expect(e.email_ask).toBe('key_line'); expect(e.offers_shown).toContain('email_key'); }
      // CONTROL under the same flags: a first-time caller does not get it, and the returning wall adds no link of its
      // own ("one human link per wall, as today": V2's sign-in page rides both walls).
      const ip2 = freshIp();
      await call(name, ip2);
      await settle();
      const first = (await call(name, ip2)).prose;
      expect(first).not.toMatch(new RegExp(RETURNING_KEY_LINE_RE.source));
      const links = (t) => new Set((t.match(/https?:\/\/[^\s)"'`\]]+/g) || []).map((u) => u.replace(/[.,;:]+$/, '')));
      const firstLinks = links(first);
      for (const u of links(prose)) expect(firstLinks.has(u), u).toBe(true);
      expect(RETURNING_KEY_LINE).not.toMatch(/https?:\/\//);
    } finally {
      for (const k of PROD_FLAGS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  });

  it('first-time keyless (not returning): today\'s wall, digest offer and today\'s key line', async () => {
    const ip = freshIp();
    await call('get_pipeline', ip);
    await settle();
    const { prose, rows } = await call('get_pipeline', ip);
    expect(rows.length).toBeGreaterThan(0);
    expect(prose).toMatch(/`subscribe_digest`/);
    expect(prose).not.toMatch(new RegExp(RETURNING_KEY_LINE_RE.source));
  });

  it('cache miss behind a slow backend: the wall answers without waiting, unchanged', async () => {
    const ip = freshIp();
    RETURNING.add(ip);
    anonDelayMs = 2000;
    const t0 = Date.now();
    const { prose, rows } = await call('get_pipeline', ip);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(rows.length).toBeGreaterThan(0);
    expect(prose).toMatch(/`subscribe_digest`/);
    expect(prose).not.toMatch(new RegExp(RETURNING_KEY_LINE_RE.source));
  });

  it('CONTROL: DCHUB_WALL_RETURNING_KEY_LINE=0 brings back today\'s wall for a returning caller', async () => {
    const ip = freshIp();
    RETURNING.add(ip);
    process.env.DCHUB_WALL_RETURNING_KEY_LINE = '0';
    await call('compare_sites', ip);
    await settle();
    const { prose } = await call('compare_sites', ip);
    expect(prose).toMatch(/`subscribe_digest`/);
    expect(prose).not.toMatch(new RegExp(RETURNING_KEY_LINE_RE.source));
  });

  const KEEP_RE = () => new RegExp(KEEP_THIS_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  it('get_market_dcpi_rank keyless full answer: the keep line once per session, before the Source / Cite footer', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
    try {
      const ip = freshIp();
      const sid = 'sess-keep-dcpi';
      const a = await call('get_market_dcpi_rank', ip, { market: 'dallas' }, { 'mcp-session-id': sid });
      expect(a.rows, 'a full answer, not a wall').toHaveLength(0);
      expect(a.all.match(KEEP_RE()) || []).toHaveLength(1);
      const i = a.blocks.findIndex((b) => b.text.includes(KEEP_THIS_LINE));
      expect(a.blocks[i].text.endsWith(KEEP_THIS_LINE)).toBe(true);
      const after = a.blocks.slice(i + 1);
      expect(after.every((b) => /^\s*(?:Source: DC Hub \(|Cite as:)/.test(b.text))).toBe(true);
      const b2 = await call('get_market_dcpi_rank', ip, { market: 'dallas' }, { 'mcp-session-id': sid });
      expect(b2.all).not.toContain(KEEP_THIS_LINE);   // once per session
      // CONTROL: the kill switch takes it away on a fresh session.
      process.env.DCHUB_KEEP_THIS_LINE = '0';
      const off = await call('get_market_dcpi_rank', freshIp(), { market: 'dallas' }, { 'mcp-session-id': sid + '-off' });
      expect(off.all).not.toContain(KEEP_THIS_LINE);
    } finally { process.env.DCHUB_KEYLESS_FIRST_FULL = '0'; }
  });

  it('analyze_site keyless site run already names get_api_key: no second key line (answerAsks)', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
    try {
      const a = await call('analyze_site', freshIp(), { lat: 32.78, lon: -96.8 }, { 'mcp-session-id': 'sess-keep-site' });
      expect(a.rows).toHaveLength(0);
      expect(a.all).toMatch(/get_api_key/);
      expect(a.all).not.toContain(KEEP_THIS_LINE);
    } finally { process.env.DCHUB_KEYLESS_FIRST_FULL = '0'; }
  });

});
