// wall-to-key-1122.test.mjs: "wall -> signed-in key" (Brain spec 2026-11-22; lib/wall-to-key.mjs, server.mjs
// _wallToKeyStep). Every piece is behind DCHUB_WALL_TO_KEY_V1 plus its own sub-flag, all default OFF.
//
// Through the real handler (backend stubbed, network fenced, outside peer, origin/main sandbox for byte identity) with
// the production wall flags on:
//   * acceptance 1: flags OFF -> search_facilities, get_facility, get_grid_intelligence answers are origin/main's byte for
//     byte; the master flag alone (no sub-flag) changes nothing either;
//   * acceptance 3: SIGNIN_URL on, treatment arm -> sign_in_url equals the human link and the answer carries no new link;
//   * acceptance 2: EMAIL_ASK_ALL on, treatment arm -> search_facilities / get_facility carry email_ask and a
//     human_message naming what the email opens (or keeps); none is "licence, not an email" alone;
//   * control arm: origin/main's answer, arm 'control' on the wall event;
//   * acceptance 6: LEAN_KEY_TOOLS on -> the light list (coding CLI on /mcp, /mcp/light) lists get_api_key + recover_my_key;
//   * acceptance 7: no "free", "$", or plan name in any string this module adds.
// Pure units cover 3.3 (once per session, dch_live_ only, session_restore only) and 3.4 (once per session, 7-day quiet
// after a decline, never without the capability or on a non-user call).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unsealPayload } from '../lib/token-seal.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import * as W from '../lib/wall-to-key.mjs';
import { LIGHT_TOOLS_LIST_MAX_BYTES } from '../lib/light-profile.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHORT = 'https://dchub.cloud/u/abcdef';
let H, O, SB, fence, why = '';
const RESTORE_KEY = 'dch_live_w2kRestoredKey0123456789';
const RESTORE = { on: false };
const HARNESS_PLANTED_KEY = 'dch_live_PLANTEDlivekey0123456789';
const events = [];
const routes = () => (p, _req, body) => {
  if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
  if (p === '/api/v1/mcp/track') return { ok: true };
  if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
  if (p === '/api/v1/relay/short') return { ok: true, url: SHORT };
  if (p === '/api/v1/relay/teaser') return { ok: true };
  if (p === '/api/v1/mcp/session-key' && RESTORE.on) return { api_key: RESTORE_KEY };
  if (p === '/api/v1/keys/validate' && body && body.api_key === RESTORE_KEY) {
    return { valid: true, tier: 'identified', developer_id: 'dev_w2k_test', email: null, tier_detail: { users_plan: null } };
  }
  return undefined;
};
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
const W2K = ['DCHUB_WALL_TO_KEY_V1', ...Object.values(W.SUB_FLAGS)];
const FLAGS = ['DCHUB_WALL_ONE_DOOR', 'DCHUB_WALL_RELAY_EVERYWHERE', 'DCHUB_WALL_VALUE_FIRST', 'DCHUB_LICENCE_BLOCK',
  'DCHUB_WALL_PAID_LINE', 'DCHUB_WALL_COPY_V2', 'DCHUB_WALL_IDENTITY_V2', ...W2K];
const setEnv = (o) => { for (const k of FLAGS) { if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k]; } };
const PROD = { DCHUB_WALL_IDENTITY_V2: '1', DCHUB_WALL_COPY_V2: '1', DCHUB_WALL_RELAY_EVERYWHERE: '1',
  DCHUB_WALL_VALUE_FIRST: '1', DCHUB_LICENCE_BLOCK: '1', DCHUB_WALL_PAID_LINE: '1' };
const ALL = { ...PROD, DCHUB_WALL_TO_KEY_V1: '1', ...Object.fromEntries(Object.values(W.SUB_FLAGS).map((f) => [f, '1'])) };

beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.42' };
    return p;
  };
  fence = fenceNetwork();
  const env = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_KEYLESS_FIRST_FULL: '0', DCHUB_ANON_DAILY_CAP: '20' };
  setEnv({});
  H = await startHarness({ env, extraRoutes: routes() });
  SERVER_PORTS.add(H.PORT);
  SB = createGitRefSandbox(REPO, 'origin/main', 'wall-to-key-origin-main');
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
afterEach(() => { setEnv({}); W._resetForTests(); });

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
async function call(h, name, args, { ip, ua = 'cursor/1.0', p = '/mcp', headers = {} } = {}) {
  const e0 = events.length;
  const r = await rpc(h, p, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } },
    { 'x-dc-client-ip': ip, 'user-agent': ua, ...headers });
  await new Promise((res) => setTimeout(res, 150));
  return { result: r.msg && r.msg.result, rows: events.slice(e0) };
}
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
let ipSeq = 1;
function ipIn(a) {
  for (;;) {
    const ip = `198.18.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250 + 1}`;
    if (W.arm(W.armCallerId({ client_ip: ip })) === a) return ip;
  }
}
const CASES = [
  ['search_facilities', { state: 'VA' }],
  ['get_facility', { facility_id: 'equinix-dc1' }],
  ['get_grid_intelligence', { iso: 'PJM' }],
];

