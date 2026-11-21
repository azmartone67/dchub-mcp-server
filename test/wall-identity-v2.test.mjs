// wall-identity-v2.test.mjs — DCHUB_WALL_IDENTITY_V2 (lib/wall-identity-v2.mjs, server.mjs _wallIdentityV2Step).
//
// Measured on main 2026-11-20 with the real /mcp handler (this file's harness, WorkOS validation on): no keyless or
// trial-key wall of get_grid_intelligence, get_interconnection_queue or execute_plan named https://dchub.cloud/mcp/oauth,
// and no wall row's offers_shown carried 'oauth_signin' (one route per wall drops the sign-in whenever the floor is
// eligible; execute_plan's neutral CTA step rewrites the URL to /connect).
//
// Rules asserted, through the real handler (backend stubbed, network fenced, an outside peer address):
//   * flag ON, /mcp keyless and trial-key, each of the three tools: the walled answer carries the sign-in line exactly
//     once (execute_plan: one line on the plan answer), and every wall row the call posts names 'oauth_signin';
//   * flag ON, the wall's email ask reads the V2 copy with the call's market, and its structured email_ask names
//     get_api_key with that market;
//   * flag OFF (unset, and '0'): every answer is byte-identical to origin/main's (git-ref sandbox), keyless and trial;
//   * /mcp/chatgpt: byte-identical to origin/main with the flag ON;
//   * no price, plan name or allowance figure in any new wall text;
//   * /mcp answers a keyless initialize with 200 (never 401) with the flag ON;
//   * not for a caller signed in or with an email on file, Grok, a plan step, the key tools; once per (session, tool).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import { OAUTH_SIGNIN_RE } from '../lib/wall-oauth-lead.mjs';
import { wallIdentityV2On, SIGNIN_LINE, emailAskLine, emailAskCall, wallMarketFrom, withSignInLine, withEmailAsk,
  signInEligible, EMAIL_ASK_LEAD } from '../lib/wall-identity-v2.mjs';
import { BANNED_WORDING } from '../lib/keyless-plan-wording.mjs';
import { offersShown } from '../lib/offers-shown.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TRIAL = 'dch_trial_V2testKEY0123456789abcdef';
const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i, score: 50 + i }));
// No price, no plan name, no allowance figure (owner rule: agent-facing text names no plans and no prices).
const NO_PRICE = /\$|\bper month\b|\/mo\b|\b(?:pro|developer|starter|enterprise|credit pack)\b|\b\d[\d,]*\s+(?:MCP\s+)?(?:calls?|full answers?|answers?|credits?)\b|\bfree\b/i;

let H, O, SB, S, fence, why = '', anonCount = 999;
const events = [];
const routes = () => (p, _req, body) => {
  if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
  if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
  if (p === '/api/v1/keys/validate' && body && typeof body.api_key === 'string' && body.api_key.startsWith('dch_trial_V2')) return { valid: true, tier: 'trial', email: null, tier_detail: { users_plan: null } };
  if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
  if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
  return { success: true, count: 12, total_count: 12, data: ROWS, results: ROWS, items: ROWS, markets: ROWS, rows: ROWS };
};
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.11' };
    return p;
  };
  fence = fenceNetwork();
  const env = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_KEYLESS_FIRST_FULL: '0', DCHUB_ANON_DAILY_CAP: '20',
    DCHUB_WORKOS_OAUTH_ENABLED: '1' };
  delete process.env.DCHUB_WALL_IDENTITY_V2;
  H = await startHarness({ env, extraRoutes: routes() });
  SERVER_PORTS.add(H.PORT);
  S = await import('../server.mjs');
  SB = createGitRefSandbox(REPO, 'origin/main', 'wallid-v2-origin-main');
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
  delete process.env.DCHUB_WALL_IDENTITY_V2;
});
afterEach(() => { delete process.env.DCHUB_WALL_IDENTITY_V2; anonCount = 999; });

