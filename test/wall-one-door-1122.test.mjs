// wall-one-door-1122.test.mjs — DCHUB_WALL_ONE_DOOR, the "one door" wall A/B (lib/wall-one-door.mjs, server.mjs
// _wallOneDoorStep; owner 2026-11-22 "Build it", DRAFT, flag OFF until the owner says so).
//
// Asserted through the real handler (backend stubbed, network fenced, an outside peer address, the git-ref sandbox of
// origin/main for byte identity), with the production wall flags on (identity v2, copy v2, relay everywhere, value
// first, licence block):
//   * flag OFF: every answer on /mcp, /mcp/claude and /mcp/chatgpt is origin/main's, byte for byte;
//   * flag ON, /mcp/claude and /mcp/chatgpt: origin/main's byte for byte;
//   * flag ON, /mcp, control arm: origin/main's byte for byte; 'control' on the track row and the wall row;
//   * flag ON, /mcp, one_door arm: origin/main's answer minus exactly the sign-in line, the "For your human" block and
//     the identity footer, with the relay link appended to the answer-first line; the in-chat email ask, the
//     value-first block, the JSON block and structuredContent unchanged; 'one_door' on the track row and the wall row;
//   * the split: ~50/50, stable per caller, independent of the paid-line split;
//   * never: a ChatGPT client, a gateway, the key tools, a non-trial key, a loopback step.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unsealPayload } from '../lib/token-seal.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import { SIGNIN_LINE } from '../lib/wall-identity-v2.mjs';
import { PREVIEW_FOOTER } from '../lib/dchub-identity.mjs';
import { ANSWER_FIRST_LEAD, ANSWER_FIRST_SKIP } from '../lib/claim-handoff.mjs';
import { FOR_HUMAN_LEAD } from '../lib/wall-relay-everywhere.mjs';
import * as WPL from '../lib/wall-paid-line.mjs';
import * as W from '../lib/wall-one-door.mjs';
import { createLastWallMemo, emailEnteredEventBody } from '../lib/email-entered.mjs';

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
const FLAGS = ['DCHUB_WALL_ONE_DOOR', 'DCHUB_WALL_RELAY_EVERYWHERE', 'DCHUB_WALL_VALUE_FIRST', 'DCHUB_LICENCE_BLOCK',
  'DCHUB_WALL_PAID_LINE', 'DCHUB_WALL_COPY_V2', 'DCHUB_WALL_IDENTITY_V2'];
const setEnv = (o) => { for (const k of FLAGS) { if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k]; } };
// The wall flags production runs with on 2026-11-22.
const PROD = { DCHUB_WALL_IDENTITY_V2: '1', DCHUB_WALL_COPY_V2: '1', DCHUB_WALL_RELAY_EVERYWHERE: '1',
  DCHUB_WALL_VALUE_FIRST: '1', DCHUB_LICENCE_BLOCK: '1', DCHUB_WALL_PAID_LINE: '1' };
const ON = { ...PROD, DCHUB_WALL_ONE_DOOR: '1' };
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
  SB = createGitRefSandbox(REPO, 'origin/main', 'wall-one-door-origin-main');
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
    if (W.oneDoorArm(W.oneDoorCallerId({ client_ip: ip })) === arm) return ip;
  }
}
function keyIn(arm) {
  for (;;) {
    const key = 'dch_trial_ODtest' + String(keySeq++).padStart(8, '0') + 'abcdefghijk';
    if (W.oneDoorArm(W.oneDoorCallerId({ api_key: key })) === arm) return key;
  }
}
const anyIp = () => `198.51.${200 + Math.floor(ipSeq / 250) % 50}.${ipSeq++ % 250 + 1}`;

