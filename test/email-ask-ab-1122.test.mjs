// email-ask-ab-1122.test.mjs — F4, the email-ask copy A/B (lib/email-ask-ab.mjs, server.mjs _emailAskAbStep;
// Grok funnel spec 2026-11-22). DRAFT: DCHUB_EMAIL_ASK_AB stays OFF until the owner says so.
//   E1  sticky arm: the same identity always gets the same arm; ~50/50 over many identities; independent of the
//       one-door / paid-line splits; key first, else the keyless identity.
//   E2  arm b names the call's own ISO, else its market, else a generic fallback; arm a is unchanged.
//   E3  copy check: no price, plan name, "free", credits, trial or allowance figure in any arm-b line.
//   E4  (backend) the /api/v1/mcp/funnel/experiments readout: dchub-backend tests/test_email_ask_ab.py.
// Through the real handler (backend stubbed, network fenced, an outside peer address) with the production wall flags
// on: flag OFF and arm a are byte-identical to the flag-off answer; arm b differs by exactly the ask sentence; both
// arms ride the wall row as email_ask_ab; /mcp/chatgpt and /mcp/claude never change; no arm while mcp#1677's
// email-ask-all flags are both on.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unsealPayload } from '../lib/token-seal.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { SIGNIN_LINE } from '../lib/wall-identity-v2.mjs';
import { PREVIEW_FOOTER } from '../lib/dchub-identity.mjs';
import { ANSWER_FIRST_LEAD, ANSWER_FIRST_SKIP } from '../lib/claim-handoff.mjs';
import { FOR_HUMAN_LEAD } from '../lib/wall-relay-everywhere.mjs';
import * as WPL from '../lib/wall-paid-line.mjs';
import * as E from '../lib/email-ask-ab.mjs';
import { createLastWallMemo, emailEnteredEventBody } from '../lib/email-entered.mjs';
import { identityOf } from '../lib/monetization-experiments.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHORT = 'https://dchub.cloud/u/abcdef';
let H, O, SB, fence, why = '', anonCount = 0;
const events = [];
const tracks = [];
const routes = () => (p, _req, body) => {
  if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
  if (p === '/api/v1/mcp/track') { if (body && typeof body === 'object') tracks.push(body); return { ok: true }; }
  if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
  if (p === '/api/v1/keys/validate' && body && typeof body.api_key === 'string' && body.api_key.startsWith('dch_trial_OD')) return { valid: true, tier: 'trial', email: null, tier_detail: { users_plan: null } };
  if (p === '/api/v1/relay/short') return { ok: true, url: SHORT };
  if (p === '/api/v1/relay/teaser') return { ok: true };
  return undefined;   // the harness's own stubs: the walled shapes each tool's backend serves a keyless caller
};
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
const FLAGS = ['DCHUB_EMAIL_ASK_AB', 'DCHUB_WALL_TO_KEY_V1', 'DCHUB_W2K_EMAIL_ASK_ALL', 'DCHUB_WALL_ONE_DOOR', 'DCHUB_WALL_RELAY_EVERYWHERE', 'DCHUB_WALL_VALUE_FIRST', 'DCHUB_LICENCE_BLOCK',
  'DCHUB_WALL_PAID_LINE', 'DCHUB_WALL_COPY_V2', 'DCHUB_WALL_IDENTITY_V2'];
const setEnv = (o) => { for (const k of FLAGS) { if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k]; } };
// The wall flags production runs with on 2026-11-22.
const PROD = { DCHUB_WALL_IDENTITY_V2: '1', DCHUB_WALL_COPY_V2: '1', DCHUB_WALL_RELAY_EVERYWHERE: '1',
  DCHUB_WALL_VALUE_FIRST: '1', DCHUB_LICENCE_BLOCK: '1', DCHUB_WALL_PAID_LINE: '1' };