let rid = 1, ipN = 1;
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
async function call(h, p, name, args, { trial = false, ip = `198.51.120.${ipN++ % 250}`, key = TRIAL } = {}) {
  const before = events.length;
  const r = await rpc(h, p, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } },
    { 'x-dc-client-ip': ip, ...(trial ? { 'x-api-key': key } : {}) });
  await new Promise((res) => setTimeout(res, 150));
  return { result: r.msg && r.msg.result, rows: events.slice(before) };
}
// What differs between two runs of the same call by design (same normaliser as test/m12-wall-relay-url).
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

const TOOLS = [
  ['get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }, 'dallas'],
  // get_interconnection_queue takes no market argument (iso only), so its ask carries no market clause.
  ['get_interconnection_queue', { iso: 'PJM' }, ''],
  ['execute_plan', { intent: 'compare PJM vs ERCOT grid headroom and interconnection queue', market: 'dallas' }, 'dallas'],
];
// keyless at the anonymous hard wall (count 999), keyless at the trial / preview walls (count 0), and a trial key.
const CALLERS = [['keyless hard wall', { trial: false, cnt: 999 }], ['keyless preview wall', { trial: false, cnt: 0 }], ['trial key', { trial: true, cnt: 0 }]];

describe('lib/wall-identity-v2.mjs', () => {
  it('the flag is on only for 1 / true / yes / on', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'ON', ' True ']) expect(wallIdentityV2On({ DCHUB_WALL_IDENTITY_V2: v }), v).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'off', 'no', '2', 'enabled']) expect(wallIdentityV2On({ DCHUB_WALL_IDENTITY_V2: v }), String(v)).toBe(false);
  });
  it('the copy is exactly the approved wording', () => {
    expect(SIGNIN_LINE).toBe('Reconnect with https://dchub.cloud/mcp/oauth to keep your history and get fuller answers. One sign-in, no key to copy. If your user sets it up by hand: https://dchub.cloud/mcp/connect.');
    // the /mcp/oauth URL stays in the line, so offers_shown still records 'oauth_signin'
    expect(OAUTH_SIGNIN_RE.test(SIGNIN_LINE)).toBe(true);
    expect(emailAskLine('dallas')).toBe('Share an email with get_api_key to keep this answer and get a daily change note for Dallas.');
    expect(emailAskLine('northern-virginia')).toBe('Share an email with get_api_key to keep this answer and get a daily change note for Northern Virginia.');
    expect(emailAskLine('')).toBe('Share an email with get_api_key to keep this answer and get a daily change note.');
    expect(emailAskLine('not a slug!')).toBe('Share an email with get_api_key to keep this answer and get a daily change note.');
    expect(emailAskCall('dallas')).toEqual({ tool: 'get_api_key', arguments: { email: expect.any(String), market: 'dallas' }, copy: emailAskLine('dallas') });
    expect(emailAskCall('').arguments).not.toHaveProperty('market');
  });
  it('no price, plan name or allowance figure in any new wall text', () => {
    const all = [SIGNIN_LINE, emailAskLine(''), emailAskLine('dallas'), emailAskLine('northern-virginia'), JSON.stringify(emailAskCall('dallas'))];
    for (const t of all) { expect(t).not.toMatch(NO_PRICE); expect(t).not.toMatch(BANNED_WORDING); }
    // CONTROL: the guard fires on the shapes it exists for.
    for (const bad of ['$49/mo', 'the Pro plan', '50 MCP calls/day', 'a free key', '10 full answers a day']) expect(bad).toMatch(NO_PRICE);
  });
  it('market: market, metro, slug, market_slug, else the planner\'s resolved market', () => {
    expect(wallMarketFrom({ market: 'Dallas' })).toBe('dallas');
    expect(wallMarketFrom({ metro: 'Northern Virginia' })).toBe('northern-virginia');
    expect(wallMarketFrom({ slug: 'phoenix' })).toBe('phoenix');
    expect(wallMarketFrom({ market_slug: 'atlanta' })).toBe('atlanta');
    expect(wallMarketFrom({ iso: 'PJM' }, ['', 'columbus'])).toBe('columbus');
    expect(wallMarketFrom({ iso: 'PJM' })).toBe('');
    expect(wallMarketFrom(null, 'chicago')).toBe('chicago');
  });
  it('withSignInLine: own block after the JSON block, never twice; withEmailAsk rewrites the daily ask and names get_api_key', () => {
    const r = { content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: 'Source: DC Hub' }] };
    const o = withSignInLine(r);
    expect(o.content.map((b) => b.text)).toEqual(['{"a":1}', SIGNIN_LINE, 'Source: DC Hub']);
    expect(withSignInLine(o)).toBe(o);
    const plan = { content: [{ type: 'text', text: 'Lead text.' }, { type: 'text', text: '{"p":1}' }] };
    expect(withSignInLine(plan).content.map((b) => b.text)).toEqual(['Lead text.', '{"p":1}', SIGNIN_LINE]);
    const w = { content: [{ type: 'text', text: '{"email_ask":{"tool":"claim_free_key","arguments":{"email":"x"},"copy":"Give your email to keep this answer and get daily changes."}}' },
      { type: 'text', text: 'Ask your human: "Give your email to keep this answer and get daily changes for Dallas." Then make ONE call.' }],
    structuredContent: { email_ask: { tool: 'claim_free_key', arguments: { email: 'x' }, copy: 'Give your email to keep this answer and get daily changes.' } } };
    const e = withEmailAsk(w, 'dallas');
    expect(e.structuredContent.email_ask).toEqual({ tool: 'get_api_key', arguments: { email: expect.any(String), market: 'dallas' }, copy: emailAskLine('dallas') });
    expect(JSON.parse(e.content[0].text).email_ask.arguments.market).toBe('dallas');
    expect(e.content[1].text).toContain('"' + emailAskLine('dallas') + '"');
    expect(JSON.stringify(e)).not.toMatch(/Give your email/);
    const none = { content: [{ type: 'text', text: 'no ask here' }] };
    expect(withEmailAsk(none, 'dallas')).toBe(none);
    expect(signInEligible({ walled: true, workosEnabled: true })).toBe(true);
    for (const k of ['signedIn', 'bound', 'chatgpt', 'grok', 'planStep', 'keyTool']) expect(signInEligible({ walled: true, workosEnabled: true, [k]: true }), k).toBe(false);
    expect(signInEligible({ walled: true, workosEnabled: false })).toBe(false);
    expect(signInEligible({ walled: false, workosEnabled: true })).toBe(false);
  });
});