// ── the pure transform, on the live layout read 2026-11-22 (QA probe, keyless get_interconnection_queue PJM) ─────────
const LIVE = () => ({
  content: [
    { type: 'text', text: 'PJM queued generation 312 GW (as of 2026-11-21).\nWithheld here: project rows.\nSee the full answer: ' + SHORT },
    { type: 'text', text: JSON.stringify({ human_url: SHORT, note: SIGNIN_LINE, user_message: ANSWER_FIRST_LEAD + 'x' }) },
    { type: 'text', text: ANSWER_FIRST_LEAD + 'PJM queued generation 312 GW (as of 2026-11-21), across 25 active projects.' + ANSWER_FIRST_SKIP },
    { type: 'text', text: SIGNIN_LINE },
    { type: 'text', text: '0 of 25 projects shown.' },
    { type: 'text', text: 'Ask your user for their email, then call `get_api_key`.' },
    { type: 'text', text: FOR_HUMAN_LEAD + 'Your user can see the full answer here: ' + SHORT },
    { type: 'text', text: 'Capacity Source: listings at https://dchub.cloud/listings' },
    { type: 'text', text: 'Source: DC Hub (dchub.cloud/grid/pjm)' },
    { type: 'text', text: PREVIEW_FOOTER.replace('dchub.cloud/connect', 'https://dchub.cloud/mcp/connect') },
  ],
  structuredContent: { human_url: SHORT, next_ask: { tool: 'get_api_key' } },
});

describe('lib/wall-one-door.mjs: the transform', () => {
  it('drops exactly the sign-in, "For your human" and footer blocks; the link joins the answer-first sentence', () => {
    const before = LIVE();
    const out = W.withOneDoor(before, SHORT);
    const t = texts(out);
    expect(t).toHaveLength(7);
    expect(t[0]).toBe(before.content[0].text);
    expect(t[1]).toBe(before.content[1].text);   // the JSON block is never edited, even where it repeats a line
    expect(t[2]).toBe(ANSWER_FIRST_LEAD + 'PJM queued generation 312 GW (as of 2026-11-21), across 25 active projects.'
      + W.LINK_LEAD + SHORT + ANSWER_FIRST_SKIP);
    expect(t.slice(3)).toEqual([before.content[4].text, before.content[5].text, before.content[7].text, before.content[8].text]);
    expect(out.structuredContent).toBe(before.structuredContent);
    expect(t.filter((x) => !isJson(x)).some((x) => x.includes(SIGNIN_LINE) || x.startsWith(FOR_HUMAN_LEAD) || x.startsWith('DC Hub: the orchestration'))).toBe(false);
    expect(t.filter((x) => x.includes('get_api_key'))).toHaveLength(1);
  });
  it('the footer as built (before the v2 rewrite) goes too', () => {
    const b = LIVE(); b.content[9] = { type: 'text', text: PREVIEW_FOOTER };
    expect(texts(W.withOneDoor(b, SHORT)).some((x) => x.includes('orchestration layer'))).toBe(false);
  });
  it('no skip clause: the link ends the answer-first line, before any later line in the block', () => {
    const b = LIVE(); b.content[2] = { type: 'text', text: ANSWER_FIRST_LEAD + 'ERCOT demand 61,000 MW.\nAsk your user for their email.' };
    expect(texts(W.withOneDoor(b, SHORT))[2]).toBe(ANSWER_FIRST_LEAD + 'ERCOT demand 61,000 MW.' + W.LINK_LEAD + SHORT + '\nAsk your user for their email.');
  });
  it('a sign-in line sharing a block with other text: only the line goes', () => {
    const b = LIVE(); b.content[3] = { type: 'text', text: 'Keep this.\n\n' + SIGNIN_LINE };
    expect(texts(W.withOneDoor(b, SHORT))).toContain('Keep this.');
  });
  it('no answer-first line, no link, a bad link or not a content result: unchanged (same object)', () => {
    const b = LIVE(); b.content.splice(2, 1);
    expect(W.withOneDoor(b, SHORT)).toBe(b);
    const l = LIVE();
    for (const bad of ['', null, 'http://dchub.cloud/u/x', 'not a url', 'https://dchub.cloud/u/a b']) expect(W.withOneDoor(l, bad)).toBe(l);
    for (const r of [null, {}, { content: [] }, { content: 'x' }]) expect(W.withOneDoor(r, SHORT)).toBe(r);
  });
  it('never the link twice; idempotent', () => {
    const once = W.withOneDoor(LIVE(), SHORT);
    expect(W.withOneDoor(once, SHORT)).toEqual(once);
    expect(texts(once)[2].split(SHORT).length - 1).toBe(1);
  });
  it('switch: off unless 1 / true / yes / on', () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'no', '2']) expect(W.wallOneDoorOn({ DCHUB_WALL_ONE_DOOR: v })).toBe(false);
    for (const v of ['1', 'true', 'yes', 'on', ' ON ']) expect(W.wallOneDoorOn({ DCHUB_WALL_ONE_DOOR: v })).toBe(true);
  });
});

