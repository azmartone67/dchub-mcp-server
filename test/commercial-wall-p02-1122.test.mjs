// commercial-wall-p02-1122.test.mjs — Agent Handoff P0-2: the commercial wall `access` block (lib/commercial-wall.mjs,
// server.mjs _commercialWallStep), get_access_status (unlisted, DCHUB_ACCESS_STATUS_TOOL), the handoff elicitation flag
// and the linked-identity resolve (DCHUB_AGENT_HANDOFF_RESOLVE). Every flag defaults OFF.
//
// Asserted through the real /mcp handler (backend stubbed, network fenced, an outside peer address) where the rule is
// about what an agent receives, and on the pure helpers where it is about a function:
//   * flags off (unset and '0'): every answer is origin/main's, byte for byte (git-ref sandbox), keyless and trial key;
//     /mcp/chatgpt is origin/main's with every flag ON;
//   * treatment vs holdout: the arm is the holdouts helper's (shared vectors pk-'a'*64 -> 95 holdout, sk-'c'*32 -> 26
//     treatment); `exposure` is posted in BOTH arms, only the treatment arm's answer carries `access`;
//   * a Pro-only tool is answered 'pro', never 'credit_pack', for EVERY Pro-only tool;
//   * no price and no plan name in any agent-facing field, over many sample walls (with a control that fires);
//   * handoff_url is the stubbed mint's, no email or key in it or in the mint body; a failed mint attaches nothing;
//   * one handoff link per session; a ChatGPT client gets nothing; a keyless task an email finishes keeps its ask;
//   * get_access_status: absent with the flag off, callable and never listed with it on, no price;
//   * a handoff-linked keyless identity is served at the buyer's tier with DCHUB_AGENT_HANDOFF_RESOLVE=1, key scrubbed.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import * as CW from '../lib/commercial-wall.mjs';
import * as MX from '../lib/monetization-experiments.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FLAGS = ['DCHUB_EXP_UPGRADE_BLOCK', 'DCHUB_COMMERCIAL_WALL_CLIENTS', 'DCHUB_ACCESS_STATUS_TOOL', 'DCHUB_HANDOFF_ELICIT',
  'DCHUB_AGENT_HANDOFF_RESOLVE'];
const clearFlags = () => { for (const f of FLAGS) delete process.env[f]; };
const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i, score: 50 + i }));
const MINT_URL = 'https://dchub.cloud/h/hx1.AbCdEfGh12345678';
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

let H, O, SB, S, fence, why = '', anonCount = 999, mintMode = 'ok', linked = null, linkedToken = '';
const LINKED_TOKEN = 'dchl1.x1' + 'Q'.repeat(40) + '.' + 'f'.repeat(32);   // be#9214 util/linked_key shape
const dataHits = [];   // data reads: which credential headers reached the backend
const mints = [];
const exposures = [];
const outcomes = [];   // continued / returned_next_day / key_minted rows (_expOutcomeStep)
const entitlementReads = [];
const identityReads = [];
const routes = () => async (p, req, body, u) => {
  if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
  if (p === '/api/v1/keys/validate' && body && typeof body.api_key === 'string' && body.api_key.startsWith('dch_trial_CW')) return { valid: true, tier: 'trial', email: null, tier_detail: { users_plan: null } };
  if (p === CW.MINT_PATH) {
    mints.push({ body, internal: req.headers['x-internal-key'] });
    if (mintMode === 'fail') return { status: 500, body: { error: 'down' } };
    if (mintMode === 'slow') { await new Promise((r) => setTimeout(r, 1500)); return { handoff_url: MINT_URL, token_id: 't1', expires_at: '2026-11-25T00:00:00Z' }; }
    if (mintMode === 'bad') return { handoff_url: 'https://dchub.cloud/h/abcdefgh123?email=a@b.co', token_id: 't1' };
    return { handoff_url: MINT_URL, token_id: 't1', expires_at: '2026-11-25T00:00:00Z' };
  }
  if (p === MX.EXPOSURE_PATH) { if (body && body.event === 'exposure') exposures.push(body); else outcomes.push(body); return { ok: true }; }
  if (p === CW.IDENTITY_PATH) {
    identityReads.push({ internal: req.headers['x-internal-key'] || '', method: req.method, q: Object.fromEntries(u.searchParams), body });
    return linked ? { linked: true, api_key_hash: 'e'.repeat(64), tier: linked, ...(linkedToken ? { linked_token: linkedToken } : {}) }
      : { linked: false };   // be#9214: a hash, never a key
  }
  if (p === CW.ENTITLEMENTS_ME_PATH) {
    entitlementReads.push({ key: req.headers['x-api-key'] || '', internal: req.headers['x-internal-key'] || '', method: req.method, q: Object.fromEntries(u.searchParams), body });
    // be#9213/9214 shape, plus price / plan junk the shaper must drop
    return { schema_version: 1, tier: 'developer', keyed: !!req.headers['x-api-key'],
      allowance: { calls_per_day: 500, used_today: 3, remaining_today: 497 }, full_answers_per_tool_per_day: 25, credits: 0,
      excluded_tools: ['analyze_site', 'compare_sites'], as_of: '2026-11-22T10:00:00Z', table: 'mcp_entitlements',
      base_tier: 'free_key', linked_via: 'handoff', price: '$49/month', plan_name: 'Developer' };
  }
  if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
  // 2026-11-25: the capacity_grid plan's first step; each row names its grid, which the queue and grid steps take.
  if (p === '/api/v1/site-selection/canvas') {
    dataHits.push({ path: p, apiKey: req.headers['x-api-key'] || '', linked: req.headers['x-dchub-linked-key'] || '', callerTier: req.headers['x-dchub-caller-tier'] || '' });
    return { ok: true, matched: 2, applied_filters: { region: 'us' }, shortlist: [
      { market: 'Midland–Odessa', slug: 'midland-tx', state: 'TX', iso: 'ERCOT', verdict: 'BUILD' },
      { market: 'Upper Peninsula MI', slug: 'upper-michigan', state: 'MI', iso: 'MISO', verdict: 'BUILD' }] };
  }
  if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
  dataHits.push({ path: p, apiKey: req.headers['x-api-key'] || '', linked: req.headers['x-dchub-linked-key'] || '',
    callerTier: req.headers['x-dchub-caller-tier'] || '' });
  // A backend that honours X-DCHub-Linked-Key (be#9214, next to X-Internal-Key) answers the buyer's key: the full row.
  if (req.headers['x-dchub-linked-key'] === LINKED_TOKEN && req.headers['x-internal-key']) {
    return { success: true, count: 3, total: 3, score: 71, demand_mw: 18000,
      data: [{ id: 1, name: 'Ashburn Campus A', market: 'northern-virginia', capacity_mw: 120, score: 71 }] };
  }
  return undefined;   // the harness's data body: a relay wall (_score_in_pro) for a caller below Pro
};
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.21' };
    return p;
  };
  fence = fenceNetwork();
  clearFlags();
  const env = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_KEYLESS_FIRST_FULL: '0', DCHUB_ANON_DAILY_CAP: '20' };
  H = await startHarness({ env, extraRoutes: routes() });
  SERVER_PORTS.add(H.PORT);
  S = await import('../server.mjs');
  SB = createGitRefSandbox(REPO, 'origin/main', 'commercial-wall-origin-main');
  if (!SB) why = 'origin/main is not available in this clone';
  else {
    // Owner 2026-11-23 (lib/paid-full-only.mjs): until origin/main carries the paid-only rule, its keyless grid wall
    // differs from this branch by design (no email unlock here); MAIN_HAS_GATE says which baseline holds.
    MAIN_HAS_GATE = fs.existsSync(path.join(SB.root, 'lib', 'paid-full-only.mjs'));
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
  clearFlags();
});
afterEach(() => { clearFlags(); anonCount = 999; mintMode = 'ok'; linked = null; linkedToken = ''; });