const ON = { ...PROD, DCHUB_EMAIL_ASK_AB: '1' };
beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.41' };
    return p;
  };
  fence = fenceNetwork();
  const env = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_KEYLESS_FIRST_FULL: '0', DCHUB_ANON_DAILY_CAP: '20',
    DCHUB_WORKOS_OAUTH_ENABLED: '1' };
  setEnv({});
  H = await startHarness({ env, extraRoutes: routes() });
  SERVER_PORTS.add(H.PORT);
  
}, 180_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (O) await O.stop();
  if (H) await H.stop();
  if (SB) SB.cleanup();
  if (fence) fence.restore();
  setEnv({});
});
afterEach(() => { setEnv({}); anonCount = 0; });

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
  // Wall rows of this call (an execute_plan answer's rows name its walled steps' tools, not execute_plan).
  return { result: r.msg && r.msg.result, rows: events.slice(e0),
    tracks: tracks.slice(t0).filter((t) => t.tool === name) };
}
// What differs between two runs of the same call by design (same normaliser as test/wall-relay-value-first-1121).
const RERUN_TOK = /pr1\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;
const rerunBody = (m, b) => {
  try {
    const { t, ...rest } = JSON.parse(unsealPayload(b));
    if (Array.isArray(rest.s)) rest.s = rest.s.map((x) => (Array.isArray(x) ? x.map((v, i) => (i === 3 || i === 7 ? 'H' : v)) : x));
    return 'RERUN.' + Buffer.from(JSON.stringify(rest)).toString('base64url');
  } catch { return m; }
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
const isJson = (t) => /^\s*[{[]/.test(String(t || ''));

let ipSeq = 1, keySeq = 1;
function ipIn(arm) {
  for (;;) {
    const ip = `198.51.${100 + Math.floor(ipSeq / 250) % 100}.${ipSeq++ % 250 + 1}`;
    if (E.armFor(E.callerId({ client_ip: ip })) === arm) return ip;
  }
}
function keyIn(arm) {
  for (;;) {
    const key = 'dch_trial_ODtest' + String(keySeq++).padStart(8, '0') + 'abcdefghijk';
    if (E.armFor(E.callerId({ api_key: key })) === arm) return key;
  }
}
const anyIp = () => `198.51.${200 + Math.floor(ipSeq / 250) % 50}.${ipSeq++ % 250 + 1}`;


const askOf = (r) => { const f = E.findAsk(r); return f ? f.m[0] : ''; };
const BANNED = /\$|\bfree\b|\bcredits?\b|\btrials?\b|calls?\s*\/\s*day|per\s+day|\b(?:Developer|Pro|Starter|Founding|Enterprise|plan)\b/i;

describe('E1 sticky arm', () => {
  it('same identity, same arm; ~50/50; key first, else IP/session identity', () => {
    for (let i = 0; i < 200; i++) {
      const c = { client_ip: '203.0.113.' + (i % 250) };
      expect(E.armFor(E.callerId(c))).toBe(E.armFor(E.callerId({ ...c })));
    }
    let b = 0;
    for (let i = 0; i < 10000; i++) if (E.armFor('ip-' + i) === E.ARM_B) b++;
    expect(b).toBeGreaterThan(4700); expect(b).toBeLessThan(5300);
    // the key wins over the IP: a keyed caller keeps its arm when its IP changes
    const k = 'dch_live_' + 'k'.repeat(30);
    expect(E.armFor(E.callerId({ api_key: k, client_ip: '1.1.1.1' }))).toBe(E.armFor(E.callerId({ api_key: k, client_ip: '2.2.2.2' })));
    expect(E.callerId({ api_key: k })).toBe(identityOf({ api_key: k }));
    expect(E.armFor('')).toBe(null);
  });
  it('independent of the one-door / paid-line split (not the same partition)', () => {
    let same = 0;
    for (let i = 0; i < 4000; i++) {
      const id = 'ip-' + i;
      if ((E.armFor(id) === E.ARM_B) === (WPL.paidLineArm(id) === WPL.ARM_PAID_LINE)) same++;
    }
    expect(same).toBeGreaterThan(1800); expect(same).toBeLessThan(2200);
  });
});

describe('E2 arm b names the market / ISO, with a fallback', () => {
  const SOFT = 'If your user would like the full answer, ask whether they want to share their email, then call `get_api_key` with it. Only use an address they gave you.';
  const R = (t) => ({ content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: 'Preview.\n' + t + ' Tail.' }] });
  it('ISO from the arguments wins, then the market, then generic', () => {
    expect(E.scopeFrom({ iso: 'ercot', market: 'dallas' })).toBe('ERCOT');
    expect(E.scopeFrom({ iso_region: 'iso-ne' })).toBe('ISO-NE');
    expect(E.scopeFrom({ market: 'dallas' })).toBe('Dallas');
    expect(E.scopeFrom({ iso: 'not-an-iso' })).toBe('');
    expect(E.scopeFrom({})).toBe('');
    expect(E.armBLine('ERCOT')).toBe('Ask your user for their email and pass it as email=… to `get_api_key` to get the full ERCOT answer now, plus a key that remembers this session.');
    expect(E.armBLine('')).toContain('to get the full answer now');
    expect(E.armBLine('PJM', 'bind_email')).toContain('`bind_email`');
  });
  it('withArmB swaps exactly the ask sentence and keeps the consent line and the rest', () => {
    const r = R(SOFT);
    const b = E.withArmB(r, 'ERCOT');
    expect(b.content[0]).toBe(r.content[0]);
    expect(b.content[1].text).toBe('Preview.\n' + E.armBLine('ERCOT') + ' Only use an address they gave you. Tail.');
    const v2 = E.withArmB(R('Share an email with get_api_key to keep this answer and get a daily change note for Dallas.'), 'Dallas');
    expect(v2.content[1].text).toContain(E.armBLine('Dallas'));
    const none = R('Nothing to ask here.');
    expect(E.withArmB(none, 'PJM')).toBe(none);
  });
  it('decide(): arm a unchanged, arm b swapped; never without an unlock mark, on a skip, paid, email on file, keyless Grok, or with mcp#1677 email-ask-all on', () => {
    const env = { DCHUB_EMAIL_ASK_AB: '1' };
    const facts = { walled: true, emailAsk: 'line' };
    const r = R(SOFT);
    const ipA = (() => { for (let i = 0; ; i++) { const ip = '192.0.2.' + i; if (E.armFor(E.callerId({ client_ip: ip })) === E.ARM_A) return ip; } })();
    const ipB = (() => { for (let i = 0; ; i++) { const ip = '192.0.2.' + i; if (E.armFor(E.callerId({ client_ip: ip })) === E.ARM_B) return ip; } })();
    const a = E.decide(r, { c: { client_ip: ipA }, args: { iso: 'PJM' }, facts, env });
    expect(a.arm).toBe('a'); expect(a.result).toBe(r);
    const b = E.decide(r, { c: { client_ip: ipB }, args: { iso: 'PJM' }, facts, env });
    expect(b.arm).toBe('b'); expect(askOf(b.result)).toBe(''); expect(JSON.stringify(b.result)).toContain('full PJM answer now');
    const c = { client_ip: ipB };
    for (const [f, e] of [[{ ...facts, emailAsk: 'key_line' }, env], [{ ...facts, emailAsk: 'digest_line' }, env],
      [{ ...facts, emailAsk: 'bind_field' }, env], [{ ...facts, emailAsk: '' }, env], [{ ...facts, skip: true }, env],
      [{ ...facts, walled: false }, env], [{ ...facts, paid: true }, env], [{ ...facts, hasEmail: true }, env],
      [{ ...facts, grok: true }, env], [facts, {}], [facts, { ...env, DCHUB_WALL_TO_KEY_V1: '1', DCHUB_W2K_EMAIL_ASK_ALL: '1' }]]) {
      const d = E.decide(r, { c, args: {}, facts: f, env: e });
      expect(d.arm, JSON.stringify(f) + JSON.stringify(e)).toBe(null);
      expect(d.result).toBe(r);
    }
    // one of the two W2K flags alone does not run its email-ask-all piece: the test still runs
    expect(E.decide(r, { c, args: {}, facts, env: { ...env, DCHUB_W2K_EMAIL_ASK_ALL: '1' } }).arm).toBe('b');
    // a keyed Grok caller is sticky by key: in the test
    expect(E.decide(r, { c: { api_key: 'dch_trial_' + 'x'.repeat(30) }, args: {}, facts: { ...facts, grok: true }, env }).arm).not.toBe(null);
  });
  it('withArmEvent and the email memo carry the arm to email_entered', () => {
    expect(E.withArmEvent({ event: 'quota_wall_hit' }, 'b')).toEqual({ event: 'quota_wall_hit', email_ask_ab: 'b' });
    const body = { event: 'quota_wall_hit' };
    expect(E.withArmEvent(body, null)).toBe(body);
    expect(E.withArmEvent(body, 'x')).toBe(body);
    const memo = createLastWallMemo();
    const c = { session_id: 'sess-email-ask-ab-1', client_ip: '198.51.100.9' };
    memo.note(c, { event: 'quota_wall_hit', tool: 'get_grid_intelligence', wall_status: 'preview', email_ask: 'line', email_ask_ab: 'b' });
    const e = emailEnteredEventBody({ c, path: 'claim_free_key', wall: memo.get(c) });
    expect(e.email_ask_ab).toBe('b');
    memo.note(c, { event: 'quota_wall_hit', tool: 'get_grid_intelligence', email_ask_ab: 'zzz' });
    expect(emailEnteredEventBody({ c, path: 'claim_free_key', wall: memo.get(c) }).email_ask_ab).toBeUndefined();
  });
});

describe('E3 copy check', () => {
  it('no price, plan, free, credits, trial or allowance in any arm-b line', () => {
    for (const s of ['', 'ERCOT', 'PJM', 'ISO-NE', 'Dallas', 'Northern Virginia']) {
      for (const t of ['get_api_key', 'bind_email']) {
        const l = E.armBLine(s, t);
        expect(BANNED.test(l), l).toBe(false);
        expect(l).not.toMatch(/\d/);
      }
    }
  });
});

const TOOLS = [
  ['get_interconnection_queue', { iso: 'PJM' }],
  ['get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }],
  ['get_energy_prices', { iso: 'PJM' }],
  ['rank_markets', {}],
];
describe('server.mjs _emailAskAbStep, through the handler', () => {
  it('flag OFF: no email_ask_ab on any wall row', async () => {
    setEnv(PROD);
    for (const [name, args] of TOOLS) {
      const r = await call(H, '/mcp', name, args, { ip: anyIp() });
      for (const e of r.rows) expect(e.email_ask_ab, name).toBeUndefined();
    }
  }, 180_000);

  it('arm a: byte-identical to the flag-off answer; "a" on the wall row', async () => {
    for (const [name, args] of TOOLS) {
      setEnv(PROD);
      const base = norm((await call(H, '/mcp', name, args, { ip: ipIn(E.ARM_A) })).result);
      setEnv(ON);
      const r = await call(H, '/mcp', name, args, { ip: ipIn(E.ARM_A) });
      expect(norm(r.result), name + firstDiff(norm(r.result), base)).toBe(base);
      expect(r.rows.length, name + ' wall row').toBeGreaterThan(0);
      for (const e of r.rows) expect(e.email_ask_ab, name).toBe('a');
    }
  }, 180_000);

  it('arm b: the flag-off answer with exactly the ask sentence swapped for the scoped line; "b" on the wall row', async () => {
    const want = { get_interconnection_queue: 'PJM', get_grid_intelligence: 'ERCOT', get_energy_prices: 'PJM', rank_markets: '' };
    for (const [name, args] of TOOLS) {
      setEnv(PROD);
      const b0 = (await call(H, '/mcp', name, args, { ip: ipIn(E.ARM_B) })).result;
      const ask = askOf(b0);
      expect(ask, name + ' carries a generic ask today').not.toBe('');
      setEnv(ON);
      const r = await call(H, '/mcp', name, args, { ip: ipIn(E.ARM_B) });
      const tool = E.findAsk(b0).m[1];
      // exactly one prose block differs from the flag-off answer, by exactly the ask sentence; JSON blocks and
      // structuredContent are untouched
      const swapped = E.withArmB(b0, want[name]);
      const diffBlocks = swapped.content.filter((x, i) => x !== b0.content[i]);
      expect(diffBlocks.length, name).toBe(1);
      expect(swapped.structuredContent).toBe(b0.structuredContent);
      const expected = norm(swapped);
      expect(norm(r.result), name + firstDiff(norm(r.result), expected)).toBe(expected);
      for (const e of r.rows) expect(e.email_ask_ab, name).toBe('b');
      expect(texts(r.result).join('\n')).toContain(E.armBLine(want[name], tool));
    }
  }, 180_000);

  it('/mcp/chatgpt and /mcp/claude: unchanged with the flag on, no arm recorded', async () => {
    for (const p of ['/mcp/chatgpt', '/mcp/claude']) {
      for (const [name, args] of TOOLS) {
        setEnv(PROD);
        const base = norm((await call(H, p, name, args, { ip: ipIn(E.ARM_B) })).result);
        setEnv(ON);
        const r = await call(H, p, name, args, { ip: ipIn(E.ARM_B) });
        expect(norm(r.result), p + ' ' + name + firstDiff(norm(r.result), base)).toBe(base);
        for (const e of r.rows) expect(e.email_ask_ab, p + ' ' + name).toBeUndefined();
      }
    }
  }, 180_000);

  it('no arm while mcp#1677 email-ask-all is on (both flags)', async () => {
    for (const [name, args] of TOOLS) {
      setEnv(PROD);
      const base = norm((await call(H, '/mcp', name, args, { ip: ipIn(E.ARM_B) })).result);
      setEnv({ ...ON, DCHUB_WALL_TO_KEY_V1: '1', DCHUB_W2K_EMAIL_ASK_ALL: '1' });
      const r = await call(H, '/mcp', name, args, { ip: ipIn(E.ARM_B) });
      expect(norm(r.result), name).toBe(base);
      for (const e of r.rows) expect(e.email_ask_ab, name).toBeUndefined();
    }
  }, 180_000);
});
