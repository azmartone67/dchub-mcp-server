// Dead-end walls (owner 2026-11-13, Grok): the seven digest-only depth walls name what opens their held-back
// fields, the 7-day free trial on the page their own human link opens (lib/wall-depth-trial.mjs, server.mjs
// _wallOfferFloorStep -> _depthTrial).
//
// Measured on main before this change, real /mcp handler (harness below, lean ON, outside peer, WorkOS on): every
// one of the seven walls read "One-click sign-in ... An account does not open the fields held back here." then
// "An email does not open the fields held back here ..." and the human link, and nothing that says what DOES open
// them. The relay page behind that link sells the 7-day trial (dchub-backend routes/human_relay), so the agent
// was told two refusals and never the unlock.
//
// Rules asserted, on the wire:
//   - each of the seven tools, on the trial / Pro walls and on the anonymous hard wall, sessionless and in a
//     session, carries the trial line, and the answer carries the human link it points at;
//   - the line does not repeat the URL (one pointer per response, r-relay-cap);
//   - order: the sign-in line and the digest line (the free path) first, the human line, then the trial line right
//     below the block that hands out the link (the digest line keeps its place directly above the human line);
//   - the wall row's offers_shown names 'trial' (and still 'oauth_signin' and 'digest');
//   - no plan name and no price in the line;
//   - a tool outside the seven, and every one of the seven with DCHUB_WALL_DEPTH_TRIAL=0, carries no trial line
//     (the CONTROL that shows the assertion can fail).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork, GUESS_ARGS } from './helpers/claude-directory-harness.mjs';
import { DEPTH_TRIAL_LEAD, DEPTH_TRIAL_TOOLS, depthTrialLine, depthTrialEligible, humanLinkOf, withDepthTrialLine,
  depthTrialOn } from '../lib/wall-depth-trial.mjs';
import { OAUTH_LEAD } from '../lib/wall-oauth-lead.mjs';
import { FLOOR_DIGEST_LEAD } from '../lib/wall-offer-floor.mjs';
import { offersShown, OFFER_KINDS } from '../lib/offers-shown.mjs';

const SEVEN = ['list_transactions', 'get_pipeline', 'get_dchub_recommendation', 'hyperscaler_deals', 'compare_isos',
  'get_intelligence_index', 'get_air_permit_context'];
const FORBIDDEN = /\$\s?\d|\bper month\b|\bmonthly\b|\b(?:developer|pro|enterprise|credit[_ ]pack|starter)\b|\bpricing\b|\bplan\b/i;
const SHORT = 'https://dchub.cloud/u/abcdef';

const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i, score: 50 + i }));
let H, fence, anonCount = 0;
const events = [];
const CLIENT_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
net.Socket.prototype._getpeername = function _getpeername() {
  const p = _peer.call(this);
  return H && this.server && this.localPort === H.PORT && p && p.address && CLIENT_PORTS.has(p.port)
    ? { ...p, address: '203.0.113.9' } : p;
};
const prevEnv = {};
const ENV = ['DCHUB_WORKOS_OAUTH_ENABLED', 'DCHUB_WALL_DEPTH_TRIAL', 'DCHUB_WALL_OFFER_FLOOR', 'DCHUB_LEAN_RESPONSES'];

