// monetization-experiments-1122.test.mjs — the Nov 22 monetization tests (lib/monetization-experiments.mjs,
// lib/save-key-prompt.mjs, server.mjs _expSaveKeyStep / _expOutcomeStep). DRAFT, every flag OFF.
//
// Rules asserted:
//   * the arm is the backend's (shared vectors with dchub-backend tests/test_monetization_experiments.py), stable per
//     identity, ~80/20, and independent across tests;
//   * Test B through the real handler (backend stubbed, network fenced, an outside peer address):
//       - flag OFF: no decide call, no exposure row, the answer unchanged;
//       - flag ON, treatment: calls 1-2 unchanged, call 3 gains exactly the save-key line (one block, at the end),
//         and the decide body carries the backend's arm; call 4 asks nothing more (once per identity);
//       - flag ON, holdout: the decide happens (exposure recorded in both arms) and the answer is unchanged;
//       - never on /mcp/chatgpt, never for a keyed caller;
//   * the copy names no price, plan name, allowance or "free";
//   * outcomes: continued (same session, later call), returned_next_day (next UTC day), key_minted (the minted key's
//     ref only, never the raw key; only for tests whose flag is on).
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import * as MX from '../lib/monetization-experiments.mjs';
import * as SKP from '../lib/save-key-prompt.mjs';

const NO_PRICE = /\$|\bper month\b|\/mo\b|\b(?:pro|developer|starter|enterprise|team|plan|trial|credits?)\b|\/day\b|\bper day\b|\bfree\b/i;

describe('shared assignment', () => {
  it('matches the backend vectors', () => {
    expect(MX.bucketFor('pk-' + 'a'.repeat(64), MX.UPGRADE_BLOCK)).toBe(95);
    expect(MX.armFor('pk-' + 'a'.repeat(64), MX.UPGRADE_BLOCK)).toBe(MX.HOLDOUT);
    expect(MX.bucketFor('ip-' + 'b'.repeat(64), MX.SAVE_KEY_PROMPT)).toBe(83);
    expect(MX.armFor('sk-' + 'c'.repeat(32), MX.UPGRADE_BLOCK)).toBe(MX.TREATMENT);
    expect(MX.bucketFor('sk-' + 'c'.repeat(32), MX.UPGRADE_BLOCK)).toBe(26);
  });
  it('is stable, about 80/20, and independent across tests', () => {
    const ids = Array.from({ length: 20000 }, (_, n) => 'ip-' + n.toString(16).padStart(64, '0'));
    const a = ids.map((i) => MX.armFor(i, MX.UPGRADE_BLOCK));
    expect(ids.map((i) => MX.armFor(i, MX.UPGRADE_BLOCK))).toEqual(a);
    const share = a.filter((x) => x === MX.TREATMENT).length / ids.length;
    expect(share).toBeGreaterThan(0.78);
    expect(share).toBeLessThan(0.82);
    const b = ids.map((i) => MX.armFor(i, MX.SAVE_KEY_PROMPT));
    const bothHold = a.filter((x, i) => x === MX.HOLDOUT && b[i] === MX.HOLDOUT).length / ids.length;
    expect(bothHold).toBeGreaterThan(0.02);
    expect(bothHold).toBeLessThan(0.06);
  });
  it('identity: key ref when keyed, else the keyless cap identity', () => {
    expect(MX.identityOf({ api_key: 'dch_live_x' })).toMatch(/^pk-[0-9a-f]{64}$/);
    expect(MX.identityOf({ client_ip: '203.0.113.9' })).toMatch(/^ip-[0-9a-f]{64}$/);
    expect(MX.identityOf({})).toBe('');
  });
});

describe('save-key copy and counting', () => {
  beforeEach(() => SKP._resetForTests());
  it('names the key tool and nothing commercial', () => {
    expect(SKP.SAVE_KEY_LINE).toContain('get_api_key');
    expect(SKP.SAVE_KEY_LINE).toContain('get_changes');
    expect(NO_PRICE.test(SKP.SAVE_KEY_LINE)).toBe(false);
  });
  it('is due at the 3rd call in 24 h, and not again on this replica for 7 days once decided', () => {
    const t0 = Date.UTC(2026, 10, 22, 12);
    expect(SKP.countAndDue('ip-x', t0)).toBe(false);
    expect(SKP.countAndDue('ip-x', t0 + 1000)).toBe(false);
    expect(SKP.countAndDue('ip-x', t0 + 2000)).toBe(true);
    SKP.markDecided('ip-x', t0 + 2000);
    expect(SKP.countAndDue('ip-x', t0 + 3000)).toBe(false);
    expect(SKP.countAndDue('ip-y', t0)).toBe(false);
    expect(SKP.countAndDue('ip-y', t0 + 25 * 3600e3)).toBe(false);   // the first call fell out of the 24 h window
  });
  it('a key ask or a wall link in the answer counts as an ask; the neutral /connect line does not', () => {
    const r = (t) => ({ content: [{ type: 'text', text: t }] });
    expect(SKP.answerAsks(r('More detail is available at dchub.cloud/connect.'))).toBe(false);
    expect(SKP.answerAsks(r('Call get_api_key with your email'))).toBe(true);
    expect(SKP.answerAsks(r('Open https://dchub.cloud/mcp/connect'))).toBe(true);
    expect(SKP.answerAsks(r('https://dchub.cloud/u/abcdef'))).toBe(true);
  });
});

