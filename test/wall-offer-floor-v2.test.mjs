// wall-offer-floor-v2.test.mjs: Grok funnel spec F2 (2026-11-22), DCHUB_WALL_OFFER_FLOOR_V2 (lib/wall-offer-floor-v2.mjs).
// Real /mcp handler, plain stub, keyless caller, no network:
//   W3 get_facility: the key line ahead of the digest offer, no email unlock ask;
//   W4 the repeat rule: walls 1 and 3+ of one identity on one tool carry the key line, wall 2 does not;
//   R1 Grok: get_facility and rank_markets walls that carried no free offer now carry the key line, tagged key_line;
//   W6 every wall row's status is the same with the flag on and off (enforcement untouched);
//   a caller with an email on file gets none of it; CONTROL: flag off brings back the old rows.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork, GUESS_ARGS } from './helpers/claude-directory-harness.mjs';
import { keyLine, keyLineAllowance, keyLineEligible, withKeyLineAheadOfDigest, KEY_LINE_RE, KEY_LINE_LEAD } from '../lib/wall-key-line.mjs';
import { keyToolPointerText } from '../lib/key-tool-name.mjs';
import { wallOffers, wallEntitlements, mintedOnly, statesOnlyCanonLimits, offerKinds } from '../lib/wall-offers.mjs';
import { offersShown, OFFER_KINDS } from '../lib/offers-shown.mjs';
import { markEmailAsk, quotaWallEventBody, WALL_ASK_KINDS } from '../lib/keyless-wall.mjs';
import { FREE_TIER, FREE_OFFER_EMAIL } from '../lib/tier-canon.mjs';
import { BANNED } from '../lib/neutral-cta.mjs';

process.env.DCHUB_KEYLESS_FIRST_FULL = '0';   // the walled preview, not the keyless first full answer

const FIVE = ['get_pipeline', 'list_transactions', 'get_intelligence_index', 'compare_sites', 'compare_isos'];
// What the added text may never say (hard rules, Grok notes F/G/M and the owner).
const FORBIDDEN = /\bpaid\b|upgrade|trial|\$\s?\d|\/pricing|\/checkout|stripe|\b(?:Pro|Developer|Enterprise|Starter|Founding)\b|per month|\/mo\b/i;
const keyless = (over = {}) => ({ keyed: false, bound: false, signedIn: false, paid: false, held: '', ...over });

