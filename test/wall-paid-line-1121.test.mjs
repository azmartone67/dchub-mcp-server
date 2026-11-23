// wall-paid-line-1121.test.mjs — DCHUB_WALL_PAID_LINE, the wall "paid license" A/B (lib/wall-paid-line.mjs, server.mjs
// _wallPaidLineStep; owner relay from Grok 2026-11-21, DRAFT, flag OFF until the owner says so).
//
// Rules asserted, through the real handler (backend stubbed, network fenced, an outside peer address) and the step:
//   * flag OFF (unset, and '0'): every answer on /mcp, /mcp/claude and /mcp/chatgpt is origin/main's, byte for byte
//     (git-ref sandbox), keyless and trial-key, with DCHUB_WALL_COPY_V2 on (production since 2026-11-21 15:11Z) and off;
//   * flag ON, /mcp/claude and /mcp/chatgpt: origin/main's byte for byte (generic /mcp only);
//   * flag ON, /mcp, control arm: origin/main's byte for byte; the arm 'control' is on the track row and the wall row;
//   * flag ON, /mcp, paid_line arm: the answer is origin/main's plus exactly the added line (and next_ask.full_access,
//     the short form), the line sits right after the sign-in line, its tagged URL is intact with DCHUB_WALL_COPY_V2
//     off AND on; the arm 'paid_line' is on the track row and the wall row;
//   * the split: ~50/50 over many synthetic callers, the same arm for the same caller on every call;
//   * the copy names no price, plan name, credits or calls-per-day, and no "free";
//   * never: a profile, a path but /mcp, Grok, a ChatGPT client, a loopback step, the key tools, a non-trial key;
//     once per (session, tool).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import { SIGNIN_LINE } from '../lib/wall-identity-v2.mjs';
import { rewriteText } from '../lib/wall-copy-v2.mjs';
import * as W from '../lib/wall-paid-line.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i, score: 50 + i }));
// The owner's ban list for this line: no price, plan name, credits, calls-per-day, and no "free" (the 2026-11-21
// sweep). "paid" is the line's point and is allowed here.
const NO_PRICE = /\$|\bper month\b|\/mo\b|\b(?:pro|developer|starter|enterprise|team|credit pack|credit-pack|credits?)\b|\b\d[\d,]*\s+(?:MCP\s+)?(?:calls?|full answers?|answers?)\b|\/day\b|\bper day\b|\ba day\b|\bfree\b/i;

let H, O, SB, S, fence, why = '', anonCount = 999;
const events = [];
const tracks = [];
const routes = () => (p, _req, body) => {
  if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
  if (p === '/api/v1/mcp/track') { if (body && typeof body === 'object') tracks.push(body); return { ok: true }; }
  if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
  if (p === '/api/v1/keys/validate' && body && typeof body.api_key === 'string' && body.api_key.startsWith('dch_trial_PL')) return { valid: true, tier: 'trial', email: null, tier_detail: { users_plan: null } };
  if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
  if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
  return { success: true, count: 12, total_count: 12, data: ROWS, results: ROWS, items: ROWS, markets: ROWS, rows: ROWS };
};
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
const FLAGS = ['DCHUB_WALL_PAID_LINE', 'DCHUB_WALL_COPY_V2', 'DCHUB_WALL_IDENTITY_V2'];
const setEnv = (o) => { for (const k of FLAGS) { if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k]; } };
beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.21' };
    return p;
  };
  fence = fenceNetwork();
  const env = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_KEYLESS_FIRST_FULL: '0', DCHUB_ANON_DAILY_CAP: '20',
    DCHUB_WORKOS_OAUTH_ENABLED: '1' };
  setEnv({});
  H = await startHarness({ env, extraRoutes: routes() });
  SERVER_PORTS.add(H.PORT);
  S = await import('../server.mjs');
  SB = createGitRefSandbox(REPO, 'origin/main', 'wall-paid-line-origin-main');
  if (!SB) why = 'origin/main is not available in this clone';
  else {
    O = await startHarness({ env, extraRoutes: routes(), serverUrl: pathToFileURL(path.join(SB.root, 'server.mjs')).href });
    SERVER_PORTS.add(O.PORT);
  }
}, 180_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (O) await O.stop();
  if (H) await H.stop();
  if (SB) SB.cleanup();
  if (fence) fence.restore();
  setEnv({});
});
afterEach(() => { setEnv({}); anonCount = 999; });