let rid = 1, ipN = 1;
function rpc(h, p, body, headers = {}) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: h.PORT, path: p, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'claude-code/2.0.1',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, msg, headers: res.headers, raw });
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
const nextIp = () => `198.51.130.${ipN++ % 250}`;
async function call(h, p, name, args, { key = '', ip = nextIp(), headers = {} } = {}) {
  const r = await rpc(h, p, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } },
    { 'x-dc-client-ip': ip, ...(key ? { 'x-api-key': key } : {}), ...headers });
  await new Promise((res) => setTimeout(res, 120));
  return { result: r.msg && r.msg.result, error: r.msg && r.msg.error, raw: r.raw };
}
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
const accessOf = (r) => r && r.structuredContent && r.structuredContent.access;
let keyN = 1;
const trialKey = () => 'dch_trial_CW' + String(keyN++).padStart(6, '0') + 'abcdefghijklmnop';
// An IP / key whose identity lands in the arm asked for (the holdouts helper's own assignment).
function ipIn(arm) {
  for (let i = 0; i < 400; i++) { const ip = nextIp(); if (MX.armFor('ip-' + sha(ip), MX.UPGRADE_BLOCK) === arm) return ip; }
  throw new Error('no ip in ' + arm);
}
function keyIn(arm) {
  for (let i = 0; i < 400; i++) { const k = trialKey(); if (MX.armFor(MX.keyRef(k), MX.UPGRADE_BLOCK) === arm) return k; }
  throw new Error('no key in ' + arm);
}
const ON = () => { process.env.DCHUB_EXP_UPGRADE_BLOCK = '1'; };