describe('F2 offer floor v2, through the real /mcp handler', () => {
  let H, fence;
  const events = [];
  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({
      env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0' },
      extraRoutes: (p, req, body) => {
        if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
        if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
        if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
        if (p === '/api/v1/keys/validate' && body && body.api_key === BOUND_KEY) {
          return { valid: true, tier: 'free', developer_id: 'dev_bound', email: 'person@example.com', tier_detail: { users_plan: 'free' } };
        }
        if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
        return { success: true, count: 12, total_count: 12, data: ROWS, results: ROWS, items: ROWS, markets: ROWS, rows: ROWS };
      },
    });
  }, 60_000);
  afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
  afterEach(() => { delete process.env.DCHUB_WALL_KEY_LINE; delete process.env.DCHUB_WALL_OFFER_FLOOR_V2; });

  const BOUND_KEY = 'dch_live_BOUNDkey0123456789abcdef01';
  const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i, score: 50 + i }));
  let ip = 1;
  // This file's own sockets read as an outside peer (as in test/every-wall-carries-an-offer.test.mjs): a loopback
  // peer is how the server knows an execute_plan step, and a step's wall is not the direct wall pinned here.
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
  async function walled(name, headers = {}) {
    const before = events.length;
    const r = await rpc({ 'user-agent': 'node', 'x-dc-client-ip': `198.51.77.${ip++}`, ...headers },
      { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: GUESS_ARGS } });
    for (let i = 0; i < 40 && !events.slice(before).some((e) => e.tool === name); i++) await new Promise((res) => setTimeout(res, 10));
    const result = r.msg && r.msg.result;
    const prose = ((result && result.content) || []).filter((b) => b && b.type === 'text' && !/^\s*[{[]/.test(b.text)).map((b) => b.text).join('\n');
    return { prose, rows: events.slice(before).filter((e) => e.tool === name) };
  }


  async function session(ua, name='github-copilot-developer') {
    const r = await new Promise((resolve) => {
      const data = JSON.stringify({ jsonrpc: '2.0', id: rid++, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } } });
      const req = http.request({ host: '127.0.0.1', port: H.PORT, path: '/mcp', method: 'POST', agent: false,
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': Buffer.byteLength(data), 'user-agent': ua, 'x-dc-client-ip': '198.51.99.7' } }, (res) => { res.resume(); resolve(res.headers['mcp-session-id']); });
      req.on('socket', (sock) => { const note = () => { CLIENT_PORTS.add(sock.localPort); }; if (sock.localPort) note(); else sock.once('connect', note); });
      req.end(data);
    });
    return r;
  }
  let ipn = 1;
  async function run(tool, { ua = 'node', cname = 'github-copilot-developer', n = 4, key } = {}) {
    const ipx = `198.51.${100 + (ipn % 100)}.${ipn++ % 250 + 1}`;
    const sid = await session(ua, cname);
    const out = [];
    for (let i = 0; i < n; i++) {
      const h = { 'user-agent': ua, 'mcp-session-id': sid, 'x-dc-client-ip': ipx, ...(key ? { 'x-api-key': key } : {}) };
      const { prose, rows } = await walled(tool, h);
      const e = rows[0] || {};
      const k = prose.search(/get your DC Hub key/);
      const d = prose.indexOf('`subscribe_digest`');
      out.push({ ask: e.email_ask || '', shown: e.offers_shown || [], floor: e.offer_floor || '', status: e.status || '', walled: rows.length > 0, kl: k >= 0, k, d });
    }
    return out;
  }

  describe('F2 pure', () => {
    it('the repeat counter counts per (identity, tool) inside 24h only', async () => {
      const { createRepeatWallCounter, isRepeatWall, grokKeyFloorEligible } = await import('../lib/wall-offer-floor-v2.mjs');
      let t = 0;
      const c = createRepeatWallCounter({ now: () => t });
      expect([1, 2, 3].map(() => c.record('a', 'x'))).toEqual([1, 2, 3]);
      expect(c.record('a', 'y')).toBe(1);
      expect(c.record('b', 'x')).toBe(1);
      t = 24 * 3600 * 1000 + 1;
      expect(c.record('a', 'x')).toBe(1);
      expect([isRepeatWall(2), isRepeatWall(3)]).toEqual([false, true]);
      expect(grokKeyFloorEligible({ shownOffers: ['pro'], line: 'x' })).toBe(true);
      expect(grokKeyFloorEligible({ shownOffers: ['pro', 'digest'], line: 'x' })).toBe(false);
      expect(grokKeyFloorEligible({ shownOffers: [], line: 'x', bound: true })).toBe(false);
      expect(grokKeyFloorEligible({ shownOffers: [], line: 'x', paid: true })).toBe(false);
    });
  });

  it('W3+W4: get_facility key line ahead of the digest on walls 1, 3, 4, not 2; never an unlock ask', async () => {
    process.env.DCHUB_WALL_OFFER_FLOOR_V2 = '1';
    const r = await run('get_facility');
    expect(r.every((x) => x.walled)).toBe(true);
    expect(r.map((x) => x.kl)).toEqual([true, false, true, true]);
    expect(r.map((x) => x.ask)).toEqual(['key_line', 'digest_line', 'key_line', 'key_line']);
    for (const x of r) {
      expect(x.shown).not.toContain('email_unlock');
      expect(x.d).toBeGreaterThanOrEqual(0);
      if (x.kl) expect(x.k).toBeLessThan(x.d);
    }
  }, 60000);

  it('R1: Grok get_facility and rank_markets walls carry the key line; every Grok wall carries an offer', async () => {
    process.env.DCHUB_WALL_OFFER_FLOOR_V2 = '1';
    for (const t of ['get_facility', 'rank_markets', 'get_interconnection_queue']) {
      const r = await run(t, { ua: 'Grok/1.0 xAI', cname: 'grok' });
      for (const x of r.filter((y) => y.walled)) {
        expect(x.floor, t).toBe('grok');
        expect(['key_line', 'line'], t).toContain(x.ask);
        expect(x.shown.some((k) => ['email_key', 'email_unlock', 'digest'].includes(k)), t).toBe(true);
      }
      expect(r.some((y) => y.walled), t + ' walled at least once').toBe(true);
    }
  }, 60000);

  it('a caller with an email on file: no key line from either rule', async () => {
    process.env.DCHUB_WALL_OFFER_FLOOR_V2 = '1';
    for (const [ua, cname] of [['node', 'github-copilot-developer'], ['Grok/1.0 xAI', 'grok']]) {
      const r = await run('get_facility', { ua, cname, key: BOUND_KEY });
      for (const x of r) expect(x.kl, cname).toBe(false);
    }
  }, 60000);

  it('W6 + CONTROL: same wall statuses on and off; flag off is the old rows (wall 3 digest only, Grok no offer)', async () => {
    const off = await run('get_facility');
    const goff = await run('get_facility', { ua: 'Grok/1.0 xAI', cname: 'grok' });
    process.env.DCHUB_WALL_OFFER_FLOOR_V2 = '1';
    const on = await run('get_facility');
    const gon = await run('get_facility', { ua: 'Grok/1.0 xAI', cname: 'grok' });
    expect(on.map((x) => x.status)).toEqual(off.map((x) => x.status));
    expect(gon.map((x) => x.status)).toEqual(goff.map((x) => x.status));
    expect(off.map((x) => x.kl)).toEqual([true, false, false, false]);
    expect(goff.every((x) => !x.kl && x.ask === '')).toBe(true);
  }, 60000);
});