describe('wall to key: flags OFF and the master flag alone are byte-identical to origin/main', () => {
  for (const [name, args] of CASES) {
    for (const [label, env] of [['all off', PROD], ['master only', { ...PROD, DCHUB_WALL_TO_KEY_V1: '1' }],
      ['sub-flags without master', { ...PROD, ...Object.fromEntries(Object.values(W.SUB_FLAGS).map((f) => [f, '1'])) }]]) {
      it(`${name}, ${label}`, async () => {
        if (!O) return console.warn('skip:', why);
        setEnv(env);
        const ip = ipIn(W.ARM_TREATMENT);
        const a = await call(H, name, args, { ip });
        W._resetForTests();
        const b = await call(O, name, args, { ip });
        const x = norm(a.result), y = norm(b.result);
        expect(x === y, firstDiff(x, y)).toBe(true);
        expect(a.rows.some((r) => Object.prototype.hasOwnProperty.call(r, W.EVENT_FIELD))).toBe(false);
      }, 60_000);
    }
  }
});

describe('wall to key: control arm', () => {
  it('every flag on, control arm: origin/main answer, arm recorded on the wall event', async () => {
    if (!O) return console.warn('skip:', why);
    for (const [name, args] of CASES.slice(0, 2)) {
      const ip = ipIn(W.ARM_CONTROL);
      setEnv(ALL);
      const a = await call(H, name, args, { ip });
      setEnv(PROD);
      const b = await call(O, name, args, { ip });
      // COPY_NEUTRAL is not armed: strip preview_only (its one addition) before comparing.
      const strip = (r) => JSON.parse(JSON.stringify(r).replace(/,?\\?"preview_only\\?":(true|false)/g, ''));
      const x = norm(strip(a.result)), y = norm(b.result);
      expect(x === y, name + firstDiff(x, y)).toBe(true);
      if (a.rows.length) expect(a.rows.every((r) => r[W.EVENT_FIELD] === W.ARM_CONTROL)).toBe(true);
    }
  }, 60_000);
});

describe('wall to key: treatment arm', () => {
  it('sign_in_url is the wall\'s own human link, mirrored in for_your_human, and no new link appears', async () => {
    if (!O) return console.warn('skip:', why);
    let checked = 0, armed = 0;
    for (const [name, args] of CASES) {
      const ip = ipIn(W.ARM_TREATMENT);
      setEnv({ ...PROD, DCHUB_WALL_TO_KEY_V1: '1', [W.SUB_FLAGS.SIGNIN_URL]: '1' });
      const a = await call(H, name, args, { ip });
      setEnv(PROD);
      const b = await call(O, name, args, { ip });
      const sc = a.result.structuredContent || {};
      const link = W.humanLinkOf(a.result);
      if (!link) continue;   // an answer with no human link gets no sign_in_url
      expect(sc.sign_in_url, name).toBe(link);
      expect(sc.for_your_human.url).toBe(link);
      expect(sc.for_your_human.render).toBe(W.RENDER_VERBATIM);
      const before = new Set(W.linksIn(b.result).map((u) => u.replace(/\/upgrade\/h\/[^?]+/, '/upgrade/h/X')));
      const added = W.linksIn(a.result).map((u) => u.replace(/\/upgrade\/h\/[^?]+/, '/upgrade/h/X')).filter((u) => !before.has(u));
      expect(added, name).toEqual([]);
      expect(a.rows.every((r) => r[W.EVENT_FIELD] === W.ARM_TREATMENT)).toBe(true);
      if (a.rows.length) armed += 1;
      checked += 1;
    }
    expect(checked).toBe(CASES.length);
    expect(armed).toBeGreaterThan(0);
  }, 60_000);
  it('the licence-only walls carry email_ask and a human_message that says what the email opens or keeps', async () => {
    if (!O) return console.warn('skip:', why);
    for (const [name, args] of CASES.slice(0, 2)) {
      setEnv({ ...PROD, DCHUB_WALL_TO_KEY_V1: '1', [W.SUB_FLAGS.EMAIL_ASK_ALL]: '1' });
      const a = await call(H, name, args, { ip: ipIn(W.ARM_TREATMENT) });
      const sc = a.result.structuredContent || {};
      expect(sc.email_ask, name).toEqual(W.EMAIL_ASK);
      expect(sc.human_message, name).toMatch(/^Your AI assistant got a preview of /);
      expect(sc.human_message, name).toMatch(/Add your email on this page to (open|keep) /);
      const all = JSON.stringify(a.result);
      expect(all, name).not.toMatch(/licence, not with an email/);
    }
  }, 60_000);
});

