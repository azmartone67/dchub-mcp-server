// Grok note N item 1 (2026-11-15): the free-key line ahead of the digest offer on a digest-only wall
// (lib/wall-key-line.mjs, lib/wall-offers.mjs, server.mjs _placeWallOffers).
//
// Live funnel 11-16 00:4xZ, by_tool_email_ask_7d: get_pipeline 37/0, list_transactions 36/0, get_intelligence_index
// 31/0, compare_sites 21/0, compare_isos 17/0 (walled hits / hits with an ask), all offer_kind 'digest'. Pinned here,
// through the real /mcp handler (lean on, the plain stub, a keyless caller):
//   * each of the five walls carries the key line, AHEAD of the digest offer, and the digest offer is still there;
//   * the wall row's email_ask is 'key_line' and offers_shown names email_key and digest, not email_unlock;
//   * the added text names no plan, no price, no pricing link, and never "paid", "upgrade" or "trial";
//   * a caller with an email on file does not get it (its digest line is unchanged), nor does Grok;
//   * CONTROL: DCHUB_WALL_KEY_LINE=0 takes it away, so the e2e assertions can fail.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork, GUESS_ARGS } from './helpers/claude-directory-harness.mjs';
import { keyLine, keyLineAllowance, keyLineEligible, withKeyLineAheadOfDigest, KEY_LINE_RE, KEY_LINE_URL } from '../lib/wall-key-line.mjs';
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

describe('the key line (pure)', () => {
  it('states canon figure in canon form, names /connect, and nothing forbidden', () => {
    expect(FREE_TIER.identified_calls_per_day).toBe(50);
    expect(keyLineAllowance()).toBe('50 MCP calls/day');
    expect(FREE_OFFER_EMAIL.startsWith(keyLineAllowance())).toBe(true);
    for (const keyed of [false, true]) {
      const l = keyLine({ keyed });
      expect(l.startsWith('Add your email to get your free key (50 MCP calls/day) and keep going: https://dchub.cloud/connect\n')).toBe(true);
      expect(l).toMatch(/Only use an address they gave you\.$/);
      expect(l).toMatch(keyed ? /`bind_email` \{api_key, email\}/ : /`bind_email` with it: with no key it returns an email-bound key.*`claim_free_key`/);
      expect(l).not.toMatch(FORBIDDEN);
      expect(BANNED.test(l)).toBe(false);                      // note K / L neutral-cta keeps every sentence of it
      expect(statesOnlyCanonLimits(l)).toBe(true);
      expect(mintedOnly([{ line: l }], '')).toHaveLength(1);   // /connect is an allowed URL
      expect(l.match(new RegExp(KEY_LINE_RE.source, 'g'))).toHaveLength(1);
    }
  });
  it('a figure canon does not publish is refused: no line, and the canon check now reads "N MCP calls"', () => {
    expect(keyLine({ perDay: 75 })).toBe('');
    expect(statesOnlyCanonLimits('Add your email to get your free key (75 MCP calls/day)')).toBe(false);
    expect(statesOnlyCanonLimits('Add your email to get your free key (50 MCP calls/day)')).toBe(true);
  });
  it('eligibility: digest-only wall, no email on file, a digest offer, no unlock ask', () => {
    expect(keyLineEligible({ floorKind: 'digest', bound: false, digest: true })).toBe(true);
    expect(keyLineEligible({ floorKind: 'digest', bound: true, digest: true })).toBe(false);
    expect(keyLineEligible({ floorKind: 'email', bound: false, digest: true })).toBe(false);
    expect(keyLineEligible({ floorKind: 'digest', bound: false, digest: false })).toBe(false);
    expect(keyLineEligible({ floorKind: 'digest', bound: false, digest: true, unlock: true })).toBe(false);
    expect(keyLineEligible({ floorKind: 'digest', bound: false, digest: true, env: { DCHUB_WALL_KEY_LINE: '0' } })).toBe(false);
  });
  it('placement: in the digest block, ahead of it; never without a digest block', () => {
    const r = { content: [{ type: 'text', text: '{"a":"`subscribe_digest`"}' }, { type: 'text', text: 'x' },
      { type: 'text', text: 'call `subscribe_digest` with it' }] };
    const out = withKeyLineAheadOfDigest(r, 'KEY');
    expect(out.content[2].text).toBe('KEY\n\ncall `subscribe_digest` with it');
    expect(out.content[0]).toBe(r.content[0]);
    const none = { content: [{ type: 'text', text: 'no digest here' }] };
    expect(withKeyLineAheadOfDigest(none, 'KEY')).toBe(none);
  });
});