describe('flag ON: /mcp walls carry the sign-in line and offers_shown counts it', () => {
  for (const [label, who] of CALLERS) {
    const tools = TOOLS.filter(([n]) => !(label === 'keyless preview wall' && n === 'get_grid_intelligence'));   // answers in full there: no wall
    it.each(tools)(`${label}: %s`, async (name, args, market) => {
      process.env.DCHUB_WALL_IDENTITY_V2 = '1';
      anonCount = who.cnt;
      const { result, rows } = await call(H, '/mcp', name, args, { trial: who.trial });
      expect(rows.length, 'the call walled').toBeGreaterThan(0);
      expect(count(result, SIGNIN_LINE), 'the sign-in line, exactly once').toBe(1);
      for (const e of rows) expect(e.offers_shown, `${e.tool}/${e.wall_status}`).toContain('oauth_signin');
      // the new text names no price, plan or allowance figure
      expect(SIGNIN_LINE).not.toMatch(NO_PRICE);
      // owner 2026-11-21 ("fix above"): the WHOLE wall's prose, not only the new lines, names no price, plan, "free"
      // or allowance figure (lib/wall-copy-v2.mjs), and no older human link
      for (const tx of texts(result).filter((x) => !/^\s*[{[]/.test(x))) {
        expect(tx).not.toMatch(NO_PRICE);
        expect(tx).not.toMatch(/answers\/day|After they pay|no card|dchub\.cloud\/upgrade\/h\//i);
      }
      // where the wall asks for an email, the ask is the V2 copy with this call's market, and the structured call names it
      const t = texts(result).join('\n');
      if (t.includes(EMAIL_ASK_LEAD)) {
        expect(t).toContain(emailAskLine(market));
        expect(result.structuredContent.email_ask).toMatchObject({ tool: 'get_api_key' });
        expect(result.structuredContent.email_ask.arguments.market).toBe(market || undefined);
      }
    }, 120_000);
  }

  it('keyless walls of all three tools at the hard wall ask for the email in the V2 copy, with the market', async () => {
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    anonCount = 999;
    for (const [name, args, market] of TOOLS) {
      const { result } = await call(H, '/mcp', name, args);
      expect(texts(result).join('\n'), name).toContain(emailAskLine(market));
      expect(result.structuredContent.email_ask, name).toMatchObject({ tool: 'get_api_key' });
      expect(result.structuredContent.email_ask.arguments.market, name).toBe(market || undefined);
    }
  }, 180_000);

  it('a keyless execute_plan answer whose steps walled: ONE sign-in line, and the key entry carries the market', async () => {
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    anonCount = 0;
    const { result, rows } = await call(H, '/mcp', 'execute_plan', { intent: 'compare PJM vs ERCOT grid headroom and interconnection queue', market: 'dallas' });
    expect(rows.length).toBeGreaterThan(1);
    expect(count(result, SIGNIN_LINE)).toBe(1);
    expect(JSON.stringify(result).split('https://dchub.cloud/mcp/oauth').length - 1).toBe(1);
    for (const e of rows) expect(e.offers_shown, e.tool).toContain('oauth_signin');
    const nt = (result.structuredContent.next_tools || []).find((e) => e && e.tool === 'get_api_key');
    expect(nt).toBeTruthy();
    expect(nt.args).toEqual({ market: 'dallas' });
    expect(nt.say).toBe(emailAskLine('dallas'));
  }, 120_000);

  it('/mcp still answers a keyless initialize with 200, never 401', async () => {
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    const r = await rpc(H, '/mcp', { jsonrpc: '2.0', id: rid++, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } }, { 'x-dc-client-ip': '198.51.121.1' });
    expect(r.status).toBe(200);
    expect(r.msg && r.msg.result && r.msg.result.serverInfo).toBeTruthy();
  }, 60_000);
});

describe('flag OFF is origin/main, byte for byte; /mcp/chatgpt is origin/main with the flag ON', () => {
  const CASES = [];
  for (const [label, who] of CALLERS) for (const t of TOOLS) CASES.push(['/mcp', label, who, ...t]);
  for (const flag of [undefined, '0']) {
    it.each(CASES)(`flag ${flag === undefined ? 'unset' : flag}: %s %s %s`, async (p, _label, who, name, args) => {
      if (!O) { console.warn(`[wall-identity-v2] origin/main comparison not run: ${why}`); return; }
      if (flag === undefined) delete process.env.DCHUB_WALL_IDENTITY_V2; else process.env.DCHUB_WALL_IDENTITY_V2 = flag;
      anonCount = who.cnt;
      const ip = `198.51.122.${ipN++ % 250}`;
      const key = 'dch_trial_V2cmp' + String(ipN).padStart(6, '0') + 'abcdefghijklmn';   // a key neither server has seen
      const here = await call(H, p, name, args, { trial: who.trial, ip, key });
      const main = await call(O, p, name, args, { trial: who.trial, ip, key });
      const a = norm(here.result), b = norm(main.result);
      expect(a === b, firstDiff(a, b)).toBe(true);
      expect(JSON.stringify(here.result)).not.toContain(SIGNIN_LINE);
    }, 120_000);
  }
  it.each(TOOLS)('/mcp/chatgpt flag ON: %s is origin/main byte for byte, keyless and trial-key', async (name, args) => {
    if (!O) { console.warn(`[wall-identity-v2] origin/main comparison not run: ${why}`); return; }
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    for (const [, who] of CALLERS) {
      anonCount = who.cnt;
      const ip = `198.51.123.${ipN++ % 250}`;
      const key = 'dch_trial_V2gpt' + String(ipN).padStart(6, '0') + 'abcdefghijklmn';
      const here = await call(H, '/mcp/chatgpt', name, args, { trial: who.trial, ip, key });
      const main = await call(O, '/mcp/chatgpt', name, args, { trial: who.trial, ip, key });
      const a = norm(here.result), b = norm(main.result);
      expect(a === b, firstDiff(a, b)).toBe(true);
      expect(JSON.stringify(here.result)).not.toContain('mcp/oauth');
    }
  }, 180_000);
});

describe('_wallIdentityV2Step: who never gets the line', () => {
  const wall = () => ({ content: [{ type: 'text', text: '{"preview":true}' }, { type: 'text', text: 'Source: DC Hub (dchub.cloud)' }], structuredContent: { preview: true } });
  const ctx = (o = {}, tool = 'get_grid_intelligence') => ({ session_id: '', platform: 'cursor', tier: 'anonymous',
    _pendingWallHits: [{ name: tool, status: 'anon_hard_wall', sent: false }], ...o });
  it('a keyless and a trial-key caller get it; flag off leaves the result as it was', () => {
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    expect(count(S._wallIdentityV2Step(wall(), 'get_grid_intelligence', ctx()), SIGNIN_LINE)).toBe(1);
    expect(count(S._wallIdentityV2Step(wall(), 'get_grid_intelligence', ctx({ api_key: TRIAL, tier: 'trial' })), SIGNIN_LINE)).toBe(1);
    delete process.env.DCHUB_WALL_IDENTITY_V2;
    const w = wall();
    expect(S._wallIdentityV2Step(w, 'get_grid_intelligence', ctx())).toBe(w);
  });
  it.each([
    ['signed in (OAuth)', { auth_oauth: true }, 'get_grid_intelligence'],
    ['email on file', { email: 'someone@example.com' }, 'get_grid_intelligence'],
    ['/mcp/chatgpt profile', { profile: 'chatgpt_directory' }, 'get_grid_intelligence'],
    ['a ChatGPT client', { platform: 'chatgpt' }, 'get_grid_intelligence'],
    ['Grok', { platform: 'grok' }, 'get_grid_intelligence'],
    ['an execute_plan step', { loopback_step: true }, 'get_grid_intelligence'],
    ['a key tool', {}, 'claim_free_key'],
    ['an account tool', {}, 'bind_email'],
    ['not walled', { _pendingWallHits: [] }, 'get_grid_intelligence'],
  ])('%s: untouched', (_l, o, tool) => {
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    const w = wall();
    const out = S._wallIdentityV2Step(w, tool, ctx(o, tool));
    expect(JSON.stringify(out)).not.toContain('mcp/oauth');
  });
  it('once per (session, tool); a sessionless caller gets it on every wall; offers_shown reads it as oauth_signin', () => {
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    const sid = 'sess-wallid-v2-' + Date.now().toString(36) + 'abcdefghijkl';
    const first = S._wallIdentityV2Step(wall(), 'get_grid_intelligence', ctx({ session_id: sid }));
    const second = S._wallIdentityV2Step(wall(), 'get_grid_intelligence', ctx({ session_id: sid }));
    const other = S._wallIdentityV2Step(wall(), 'get_interconnection_queue', ctx({ session_id: sid }, 'get_interconnection_queue'));
    expect(count(first, SIGNIN_LINE)).toBe(1);
    expect(count(second, SIGNIN_LINE)).toBe(0);
    expect(count(other, SIGNIN_LINE)).toBe(1);
    for (let i = 0; i < 3; i++) expect(count(S._wallIdentityV2Step(wall(), 'get_grid_intelligence', ctx()), SIGNIN_LINE)).toBe(1);
    expect(offersShown(first, '')).toContain('oauth_signin');
  });
});