describe('wall to key 3.3: the key handed back is masked, never raw (Grok 11-22 item 4c)', () => {
  it('a restored dch_live_ key: every tool answer names it masked and never carries the full key', async () => {
    setEnv(ALL);
    RESTORE.on = true;
    try {
      let issued = 0;
      for (const [name, args] of CASES) {
        const ip = ipIn(W.ARM_TREATMENT);
        const { result } = await call(H, name, args, { ip, headers: { 'mcp-session-id': 'w2k-restore-' + name } });
        expect(result, name).toBeTruthy();
        const raw = JSON.stringify(result);
        expect(raw, name).not.toContain(RESTORE_KEY);
        // The harness backend plants its own dch_live_ key in the DATA body (a pass-through probe other suites own; the
        // default /mcp profile echoes it on origin/main too). Only that exact planted value is set aside; any other full
        // key, the restored one above included, fails.
        expect(raw.split(HARNESS_PLANTED_KEY).join(''), name).not.toMatch(W.RAW_KEY_RE);
        if (result.structuredContent && result.structuredContent.api_key_issued) {
          issued++;
          expect(result.structuredContent.api_key_issued.api_key_masked).toBe('dch_live_…6789');
          expect(raw).toContain('recover_my_key');
        }
      }
      // Not vacuous: the restore really happened and 3.3 really fired on at least one answer.
      expect(issued).toBeGreaterThan(0);
    } finally { RESTORE.on = false; }
  });
});

describe('wall to key 3.5: key tools on the light list', () => {
  const list = (h, p, ua) => rpc(h, p, { jsonrpc: '2.0', id: rid++, method: 'tools/list', params: {} }, { 'user-agent': ua });
  it('flag on: /mcp for a coding CLI and /mcp/light list get_api_key and recover_my_key; flag off: unchanged', async () => {
    for (const [p, ua] of [['/mcp', 'opencode/1.0.0/cli'], ['/mcp', 'codex-mcp-client/0.40'], ['/mcp/light', 'cursor/1.0']]) {
      setEnv({});
      const off = (await list(H, p, ua)).msg.result.tools.map((t) => t.name);
      setEnv({ DCHUB_WALL_TO_KEY_V1: '1', [W.SUB_FLAGS.LEAN_KEY_TOOLS]: '1' });
      const onRes = (await list(H, p, ua)).msg.result;
      const on = onRes.tools.map((t) => t.name);
      expect(JSON.stringify(onRes).length).toBeLessThan(LIGHT_TOOLS_LIST_MAX_BYTES);
      expect(off.includes('get_api_key'), p + ua).toBe(false);
      expect(on.slice(0, off.length)).toEqual(off);
      expect(on.slice(off.length)).toEqual(['get_api_key', 'recover_my_key']);
    }
  }, 60_000);
});

