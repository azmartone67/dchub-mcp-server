// grok-key-sticky.test.mjs: Grok funnel spec F1 (2026-11-22), DCHUB_GROK_KEY_STICKY (lib/grok-key-sticky.mjs).
//
// Real server.mjs /mcp handler, stub backend on loopback, no network:
//   G1 a Grok caller's claim_free_key / bind_email reply carries the keep-attached line, the grok.com connector URL
//      and the xAI Remote MCP tool block, with the key as a placeholder (and grok_keep_key in structuredContent);
//   G2 a second Grok call with the same key from a new IP mints nothing (no POST /api/v1/keys/claim) and returns that
//      key, also with the inline auto-trial mint switched on;
//   G4 a non-Grok caller's reply is byte-identical with the flag on;
//   G5 the added block never carries the key, and no console line written during the calls carries it;
//   CONTROL: flag off, a Grok reply has none of it.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { KEEP_ATTACHED_LINE, GROK_CONNECTOR_URL_TEMPLATE, KEY_PLACEHOLDER, grokKeepKeyText } from '../lib/grok-key-sticky.mjs';

const FLAG = 'DCHUB_GROK_KEY_STICKY';
const GROK_UA = 'Grok/1.0 (xAI connectors)';
const OTHER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) owner-live-run/1.0';
const MINTED = 'dch_live_GROKSTICKYmint0123456789ab';   // fixture key, test value only

let H, fence, ipN = 0, claims = [], logs = [];
const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/claim') { claims.push(body); return { ok: true, api_key: MINTED, tier: 'free', email: body && body.email }; }
      if (p === '/api/v1/keys/validate' && body && body.api_key === MINTED) return { valid: true, tier: 'free', developer_id: 'd_grok' };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      return undefined;
    },
  });
  H.S._readDeadline.signal = () => AbortSignal.timeout(120_000);
}, 120_000);
// The server reads a loopback peer as an execute_plan step; these calls are direct calls from an outside agent.
const _peer = net.Socket.prototype._getpeername;
beforeAll(() => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (H && this.server && this.localPort === H.PORT && p) return { ...p, address: '203.0.113.9' };
    return p;
  };
});
afterAll(async () => { net.Socket.prototype._getpeername = _peer; if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => {
  claims = []; logs = [];
  for (const k of Object.keys(orig)) console[k] = (...a) => { logs.push(a.map(String).join(' ')); };
});
afterEach(() => {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  delete process.env[FLAG]; delete process.env.DCHUB_AUTO_TRIAL_MINT;
});

const hdr = (ua, extra = {}) => ({ 'user-agent': ua, 'x-dc-client-ip': `198.51.120.${++ipN}`, ...extra });
async function call(name, args, h) {
  const r = await H.call('/mcp', name, args, h);
  const res = (r.msg && r.msg.result) || {};
  const texts = (res.content || []).filter((b) => b && b.type === 'text').map((b) => b.text);
  return { res, texts, text: texts.join('\n'), sc: res.structuredContent || {} };
}

describe('F1 Grok key persistence', () => {
  it('pure: the block names the placeholder, never a key, and nothing commercial', () => {
    const t = grokKeepKeyText();
    expect(t.startsWith(KEEP_ATTACHED_LINE)).toBe(true);
    expect(t).toContain(GROK_CONNECTOR_URL_TEMPLATE);
    expect(t).toContain('"authorization":"Bearer ' + KEY_PLACEHOLDER + '"');
    expect(t).not.toMatch(/dch_(live|trial)_/);
    expect(t).not.toMatch(/\bfree\b|\btrial\b|credits?\b|calls\/day|\$\d|\b(Pro|Developer|Enterprise|Starter)\b|\b\d+ tools\b/i);
  });

  it('G1 + G5: a Grok claim_free_key and bind_email reply carry the block; the block and the logs never carry the key', async () => {
    process.env[FLAG] = '1';
    for (const [name, args] of [['claim_free_key', { client_name: 'grok-check' }], ['bind_email', { email: 'jane@firm.com' }]]) {
      const r = await call(name, args, hdr(GROK_UA));
      expect(r.res.isError, name).not.toBe(true);
      const block = r.texts.find((t) => t.startsWith(KEEP_ATTACHED_LINE));
      expect(block, name + ': keep-attached block').toBeTruthy();
      expect(block).toBe(grokKeepKeyText());
      expect(block).not.toContain(MINTED);
      expect(r.texts.filter((t) => t.includes(KEEP_ATTACHED_LINE))).toHaveLength(1);
      expect(r.sc.grok_keep_key && r.sc.grok_keep_key.connector_url, name).toBe(GROK_CONNECTOR_URL_TEMPLATE);
      expect(JSON.stringify(r.sc.grok_keep_key)).not.toContain(MINTED);
    }
    expect(logs.filter((l) => l.includes(MINTED))).toEqual([]);
  });

  it('G2: the same key from a new IP mints nothing and comes back as itself (auto-trial mint on as well)', async () => {
    process.env[FLAG] = '1';
    process.env.DCHUB_AUTO_TRIAL_MINT = '1';
    const r = await call('claim_free_key', { client_name: 'grok-check' }, hdr(GROK_UA, { 'x-api-key': MINTED }));
    expect(claims).toEqual([]);
    expect(r.sc.api_key).toBe(MINTED);
    const w = await call('get_pipeline', { market: 'dallas' }, hdr(GROK_UA, { 'x-api-key': MINTED }));
    expect(claims).toEqual([]);
    expect(w.sc.auto_trial_key).toBeUndefined();
  });

  it('G4: a non-Grok reply is byte-identical with the flag on', async () => {
    const off = await call('claim_free_key', { client_name: 'other-check' }, hdr(OTHER_UA));
    process.env[FLAG] = '1';
    const on = await call('claim_free_key', { client_name: 'other-check' }, hdr(OTHER_UA));
    expect(on.sc.grok_keep_key).toBeUndefined();
    expect(on.text).not.toContain(KEEP_ATTACHED_LINE);
    expect(on.texts.length).toBe(off.texts.length);
  });

  it('CONTROL: flag off, a Grok reply has no block', async () => {
    const r = await call('claim_free_key', { client_name: 'grok-check' }, hdr(GROK_UA));
    expect(r.text).not.toContain(KEEP_ATTACHED_LINE);
    expect(r.sc.grok_keep_key).toBeUndefined();
  });
});
