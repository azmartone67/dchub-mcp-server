// Sessionless keyless caller: wall -> email -> full answer, end to end (2026-11-10).
//
// A JSON-RPC tools/call POSTed to /mcp with no initialize and no mcp-session-id gets the rank_markets /
// ai_capacity_index preview, whose agent line asks for the user's email and names `bind_email`. With no
// key, bind_email mints a free key with the email bound (claim_free_key's path, mcp#1004). A sessionless
// client has nothing that carries that key forward: the server cannot apply it to a session, so the
// agent itself must send it as X-API-Key and repeat the walled call. This file walks the whole path on
// the REAL server.mjs /mcp handler and asserts on the final wire text (lean step on, its default):
//   1. the wall carries the email ask;
//   2. bind_email {email} returns the key AND a line telling the agent to send it as the X-API-Key header
//      on its next calls and to call the walled tool again (sessionless only; DCHUB_SESSIONLESS_BIND_KEY_LINE=0
//      removes the line and nothing else);
//   3. the repeated call with that X-API-Key returns every row (rank_markets: all 10 markets; score and
//      total MW stay paid, as the ask says. ai_capacity_index: all 20 markets with their scores).
// Controls: a caller WITH a session gets the bind_email text without the line (the server already applied
// the key to its session), and an execute_plan step (loopback peer) gets no line either.
//
// The harness serves on 127.0.0.1, and a loopback peer is an execute_plan step; a real sessionless caller
// is not, so sockets the server accepts report a TEST-NET address (as test/sessionless-cap-email-ask.test.mjs).
// The UA is a plain browser-style string that no bot / internal-caller pattern matches (asserted below).
// Stub backend on loopback; no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) owner-live-run/1.0';
const EMAIL = 'jane@firm.com';
const MINTED = 'dch_live_SESSIONLESSbindmint0123456789';   // fixture key, test value only
const AICAP = JSON.parse(readFileSync(new URL('./fixtures/ai-capacity-index-90.json', import.meta.url), 'utf8'));
const RANK_ROWS = Array.from({ length: 10 }, (_, i) => ({
  rank: i + 1, market: 'mkt-' + (i + 1), name: 'Market ' + (i + 1), slug: 'mkt-' + (i + 1),
  score: 90 - i, total_mw: 1000 - i * 50, facility_count: 40 - i,
}));
// The whole sessionless line, exactly; the key is captured so the retry sends what the text told the agent.
const LINE_RE = /This call had no MCP session, so nothing carries the key forward for you: send it as the X-API-Key header \(`X-API-Key: ([^`]+)`\) on your next DC Hub calls, then call the tool that returned the preview again for the full answer\./;

let H, fence, ipN = 0, claimBodies = [];
let EXTERNAL = true;
const _peer = net.Socket.prototype._getpeername;   // what socket.remoteAddress reads
net.Socket.prototype._getpeername = function _getpeername() {
  const p = _peer.call(this);
  return EXTERNAL && H && this.server && this.localPort === H.PORT && p && p.address ? { ...p, address: '203.0.113.9' } : p;
};

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    // production serves the owner-approved paid sell line (the rank_markets email ask rides on it)
    env: { DCHUB_PAID_SELL_LINE: '1' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/mcp/tools/rank_markets') return { criteria: 'best_overall', region: 'us', results: RANK_ROWS, total: 10, tier: 'developer' };
      if (p === '/api/v1/ai-capacity-index') return { ...AICAP, markets: AICAP.markets.slice(0, 20), result_count: 20 };
      if (p === '/api/v1/keys/claim') { claimBodies.push(body); return { ok: true, api_key: MINTED, tier: 'identified', email: body && body.email }; }
      // the minted key validates the way an email-bound free key does: tier identified, the email on the row
      if (p === '/api/v1/keys/validate' && body && body.api_key === MINTED) return { valid: true, tier: 'identified', developer_id: 'd_sessionless', email: EMAIL };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      return undefined;
    },
  });
  H.S._readDeadline.signal = () => AbortSignal.timeout(120_000);
}, 120_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop(); if (fence) fence.restore();
});
beforeEach(() => {
  EXTERNAL = true; claimBodies = [];
  delete process.env.DCHUB_SESSIONLESS_BIND_KEY_LINE;
});

const hdr = (extra = {}) => ({ 'user-agent': UA, 'x-dc-client-ip': `198.51.100.${++ipN}`, ...extra });
// The final wire result of one sessionless tools/call (no initialize, no mcp-session-id).
async function call(name, args, h) {
  const r = await H.call('/mcp', name, args, h);
  const res = (r.msg && r.msg.result) || {};
  const texts = (res.content || []).filter((b) => b && b.type === 'text').map((b) => b.text);
  let data = null;
  try { data = JSON.parse(texts[0].split('\n\n')[0]); } catch (_) { data = null; }
  return { res, texts, text: texts.join('\n'), sc: res.structuredContent || {}, data };
}
const keyFrom = (b) => { const m = b.text.match(LINE_RE); return m ? m[1] : null; };

describe('sessionless keyless: wall -> bind_email -> X-API-Key retry -> full answer', () => {
  it('the UA is a plain non-bot one (the claim/mint path would refuse a bot)', () => {
    expect(H.S.isBotOrInternalCtx({ user_agent: UA })).toBe(false);
    expect(UA).not.toMatch(/dchub-qa-readonly/);
  });

  it('rank_markets: the wall asks for the email; bind_email returns the key and the X-API-Key line; the retry shows all 10 markets', async () => {
    const h = hdr();
    const wall = await call('rank_markets', {}, h);
    expect(wall.data.results.length).toBe(3);                                   // a real preview
    expect(wall.data._results_total_available).toBe(10);
    expect(wall.text).toContain('`bind_email` with it shows all 10 markets in this ranking, free, up to 10 full rankings a day.');

    const bind = await call('bind_email', { email: EMAIL }, h);
    expect(claimBodies.map((b) => b && b.email)).toEqual([EMAIL]);              // the mint carried the email
    expect(bind.sc.bind_email_path).toBe('keyless_mint_bind');
    expect(bind.sc.api_key).toBe(MINTED);
    expect(bind.texts[0].startsWith('No key on this session, so `bind_email` minted a free DC Hub key with this email bound (one call). ')).toBe(true);
    expect(keyFrom(bind)).toBe(MINTED);                                         // the instruction names the key and the header
    expect(bind.text.split('X-API-Key header (`X-API-Key:').length - 1).toBe(1);   // once

    const full = await call('rank_markets', {}, { ...h, 'x-api-key': keyFrom(bind) });
    expect(full.data.tier).toBe('identified');
    expect(full.data._metered_trial && full.data._metered_trial.of).toBe(10);           // the email-bound allowance, not the unbound key's 2
    expect(full.data.results.map((r) => r.market)).toEqual(RANK_ROWS.map((r) => r.market));   // every row
    expect(full.data._results_total_available).toBeUndefined();                 // no rows held back
    expect(full.data.results.every((r) => r._score_withheld === true && r._total_mw_withheld === true)).toBe(true);   // fields stay paid, as asked
    expect(full.text).not.toContain('shows all 10 markets');                    // no second ask
  });

  it('ai_capacity_index: the wall asks for the email; after bind_email the X-API-Key retry shows all 20 markets with scores', async () => {
    const h = hdr();
    const wall = await call('ai_capacity_index', {}, h);
    expect(wall.data.markets.length).toBeLessThan(20);
    expect(wall.text).toContain('`bind_email` with it shows all 20 markets in this index with their scores, free, up to 10 full answers a day.');

    const bind = await call('bind_email', { email: EMAIL }, h);
    expect(keyFrom(bind)).toBe(MINTED);

    const full = await call('ai_capacity_index', {}, { ...h, 'x-api-key': keyFrom(bind) });
    expect(full.data.markets.length).toBe(20);
    expect(full.data._metered_trial && full.data._metered_trial.of).toBe(10);           // the email-bound allowance, not the unbound key's 2
    expect(full.data.markets.every((m) => typeof m.score === 'number' && m._score_withheld === undefined)).toBe(true);
    expect(full.data._markets_total_available).toBeUndefined();
    expect(full.text).not.toContain('shows all 20 markets');
  });

  it('kill switch DCHUB_SESSIONLESS_BIND_KEY_LINE=0: the line, and only the line, goes', async () => {
    const on = await call('bind_email', { email: EMAIL }, hdr());
    process.env.DCHUB_SESSIONLESS_BIND_KEY_LINE = '0';
    const off = await call('bind_email', { email: EMAIL }, hdr());
    expect(keyFrom(on)).toBe(MINTED);
    expect(off.text).not.toMatch(/X-API-Key header \(`X-API-Key:/);
    // per-call tokens and timestamps differ between any two calls; nothing else may
    const strip = (t) => t.replace(/\/go\/c\/[A-Za-z0-9._-]+/g, '/go/c/<tok>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<ts>');
    const lineOf = on.texts[0].match(new RegExp(LINE_RE.source))[0];
    expect(strip(on.texts[0].replace(lineOf + '\n\n', ''))).toBe(strip(off.texts[0]));
    expect(on.texts.slice(1).map(strip)).toEqual(off.texts.slice(1).map(strip));
    expect(strip(JSON.stringify(on.sc))).toBe(strip(JSON.stringify(off.sc)));   // structured result untouched
  });

  it('CONTROL: a caller WITH a session gets the bind_email text without the line', async () => {
    const h = hdr();
    const sid = (await H.init('/mcp', 'claude-ai', h)).headers.get('mcp-session-id');
    expect(sid).toBeTruthy();
    const bind = await call('bind_email', { email: EMAIL }, { ...h, 'mcp-session-id': sid });
    expect(bind.sc.bind_email_path).toBe('keyless_mint_bind');                  // same mint path
    expect(bind.text).toContain(MINTED);
    expect(bind.text).not.toMatch(/X-API-Key header \(`X-API-Key:/);
    expect(bind.text).not.toContain('call the tool that returned the preview again');
  });

  it('CONTROL: an execute_plan step (loopback peer) gets no line', async () => {
    EXTERNAL = false;
    const bind = await call('bind_email', { email: EMAIL }, hdr());
    expect(bind.text).toContain(MINTED);
    expect(bind.text).not.toMatch(/X-API-Key header \(`X-API-Key:/);
  });
});