describe('lib/wall-one-door.mjs: the split and telemetry', () => {
  it('about 50/50 over 20,000 callers, stable per caller, independent of the paid-line split', () => {
    let od = 0, both = 0;
    for (let i = 0; i < 20000; i++) {
      const id = W.oneDoorCallerId({ client_ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` });
      const a = W.oneDoorArm(id);
      expect(W.isOneDoorArm(a)).toBe(true);
      if (i % 997 === 0) expect(W.oneDoorArm(id)).toBe(a);
      if (a === W.ARM_ONE_DOOR) od += 1;
      if (a === W.ARM_ONE_DOOR && WPL.paidLineArm(id) === WPL.ARM_PAID_LINE) both += 1;
    }
    expect(od / 20000).toBeGreaterThan(0.48);
    expect(od / 20000).toBeLessThan(0.52);
    expect(both / 20000).toBeGreaterThan(0.23);   // independent salts: about a quarter in both treated halves
    expect(both / 20000).toBeLessThan(0.27);
    expect(W.oneDoorArm('')).toBe(null);
  });
  it('the arm on the wall row and the held track rows (first key); no arm = untouched', () => {
    const body = { event: 'quota_wall_hit', tool: 'x' };
    expect(W.withArmEvent(body, W.ARM_ONE_DOOR)).toEqual({ ...body, wall_one_door: 'one_door' });
    expect(W.withArmEvent(body, null)).toBe(body);
    expect(W.withArmEvent(body, 'paid_line')).toBe(body);
    const c = { _heldTrackRows: [{ row: { tool: 'x', params: { a: 1 } }, sent: false }, { row: { tool: 'y', params: {} }, sent: false }] };
    expect(W.markHeldTrackRows(c, 'x', W.ARM_CONTROL)).toBe(1);
    expect(Object.keys(c._heldTrackRows[0].row.params)).toEqual(['_wall_one_door', 'a']);
    expect(c._heldTrackRows[1].row.params).toEqual({});
    expect(W.markHeldTrackRows(c, 'x', null)).toBe(0);
  });
  it('the parked wall row (the one that leaves with the relay link hash) is marked too', () => {
    const c = { _pendingWallTracks: [{ payload: { tool: 'x', status: 'anon_daily_cap', params: { a: 1 } }, sent: false },
      { payload: { tool: 'x', params: {} }, sent: true }] };
    expect(W.markHeldTrackRows(c, 'x', W.ARM_ONE_DOOR)).toBe(1);
    expect(Object.keys(c._pendingWallTracks[0].payload.params)).toEqual(['_wall_one_door', 'a']);
    expect(c._pendingWallTracks[0].payload.status).toBe('anon_daily_cap');
    expect(c._pendingWallTracks[1].payload.params).toEqual({});
  });
  it('an email entered after an arm wall carries that arm (matched by IP, no session); none without one', () => {
    const memo = createLastWallMemo();
    const c = { client_ip: '198.51.100.9' };
    memo.note(c, { event: 'quota_wall_hit', tool: 'get_interconnection_queue', wall_status: 'anon_daily_cap', wall_one_door: 'one_door' });
    expect(emailEnteredEventBody({ c, path: 'claim_free_key', wall: memo.get(c) }).wall_one_door).toBe('one_door');
    const c2 = { client_ip: '198.51.100.10' };
    memo.note(c2, { event: 'quota_wall_hit', tool: 'get_interconnection_queue', wall_one_door: 'bogus' });
    expect('wall_one_door' in emailEnteredEventBody({ c: c2, path: 'claim_free_key', wall: memo.get(c2) })).toBe(false);
    expect('wall_one_door' in emailEnteredEventBody({ c: { client_ip: '10.0.0.1' }, path: 'claim_free_key', wall: null })).toBe(false);
  });
});

// ── through the real handler ──────────────────────────────────────────────────────────────────────────────────────
const TOOLS = [
  ['get_interconnection_queue', { iso: 'PJM' }],
  ['get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }],
  ['execute_plan', { intent: 'compare PJM vs ERCOT grid headroom and interconnection queue', market: 'dallas' }],
];

describe('server.mjs _wallOneDoorStep, through the handler', () => {
  it('flag OFF: /mcp, /mcp/claude and /mcp/chatgpt answers are origin/main\'s byte for byte (production wall flags on)', async () => {
    // No origin/main (CI's shallow checkout): nothing to compare against; the tests below use this branch, flag off.
    if (!O) { console.warn(`[wall-one-door] skipped the origin/main comparison: ${why}`); return; }
    setEnv(PROD);
    for (const p of ['/mcp', '/mcp/claude', '/mcp/chatgpt']) {
      for (const [name, args] of TOOLS) {
        const ip = anyIp();
        const a = norm((await call(H, p, name, args, { ip })).result);
        const b = norm((await call(O, p, name, args, { ip })).result);
        expect(a, `${p} ${name}${firstDiff(a, b)}`).toBe(b);
      }
    }
  }, 180_000);

  it('flag ON, /mcp/claude and /mcp/chatgpt: origin/main\'s byte for byte', async () => {
    // The baseline: origin/main, or (no origin/main) this branch with the flag off, called from a fresh caller of the
    // same arm (a second call from one caller on one server would see that caller's own state).
    const B = O || H;
    const bIp = (ip, arm) => (O ? ip : ipIn(arm));
    for (const p of ['/mcp/claude', '/mcp/chatgpt']) {
      for (const [name, args] of TOOLS) {
        const ip = ipIn(W.ARM_ONE_DOOR);
        setEnv(ON);
        const a = norm((await call(H, p, name, args, { ip })).result);
        setEnv(PROD);
        const b = norm((await call(B, p, name, args, { ip: bIp(ip, W.ARM_ONE_DOOR) })).result);
        expect(a, `${p} ${name}${firstDiff(a, b)}`).toBe(b);
      }
    }
  }, 180_000);

  it('flag ON, control arm: origin/main\'s byte for byte; "control" on the track row and the wall row', async () => {
    // The baseline: origin/main, or (no origin/main) this branch with the flag off, called from a fresh caller of the
    // same arm (a second call from one caller on one server would see that caller's own state).
    const B = O || H;
    const bIp = (ip, arm) => (O ? ip : ipIn(arm));
    for (const [name, args] of TOOLS) {
      const ip = ipIn(W.ARM_CONTROL);
      setEnv(ON);
      const r = await call(H, '/mcp', name, args, { ip });
      setEnv(PROD);
      const b = norm((await call(B, '/mcp', name, args, { ip: bIp(ip, W.ARM_CONTROL) })).result);
      expect(norm(r.result), `${name}${firstDiff(norm(r.result), b)}`).toBe(b);
      expect(r.rows.length, name + ' wall row').toBeGreaterThan(0);
      for (const e of r.rows) expect(e.wall_one_door, name).toBe('control');
      expect(r.tracks.length, name + ' track row').toBeGreaterThan(0);
      for (const t of r.tracks) expect(t.params._wall_one_door, name + ' every track row of the call').toBe('control');
    }
  }, 180_000);

  it('flag ON, one_door arm: main minus exactly the three doors, the link in the answer-first line; "one_door" recorded', async () => {
    // The baseline: origin/main, or (no origin/main) this branch with the flag off, called from a fresh caller of the
    // same arm (a second call from one caller on one server would see that caller's own state).
    const B = O || H;
    const bIp = (ip, arm) => (O ? ip : ipIn(arm));
    let moved = 0, linked = 0;
    for (const [name, args] of TOOLS) {
      const ip = ipIn(W.ARM_ONE_DOOR);
      setEnv(ON);
      const r = await call(H, '/mcp', name, args, { ip });
      setEnv(PROD);
      const main = (await call(B, '/mcp', name, args, { ip: bIp(ip, W.ARM_ONE_DOOR) })).result;
      // The handler's answer is the transform of main's answer: nothing else differs.
      const want = norm(W.withOneDoor(main, SHORT));
      expect(norm(r.result), `${name}${firstDiff(norm(r.result), want)}`).toBe(want);
      expect(norm(r.result.structuredContent)).toBe(norm(main.structuredContent));
      const t = texts(r.result).filter((x) => !isJson(x));
      if (texts(main).some((x) => !isJson(x) && x.includes(ANSWER_FIRST_LEAD))) {
        moved += 1;
        expect(t.some((x) => x.includes(SIGNIN_LINE) || x.startsWith(FOR_HUMAN_LEAD) || x.startsWith('DC Hub: the orchestration')), name).toBe(false);
        expect(t.find((x) => x.includes(ANSWER_FIRST_LEAD)), name).toContain(W.LINK_LEAD + SHORT);
        expect(t[0], name + ' value-first block keeps its link').toContain(SHORT);
      }
      expect(r.rows.length, name + ' wall row').toBeGreaterThan(0);
      for (const e of r.rows) expect(e.wall_one_door, name).toBe('one_door');
      expect(r.tracks.length, name + ' track row').toBeGreaterThan(0);
      for (const t of r.tracks) expect(t.params._wall_one_door, name + ' every track row of the call').toBe('one_door');
      if (r.tracks.some((t) => t.wall_link_th)) linked += 1;
    }
    expect(moved, 'at least one acceptance tool carries an answer-first line').toBeGreaterThan(0);
    expect(linked, 'a wall track row with the relay link hash carries the arm (the relay-open join)').toBeGreaterThan(0);
  }, 180_000);

  it('a trial key is split by its key; the same caller gets the same arm on every call', async () => {
    setEnv(ON);
    for (const arm of W.ONE_DOOR_ARMS) {
      const key = keyIn(arm);
      for (let k = 0; k < 2; k++) {
        const r = await call(H, '/mcp', 'get_interconnection_queue', { iso: 'PJM' }, { ip: anyIp(), key });
        for (const e of r.rows) expect(e.wall_one_door).toBe(arm);
      }
    }
  }, 120_000);

  it('never: a ChatGPT client, a gateway, the key tool (no arm, nothing recorded)', async () => {
    setEnv(ON);
    for (const ua of ['openai-mcp/1.0', 'pipeworx-gateway/2.1']) {
      const r = await call(H, '/mcp', 'get_interconnection_queue', { iso: 'PJM' }, { ip: ipIn(W.ARM_ONE_DOOR), ua });
      for (const e of r.rows) expect(e.wall_one_door, ua).toBeUndefined();
      for (const t of r.tracks) expect((t.params || {})._wall_one_door, ua).toBeUndefined();
    }
    const k = await call(H, '/mcp', 'get_api_key', { email: 'qa@example.com' }, { ip: ipIn(W.ARM_ONE_DOOR) });
    for (const t of k.tracks) expect((t.params || {})._wall_one_door).toBeUndefined();
  }, 120_000);
});