describe('lib/wall-to-key.mjs units', () => {
  it('flags: master AND sub, truthy words only', () => {
    expect(W.subOn('SIGNIN_URL', {})).toBe(false);
    expect(W.subOn('SIGNIN_URL', { DCHUB_WALL_TO_KEY_V1: '1' })).toBe(false);
    expect(W.subOn('SIGNIN_URL', { DCHUB_W2K_SIGNIN_URL: '1' })).toBe(false);
    expect(W.subOn('SIGNIN_URL', { DCHUB_WALL_TO_KEY_V1: 'on', DCHUB_W2K_SIGNIN_URL: 'yes' })).toBe(true);
    expect(W.subOn('SIGNIN_URL', { DCHUB_WALL_TO_KEY_V1: '1', DCHUB_W2K_SIGNIN_URL: '0' })).toBe(false);
    expect(W.subOn('NOPE', { DCHUB_WALL_TO_KEY_V1: '1' })).toBe(false);
  });
  it('arm: stable, ~50/50, follows DCHUB_W2K_TREATMENT_PCT, keyed on the keyless identity not the key', () => {
    let t = 0;
    for (let i = 0; i < 4000; i++) if (W.arm('id-' + i) === W.ARM_TREATMENT) t++;
    expect(t / 4000).toBeGreaterThan(0.45);
    expect(t / 4000).toBeLessThan(0.55);
    expect(W.arm('x')).toBe(W.arm('x'));
    expect(W.arm('x', { DCHUB_W2K_TREATMENT_PCT: '0' })).toBe(W.ARM_CONTROL);
    expect(W.arm('x', { DCHUB_W2K_TREATMENT_PCT: '100' })).toBe(W.ARM_TREATMENT);
    expect(W.arm('')).toBe(null);
    expect(W.armCallerId({ client_ip: '198.18.0.9', api_key: 'dch_live_a' })).toBe(W.armCallerId({ client_ip: '198.18.0.9' }));
  });
  it('3.3: once per session, only a restored dch_live_ key', () => {
    const c = { session_id: 's-1', auth_source: 'session_restore', api_key: 'dch_live_abc' };
    expect(W.shouldIssue(c)).toBe(true);
    W.markIssued(c);
    expect(W.shouldIssue(c)).toBe(false);
    expect(W.shouldIssue({ ...c, session_id: 's-2', auth_source: 'header' })).toBe(false);
    expect(W.shouldIssue({ ...c, session_id: 's-3', api_key: 'dch_trial_x' })).toBe(false);
    expect(W.shouldIssue({ ...c, session_id: 'no-session' })).toBe(false);
    const r = W.withKeyIssued({ content: [{ type: 'text', text: '{}' }], structuredContent: { a: 1 } },
      W.keyIssuedBlock(RESTORE_KEY));
    expect(r.structuredContent.api_key_issued).toEqual({ api_key_masked: 'dch_live_…6789', retrieve: W.RETRIEVE,
      retrieve_note: W.RETRIEVE_LINE, note: W.SAVE_LINE });
    expect(JSON.stringify(r)).not.toContain(RESTORE_KEY);
    expect(JSON.stringify(r)).not.toMatch(W.RAW_KEY_RE);
    expect(W.keyIssuedBlock('dch_live_ab')).toBe(null);   // too short to mask safely: no block at all
    expect(r.content.at(-1).text).toContain(W.SAVE_LINE);
  });
  it('3.4: one ask per session, needs the capability and a user call, 7 quiet days after a decline', () => {
    const caps = { elicitation: {} };
    expect(W.elicitDue({ sid: 'a', id: 'i', caps: null })).toBe(false);
    expect(W.elicitDue({ sid: 'a', id: 'i', caps, userCall: false })).toBe(false);
    expect(W.elicitDue({ sid: 'a', id: 'i', caps })).toBe(true);
    W.markElicited('a');
    expect(W.elicitDue({ sid: 'a', id: 'i', caps })).toBe(false);
    W.markDeclined('i', 1000);
    expect(W.elicitDue({ sid: 'b', id: 'i', caps, now: 1000 + W.DECLINE_QUIET_MS - 1 })).toBe(false);
    expect(W.elicitDue({ sid: 'b', id: 'i', caps, now: 1000 + W.DECLINE_QUIET_MS + 1 })).toBe(true);
    expect(W.acceptedEmail({ action: 'accept', content: { email: 'a@b.co' } })).toBe('a@b.co');
    expect(W.acceptedEmail({ action: 'decline' })).toBe('');
    expect(W.acceptedEmail({ action: 'accept', content: { email: 'nope' } })).toBe('');
  });
  it('3.6: neutral access words, preview_only beside the old key', () => {
    expect(W.neutralAccess('free')).toBe('open');
    expect(W.neutralAccess('free_preview')).toBe('preview');
    expect(W.neutralAccess('paid')).toBe('keyed');
    expect(W.neutralAccess('metered')).toBe('keyed');
    const r = W.withNeutralPreviewKey({ content: [{ type: 'text', text: '{"free_preview_only":true}' }], structuredContent: { free_preview_only: true } });
    expect(r.structuredContent).toEqual({ free_preview_only: true, preview_only: true });
    expect(JSON.parse(r.content[0].text).preview_only).toBe(true);
  });
  it('acceptance 7: no "free", "$", plan name or competitor in any line this module adds', () => {
    const lines = [W.ELICIT_MESSAGE, W.SAVE_LINE, W.KEEP_LINE, W.KEEPS,
      ...Object.keys(W.EMAIL_OPENS).flatMap((t) => [W.emailAskMessage({ tool: t, opens: W.EMAIL_OPENS[t], link: SHORT, sessionBound: true }),
        W.emailAskMessage({ tool: t, opens: '', link: SHORT })]),
      ...Object.values(W.EMAIL_OPENS)];
    for (const l of lines) {
      expect(l).not.toMatch(/\bfree\b|\$|\b(?:pro|developer|enterprise|starter|plan)\b/i);
    }
    expect(W.emailAskMessage({ tool: 'get_facility', opens: '', link: SHORT })).not.toMatch(/^.*licence, not with an email/);
  });
});