let rid = 1;
function rpc(h, p, body, headers = {}) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: h.PORT, path: p, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'cursor/1.0',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, msg, headers: res.headers });
      });
    });
    req.on('socket', (s) => {
      const note = () => { const lp = s.localPort; CLIENT_PORTS.add(lp); s.once('close', () => CLIENT_PORTS.delete(lp)); };
      if (s.localPort) note(); else s.once('connect', note);
    });
    req.on('error', reject);
    req.end(data);
  });
}
async function call(h, p, name, args, { ip, key = '', ua = 'cursor/1.0' } = {}) {
  const e0 = events.length, t0 = tracks.length;
  const r = await rpc(h, p, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } },
    { 'x-dc-client-ip': ip, 'user-agent': ua, ...(key ? { 'x-api-key': key } : {}) });
  await new Promise((res) => setTimeout(res, 150));
  return { result: r.msg && r.msg.result, rows: events.slice(e0), tracks: tracks.slice(t0).filter((t) => t.tool === name) };
}
// What differs between two runs of the same call by design (same normaliser as test/wall-identity-v2).
const RERUN_TOK = /pr1\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;
const rerunBody = (m, b) => {
  try { const { t, ...rest } = JSON.parse(Buffer.from(b, 'base64url').toString()); return 'RERUN.' + Buffer.from(JSON.stringify(rest)).toString('base64url'); } catch { return m; }
};
const norm = (r) => JSON.stringify(r)
  .replace(RERUN_TOK, rerunBody)
  .replace(/(\\*"planner_version\\*":\\*")\d+\.\d+/g, '$1V')
  .replace(/https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[^"\s\\]*)?/g, 'RELAY')
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'TS')
  .replace(/(\\?")(ms|elapsed_ms|duration_ms|took_ms|latency_ms)(\\?"):\d+/g, '$1$2$3:0')
  .replace(/(plan|req|sess|run|rp)[-_][A-Za-z0-9]{6,}/g, '$1-ID')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID');
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a === b ? '' : `\n  here: ${a.slice(Math.max(0, i - 80), i + 160)}\n  main: ${b.slice(Math.max(0, i - 80), i + 160)}`; };
const texts = (r) => ((r && r.content) || []).filter((b) => b && b.type === 'text').map((b) => b.text);
const count = (r, s) => texts(r).filter((t) => t.includes(s)).length;
// The result minus exactly what the paid line adds: its block, and next_ask.full_access (structured and JSON block).
function withoutPaidLine(r) {
  if (!r || !Array.isArray(r.content)) return r;
  const drop = (o) => {
    if (!o || typeof o !== 'object' || Array.isArray(o) || !o.next_ask || typeof o.next_ask !== 'object') return o;
    const { [W.NEXT_ASK_FIELD]: _x, ...na } = o.next_ask;
    return { ...o, next_ask: na };
  };
  const content = r.content.filter((b) => !(b && b.type === 'text' && b.text === W.PAID_LINE)).map((b) => {
    if (!b || b.type !== 'text' || !/^\s*\{/.test(b.text) || !b.text.includes(W.PAID_LINE_SHORT)) return b;
    const o = JSON.parse(b.text);
    for (const ind of [undefined, 2]) if (JSON.stringify(o, null, ind) === b.text) return { ...b, text: JSON.stringify(drop(o), null, ind) };
    return b;
  });
  return { ...r, content, ...(r.structuredContent ? { structuredContent: drop(r.structuredContent) } : {}) };
}

// A keyless caller IP / a trial key in the arm a test wants (the arm is a pure function of the caller identity).
let ipSeq = 1, keySeq = 1;
function ipIn(arm) {
  for (;;) {
    const ip = `198.51.${100 + Math.floor(ipSeq / 250) % 100}.${ipSeq++ % 250 + 1}`;
    if (W.paidLineArm(W.paidLineCallerId({ client_ip: ip })) === arm) return ip;
  }
}
function keyIn(arm) {
  for (;;) {
    const key = 'dch_trial_PLtest' + String(keySeq++).padStart(8, '0') + 'abcdefghijk';
    if (W.paidLineArm(W.paidLineCallerId({ api_key: key })) === arm) return key;
  }
}
const anyIp = () => `198.51.${200 + Math.floor(ipSeq / 250) % 50}.${ipSeq++ % 250 + 1}`;

const TOOLS = [
  ['get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }],
  ['get_interconnection_queue', { iso: 'PJM' }],
  ['execute_plan', { intent: 'compare PJM vs ERCOT grid headroom and interconnection queue', market: 'dallas' }],
];
// keyless at the anonymous hard wall (count 999), keyless at the preview walls (count 0), and a trial key.
const CALLERS = [['keyless hard wall', { trial: false, cnt: 999 }], ['keyless preview wall', { trial: false, cnt: 0 }], ['trial key', { trial: true, cnt: 0 }]];
const who = (c, arm) => (c.trial ? { ip: anyIp(), key: arm ? keyIn(arm) : keyIn(W.ARM_CONTROL) } : { ip: arm ? ipIn(arm) : anyIp() });

describe('lib/wall-paid-line.mjs: copy', () => {
  it('the owner\'s two lines, verbatim, with the tagged URL', () => {
    expect(W.PAID_LINE).toBe('Full access is a paid DC Hub license. Your user can review options and get one at https://dchub.cloud/connect?via=mcp-wall&v=paid-line');
    expect(W.PAID_LINE_SHORT).toBe('Full access needs a paid license: https://dchub.cloud/connect?via=mcp-wall&v=paid-line');
  });
  it('no price, plan name, credits, calls-per-day or "free" (and the ban list bites)', () => {
    for (const s of [W.PAID_LINE, W.PAID_LINE_SHORT]) expect(s).not.toMatch(NO_PRICE);
    for (const bad of ['Pro is $49/mo', 'a Developer license', 'buy a credit pack', '50 calls/day', '500 calls a day', 'free key'])
      expect(bad, 'control: the ban list catches ' + bad).toMatch(NO_PRICE);
  });
  it('the v2 copy step WOULD strip the tag (why the line is placed after it)', () => {
    expect(rewriteText(W.PAID_LINE)).not.toContain('v=paid-line');
    expect(rewriteText(W.PAID_LINE)).toContain('https://dchub.cloud/mcp/connect');
  });
  it('switch: off unless 1 / true / yes / on', () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'no', '2']) expect(W.wallPaidLineOn({ DCHUB_WALL_PAID_LINE: v })).toBe(false);
    for (const v of ['1', 'true', 'yes', 'on', ' ON ']) expect(W.wallPaidLineOn({ DCHUB_WALL_PAID_LINE: v })).toBe(true);
  });
});

describe('lib/wall-paid-line.mjs: the split', () => {
  it('about 50/50 over 20,000 synthetic keyless callers and 20,000 trial keys; stable per caller', () => {
    for (const mk of [(i) => ({ client_ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` }),
      (i) => ({ api_key: 'dch_trial_' + i.toString(36).padStart(23, '0'), client_ip: '10.0.0.1' })]) {
      let paid = 0;
      for (let i = 0; i < 20000; i++) {
        const a = W.paidLineArm(W.paidLineCallerId(mk(i)));
        expect(W.isPaidLineArm(a)).toBe(true);
        if (a === W.ARM_PAID_LINE) paid += 1;
        if (i % 997 === 0) for (let k = 0; k < 3; k++) expect(W.paidLineArm(W.paidLineCallerId(mk(i)))).toBe(a);
      }
      expect(paid / 20000).toBeGreaterThan(0.48);
      expect(paid / 20000).toBeLessThan(0.52);
    }
  });
  it('identity: a trial key keeps its arm across IPs and sessions; a keyless caller is its IP, else its session; none = no arm', () => {
    const k = 'dch_trial_' + 'z'.repeat(23);
    const id = W.paidLineCallerId({ api_key: k, client_ip: '10.1.1.1', session_id: 'a'.repeat(32) });
    expect(W.paidLineCallerId({ api_key: k, client_ip: '10.9.9.9' })).toBe(id);
    expect(id.startsWith('key-')).toBe(true);
    expect(W.paidLineCallerId({ client_ip: '10.1.1.1' }).startsWith('ip-')).toBe(true);
    expect(W.paidLineCallerId({ client_ip: '10.1.1.1', session_id: 'b'.repeat(32) })).toBe(W.paidLineCallerId({ client_ip: '10.1.1.1' }));
    expect(W.paidLineCallerId({})).toBe('');
    expect(W.paidLineArm('')).toBe(null);
    expect(W.paidLineArm(null)).toBe(null);
  });
});

describe('lib/wall-paid-line.mjs: placement and telemetry', () => {
  const base = (withSignIn = true, nextAsk = true) => ({
    content: [{ type: 'text', text: JSON.stringify({ preview: true, ...(nextAsk ? { next_ask: { tool: 'rank_markets', question: 'Q?' } } : {}) }) },
      ...(withSignIn ? [{ type: 'text', text: SIGNIN_LINE }] : []),
      { type: 'text', text: 'Source: DC Hub (dchub.cloud)' }],
    structuredContent: { preview: true, ...(nextAsk ? { next_ask: { tool: 'rank_markets', question: 'Q?' } } : {}) },
  });
  it('right after the sign-in line; the short form in next_ask (structured and JSON); never twice', () => {
    const out = W.withPaidLine(base());
    const t = texts(out);
    expect(t.indexOf(W.PAID_LINE)).toBe(t.indexOf(SIGNIN_LINE) + 1);
    expect(out.structuredContent.next_ask[W.NEXT_ASK_FIELD]).toBe(W.PAID_LINE_SHORT);
    expect(JSON.parse(t[0]).next_ask[W.NEXT_ASK_FIELD]).toBe(W.PAID_LINE_SHORT);
    expect(out.structuredContent.next_ask.tool).toBe('rank_markets');
    expect(count(W.withPaidLine(out), W.PAID_LINE)).toBe(1);
    expect(withoutPaidLine(out)).toEqual(base());
  });
  it('no sign-in line: right after the JSON block; no next_ask: none added', () => {
    const out = W.withPaidLine(base(false, false));
    expect(texts(out)[1]).toBe(W.PAID_LINE);
    expect(out.structuredContent).toEqual({ preview: true });
  });
  it('a 2-space JSON block keeps its layout', () => {
    const b = base(); b.content[0] = { type: 'text', text: JSON.stringify(JSON.parse(b.content[0].text), null, 2) };
    const out = W.withPaidLine(b);
    expect(out.content[0].text).toBe(JSON.stringify({ ...JSON.parse(b.content[0].text), next_ask: { tool: 'rank_markets', question: 'Q?', [W.NEXT_ASK_FIELD]: W.PAID_LINE_SHORT } }, null, 2));
  });
  it('the arm on the wall row and on the held track rows (first key); no arm = untouched', () => {
    const body = { event: 'quota_wall_hit', tool: 'x' };
    expect(W.withArmEvent(body, W.ARM_CONTROL)).toEqual({ ...body, [W.EVENT_FIELD]: 'control' });
    expect(W.withArmEvent(body, null)).toBe(body);
    expect(W.withArmEvent(body, 'other')).toBe(body);
    const c = { _heldTrackRows: [{ row: { tool: 'x', params: { a: 1 } }, sent: false }, { row: { tool: 'y', params: {} }, sent: false },
      { row: { tool: 'x', params: {} }, sent: true }] };
    expect(W.markHeldTrackRows(c, 'x', W.ARM_PAID_LINE)).toBe(1);
    expect(Object.keys(c._heldTrackRows[0].row.params)).toEqual([W.TRACK_FIELD, 'a']);
    expect(c._heldTrackRows[0].row.params[W.TRACK_FIELD]).toBe('paid_line');
    expect(c._heldTrackRows[1].row.params).toEqual({});
    expect(c._heldTrackRows[2].row.params).toEqual({});
    expect(W.markHeldTrackRows(c, 'x', null)).toBe(0);
  });
});

describe('lib/wall-paid-line.mjs: gateways stay out of the split (2026-11-22)', () => {
  it('isGatewayCaller: the Pipeworx label or UA; nothing else', () => {
    expect(W.isGatewayCaller({ platform: 'pipeworx' })).toBe(true);
    expect(W.isGatewayCaller({ platform: 'Pipeworx ' })).toBe(true);
    expect(W.isGatewayCaller({ client_ua: 'pipeworx-mcp-dchub/1.0 (+https://pipeworx.io)' })).toBe(true);
    expect(W.isGatewayCaller({ user_agent: 'pipeworx-mcp-dchub/1.0' })).toBe(true);
    for (const c of [{}, null, { platform: 'mcp' }, { platform: 'cursor', client_ua: 'cursor/1.0' },
      { client_ua: 'node (+https://example.com/pipeworx/)' }, { platform: 'mcp-generic-client', client_ua: 'node' }]) {
      expect(W.isGatewayCaller(c), JSON.stringify(c)).toBe(false);
    }
  });
  it('paidLineSurface: a gateway on /mcp is off the surface; the same call from a non-gateway is on it', () => {
    expect(W.paidLineSurface({ path: '/mcp', platform: 'cursor' })).toBe(true);
    expect(W.paidLineSurface({ path: '/mcp', platform: 'pipeworx' })).toBe(false);
    expect(W.paidLineSurface({ path: '/mcp', platform: 'mcp', client_ua: 'pipeworx-mcp-dchub/1.0 (+https://pipeworx.io)' })).toBe(false);
  });
});

describe('_wallPaidLineStep: the generic /mcp surface only', () => {
  const wall = () => ({ content: [{ type: 'text', text: '{"preview":true}' }, { type: 'text', text: SIGNIN_LINE }, { type: 'text', text: 'Source: DC Hub (dchub.cloud)' }], structuredContent: { preview: true } });
  const ctx = (o = {}, tool = 'get_grid_intelligence') => ({ session_id: '', platform: 'cursor', tier: 'anonymous', path: '/mcp',
    client_ip: ipIn(W.ARM_PAID_LINE), _pendingWallHits: [{ name: tool, status: 'anon_hard_wall', sent: false }], ...o });
  it('flag ON: a keyless and a trial-key caller in the paid_line arm get it; flag OFF: the same object back, no arm', () => {
    setEnv({ DCHUB_WALL_PAID_LINE: '1' });
    expect(count(S._wallPaidLineStep(wall(), 'get_grid_intelligence', ctx()), W.PAID_LINE)).toBe(1);
    expect(count(S._wallPaidLineStep(wall(), 'get_grid_intelligence', ctx({ api_key: keyIn(W.ARM_PAID_LINE), tier: 'trial' })), W.PAID_LINE)).toBe(1);
    const cc = ctx({ client_ip: ipIn(W.ARM_CONTROL) });
    const wc = wall();
    expect(S._wallPaidLineStep(wc, 'get_grid_intelligence', cc)).toBe(wc);
    expect(cc._wallPaidLineArm).toBe('control');
    for (const off of [undefined, '0', 'off']) {
      setEnv({ DCHUB_WALL_PAID_LINE: off });
      const w = wall(); const c = ctx();
      expect(S._wallPaidLineStep(w, 'get_grid_intelligence', c)).toBe(w);
      expect(c._wallPaidLineArm).toBeUndefined();
    }
  });
  it.each([
    ['/mcp/chatgpt profile on /mcp', { profile: 'chatgpt_directory' }],
    ['/mcp/claude profile on /mcp', { profile: 'claude_directory' }],
    ['/mcp/core profile on /mcp', { profile: 'core_profile' }],
    ['/mcp/chatgpt path', { path: '/mcp/chatgpt' }],
    ['/mcp/claude path', { path: '/mcp/claude' }],
    ['/mcp/grok path', { path: '/mcp/grok' }],
    ['/mcp/light path', { path: '/mcp/light' }],
    ['no path', { path: undefined }],
    ['a ChatGPT client', { platform: 'chatgpt' }],
    ['an OpenAI client', { platform: 'openai-mcp' }],
    ['Grok', { platform: 'grok' }],
    ['an execute_plan step', { loopback_step: true }],
    ['a device-matched caller', { device_match: true }],
    ['a claimed (non-trial) key', { api_key: 'dch_live_' + 'a'.repeat(24), tier: 'free' }],
    ['a key tool', {}, 'claim_free_key'],
    ['get_api_key', {}, 'get_api_key'],
    ['an account tool', {}, 'bind_email'],
    ['not walled', { _pendingWallHits: [] }],
    ['the Pipeworx gateway (platform label)', { platform: 'pipeworx' }],
    ['the Pipeworx gateway (raw UA, platform still generic)', { platform: 'mcp', client_ua: 'pipeworx-mcp-dchub/1.0 (+https://pipeworx.io)' }],
    ['the Pipeworx gateway forwarding an end client\'s clientInfo', { platform: 'claude', client_ua: 'pipeworx-mcp-dchub/1.0 (+https://pipeworx.io)' }],
    ['the Pipeworx gateway with a trial key', { platform: 'pipeworx', api_key: 'dch_trial_PL' + 'a'.repeat(20), tier: 'trial' }],
  ])('%s: untouched, no arm', (_l, o, tool = 'get_grid_intelligence') => {
    setEnv({ DCHUB_WALL_PAID_LINE: '1' });
    const w = wall(); const c = ctx(o, tool);
    const out = S._wallPaidLineStep(w, tool, c);
    expect(out).toBe(w);
    expect(c._wallPaidLineArm).toBeUndefined();
  });
  it('once per (session, tool); a sessionless caller gets it on every wall', () => {
    setEnv({ DCHUB_WALL_PAID_LINE: '1' });
    const sid = 'sess-paidline-' + Date.now().toString(36) + 'abcdefghijkl';
    const ip = ipIn(W.ARM_PAID_LINE);
    const first = S._wallPaidLineStep(wall(), 'get_grid_intelligence', ctx({ session_id: sid, client_ip: ip }));
    const c2 = ctx({ session_id: sid, client_ip: ip });
    const second = S._wallPaidLineStep(wall(), 'get_grid_intelligence', c2);
    const other = S._wallPaidLineStep(wall(), 'get_interconnection_queue', ctx({ session_id: sid, client_ip: ip }, 'get_interconnection_queue'));
    expect(count(first, W.PAID_LINE)).toBe(1);
    expect(count(second, W.PAID_LINE)).toBe(0);
    expect(c2._wallPaidLineArm, 'the arm is still recorded on a repeat wall').toBe('paid_line');
    expect(count(other, W.PAID_LINE)).toBe(1);
    for (let i = 0; i < 3; i++) expect(count(S._wallPaidLineStep(wall(), 'get_grid_intelligence', ctx({ client_ip: ip })), W.PAID_LINE)).toBe(1);
  });
});

// Production since 2026-11-21 15:11Z: DCHUB_WALL_IDENTITY_V2=1 and DCHUB_WALL_COPY_V2=1 on both services (COPY_V2 was 0
// before). COPY_ON is the primary case; COPY_OFF (the kill switch) must hold too.
const COPY_ON = { DCHUB_WALL_IDENTITY_V2: '1', DCHUB_WALL_COPY_V2: '1' };
const COPY_OFF = { DCHUB_WALL_IDENTITY_V2: '1', DCHUB_WALL_COPY_V2: '0' };   // COPY_V2 killed (production before 15:11Z)

// Owner 2026-11-23: a trial key's execute_plan is a preview with keyless steps (a full plan needs a paid key), so
// it is no longer origin/main's answer; the byte-for-byte cases skip it and the A/B test below pins the line on it.
const changedSince1123 = (c, name) => c.trial && name === 'execute_plan';
describe('flag OFF is origin/main byte for byte, on every profile; flag ON leaves /mcp/claude and /mcp/chatgpt as origin/main', () => {
  const run = async (p, c, name, args, env) => {
    setEnv(env);
    anonCount = c.cnt;
    const w = who(c);
    const here = await call(H, p, name, args, w);
    const main = await call(O, p, name, args, w);
    const a = norm(here.result), b = norm(main.result);
    expect(a === b, firstDiff(a, b)).toBe(true);
    expect(JSON.stringify(here.result)).not.toContain('v=paid-line');
    for (const r of here.rows) expect(r).not.toHaveProperty(W.EVENT_FIELD);
    for (const t of here.tracks) expect(t.params || {}).not.toHaveProperty(W.TRACK_FIELD);
  };
  const CASES = [];
  for (const p of ['/mcp', '/mcp/claude', '/mcp/chatgpt']) for (const t of TOOLS) CASES.push([p, ...t]);
  for (const [flag, env] of [['unset, COPY_V2 on', { ...COPY_ON }], ['0, COPY_V2 on', { ...COPY_ON, DCHUB_WALL_PAID_LINE: '0' }],
    ['unset, COPY_V2 off', { ...COPY_OFF }]]) {
    it.each(CASES)(`flag ${flag}: %s %s`, async (p, name, args) => {
      if (!O) { console.warn(`[wall-paid-line] origin/main comparison not run: ${why}`); return; }
      for (const [, c] of CALLERS) if (!changedSince1123(c, name)) await run(p, c, name, args, env);
    }, 240_000);
  }
  const ON = [];
  for (const p of ['/mcp/claude', '/mcp/chatgpt']) for (const t of TOOLS) ON.push([p, ...t]);
  it.each(ON)('flag ON (COPY_V2 off and on): %s %s is origin/main, keyless and trial-key, both arms', async (p, name, args) => {
    if (!O) { console.warn(`[wall-paid-line] origin/main comparison not run: ${why}`); return; }
    for (const env of [{ ...COPY_ON, DCHUB_WALL_PAID_LINE: '1' }, { ...COPY_OFF, DCHUB_WALL_PAID_LINE: '1' }]) {
      for (const [, c] of CALLERS) {
        if (changedSince1123(c, name)) continue;
        setEnv(env);
        anonCount = c.cnt;
        const w = who(c, W.ARM_PAID_LINE);
        const here = await call(H, p, name, args, w);
        const main = await call(O, p, name, args, w);
        const a = norm(here.result), b = norm(main.result);
        expect(a === b, firstDiff(a, b)).toBe(true);
        for (const r of here.rows) expect(r).not.toHaveProperty(W.EVENT_FIELD);
      }
    }
  }, 240_000);
});

describe('flag ON, /mcp: the A/B', () => {
  // A wall: origin/main's answer carries the v2 sign-in line (every keyless / trial-key wall under IDENTITY_V2) or posted
  // a wall row. Anything else (an error answer) must come back untouched and with no arm.
  const isWall = (r) => count(r.result, SIGNIN_LINE) > 0 || r.rows.length > 0;
  const walledSeen = new Set();
  afterAll(() => {
    // The branch above must not swallow the test: most cases are walls (a check over no wall proves nothing).
    // 28 = 32 before 2026-11-23 minus the 4 trial-key execute_plan cases (2 copies x 2 arms) moved to their own test.
    if (O) expect(walledSeen.size, 'walled cases actually exercised').toBeGreaterThanOrEqual(28);
  });
  const CASES = [];
  for (const [label, c] of CALLERS) for (const t of TOOLS) if (!changedSince1123(c, t[0])) CASES.push([label + ' / ' + t[0], c, ...t]);
  it('trial key / execute_plan (owner 2026-11-23, paid-only full plan): the paid_line arm still gets the line once, URL intact', async () => {
    const c = CALLERS.find(([, x]) => x.trial)[1];
    const [, args] = TOOLS.find((t) => t[0] === 'execute_plan');
    setEnv({ ...COPY_ON, DCHUB_WALL_PAID_LINE: '1' });
    anonCount = c.cnt;
    const here = await call(H, '/mcp', 'execute_plan', args, who(c, W.ARM_PAID_LINE));
    expect(count(here.result, W.PAID_LINE)).toBe(1);
    for (const tr of here.tracks) expect(tr.params[W.TRACK_FIELD]).toBe('paid_line');
  }, 240_000);
  for (const [copy, env] of [['COPY_V2 on', COPY_ON], ['COPY_V2 off', COPY_OFF]]) {
    it.each(CASES)(`${copy}: paid_line arm, %s: origin/main plus exactly the line, URL intact, arm recorded`, async (_l, c, name, args) => {
      if (!O) { console.warn(`[wall-paid-line] origin/main comparison not run: ${why}`); return; }
      const w = who(c, W.ARM_PAID_LINE);
      setEnv({ ...env, DCHUB_WALL_PAID_LINE: '1' });
      anonCount = c.cnt;
      const here = await call(H, '/mcp', name, args, w);
      setEnv(env);   // origin/main has no such flag; its answer is the baseline
      const main = await call(O, '/mcp', name, args, w);
      const t = texts(here.result);
      if (!isWall(main)) {   // not a wall (e.g. the stub's grid error at preview count 0): nothing added, no arm
        expect(norm(here.result)).toBe(norm(main.result));
        for (const tr of here.tracks) expect(tr.params || {}).not.toHaveProperty(W.TRACK_FIELD);
        return;
      }
      walledSeen.add(copy + _l);
      expect(count(here.result, W.PAID_LINE), 'the line, once, URL intact').toBe(1);
      const si = t.findIndex((x) => x.includes(SIGNIN_LINE));
      if (si >= 0) expect(t[si + 1], 'right after the sign-in line').toBe(W.PAID_LINE);
      for (const s of t) if (s.includes('dchub.cloud/connect?via=mcp-wall&v=') || s.includes('paid license')) expect(s.includes(W.PAID_LINE_URL)).toBe(true);
      const a = norm(withoutPaidLine(here.result)), b = norm(main.result);
      expect(a === b, 'everything else is origin/main' + firstDiff(a, b)).toBe(true);
      expect(here.tracks.length, 'the call posted its track row').toBeGreaterThan(0);
      for (const tr of here.tracks) expect(tr.params[W.TRACK_FIELD]).toBe('paid_line');
      for (const r of here.rows) expect(r[W.EVENT_FIELD]).toBe('paid_line');
    }, 240_000);
    it.each(CASES)(`${copy}: control arm, %s: origin/main byte for byte, arm recorded`, async (_l, c, name, args) => {
      if (!O) { console.warn(`[wall-paid-line] origin/main comparison not run: ${why}`); return; }
      const w = who(c, W.ARM_CONTROL);
      setEnv({ ...env, DCHUB_WALL_PAID_LINE: '1' });
      anonCount = c.cnt;
      const here = await call(H, '/mcp', name, args, w);
      setEnv(env);
      const main = await call(O, '/mcp', name, args, w);
      const a = norm(here.result), b = norm(main.result);
      expect(a === b, firstDiff(a, b)).toBe(true);
      expect(here.tracks.length).toBeGreaterThan(0);
      if (!isWall(main)) { for (const tr of here.tracks) expect(tr.params || {}).not.toHaveProperty(W.TRACK_FIELD); return; }
      walledSeen.add(copy + _l + ' control');
      for (const tr of here.tracks) expect(tr.params[W.TRACK_FIELD]).toBe('control');
      for (const r of here.rows) expect(r[W.EVENT_FIELD]).toBe('control');
    }, 240_000);
  }
  it('through the handler: about half of 80 synthetic keyless callers get the line, each the same arm on a second call', async () => {
    setEnv({ ...COPY_ON, DCHUB_WALL_PAID_LINE: '1' });
    anonCount = 999;
    let paid = 0;
    for (let i = 0; i < 80; i++) {
      const ip = `198.18.${Math.floor(i / 250)}.${i % 250 + 1}`;
      const arms = [];
      for (let k = 0; k < 2; k++) {
        const r = await call(H, '/mcp', 'get_interconnection_queue', { iso: 'PJM' }, { ip });
        const arm = r.tracks.length ? r.tracks[0].params[W.TRACK_FIELD] : undefined;
        expect(W.isPaidLineArm(arm), 'every walled caller has an arm').toBe(true);
        expect(count(r.result, W.PAID_LINE) === 1).toBe(arm === W.ARM_PAID_LINE);
        arms.push(arm);
      }
      expect(arms[1], 'stable per caller').toBe(arms[0]);
      expect(arms[0]).toBe(W.paidLineArm(W.paidLineCallerId({ client_ip: ip })));
      if (arms[0] === W.ARM_PAID_LINE) paid += 1;
    }
    expect(paid).toBeGreaterThan(24);
    expect(paid).toBeLessThan(56);
  }, 240_000);
  it('Pipeworx on /mcp (its real UA, keyless, sessionless): no line, no arm, on both arms\' IPs', async () => {
    setEnv({ ...COPY_ON, DCHUB_WALL_PAID_LINE: '1' });
    anonCount = 999;
    let walls = 0;
    for (const arm of [W.ARM_PAID_LINE, W.ARM_CONTROL]) {
      const r = await call(H, '/mcp', 'get_interconnection_queue', { iso: 'PJM' }, { ip: ipIn(arm), ua: 'pipeworx-mcp-dchub/1.0 (+https://pipeworx.io)' });
      if (count(r.result, SIGNIN_LINE) > 0 || r.rows.length > 0) walls += 1;
      expect(JSON.stringify(r.result)).not.toContain('v=paid-line');
      expect(r.tracks.length, 'the call posted its track row').toBeGreaterThan(0);
      for (const t of r.tracks) {
        expect(t.params || {}).not.toHaveProperty(W.TRACK_FIELD);
        expect(t.platform, 'the row is labelled pipeworx, not the generic mcp').toBe('pipeworx');
      }
      for (const row of r.rows) expect(row).not.toHaveProperty(W.EVENT_FIELD);
    }
    expect(walls, 'both calls were walls (a check over no wall proves nothing)').toBe(2);
  }, 120_000);
  it('Grok on /mcp (grokbot UA): no line, no arm', async () => {
    setEnv({ ...COPY_ON, DCHUB_WALL_PAID_LINE: '1' });
    anonCount = 999;
    const r = await call(H, '/mcp', 'get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }, { ip: ipIn(W.ARM_PAID_LINE), ua: 'grokbot-walltest/1.0' });
    expect(JSON.stringify(r.result)).not.toContain('v=paid-line');
    for (const t of r.tracks) expect(t.params || {}).not.toHaveProperty(W.TRACK_FIELD);
  }, 120_000);
});