describe('wallOffers: one offer, the key line first', () => {
  const f = { tool: 'compare_sites', walled: true, proOnly: true, depth: true, link: 'https://dchub.cloud/u/abcdef' };
  it('no free offer yet (the floor): ONE floor offer, key line then digest, tagged key_line', () => {
    for (const keyed of [false, true]) {
      const o = wallOffers(keyless({ keyed }), f);
      expect(o).toHaveLength(1);
      expect(o[0].place).toBe('floor');
      expect(o[0].ask).toBe('key_line');
      expect(o[0].line.startsWith(keyLine({ keyed }) + '\n\n')).toBe(true);
      expect(o[0].line.indexOf('`subscribe_digest`')).toBeGreaterThan(o[0].line.indexOf(KEY_LINE_URL));
      expect(offerKinds(o)).toEqual(keyed ? ['digest', 'email_key'] : ['digest', 'email_key', 'free_key']);
      expect(o[0].line.match(/claim_free_key/g) || []).toHaveLength(keyed ? 0 : 1);   // named once, by the key line
    }
  });
  it('the answer already carries the digest offer: ONE offer, placed ahead of that digest', () => {
    const o = wallOffers(keyless(), { ...f, freeOfferShown: true, shownOffers: ['digest', 'pro'] });
    expect(o).toEqual([{ kind: 'email_key', kinds: ['email_key'], place: 'ahead_of_digest', ask: 'key_line', line: keyLine() }]);
    expect(wallOffers(keyless(), { ...f, freeOfferShown: true, shownOffers: ['digest', 'email_unlock'] })).toEqual([]);
    // The claim hand-off already asks for the email to mint a key: no second email-for-key line, either placement.
    expect(wallOffers(keyless(), { ...f, freeOfferShown: true, shownOffers: ['digest', 'free_key'], keyAsked: true })).toEqual([]);
    expect(wallOffers(keyless(), { ...f, keyAsked: true })[0].ask).toBe('digest_line');
  });
  it('a caller with an email on file: today\'s digest line, unchanged; Grok: unchanged', () => {
    const o = wallOffers(keyless({ keyed: true, bound: true }), f);
    expect(o).toHaveLength(1);
    expect(o[0].ask).toBe('digest_line');
    expect(o[0].line).not.toMatch(KEY_LINE_RE);
    expect(wallOffers(keyless({ keyed: true, bound: true }), { ...f, env: { DCHUB_WALL_KEY_LINE: '0' } })).toEqual(o);
    expect(wallOffers(keyless(), { ...f, freeOfferShown: true, shownOffers: ['digest'], grok: true }).map((x) => x.ask)).not.toContain('key_line');
    expect(wallOffers(keyless(), { ...f, grok: true }).some((x) => KEY_LINE_RE.test(x.line))).toBe(false);
  });
  it('kill switch DCHUB_WALL_KEY_LINE=0: the digest floor as before', () => {
    const o = wallOffers(keyless(), { ...f, env: { DCHUB_WALL_KEY_LINE: '0' } });
    expect(o[0].ask).toBe('digest_line');
    expect(o[0].line).not.toMatch(/free key \(/);
  });
});

describe('the funnel tag and offers_shown', () => {
  it('key_line is a stored ask kind and wins over digest_line', () => {
    expect(WALL_ASK_KINDS.has('key_line')).toBe(true);
    const c = {}; markEmailAsk(c, 'digest_line'); markEmailAsk(c, 'key_line');
    expect(c._emailAsk).toBe('key_line');
    expect(quotaWallEventBody({ c, name: 'get_pipeline', status: 'trial_used' }).email_ask).toBe('key_line');
  });
  it('offers_shown: email_key, and the key line\'s bind_email is not an email unlock', () => {
    expect(OFFER_KINDS).toContain('email_key');
    const r = { content: [{ type: 'text', text: keyLine() + '\nAn email does not open ... `subscribe_digest` ...' }] };
    expect(offersShown(r, 'key_line')).toEqual(['digest', 'email_key', 'free_key']);
    expect(offersShown(r, '')).toEqual(['digest', 'email_key', 'free_key']);
    expect(offersShown({ content: [{ type: 'text', text: 'call `bind_email`' }] }, '')).toContain('email_unlock');
  });
});

describe('the five digest-only walls, through the real /mcp handler', () => {
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
  afterEach(() => { delete process.env.DCHUB_WALL_KEY_LINE; });

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

  it.each(FIVE)('%s, keyless: the key line, ahead of the digest offer, tagged key_line', async (name) => {
    const { prose, rows } = await walled(name);
    expect(rows.length, 'the call walled').toBeGreaterThan(0);
    const k = prose.indexOf(keyLine());
    const d = prose.indexOf('`subscribe_digest`');
    expect(k, 'the key line is in the answer').toBeGreaterThanOrEqual(0);
    expect(d, 'the digest offer is still there').toBeGreaterThan(k);
    expect(prose.match(new RegExp(KEY_LINE_RE.source, 'g'))).toHaveLength(1);   // once
    for (const e of rows) {
      expect(e.email_ask).toBe('key_line');
      expect(e.offers_shown).toEqual(expect.arrayContaining(['digest', 'email_key']));
      expect(e.offers_shown).not.toContain('email_unlock');
      expect(e.offer_floor).toBe('allowed');
    }
  });

  it.each(['get_pipeline', 'compare_sites'])('%s, a caller with an email on file: no key line, the digest offer unchanged', async (name) => {
    const { prose, rows } = await walled(name, { 'x-api-key': BOUND_KEY });
    expect(rows.length, 'the call walled').toBeGreaterThan(0);
    expect(prose).not.toMatch(/get your free key/);
    expect(prose).toMatch(/`subscribe_digest`/);
    for (const e of rows) expect(e.email_ask).not.toBe('key_line');
  });

  it('CONTROL: DCHUB_WALL_KEY_LINE=0 takes the line away (the assertions above can fail)', async () => {
    process.env.DCHUB_WALL_KEY_LINE = '0';
    for (const name of ['get_pipeline', 'compare_sites']) {
      const { prose, rows } = await walled(name);
      expect(rows.length).toBeGreaterThan(0);
      expect(prose).not.toMatch(/get your free key/);
      for (const e of rows) expect(e.email_ask).toBe('digest_line');
    }
  });
});