// Owner 2026-11-23: execute_plan's full answer needs a paid key, so a free (trial) key's plan is no longer
// origin/main's: its steps run keyless and its pointer is unlock_more_data, not bind_email. That case is pinned
// on its own below instead of byte for byte; keyless execute_plan and the other walled tools stay byte for byte.
// The same holds for every paid-full-only tool (lib/paid-full-only.mjs): a trial key's get_grid_intelligence answer is
// the preview, where origin/main walled it on the email bind; that case is also pinned on its own below.
const PAID_ONLY_WALLED = new Set(['execute_plan', 'get_grid_intelligence']);
let MAIN_HAS_GATE = false;
const WALLED = [
  ['get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }],
  ['get_market_intel', { market: 'dallas' }],
  ['execute_plan', { intent: 'compare PJM vs ERCOT grid headroom and interconnection queue', market: 'dallas' }],
];

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('lib/commercial-wall.mjs', () => {
  it('flags are on only for 1 / true / yes / on, and default OFF', () => {
    for (const [fn, k] of [[CW.commercialWallOn, 'DCHUB_EXP_UPGRADE_BLOCK'], [CW.accessStatusOn, 'DCHUB_ACCESS_STATUS_TOOL'],
      [CW.handoffElicitOn, 'DCHUB_HANDOFF_ELICIT'], [CW.handoffResolveOn, 'DCHUB_AGENT_HANDOFF_RESOLVE']]) {
      expect(fn({}), k).toBe(false);
      for (const v of ['1', 'true', 'on', 'YES']) expect(fn({ [k]: v }), k + v).toBe(true);
      for (const v of ['0', 'off', 'false', '', '2']) expect(fn({ [k]: v }), k + v).toBe(false);
    }
    expect(CW.handoffElicitOn({ DCHUB_HANDOFF_ELICIT: '1', DCHUB_URL_ELICIT_DISABLE: '1' })).toBe(false);
  });
  it('clients: grok and claude by default, "all" opens every client but ChatGPT, which is never allowed', () => {
    expect(CW.clientAllowed({ platform: 'grok' }, {})).toBe(true);
    expect(CW.clientAllowed({ platform: 'connectors-manager' }, {})).toBe(true);
    expect(CW.clientAllowed({ platform: 'claude' }, {})).toBe(true);
    expect(CW.clientAllowed({ platform: 'cursor' }, {})).toBe(false);
    expect(CW.clientAllowed({ platform: 'cursor' }, { DCHUB_COMMERCIAL_WALL_CLIENTS: 'all' })).toBe(true);
    expect(CW.clientAllowed({ platform: 'cursor' }, { DCHUB_COMMERCIAL_WALL_CLIENTS: 'grok,cursor' })).toBe(true);
    for (const p of ['chatgpt', 'openai', 'ChatGPT-User']) {
      expect(CW.clientAllowed({ platform: p }, { DCHUB_COMMERCIAL_WALL_CLIENTS: 'all' }), p).toBe(false);
      expect(CW.clientAllowed({ platform: p }, { DCHUB_COMMERCIAL_WALL_CLIENTS: p }), p).toBe(false);
    }
  });
  it('shared assignment vectors (lib/monetization-experiments.mjs): pk-a*64 -> 95 holdout, sk-c*32 -> 26 treatment', () => {
    expect(MX.bucketFor('pk-' + 'a'.repeat(64), MX.UPGRADE_BLOCK)).toBe(95);
    expect(MX.armFor('pk-' + 'a'.repeat(64), MX.UPGRADE_BLOCK)).toBe(MX.HOLDOUT);
    expect(MX.bucketFor('sk-' + 'c'.repeat(32), MX.UPGRADE_BLOCK)).toBe(26);
    expect(MX.armFor('sk-' + 'c'.repeat(32), MX.UPGRADE_BLOCK)).toBe(MX.TREATMENT);
  });
  it('unlocksWith: allowance -> developer, a keyed free heavy answer -> credit_pack, unsure -> developer, Pro marks -> pro', () => {
    const heavy = new Set(['get_grid_intelligence']);
    expect(CW.unlocksWith('get_grid_intelligence', { wallStatus: 'anon_daily_cap', keyed: true, freeKeyed: true, creditHeavyTools: heavy })).toBe('developer');
    expect(CW.unlocksWith('get_grid_intelligence', { keyed: true, freeKeyed: true, creditHeavyTools: heavy })).toBe('credit_pack');
    expect(CW.unlocksWith('get_grid_intelligence', { keyed: false, creditHeavyTools: heavy })).toBe('developer');
    expect(CW.unlocksWith('get_water_risk', { keyed: true, freeKeyed: true, creditHeavyTools: heavy })).toBe('developer');
    expect(CW.unlocksWith('get_grid_intelligence', { keyed: true, freeKeyed: true, creditHeavyTools: heavy, sc: { _score_in_pro: true } })).toBe('pro');
    expect(CW.unlocksWith('get_grid_intelligence', { wallStatus: 'pro_wall', keyed: true, freeKeyed: true, creditHeavyTools: heavy })).toBe('pro');
    expect(CW.unlocksWith('x', {})).toBe('developer');
  });
  it('sanitizeArgs drops emails, keys and credential-named arguments; validHandoffUrl refuses an email or key', () => {
    const a = CW.sanitizeArgs({ market: 'dallas', email: 'a@b.co', note: 'reach me at pat@example.com', api_key: 'dch_live_x',
      q: 'dch_live_ABCDEFGH12345678', token: 't', nested: { contact: 'x@y.io', mw: 200 }, list: ['ok', 'sk-' + 'z'.repeat(30)] });
    expect(a).toEqual({ market: 'dallas', nested: { mw: 200 }, list: ['ok'] });
    expect(CW.validHandoffUrl(MINT_URL)).toBe(true);
    for (const bad of ['https://dchub.cloud/h/abcdefgh123?email=a@b.co', 'https://dchub.cloud/h/abcdefgh123?e=a%40b.co',
      'https://dchub.cloud/h/abcdefgh123?k=dch_live_ABCDEFGH1234', 'https://evil.example/h/abcdefgh123', 'http://dchub.cloud/h/abcdefgh123',
      'https://dchub.cloud/pricing', 'https://dchub.cloud/h/short']) expect(CW.validHandoffUrl(bad), bad).toBe(false);
    expect(CW.withVia(MINT_URL)).toBe(MINT_URL + '?via=upgrade_block');
  });
  it('mintHandoff: the link on 200; null on a timeout, non-200, a bad link, or no internal key', async () => {
    const ok = async () => ({ status: 200, json: async () => ({ handoff_url: MINT_URL, token_id: 't', expires_at: 'x' }) });
    expect((await CW.mintHandoff({}, { apiBase: 'http://x', internalKey: 'k', fetchImpl: ok })).handoff_url).toBe(MINT_URL + '?via=upgrade_block');
    const slow = (_u, o) => new Promise((_r, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    const t0 = Date.now();
    expect(await CW.mintHandoff({}, { apiBase: 'http://x', internalKey: 'k', fetchImpl: slow })).toBe(null);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(await CW.mintHandoff({}, { apiBase: 'http://x', internalKey: 'k', fetchImpl: async () => ({ status: 503, json: async () => ({}) }) })).toBe(null);
    expect(await CW.mintHandoff({}, { apiBase: 'http://x', internalKey: 'k', fetchImpl: async () => ({ status: 200, json: async () => ({ handoff_url: 'https://dchub.cloud/pricing' }) }) })).toBe(null);
    expect(await CW.mintHandoff({}, { apiBase: 'http://x', internalKey: '', fetchImpl: ok })).toBe(null);
  });
  it('withAccess: appended last, into structuredContent; never over an answer that says full, never twice', () => {
    const blk = CW.buildAccess({ completed: 'DC Hub answered with 3 of 12 sites', withheld: 'all 12 sites', unlocks_with: 'developer', handoff_url: MINT_URL });
    const r = { content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: 'Source: DC Hub' }], structuredContent: { a: 1 } };
    const o = CW.withAccess(r, blk);
    expect(o.content.slice(0, 2)).toEqual(r.content);
    expect(o.content[2].text).toMatch(/^Access: partial\./);
    expect(o.structuredContent).toEqual({ a: 1, access: blk.access });
    expect(CW.withAccess(o, blk)).toBe(o);
    const full = { ...r, structuredContent: { a: 1, access: 'full' } };
    expect(CW.withAccess(full, blk)).toBe(full);
    const stamp = { ...r, structuredContent: { a: 1, access: 'partial', access_basis: 'x' } };
    expect(CW.withAccess(stamp, blk).structuredContent).toEqual({ a: 1, access: blk.access, access_basis: 'x' });
    const noSc = { content: [{ type: 'text', text: 'x' }] };
    expect(CW.withAccess(noSc, blk).content).toHaveLength(2);
  });
  it('shapeAccessStatus keeps codes and numbers only: no price, no plan display name', () => {
    const o = CW.shapeAccessStatus({ tier: 'Developer', allowance: { calls_per_day: 500, used_today: 3, remaining_today: 497, label: '$49/month' },
      full_answers_per_tool_per_day: 25, credits: { remaining: 12 }, excluded_tools: ['analyze_site', 'Pro tools ($99)'],
      base_tier: 'free_key', linked_via: 'handoff', price: '$49', plan_name: 'Developer' }, { keyed: true });
    expect(o).toEqual({ tier: 'developer', keyed: true, allowance: { calls_per_day: 500, used_today: 3, remaining_today: 497, full_answers_per_tool_per_day: 25 },
      credits: 12, excluded_tools: ['analyze_site'], upgraded_since_handoff: true, as_of: expect.any(String) });
    expect(JSON.stringify(o)).not.toMatch(/\$|Developer|month/);
  });
  it('upgraded_since_handoff: linked_via with a higher tier than base_tier, or the explicit flag; never on a plain read', () => {
    expect(CW.shapeAccessStatus({ tier: 'free_key' }).upgraded_since_handoff).toBe(false);
    expect(CW.shapeAccessStatus({ tier: 'pro', base_tier: 'pro', linked_via: 'handoff' }).upgraded_since_handoff).toBe(false);
    expect(CW.shapeAccessStatus({ tier: 'pro', base_tier: 'keyless', linked_via: 'handoff' }).upgraded_since_handoff).toBe(true);
    expect(CW.shapeAccessStatus({ tier: 'pro', linked_via: '' }).upgraded_since_handoff).toBe(false);
    expect(CW.shapeAccessStatus({ tier: 'pro', upgraded_since_handoff: true }).upgraded_since_handoff).toBe(true);
  });
  it('linkedTokenOf keeps only the be#9214 linked-token shape (dchl1.x1<sealed>.<32 hex>)', () => {
    expect(CW.LINKED_KEY_HEADER).toBe('X-DCHub-Linked-Key');
    const tok = 'dchl1.x1' + 'Ab_-'.repeat(10) + '.' + '0123456789abcdef'.repeat(2);
    expect(CW.linkedTokenOf({ linked_token: tok })).toBe(tok);
    for (const bad of ['', 'dch_live_' + 'a'.repeat(32), 'dchl1.' + 'a'.repeat(40) + '.' + 'f'.repeat(32),
      'dchl1.x1' + 'a'.repeat(40) + '.' + 'F'.repeat(32), 'dchl1.x1short.' + 'f'.repeat(32), tok + '\nX-API-Key: x', 7, null]) {
      expect(CW.linkedTokenOf({ linked_token: bad }), String(bad)).toBe('');
    }
    expect(CW.linkedTokenOf(null)).toBe('');
    expect(CW.buildAccess({ unlocks_with: 'pro' }).access.agent_note).toBe(CW.ACCESS_AGENT_NOTE);
    expect(CW.ACCESS_AGENT_NOTE).not.toMatch(CW.AGENT_TEXT_BANNED);
  });
  it('sessionRef is the bare sha256 hex the backend accepts; liftTierFor lifts developer and pro only', () => {
    expect(CW.sessionRef('abc-123')).toBe(sha('abc-123'));
    expect(CW.sessionRef('abc-123')).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(CW.sessionRef('')).toBe('');
    expect(CW.sessionRef('no-session')).toBe('');
    expect(['pro', 'developer', 'PRO', 'credit_pack', 'free_key', 'email_key', 'keyless', '', undefined].map(CW.liftTierFor))
      .toEqual(['pro', 'developer', 'pro', '', '', '', '', '', '']);
  });
});

// ── the no-price / no-plan guard over many sample walls ───────────────────────────────────────────────────────────────
describe('agent-facing text names no price and no plan (guard over sample walls)', () => {
  const SAMPLE_WALLS = [
    { preview_scope: { shown: 3, total: 12, list: 'sites', withheld_fields: ['capacity', 'time to power'] }, _wall: true },
    { preview_scope: { shown: 0, total: 25, list: 'projects', withheld_fields: [] }, _wall: true, withheld: [{ section: 'projects', count: 25 }] },
    { _locked_fields: ['pro_score', 'price_usd', 'developer_notes', 'avg_kwh_cents', 'credit_pack_cost', 'enterprise_tier'], _wall: true },
    { _score_in_pro: true, score: null, data: [{}, {}, {}], _data_total_in_pro: 12 },
    { taste: { headline: { name: 'demand_mw', value: 18000, unit: 'MW', as_of: '2026-11-21T00:00:00Z' } }, trial_preview: true },
    { verdict: 'BUILD', market_name: 'Dallas', composite_score: 71.2, computed_at: '2026-11-20', _locked_fields: ['excess_power_score'], _wall: true },
    { market_verdict: { verdict: 'CAUTION', market: 'Phoenix', as_of: '2026-11-19' }, missing: ['pricing detail', 'Pro report'], _wall: true },
    { _entity: 'facility', data: [{ name: 'Pro Campus $5B', provider: 'Enterprise Holdings', as_of: '2026-11-01' }], _preview_only: true },
    { fact_header: 'SOURCE: DC Hub | AS_OF: 2026-11-22\nENTITY: Dallas\nSUMMARY: Developer plan $49/month unlocks it', _wall: true },
    { required_plan: 'pro', error: 'pro_required' },
    { provenance: { completeness: 'partial_preview', preview: { shown: 2, total: 9 } }, rows: [{}, {}] },
    {},
  ];
  const URLS = ['', MINT_URL, MINT_URL + '?via=upgrade_block'];
  it('every block over every sample, code and link passes AGENT_TEXT_BANNED; for_your_human <= 25 words with the link', () => {
    let checked = 0;
    for (const sc of SAMPLE_WALLS) for (const code of CW.UNLOCK_CODES) for (const url of URLS) {
      const block = CW.buildAccess({ completed: CW.completedFrom(sc), withheld: CW.withheldShape(sc), unlocks_with: code, handoff_url: url });
      const txt = CW.agentFacingText(block);
      expect(txt, JSON.stringify(sc)).not.toMatch(CW.AGENT_TEXT_BANNED);
      expect(CW.accessText(block)).not.toMatch(CW.AGENT_TEXT_BANNED);
      expect(block.access.unlocks_with).toBe(code);
      expect(block.access.status).toBe('partial');
      expect(block.access.retry_after_unlock).toBe(true);
      if (url) {
        expect(block.access.handoff_url).toBe(url);
        expect(block.access.for_your_human.split(/\s+/).length).toBeLessThanOrEqual(25);
        expect(block.access.for_your_human).toContain('Open this link to see');
        expect(block.access.for_your_human.endsWith(url)).toBe(true);
      } else {
        expect(block.access).not.toHaveProperty('handoff_url');
        expect(block.access).not.toHaveProperty('for_your_human');
      }
      checked++;
    }
    expect(checked).toBe(SAMPLE_WALLS.length * 3 * 3);
  });
  it('the shape names what is missing, never a withheld value', () => {
    expect(CW.withheldShape(SAMPLE_WALLS[0])).toBe('all 12 sites with capacity and time to power');
    expect(CW.completedFrom(SAMPLE_WALLS[0])).toBe('DC Hub answered with 3 of 12 sites');
    expect(CW.completedFrom(SAMPLE_WALLS[4])).toBe('DC Hub found demand 18,000 MW (as of 2026-11-21)');
    expect(CW.withheldShape(SAMPLE_WALLS[3])).toMatch(/^all 12 data with score$/);
  });
  it('CONTROL: the guard fires on the shapes it exists for', () => {
    for (const bad of ['$49/mo', 'the Pro plan', 'Developer', 'a credit pack', 'the pack', '1,000 credits for $10', '49/month',
      'starter', 'Enterprise', 'pricing', 'upgrade now', 'unlock it', 'free key', '99 per month']) expect(bad, bad).toMatch(CW.AGENT_TEXT_BANNED);
    // and a block whose completed / withheld carry them falls back to the neutral wording
    const b = CW.buildAccess({ completed: 'Pro plan at $99/month', withheld: 'the credit pack rows', unlocks_with: 'pro', handoff_url: MINT_URL });
    expect(CW.agentFacingText(b)).not.toMatch(CW.AGENT_TEXT_BANNED);
  });
});

// ── server: Pro-only tools and the step itself ───────────────────────────────────────────────────────────────────────
describe('server rules', () => {
  it('every Pro-only tool is answered pro, never credit_pack, for every caller shape', () => {
    const pro = S._COMMERCIAL_PRO_ONLY();
    const heavy = S._commercialCreditHeavy();
    expect(pro.size).toBeGreaterThanOrEqual(6);
    for (const t of ['analyze_site', 'compare_sites', 'get_dchub_recommendation', 'generate_site_analysis', 'export_dataset', 'get_composite_site_score']) expect(pro.has(t), t).toBe(true);
    // some Pro-only tools are ALSO credit-heavy: the order inside unlocksWith is what keeps the pack away from them
    expect([...pro].some((t) => heavy.has(t))).toBe(true);
    for (const t of pro) for (const keyed of [true, false]) for (const freeKeyed of [true, false]) for (const wallStatus of ['', 'anon_daily_cap', 'credits_depleted', 'pro_wall']) {
      expect(CW.unlocksWith(t, { proOnlyTools: pro, keyed, freeKeyed, creditHeavyTools: heavy, wallStatus, sc: {} }), `${t} ${keyed} ${freeKeyed} ${wallStatus}`).toBe('pro');
    }
  });
  it('the instruction line: appended after the relay contract only with a flag on; never twice', () => {
    const base = 'Head. ' + 'X';
    expect(S._accessInstr(base, {})).toBe(base);
    const lean = S._INSTRUCTIONS_LEAN;
    expect(S._accessInstr(lean, {})).toBe(lean);
    const on = S._accessInstr(lean, { DCHUB_EXP_UPGRADE_BLOCK: '1' });
    expect(on).toContain(S.ACCESS_INSTR_LINE);
    expect(S._accessInstr(lean, { DCHUB_ACCESS_STATUS_TOOL: '1' })).toBe(on);
    expect(S._accessInstr(on, { DCHUB_EXP_UPGRADE_BLOCK: '1' })).toBe(on);
    expect(S.ACCESS_INSTR_LINE).not.toMatch(/\$|\b(?:developer|pro|starter|enterprise)\b|credit pack|\bpack\b/i);
  });
  it('flag off returns the very same object', async () => {
    const r = { content: [{ type: 'text', text: '{}' }], structuredContent: { _score_in_pro: true } };
    expect(await S._commercialWallStep(r, 'get_grid_intelligence', {}, { platform: 'claude', session_id: '' })).toBe(r);
    process.env.DCHUB_EXP_UPGRADE_BLOCK = '0';
    expect(await S._commercialWallStep(r, 'get_grid_intelligence', {}, { platform: 'claude', session_id: '' })).toBe(r);
  });
});

// ── through the real /mcp handler ────────────────────────────────────────────────────────────────────────────────────
describe('flag ON through /mcp: treatment vs holdout, exposure in both arms', () => {
  it('a trial key in the treatment arm gets access with the stubbed link; one in the holdout arm does not; both post exposure', async () => {
    ON();
    for (const arm of [MX.TREATMENT, MX.HOLDOUT]) {
      const key = keyIn(arm);
      const before = exposures.length;
      const nm = mints.length;
      const { result } = await call(H, '/mcp', 'get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }, { key });
      const ex = exposures.slice(before);
      expect(ex.length, arm + ' exposure rows').toBe(1);
      expect(ex[0]).toMatchObject({ test: MX.UPGRADE_BLOCK, identity: MX.keyRef(key), event: 'exposure', tool: 'get_grid_intelligence', arm });
      const a = accessOf(result);
      if (arm === MX.TREATMENT) {
        expect(a, 'treatment carries access').toBeTruthy();
        expect(a).toMatchObject({ status: 'partial', retry_after_unlock: true, handoff_url: MINT_URL + '?via=upgrade_block' });
        expect(CW.UNLOCK_CODES).toContain(a.unlocks_with);
        expect(a.for_your_human.endsWith(a.handoff_url)).toBe(true);
        expect(CW.agentFacingText({ access: a })).not.toMatch(CW.AGENT_TEXT_BANNED);
        // visible part first: the access text is the LAST block, the answer's own blocks are before it
        const t = texts(result);
        expect(t.at(-1)).toMatch(/^Access: partial\./);
        expect(t.slice(0, -1).some((x) => x.includes('Access: partial'))).toBe(false);
        expect(mints.length).toBe(nm + 1);
        const mb = mints.at(-1);
        expect(mb.internal).toBeTruthy();
        expect(mb.body).toMatchObject({ tool: 'get_grid_intelligence', identity_ref: MX.keyRef(key), unlocks_with: a.unlocks_with,
          completed: a.completed, withheld: a.withheld, client: 'claude' });
        expect(mb.body.visible).toHaveProperty('source');
        expect(mb.body.visible).toHaveProperty('as_of');
        expect(JSON.stringify(mb.body)).not.toContain(key);
      } else {
        expect(a, 'holdout carries no access').toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('Access: partial');
        expect(mints.length).toBe(nm);
      }
    }
  }, 120_000);

  it('keyless, Pro-only tool: treatment answers unlocks_with pro; holdout nothing', async () => {
    ON();
    for (const [name, args] of [['get_dchub_recommendation', { intent: 'best market for 200 MW' }], ['compare_sites', { locations: '39.04,-77.48;33.45,-112.07' }]]) {
      const t = await call(H, '/mcp', name, args, { ip: ipIn(MX.TREATMENT) });
      const a = accessOf(t.result);
      expect(a, name).toBeTruthy();
      expect(a.unlocks_with, name).toBe('pro');
      const h = await call(H, '/mcp', name, args, { ip: ipIn(MX.HOLDOUT) });
      expect(accessOf(h.result), name).toBeUndefined();
    }
  }, 120_000);

  it('the mint body carries no email or key from the arguments, and the link is the stub\'s', async () => {
    ON();
    const key = keyIn(MX.TREATMENT);
    const { result } = await call(H, '/mcp', 'get_grid_intelligence', { iso: 'ERCOT', market: 'dallas pat@example.com dch_live_ABCDEFGH12345678' }, { key });
    const a = accessOf(result);
    expect(a).toBeTruthy();
    expect(a.handoff_url).toBe(MINT_URL + '?via=upgrade_block');
    const body = JSON.stringify(mints.at(-1).body);
    expect(body).not.toMatch(/@|dch_live_|dch_trial_/);
    expect(mints.at(-1).body.label).toBe('ERCOT');
    expect(mints.at(-1).body).toMatchObject({ endpoint: '/mcp', is_qa: false, user_agent: 'claude-code/2.0.1' });
    expect(mints.at(-1).body.identity_ref).toMatch(/^(pk|ip|sk)-[0-9a-f]{64}$/);
    expect(mints.at(-1).body.args).toEqual({ iso: 'ERCOT' });
  }, 60_000);

  it.each(['fail', 'slow', 'bad'])('mint %s: no access block, the wall stands', async (mode) => {
    ON();
    mintMode = mode;
    const { result } = await call(H, '/mcp', 'get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }, { key: keyIn(MX.TREATMENT) });
    expect(result).toBeTruthy();
    expect(accessOf(result)).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('Access: partial');
  }, 60_000);

  it('a ChatGPT client on /mcp gets nothing, and posts no exposure', async () => {
    ON();
    process.env.DCHUB_COMMERCIAL_WALL_CLIENTS = 'all';
    const before = exposures.length;
    const { result } = await call(H, '/mcp', 'get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' },
      { key: keyIn(MX.TREATMENT), headers: { 'user-agent': 'openai-mcp/1.0 ChatGPT' } });
    expect(accessOf(result)).toBeUndefined();
    expect(exposures.length).toBe(before);
  }, 60_000);

  it('a client outside DCHUB_COMMERCIAL_WALL_CLIENTS (cursor, default list) gets nothing', async () => {
    ON();
    const { result } = await call(H, '/mcp', 'get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' },
      { key: keyIn(MX.TREATMENT), headers: { 'user-agent': 'cursor/1.0' } });
    expect(accessOf(result)).toBeUndefined();
  }, 60_000);

  it('a keyless task an email finishes keeps its identity ask and gets no access block', async () => {
    ON();
    anonCount = 999;
    const ip = ipIn(MX.TREATMENT);
    // 2026-11-23 (owner): get_grid_intelligence is paid-full-only (lib/paid-full-only.mjs): an email no longer finishes
    // it (its unlock is the licence), so the email-finished task is pinned on get_market_intel, which an email still opens.
    expect(S._wallUnlockFor('get_grid_intelligence', {}, { tier: 'anonymous' })).not.toBe('email');
    const { result } = await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip });
    expect(S._wallUnlockFor('get_market_intel', result.structuredContent || {}, { tier: 'anonymous' })).toBe('email');
    expect(accessOf(result)).toBeUndefined();
    expect(JSON.stringify(result)).toMatch(/get_api_key|email/i);
  }, 60_000);

  it('one handoff link per session: the second wall carries access without a link or a human line', async () => {
    ON();
    const key = keyIn(MX.TREATMENT);
    const ini = await rpc(H, '/mcp', { jsonrpc: '2.0', id: rid++, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.0' } } },
    { 'x-dc-client-ip': nextIp(), 'x-api-key': key });
    const sid = ini.headers['mcp-session-id'];
    expect(sid).toBeTruthy();
    await rpc(H, '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': sid, 'x-api-key': key });
    const nm = mints.length;
    const ne = exposures.length;
    const one = await call(H, '/mcp', 'get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }, { key, headers: { 'mcp-session-id': sid } });
    const two = await call(H, '/mcp', 'get_grid_intelligence', { iso: 'PJM' }, { key, headers: { 'mcp-session-id': sid } });
    const a1 = accessOf(one.result), a2 = accessOf(two.result);
    expect(a1 && a1.handoff_url).toBe(MINT_URL + '?via=upgrade_block');
    expect(a2).toBeTruthy();
    expect(a2).not.toHaveProperty('handoff_url');
    expect(a2).not.toHaveProperty('for_your_human');
    expect(a2.retry_after_unlock).toBe(true);
    expect(mints.length).toBe(nm + 1);
    expect(exposures.length).toBe(ne + 1);
    expect(JSON.stringify(two.result)).not.toContain('dchub.cloud/h/');
    // the second call is the exposure's "continued" outcome (holdouts helper), posted once
    expect(outcomes.filter((o) => o.event === 'continued' && o.session_id === sid).length).toBe(1);
  }, 120_000);
});