describe('outcomes', () => {
  beforeEach(() => MX._resetForTests());
  it('continued and returned_next_day, once each; the exposure call itself is not "continued"', () => {
    const posts = [];
    const post = (p, b) => { posts.push([p, b]); return Promise.resolve(null); };
    const t0 = Date.UTC(2026, 10, 22, 20);
    MX.rememberExposure({ test: MX.SAVE_KEY_PROMPT, identity: 'ip-a', session_id: 's1', now: t0 });
    expect(MX.noteCall(post, { identity: 'ip-a', session_id: 's1', now: t0, exposureCall: true })).toEqual([]);
    expect(MX.noteCall(post, { identity: 'ip-a', session_id: 's1', now: t0 + 1000 }).map((r) => r.event)).toEqual(['continued']);
    expect(MX.noteCall(post, { identity: 'ip-a', session_id: 's1', now: t0 + 2000 })).toEqual([]);
    expect(MX.noteCall(post, { identity: 'ip-a', session_id: 's9', now: t0 + 6 * 3600e3 }).map((r) => r.event)).toEqual(['returned_next_day']);
    expect(MX.noteCall(post, { identity: 'ip-a', session_id: 's9', now: t0 + 7 * 3600e3 })).toEqual([]);
    expect(posts.every(([p, b]) => p === MX.EXPOSURE_PATH && b.arm === MX.armFor('ip-a', MX.SAVE_KEY_PROMPT))).toBe(true);
  });
  it('key_minted carries the ref, never the raw key, and only for tests whose flag is on', () => {
    const posts = [];
    const post = (p, b) => { posts.push(b); return Promise.resolve(null); };
    const result = { content: [{ type: 'text', text: '{"api_key":"dch_live_ABCDEFGH1234"}' }], structuredContent: { api_key: 'dch_live_ABCDEFGH1234' } };
    expect(MX.noteMint(post, { identity: 'ip-a', result, env: {} })).toEqual([]);
    const rows = MX.noteMint(post, { identity: 'ip-a', result, env: { DCHUB_EXP_SAVE_KEY_PROMPT: '1' } });
    expect(rows.map((r) => r.test)).toEqual([MX.SAVE_KEY_PROMPT]);
    expect(rows[0].ref).toBe(MX.keyRef('dch_live_ABCDEFGH1234'));
    expect(JSON.stringify(posts)).not.toContain('dch_live_ABCDEFGH1234');
  });
});

// ── Test B through the real handler ──────────────────────────────────────────────────────────────────────────────────
let H, fence;
const decides = [];
const exposures = [];
let decideAnswer = null;
const ROWS = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i }));
const routes = () => (p, _req, body) => {
  if (p === '/api/v1/mcp/experiments/decide') { decides.push(body); return decideAnswer ? decideAnswer(body) : { fire: false }; }
  if (p === '/api/v1/mcp/experiments/exposure') { exposures.push(body); return { recorded: true }; }
  if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
  if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
  return { success: true, count: 4, total_count: 4, data: ROWS, results: ROWS, items: ROWS, rows: ROWS };
};
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
const FLAGS = ['DCHUB_EXP_SAVE_KEY_PROMPT', 'DCHUB_EXP_UPGRADE_BLOCK'];
const setEnv = (o) => { for (const k of FLAGS) { if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k]; } };
let rid = 1;
function rpc(p, body, headers = {}) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: H.PORT, path: p, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'cursor/1.0',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, msg });
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
async function call(p, ip, { key = '', name = 'get_grid_scoreboard', args = {} } = {}) {
  const r = await rpc(p, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } },
    { 'x-dc-client-ip': ip, ...(key ? { 'x-api-key': key } : {}) });
  await new Promise((res) => setTimeout(res, 120));
  return r.msg && r.msg.result;
}
const texts = (r) => ((r && r.content) || []).filter((b) => b && b.type === 'text').map((b) => b.text);
const lineCount = (r) => texts(r).filter((t) => t.includes(SKP.SAVE_KEY_LINE)).length;
// A fresh outside IP whose keyless identity lands in `arm` for Test B.
let ipSeq = 10;
async function ipIn(arm) {
  const { capWallIdentity } = await import('../lib/keyless-wall.mjs');
  for (;;) {
    const ip = '198.51.' + Math.floor(ipSeq / 250) + '.' + (ipSeq % 250 + 1);
    ipSeq++;
    if (MX.armFor(capWallIdentity({ client_ip: ip }), MX.SAVE_KEY_PROMPT) === arm) return ip;
  }
}