beforeAll(async () => {
  for (const k of ENV) prevEnv[k] = process.env[k];
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_ANON_DAILY_CAP: '20' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
      if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
      if (p === '/api/v1/relay/short') return { ok: true, url: SHORT };
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      return { success: true, count: 12, total_count: 12, data: ROWS, results: ROWS, items: ROWS, markets: ROWS, rows: ROWS };
    },
  });
}, 60_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (H) await H.stop(); if (fence) fence.restore();
});
beforeEach(() => {
  process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1';
  for (const k of ['DCHUB_WALL_DEPTH_TRIAL', 'DCHUB_WALL_OFFER_FLOOR', 'DCHUB_LEAN_RESPONSES']) delete process.env[k];
});

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
        resolve({ msg, headers: res.headers });
      });
    });
    req.on('socket', (sock) => { const note = () => CLIENT_PORTS.add(sock.localPort); if (sock.localPort) note(); else sock.once('connect', note); });
    req.on('error', reject);
    req.end(data);
  });
}
let ip = 1, rid = 100;
const freshIp = () => `198.51.${100 + Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
async function call(name, hdr) {
  const before = events.length;
  const r = await rpc(hdr, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: GUESS_ARGS } });
  const result = (r.msg && r.msg.result) || {};
  const mine = () => events.slice(before).filter((e) => e.tool === name);
  for (let i = 0; i < 12 && !mine().length; i++) await new Promise((res) => setTimeout(res, 10));
  await new Promise((res) => setTimeout(res, 30));
  const blocks = (result.content || []).filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  return { result, blocks, rows: mine() };
}
async function session(ipAddr) {
  const hdr = { 'user-agent': 'node', 'x-dc-client-ip': ipAddr };
  const init = await rpc(hdr, { jsonrpc: '2.0', id: rid++, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
  const sid = init.headers['mcp-session-id'];
  await rpc({ ...hdr, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { ...hdr, 'mcp-session-id': sid };
}
// Sessionless twice, then twice in one session (the repeat walls the ask-once memo thins out).
async function runTool(name) {
  const out = [];
  const sl = { 'user-agent': 'node', 'x-dc-client-ip': freshIp() };
  for (const n of [1, 2]) out.push({ where: 'sessionless#' + n, ...(await call(name, sl)) });
  const s = await session(freshIp());
  for (const n of [1, 2]) out.push({ where: 'session#' + n, ...(await call(name, s)) });
  return out;
}
const at = (blocks, lead) => blocks.findIndex((t) => t.startsWith(lead));

// The walls of one tool that broke the rule, as readable strings ([] = clean).
function offenders(name, calls) {
  const bad = [];
  for (const c of calls) {
    if (!c.rows.length) { bad.push(`${name} ${c.where}: did not wall`); continue; }
    const link = humanLinkOf(c.result);
    const iT = at(c.blocks, DEPTH_TRIAL_LEAD), iO = at(c.blocks, OAUTH_LEAD), iD = at(c.blocks, FLOOR_DIGEST_LEAD);
    if (!link) bad.push(`${name} ${c.where}: no human link on the wall`);
    if (iT < 0) { bad.push(`${name} ${c.where}: no trial line [${c.blocks.map((b) => b.slice(0, 40)).join(' | ')}]`); continue; }
    if (/https?:\/\//.test(c.blocks[iT])) bad.push(`${name} ${c.where}: trial line repeats a URL`);
    const iH = c.blocks.findIndex((t, i) => i > 0 && !/^\s*[{[]/.test(t) && t.includes(link));   // the block handing out the link
    if (iH >= 0 && iT !== iH + 1) bad.push(`${name} ${c.where}: trial line is not right below the block with the link [${c.blocks.map((x) => x.slice(0, 50)).join(' | ')}]`);
    if (FORBIDDEN.test(c.blocks[iT])) bad.push(`${name} ${c.where}: plan or price in the trial line`);
    if (iO >= 0 && !(iO < iT)) bad.push(`${name} ${c.where}: trial line before the sign-in line`);
    if (iD >= 0 && !(iD < iT)) bad.push(`${name} ${c.where}: trial line ahead of the digest line`);
    for (const e of c.rows) {
      const offers = Array.isArray(e.offers_shown) ? e.offers_shown : [];
      if (!offers.includes('trial')) bad.push(`${name} ${c.where} row ${e.wall_status}: offers ${offers.join('+') || 'none'}`);
    }
  }
  return bad;
}

describe('the seven digest-only depth walls name the trial (wire, lean ON)', () => {
  it('pins the seven tools', () => {
    expect([...DEPTH_TRIAL_TOOLS].sort()).toEqual([...SEVEN].sort());
  });
  // get_air_permit_context answers the plain stub in full (its preview comes from the backend's own gate), so it walls
  // here only on the anonymous hard wall below; the other six wall on the plain stub too.
  it.each(SEVEN.filter((t) => t !== 'get_air_permit_context'))('%s: the trial / Pro wall, every repeat, carries the trial line after the free offers, below the human line', async (name) => {
    anonCount = 0;
    expect(offenders(name, await runTool(name))).toEqual([]);
  }, 60_000);
  it.each(SEVEN)('%s: the anonymous hard wall carries it too', async (name) => {
    anonCount = 999;
    expect(offenders(name, await runTool(name))).toEqual([]);
  }, 60_000);
  it('with sign-in unavailable (WorkOS off) the line is still there, and the free offers still lead', async () => {
    delete process.env.DCHUB_WORKOS_OAUTH_ENABLED;
    anonCount = 0;
    const calls = await runTool('list_transactions');
    expect(offenders('list_transactions', calls)).toEqual([]);
    for (const c of calls) {
      expect(at(c.blocks, OAUTH_LEAD)).toBe(-1);
      expect(at(c.blocks, DEPTH_TRIAL_LEAD)).toBeGreaterThan(1);
    }
  }, 60_000);
  it('a tool outside the seven gets no trial line (rank_markets: an email opens it)', async () => {
    anonCount = 0;
    const calls = await runTool('rank_markets');
    expect(calls.some((c) => c.rows.length), 'rank_markets walled').toBe(true);
    for (const c of calls) expect(at(c.blocks, DEPTH_TRIAL_LEAD), c.where).toBe(-1);
  }, 60_000);
  it('CONTROL: DCHUB_WALL_DEPTH_TRIAL=0 brings back the walls with no trial line', async () => {
    process.env.DCHUB_WALL_DEPTH_TRIAL = '0';
    anonCount = 0;
    const bad = [];
    for (const name of ['list_transactions', 'get_dchub_recommendation']) bad.push(...offenders(name, await runTool(name)));
    expect(bad.filter((b) => /no trial line/.test(b)).length).toBe(8);
  }, 60_000);
});

describe('server.mjs _wallOfferFloorStep: who gets the trial line', () => {
  let S;
  beforeAll(async () => { S = await import('../server.mjs'); });
  const wall = (o = {}) => ({ content: [{ type: 'text', text: '{"preview":true}' }, { type: 'text', text: 'Source: DC Hub (dchub.cloud)' }],
    structuredContent: { human_url: SHORT, ...o } });
  const ctx = (o = {}, tool = 'list_transactions') => ({ session_id: 's-depth-trial', platform: 'cursor', auth_source: 'none',
    tier: 'anonymous', _pendingWallHits: [{ name: tool, status: 'anon_hard_wall', sent: false }], ...o });
  const has = (r) => r.content.some((b) => typeof b.text === 'string' && b.text.startsWith(DEPTH_TRIAL_LEAD));
  it('an anonymous depth wall gets it after the sign-in and digest lines, ahead of the closing Source line', () => {
    const t = S._wallOfferFloorStep(wall(), 'list_transactions', ctx()).content.map((b) => b.text);
    expect(at(t, OAUTH_LEAD)).toBe(1);
    expect(at(t, FLOOR_DIGEST_LEAD)).toBe(2);
    expect(at(t, DEPTH_TRIAL_LEAD)).toBe(3);
    expect(t[4]).toBe('Source: DC Hub (dchub.cloud)');
  });
  it('with a human line, it sits right below it, and the digest line stays directly above the human line', () => {
    const w = wall();
    w.content.splice(1, 0, { type: 'text', text: '\u2192 **For your human:** open ' + SHORT + ' to see what your agent found.' });
    const t = S._wallOfferFloorStep(w, 'list_transactions', ctx()).content.map((b) => b.text);
    const iT = at(t, DEPTH_TRIAL_LEAD);
    expect(t[iT - 1]).toMatch(/For your human/);
    expect(t[iT - 2].startsWith(FLOOR_DIGEST_LEAD)).toBe(true);
  });
  it('a free keyed or signed-in caller gets it too (no sign-in line for the signed-in one)', () => {
    expect(has(S._wallOfferFloorStep(wall(), 'compare_isos', ctx({ api_key: 'dchub_free_x', tier: 'free' }, 'compare_isos')))).toBe(true);
    const out = S._wallOfferFloorStep(wall(), 'get_pipeline', ctx({ auth_oauth: true, tier: 'free' }, 'get_pipeline'));
    expect(at(out.content.map((b) => b.text), OAUTH_LEAD)).toBe(-1);
    expect(at(out.content.map((b) => b.text), DEPTH_TRIAL_LEAD)).toBeGreaterThan(0);
  });
  it.each(['starter', 'developer', 'pro'])('a %s caller already pays: no trial line', (tier) => {
    expect(has(S._wallOfferFloorStep(wall(), 'get_dchub_recommendation',
      ctx({ api_key: 'dchub_live_x', tier }, 'get_dchub_recommendation')))).toBe(false);
  });
  it('a depth wall outside the seven keeps the digest and gets no trial line (the scope is the seven)', () => {
    const out = S._wallOfferFloorStep(wall(), 'get_tax_incentives', ctx({}, 'get_tax_incentives'));
    expect(at(out.content.map((b) => b.text), FLOOR_DIGEST_LEAD), 'a depth wall').toBeGreaterThan(0);
    expect(has(out)).toBe(false);
  });
  it('no human link on the answer: no trial line (nothing to start it from)', () => {
    expect(has(S._wallOfferFloorStep(wall({ human_url: undefined }), 'list_transactions', ctx()))).toBe(false);
  });
  it.each([
    ['Grok (G3 fixed copy)', { platform: 'grok' }],
    ['the Claude directory profile', { profile: 'claude_directory' }],
    ['a plan step', { loopback_step: true }],
  ])('%s: no trial line', (_l, o) => {
    expect(has(S._wallOfferFloorStep(wall(), 'list_transactions', ctx(o)))).toBe(false);
  });
  it('a non-wall answer: untouched', () => {
    const input = wall();
    expect(S._wallOfferFloorStep(input, 'list_transactions', ctx({ _pendingWallHits: [] }))).toBe(input);
  });
});

describe('lib/wall-depth-trial.mjs', () => {
  const W = () => ({ content: [{ type: 'text', text: '{"preview":true}' }, { type: 'text', text: 'Source: DC Hub' }],
    structuredContent: { human_url: SHORT } });
  it('eligibility is pure and fail-closed', () => {
    const base = { tool: 'list_transactions', walled: true, depth: true, paid: false, link: SHORT, env: {} };
    expect(depthTrialEligible(base)).toBe(true);
    for (const k of ['walled', 'depth']) expect(depthTrialEligible({ ...base, [k]: false })).toBe(false);
    expect(depthTrialEligible({ ...base, paid: true })).toBe(false);
    expect(depthTrialEligible({ ...base, link: '' })).toBe(false);
    expect(depthTrialEligible({ ...base, tool: 'rank_markets' })).toBe(false);
    expect(depthTrialEligible({ ...base, env: { DCHUB_WALL_DEPTH_TRIAL: 'off' } })).toBe(false);
    expect(depthTrialOn({})).toBe(true);
  });
  it('humanLinkOf reads human_url, then for_your_human.url, and only a DC Hub relay link', () => {
    expect(humanLinkOf(W())).toBe(SHORT);
    expect(humanLinkOf({ structuredContent: { for_your_human: { url: SHORT } } })).toBe(SHORT);
    expect(humanLinkOf({ structuredContent: { human_url: 'https://evil.example/u/abcdef' } })).toBe('');
    expect(humanLinkOf({ structuredContent: { human_url: 'https://dchub.cloud/pricing' } })).toBe('');
    expect(humanLinkOf(null)).toBe('');
  });
  it('the line names the trial and its terms, points at human_url without repeating a URL, and no plan or price', () => {
    const l = depthTrialLine();
    expect(l.startsWith(DEPTH_TRIAL_LEAD)).toBe(true);
    expect(l).toContain('human_url');
    expect(l).not.toMatch(/https?:\/\//);
    expect(l).toMatch(/card is required/);
    expect(l).toMatch(/one trial per person/);
    expect(l).not.toMatch(FORBIDDEN);
  });
  it('withDepthTrialLine goes at `before`, else right after block 0, and tolerates junk', () => {
    expect(withDepthTrialLine(W(), 'x').content[1].text).toBe('x');
    expect(withDepthTrialLine(W(), 'x', { before: 2 }).content[2].text).toBe('x');
    expect(withDepthTrialLine(W(), 'x', { before: 99 }).content[1].text).toBe('x');
    expect(withDepthTrialLine(null, 'x')).toBe(null);
  });
  it('offers_shown names the trial line, and the kind list stays sorted', () => {
    expect(OFFER_KINDS).toContain('trial');
    expect(offersShown(withDepthTrialLine(W(), depthTrialLine()), '')).toContain('trial');
    expect(offersShown(W(), '')).not.toContain('trial');
    expect([...OFFER_KINDS]).toEqual([...OFFER_KINDS].slice().sort());
  });
});