describe('flags OFF is origin/main, byte for byte; /mcp/chatgpt is origin/main with every flag ON', () => {
  const CASES = [];
  for (const who of ['keyless', 'trial']) for (const t of WALLED) if (!(who === 'trial' && PAID_ONLY_WALLED.has(t[0]))) CASES.push([who, ...t]);
  for (const flag of [undefined, '0']) {
    it.each(CASES)(`flags ${flag === undefined ? 'unset' : flag}: %s %s`, async (who, name, args) => {
      if (!O) { console.warn(`[commercial-wall] origin/main comparison not run: ${why}`); return; }
      clearFlags();
      if (flag !== undefined) for (const f of FLAGS) if (f !== 'DCHUB_COMMERCIAL_WALL_CLIENTS') process.env[f] = flag;
      const ip = nextIp();
      const key = who === 'trial' ? trialKey() : '';
      const here = await call(H, '/mcp', name, args, { ip, key });
      if (!MAIN_HAS_GATE && name === 'get_grid_intelligence') {
        // Before origin/main carries the rule: the keyless grid wall is the preview, with no email unlock (an email
        // opens nothing on a paid-only tool), and a paid key on the same call gets the full answer (the control).
        const a = norm(here.result);
        expect(a.length).toBeGreaterThan(50);
        // a wall (the harness's IP is past the anonymous cap here) or the preview, never the full answer
        expect(a).toMatch(/anon_hard_wall|preview_is_partial|_withheld/);
        // its email offer is the depth one (the key line may still offer a key for an email; it promises no unlock)
        expect(a).toContain('an email does not open the fields held back here');
        expect(a).not.toMatch(/opens more of this answer|email (?:opens|unlocks) the full|full (?:answer|brief) [^"]{0,40}with (?:their|an|your) email/i);
        const paid = norm((await call(H, '/mcp', name, args, { ip: nextIp(), key: PRO_KEY })).result);
        expect(paid).not.toMatch(/preview_is_partial|anon_hard_wall|an email does not open the fields/);
        return;
      }
      const main = await call(O, '/mcp', name, args, { ip, key });
      const a = norm(here.result), b = norm(main.result);
      expect(a.length).toBeGreaterThan(50);
      expect(a === b, firstDiff(a, b)).toBe(true);
    }, 120_000);
  }
  it('trial key, execute_plan (owner 2026-11-23): a preview whose steps ran keyless and which points at the paid path', async () => {
    clearFlags();
    const [, args] = WALLED.find((w) => w[0] === 'execute_plan');
    const here = await call(H, '/mcp', 'execute_plan', args, { ip: nextIp(), key: trialKey() });
    const t = norm(here.result);
    expect(t).toContain('\\"next_tool\\":\\"unlock_more_data\\"');
    expect(t).not.toContain('\\"next_tool\\":\\"bind_email\\"');
    const tok = (t.match(/RERUN\.([A-Za-z0-9_-]+)/) || [])[1];
    expect(tok, 'no rerun token').toBeTruthy();
    expect(Buffer.from(tok, 'base64url').toString()).toContain('"a":"mcp:anon:trial"');
  }, 120_000);
  it('trial key, get_grid_intelligence (owner 2026-11-23): the preview, not origin/main\'s email-bind wall', async () => {
    clearFlags();
    const [, args] = WALLED.find((w) => w[0] === 'get_grid_intelligence');
    const here = await call(H, '/mcp', 'get_grid_intelligence', args, { ip: nextIp(), key: trialKey() });
    const t = norm(here.result);
    expect(here.result && here.result.isError).toBeFalsy();
    expect(t).toContain('\\"tool\\":\\"get_grid_intelligence\\"');
    expect(t).not.toContain('is not email-bound yet');
    expect(t).not.toContain('"error":"paid_only"');
  }, 120_000);
  // On /mcp/chatgpt a trial key on a paid-full-only tool now reads the preview where origin/main answered paid_only:
  // keyless stays byte for byte; the trial half of those two tools is pinned to the preview, with no access block.
  it.each(WALLED)('/mcp/chatgpt every flag ON: %s is origin/main byte for byte', async (name, args) => {
    if (!O) { console.warn(`[commercial-wall] origin/main comparison not run: ${why}`); return; }
    for (const f of FLAGS) process.env[f] = '1';
    process.env.DCHUB_COMMERCIAL_WALL_CLIENTS = 'all';
    for (const who of ['keyless', 'trial']) {
      const ip = nextIp();
      const key = who === 'trial' ? trialKey() : '';
      const here = await call(H, '/mcp/chatgpt', name, args, { ip, key, headers: { 'user-agent': 'openai-mcp/1.0' } });
      const a = norm(here.result || here.error);
      expect(a).not.toMatch(/Access: partial|"access"|dchub\.cloud\/h\//);
      if (who === 'trial' && PAID_ONLY_WALLED.has(name)) {
        expect(here.result, 'a preview, not an error').toBeTruthy();
        expect(a).toMatch(/preview|_withheld/);
        continue;
      }
      const main = await call(O, '/mcp/chatgpt', name, args, { ip, key, headers: { 'user-agent': 'openai-mcp/1.0' } });
      const b = norm(main.result || main.error);
      expect(a === b, firstDiff(a, b)).toBe(true);
    }
  }, 180_000);
});

describe('get_access_status (DCHUB_ACCESS_STATUS_TOOL)', () => {
  const listNames = async () => {
    const r = await rpc(H, '/mcp', { jsonrpc: '2.0', id: rid++, method: 'tools/list' }, { 'x-dc-client-ip': nextIp() });
    return ((r.msg && r.msg.result && r.msg.result.tools) || []).map((t) => t.name);
  };
  it('flag off: absent from tools/list and not callable', async () => {
    const names = await listNames();
    expect(names.length).toBeGreaterThan(5);
    expect(names).not.toContain('get_access_status');
    const r = await call(H, '/mcp', 'get_access_status', {}, { key: trialKey() });
    const blob = JSON.stringify(r.result || r.error || {});
    expect(r.error || (r.result && r.result.isError)).toBeTruthy();
    expect(blob).not.toContain('upgraded_since_handoff');
  }, 60_000);
  // The stateless tools/list is a warm cache built once, and a coding CLI on bare /mcp gets the ten-tool light list; a
  // generic client's fresh session lists the FULL catalog from its own server, built with the flag as set now.
  const sessionListNames = async () => {
    const ip = nextIp();
    const h = { 'x-dc-client-ip': ip, 'user-agent': 'example-agent/1.0' };
    const ini = await rpc(H, '/mcp', { jsonrpc: '2.0', id: rid++, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'example-agent', version: '1.0' } } }, h);
    const sid = ini.headers['mcp-session-id'];
    expect(sid, 'no session id from initialize').toBeTruthy();
    await rpc(H, '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { ...h, 'mcp-session-id': sid });
    const r = await rpc(H, '/mcp', { jsonrpc: '2.0', id: rid++, method: 'tools/list' }, { ...h, 'mcp-session-id': sid });
    return ((r.msg && r.msg.result && r.msg.result.tools) || []).map((t) => t.name);
  };
  it('flag on: still never listed, callable by name, keyed read uses the caller key, no price or plan display name', async () => {
    process.env.DCHUB_ACCESS_STATUS_TOOL = '1';
    expect(await listNames()).not.toContain('get_access_status');
    const sessioned = await sessionListNames();
    expect(sessioned.length).toBeGreaterThan(40);   // the full catalog, so the filter is what keeps the tool out
    expect(sessioned).not.toContain('get_access_status');
    const key = trialKey();
    const n = entitlementReads.length;
    const r = await call(H, '/mcp', 'get_access_status', {}, { key });
    expect(r.result && !r.result.isError, JSON.stringify(r.error || r.result)).toBeTruthy();
    const sc = r.result.structuredContent;
    expect(sc).toMatchObject({ tier: 'developer', keyed: true, credits: 0, upgraded_since_handoff: true, excluded_tools: ['analyze_site', 'compare_sites'],
      allowance: { calls_per_day: 500, used_today: 3, remaining_today: 497, full_answers_per_tool_per_day: 25 } });
    expect(Object.keys(sc).sort()).toEqual(['allowance', 'as_of', 'credits', 'excluded_tools', 'keyed', 'tier', 'upgraded_since_handoff']);
    expect(JSON.stringify(r.result)).not.toMatch(/\$|\/month|Developer|plan_name|price/);
    expect(entitlementReads.slice(n)).toEqual([expect.objectContaining({ key, internal: '' })]);
    // keyless: the internal key plus identity_ref and session_ref, never a raw IP
    const ip = nextIp();
    const k = await call(H, '/mcp', 'get_access_status', {}, { ip });
    expect(k.result && k.result.structuredContent && k.result.structuredContent.keyed).toBe(false);
    const read = entitlementReads.at(-1);
    expect(read.key).toBe('');
    expect(read.internal).toBeTruthy();
    // the refs ride in a POST body, never the query string (a credential-shaped arg is cacheable at the edge)
    expect(read.method).toBe('POST');
    expect(read.q).toEqual({});
    expect(read.body.identity_ref).toBe('ip-' + sha(ip));
    expect(read.body).toHaveProperty('session_ref');
    expect(JSON.stringify(read.body)).not.toContain(ip);
  }, 60_000);
});

describe('DCHUB_AGENT_HANDOFF_RESOLVE: a handoff-linked keyless identity is served at the buyer\'s tier', () => {
  // The lookup answers {linked, api_key_hash, tier}: the server lifts c.tier for the call and never holds a key. Fields the
  // BACKEND withholds from a keyless read stay withheld (it gates by key), so this pins the lift, not a full answer.
  const tierOf = (r) => r && r.result && r.result.structuredContent && r.result.structuredContent.identity && r.result.structuredContent.identity.tier;
  it('off: no lookup, no lift; on and linked pro or developer: the call runs at that tier; pack, unlinked or keyed: no lift', async () => {
    linked = 'pro';
    anonCount = 0;
    let n = identityReads.length;
    const off = await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip: nextIp() });
    expect(tierOf(off)).toBeTruthy();
    expect(tierOf(off)).not.toBe('pro');
    expect(identityReads.length).toBe(n);
    process.env.DCHUB_AGENT_HANDOFF_RESOLVE = '1';
    S._setHandoffResolveLookupForTest(null);
    const ip = nextIp();
    const on = await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip });
    expect(tierOf(on)).toBe('pro');
    const blob = JSON.stringify(on.result);
    expect(blob).not.toContain('e'.repeat(64));
    expect(blob).not.toMatch(/Access: partial|dchub\.cloud\/h\//);   // a lifted Pro call gets no handoff block
    const read = identityReads.slice(n)[0];
    expect(read.internal).toBeTruthy();
    expect(read.method).toBe('POST');
    expect(read.q).toEqual({});
    expect(read.body.identity_ref).toBe('ip-' + sha(ip));
    expect(read.body).toHaveProperty('session_ref');
    expect(JSON.stringify(read.body)).not.toContain(ip);
    linked = 'developer';
    S._setHandoffResolveLookupForTest(null);
    expect(tierOf(await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip: nextIp() }))).toBe('developer');
    // a pack buyer: the credits sit on the buyer's key, so a keyless call is not lifted
    linked = 'credit_pack';
    S._setHandoffResolveLookupForTest(null);
    expect(tierOf(await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip: nextIp() }))).not.toMatch(/^(pro|developer|credit_pack)$/);
    linked = null;
    S._setHandoffResolveLookupForTest(null);
    expect(tierOf(await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip: nextIp() }))).not.toBe('pro');
    // a keyed caller is never looked up
    linked = 'pro';
    S._setHandoffResolveLookupForTest(null);
    n = identityReads.length;
    await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { key: trialKey() });
    expect(identityReads.length).toBe(n);
    linked = null;
  }, 90_000);
  it('P0-4: a linked keyless identity\'s next call to the same tool has no withheld field; the token rides X-DCHub-Linked-Key, never X-API-Key', async () => {
    const withheld = (r) => /_withheld|_in_pro|"score":null/.test(JSON.stringify(r && r.result));
    const ip = nextIp();
    anonCount = 0;
    process.env.DCHUB_AGENT_HANDOFF_RESOLVE = '1';
    // before payment: no link, the keyless answer is a preview
    S._setHandoffResolveLookupForTest(null);
    let n = dataHits.length;
    const before = await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip });
    expect(withheld(before)).toBe(true);
    expect(dataHits.slice(n).every((h) => !h.linked && !h.apiKey)).toBe(true);
    // a link with no token (the backend's flag off): the tier lift alone, nothing forwarded, the backend still
    // answers keyless, so fields stay withheld (what P0-4 fixes)
    linked = 'pro'; linkedToken = '';
    S._setHandoffResolveLookupForTest(null);
    n = dataHits.length;
    const liftOnly = await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip });
    expect(dataHits.slice(n).every((h) => !h.linked && !h.apiKey)).toBe(true);
    expect(withheld(liftOnly)).toBe(true);
    // the human paid: the identity is linked and the backend hands this server a linked token
    linkedToken = LINKED_TOKEN;
    S._setHandoffResolveLookupForTest(null);
    n = dataHits.length;
    const after = await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip });
    expect(after.error).toBeFalsy();
    expect(withheld(after)).toBe(false);
    expect(JSON.stringify(after.result)).toContain('"completeness":"unrestricted"');
    const hits = dataHits.slice(n);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.linked === LINKED_TOKEN)).toBe(true);
    expect(hits.every((h) => h.apiKey === '')).toBe(true);   // never as X-API-Key
    expect(hits.filter((h) => h.linked).every((h) => h.callerTier === 'pro')).toBe(true);
    const blob = JSON.stringify(after.result);
    expect(blob).not.toContain(LINKED_TOKEN);
    expect(blob).not.toContain('e'.repeat(64));
    // flag off on this server: no lookup, no header, even with a token on offer
    delete process.env.DCHUB_AGENT_HANDOFF_RESOLVE;
    linkedToken = LINKED_TOKEN;
    S._setHandoffResolveLookupForTest(null);
    n = dataHits.length;
    const off = await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip: nextIp() });
    expect(dataHits.slice(n).every((h) => !h.linked)).toBe(true);
    expect(withheld(off)).toBe(true);
    // a malformed token is never forwarded
    process.env.DCHUB_AGENT_HANDOFF_RESOLVE = '1';
    linkedToken = 'dchl1.not-a-token';
    S._setHandoffResolveLookupForTest(null);
    n = dataHits.length;
    await call(H, '/mcp', 'get_market_intel', { market: 'dallas' }, { ip: nextIp() });
    expect(dataHits.slice(n).every((h) => !h.linked)).toBe(true);
  }, 90_000);
  it('execute_plan: a linked keyless caller past the per-IP wall gets its plan steps at its tier (2026-11-25)', async () => {
    // Live 2026-11-25: the plan itself was lifted, but its steps (loopback calls) re-entered as anonymous on the same IP,
    // so site_selection_canvas hit anon_hard_wall and the queue and grid steps were skipped for want of an ISO.
    const Q = 'Which US markets have the most available power and the shortest time to power for a 120 MW sovereign AI cluster?';
    const plan = async () => {
      const r = await call(H, '/mcp', 'execute_plan', { intent: Q }, { ip: nextIp() });
      return r.result.structuredContent || JSON.parse(r.result.content[0].text);
    };
    anonCount = 999;   // the caller's IP is past the hard wall (cap 20 x 10)
    process.env.DCHUB_AGENT_HANDOFF_RESOLVE = '1';
    linked = 'pro'; linkedToken = LINKED_TOKEN;
    S._setHandoffResolveLookupForTest(null);
    let n = dataHits.length;
    const o = await plan();
    const by = (t) => (o.executed || []).filter((e) => e.tool === t);
    const st = JSON.stringify((o.executed || []).map((e) => [e.step, e.tool, e.status, e.limit_hit || null]));
    expect(o.error, st).toBeUndefined();
    expect(by('site_selection_canvas')[0], st).toMatchObject({ status: 'executed' });
    expect(by('site_selection_canvas')[0].limit_hit, st).toBeUndefined();
    for (const t of ['get_interconnection_queue', 'get_grid_intelligence']) {
      expect(by(t).length, st).toBeGreaterThan(0);
      expect(by(t).every((e) => e.status !== 'skipped_unresolved'), st).toBe(true);
    }
    expect(by('get_interconnection_queue').map((e) => e.args && e.args.iso).sort(), st).toEqual(['ERCOT', 'MISO']);
    // the step's backend read carries the linked token (never X-API-Key)
    const canvasHit = dataHits.slice(n).find((h) => h.path === '/api/v1/site-selection/canvas');
    expect(canvasHit && canvasHit.linked).toBe(LINKED_TOKEN);
    expect(canvasHit.apiKey).toBe('');
    expect(JSON.stringify(o)).not.toContain(LINKED_TOKEN);
    // control: kill switch DCHUB_PLAN_HANDOFF_LINK=0 is the pre-fix server (the plan lifted, its steps anonymous on a
    // walled IP): the canvas step is walled and says so, and its dependants say the limit stopped them, not missing data.
    process.env.DCHUB_PLAN_HANDOFF_LINK = '0';
    S._setHandoffResolveLookupForTest(null);
    const u = await plan();
    delete process.env.DCHUB_PLAN_HANDOFF_LINK;
    const ust = JSON.stringify((u.executed || []).map((e) => [e.step, e.tool, e.status, e.limit_hit || null]));
    expect(u.error, ust).toBeUndefined();
    {
      const cv = (u.executed || []).find((e) => e.tool === 'site_selection_canvas');
      expect(cv && cv.limit_hit, ust).toBe('anon_hard_wall');
      expect(cv.depth, ust).toBeUndefined();
      const sk = (u.executed || []).filter((e) => e.status === 'skipped_unresolved');
      expect(sk.length, ust).toBeGreaterThan(0);
      for (const e of sk) {
        expect(e.blocked_by, ust).toMatchObject({ step: cv.step, tool: 'site_selection_canvas', limit: 'anon_hard_wall' });
        expect(e.note).toMatch(/hit this caller's DC Hub limit \(anon_hard_wall\).*not missing data/);
      }
      expect(JSON.stringify(u.next_tools || [])).not.toMatch(/coverage_gap/);
    }
    linked = null; linkedToken = '';
    delete process.env.DCHUB_AGENT_HANDOFF_RESOLVE;
    anonCount = 999;
  }, 120_000);
});