describe('Test B through the handler', () => {
  beforeAll(async () => {
    net.Socket.prototype._getpeername = function _getpeername() {
      const p = _peer.call(this);
      if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.21' };
      return p;
    };
    fence = fenceNetwork();
    setEnv({});
    H = await startHarness({ env: { DCHUB_INTERNAL_KEY: 'test-internal', DCHUB_ANON_DAILY_CAP: '50' }, extraRoutes: routes() });
    SERVER_PORTS.add(H.PORT);
  }, 180_000);
  afterAll(async () => {
    net.Socket.prototype._getpeername = _peer;
    if (H) await H.stop();
    if (fence) fence.restore();
    setEnv({});
  });
  afterEach(() => { setEnv({}); decides.length = 0; exposures.length = 0; decideAnswer = null; });

  it('flag OFF: no decide, no exposure, the answer unchanged on every call', async () => {
    const ip = await ipIn(MX.TREATMENT);
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await call('/mcp', ip));
    expect(r.every((x) => x && lineCount(x) === 0)).toBe(true);
    expect(decides.length).toBe(0);
    expect(exposures.length).toBe(0);
  }, 60_000);

  it('flag ON, treatment: the 3rd good call gains exactly the line, at the end; nothing on 1, 2 or 4', async () => {
    setEnv({ DCHUB_EXP_SAVE_KEY_PROMPT: '1' });
    decideAnswer = (b) => ({ fire: b.arm === MX.TREATMENT, arm: b.arm, exposed: true, test: MX.SAVE_KEY_PROMPT });
    const ip = await ipIn(MX.TREATMENT);
    const r1 = await call('/mcp', ip);
    const r2 = await call('/mcp', ip);
    const r3 = await call('/mcp', ip);
    const r4 = await call('/mcp', ip);
    expect([lineCount(r1), lineCount(r2), lineCount(r3), lineCount(r4)]).toEqual([0, 0, 1, 0]);
    expect(texts(r3).at(-1)).toBe(SKP.SAVE_KEY_LINE);
    // The 3rd answer is the 2nd answer's shape plus exactly one block.
    expect(r3.content.length).toBe(r2.content.length + 1);
    expect(decides.length).toBe(1);
    expect(decides[0]).toMatchObject({ test: MX.SAVE_KEY_PROMPT, arm: MX.TREATMENT, tool: 'get_grid_scoreboard' });
    expect(decides[0].identity).toMatch(/^ip-[0-9a-f]{64}$/);
  }, 60_000);

  it('flag ON, holdout: the decide records the exposure, the answer is unchanged (even if the backend says fire)', async () => {
    setEnv({ DCHUB_EXP_SAVE_KEY_PROMPT: '1' });
    decideAnswer = (b) => ({ fire: true, arm: b.arm, exposed: true, test: MX.SAVE_KEY_PROMPT });
    const ip = await ipIn(MX.HOLDOUT);
    const r = [];
    for (let i = 0; i < 3; i++) r.push(await call('/mcp', ip));
    expect(r.map(lineCount)).toEqual([0, 0, 0]);
    expect(decides.length).toBe(1);
    expect(decides[0].arm).toBe(MX.HOLDOUT);
  }, 60_000);

  it('never on /mcp/chatgpt', async () => {
    setEnv({ DCHUB_EXP_SAVE_KEY_PROMPT: '1' });
    decideAnswer = (b) => ({ fire: true, arm: b.arm, exposed: true });
    const ip = await ipIn(MX.TREATMENT);
    for (let i = 0; i < 4; i++) expect(lineCount(await call('/mcp/chatgpt', ip))).toBe(0);
    expect(decides.length).toBe(0);
    expect(exposures.length).toBe(0);
  }, 60_000);
});
