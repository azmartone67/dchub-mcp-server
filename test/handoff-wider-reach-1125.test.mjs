// handoff-wider-reach-1125.test.mjs — two flags that let the handoff `access` block (lib/commercial-wall.mjs,
// commercialWallStep) reach more walled callers. Both default OFF; the owner flips them.
//
//   DCHUB_HANDOFF_WITH_EMAIL_ASK  a keyless wall an email would finish keeps its email ask AND gains the block
//                                 (off: the step returns early there and the answer carries the ask alone).
//   DCHUB_HANDOFF_OVER_DIGEST     a wall whose only free offer is the weekly digest, and for which a handoff link was
//                                 minted on this call, leaves without the digest paragraph (off: both ride).
//
// Through the real /mcp handler (backend stubbed, network fenced, an outside peer address), with the flags already on
// in production set (DCHUB_EXP_UPGRADE_BLOCK=1, DCHUB_COMMERCIAL_WALL_CLIENTS=all):
//   * each new flag unset or '0': the answer is origin/main's, byte for byte (git-ref sandbox);
//   * WITH_EMAIL_ASK on: treatment gets `access` with the stubbed link AFTER the unchanged email ask; holdout gets the
//     email ask alone and still posts its exposure; one link per session; a failed mint attaches nothing;
//   * OVER_DIGEST on: treatment's answer names no subscribe_digest and carries the link, every other paragraph as it was;
//     holdout, a failed mint and a later wall in the same session (no link) keep the digest offer;
//   * exclusions, both flags on: a ChatGPT client, a QA caller and a bot caller get nothing; /mcp/chatgpt and /mcp/claude
//     are origin/main's;
//   * no price / plan word in any agent-facing field, no email or key in the mint body or the link.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import * as CW from '../lib/commercial-wall.mjs';
import * as MX from '../lib/monetization-experiments.mjs';
import { offersShown } from '../lib/offers-shown.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const NEW_FLAGS = [CW.HANDOFF_WITH_EMAIL_ASK_FLAG, CW.HANDOFF_OVER_DIGEST_FLAG];
const FLAGS = ['DCHUB_EXP_UPGRADE_BLOCK', 'DCHUB_COMMERCIAL_WALL_CLIENTS', ...NEW_FLAGS];
const clearFlags = () => { for (const f of FLAGS) delete process.env[f]; };
// Production's standing flags (2026-11-25): the block is live for every client but ChatGPT.
const PROD = () => { process.env.DCHUB_EXP_UPGRADE_BLOCK = '1'; process.env.DCHUB_COMMERCIAL_WALL_CLIENTS = 'all'; };
const MINT_URL = 'https://dchub.cloud/h/hx1.AbCdEfGh12345678';
const LINK = MINT_URL + '?via=upgrade_block';
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const EMAIL_TOOL = ['get_market_intel', { market: 'dallas' }];          // a keyless wall an email finishes
const DIGEST_TOOLS = [['list_transactions', {}], ['get_grid_intelligence', { iso: 'ERCOT' }], ['get_interconnection_queue', { iso: 'ERCOT' }],
  ['get_energy_prices', { iso: 'ERCOT' }]];                              // digest-only walls (an email opens nothing)

let H, O, SB, S, fence, why = '', mintMode = 'ok', anonCount = 999;
const mints = [];
const exposures = [];
const wallRows = [];   // quota_wall_hit rows (POST /api/v1/mcp/funnel-event): what the funnel's offers_shown reads
// A free key with an email on file, in the treatment arm (the holdouts helper's own assignment).
const BOUND_KEY = (() => {
  for (let i = 0; i < 400; i++) { const k = 'dch_live_HWBOUND' + String(i).padStart(4, '0') + 'abcdef0123456789'; if (MX.armFor(MX.keyRef(k), MX.UPGRADE_BLOCK) === MX.TREATMENT) return k; }
  throw new Error('no bound key in treatment');
})();
const routes = () => async (p, req, body) => {
  if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
  if (p === '/api/v1/keys/validate' && body && body.api_key === BOUND_KEY) return { valid: true, tier: 'free', developer_id: 'dev_bound', email: 'pat@example.com', tier_detail: { users_plan: 'free' } };
  if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') wallRows.push(body); return undefined; }
  if (p === CW.MINT_PATH) {
    mints.push({ body, internal: req.headers['x-internal-key'] });
    if (mintMode === 'fail') return { status: 500, body: { error: 'down' } };
    return { handoff_url: MINT_URL, token_id: 't1', expires_at: '2026-11-28T00:00:00Z' };
  }
  if (p === MX.EXPOSURE_PATH) { if (body && body.event === 'exposure') exposures.push(body); return { ok: true }; }
  if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
  return undefined;
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
  SB = createGitRefSandbox(REPO, 'origin/main', 'handoff-wider-reach-origin-main');
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
  clearFlags();
});
afterEach(() => { clearFlags(); mintMode = 'ok'; anonCount = 999; });

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
const nextIp = () => `198.51.131.${ipN++ % 250}`;
async function call(h, p, name, args, { ip = nextIp(), key = '', headers = {} } = {}) {
  const r = await rpc(h, p, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } },
    { 'x-dc-client-ip': ip, ...(key ? { 'x-api-key': key } : {}), ...headers });
  await new Promise((res) => setTimeout(res, 120));
  return { result: r.msg && r.msg.result, error: r.msg && r.msg.error, raw: r.raw };
}
async function session(ip) {
  const ini = await rpc(H, '/mcp', { jsonrpc: '2.0', id: rid++, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.0' } } }, { 'x-dc-client-ip': ip });
  const sid = ini.headers['mcp-session-id'];
  expect(sid).toBeTruthy();
  await rpc(H, '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': sid, 'x-dc-client-ip': ip });
  return sid;
}
// Capabilities messaging (2026-11-26) reworded the access block's agent_note (lib/commercial-wall.mjs ACCESS_AGENT_NOTE);
// origin/main still says the old sentence, so the comparison reads both as the new one. Nothing else is folded.
const norm = (r) => JSON.stringify(r)
  .replace(/Never claim a purchase until get_access_status confirms it\./g, 'Never claim a purchase or full access until a later result is no longer marked as a preview.')
  .replace(/https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[^"\s\\]*)?/g, 'RELAY')
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'TS')
  .replace(/(\\?")(ms|elapsed_ms|duration_ms|took_ms|latency_ms)(\\?"):\d+/g, '$1$2$3:0')
  .replace(/(plan|req|sess|run|rp)[-_][A-Za-z0-9]{6,}/g, '$1-ID')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID');
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a === b ? '' : `\n  here: ${a.slice(Math.max(0, i - 80), i + 160)}\n  main: ${b.slice(Math.max(0, i - 80), i + 160)}`; };
const texts = (r) => ((r && r.content) || []).filter((b) => b && b.type === 'text').map((b) => b.text);
const accessOf = (r) => r && r.structuredContent && r.structuredContent.access;
const hasAccess = (r) => JSON.stringify(r).includes('Access: partial');
const DIGEST = /subscribe_digest/;
const EMAIL_ASK = /Share your email and DC Hub opens more of this answer[^]*`bind_email`/;
function ipIn(arm) {
  for (let i = 0; i < 400; i++) { const ip = nextIp(); if (MX.armFor('ip-' + sha(ip), MX.UPGRADE_BLOCK) === arm) return ip; }
  throw new Error('no ip in ' + arm);
}
// The answer without the block: what the same wall reads with the block never attached.
const withoutBlock = (r) => {
  const { access, ...sc } = r.structuredContent || {};
  return { ...r, content: r.content.slice(0, -1), ...(r.structuredContent ? { structuredContent: sc } : {}) };
};

// ── pure ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('lib/commercial-wall.mjs: the two wider-reach flags and the digest cut', () => {
  it('both flags have the names the owner flips, default OFF, on only for 1 / true / yes / on', () => {
    expect(CW.HANDOFF_WITH_EMAIL_ASK_FLAG).toBe('DCHUB_HANDOFF_WITH_EMAIL_ASK');
    expect(CW.HANDOFF_OVER_DIGEST_FLAG).toBe('DCHUB_HANDOFF_OVER_DIGEST');
    for (const [fn, k] of [[CW.handoffWithEmailAskOn, CW.HANDOFF_WITH_EMAIL_ASK_FLAG], [CW.handoffOverDigestOn, CW.HANDOFF_OVER_DIGEST_FLAG]]) {
      expect(fn({}), k).toBe(false);
      for (const v of ['1', 'true', 'on', 'YES']) expect(fn({ [k]: v }), k + v).toBe(true);
      for (const v of ['0', 'off', 'false', '', '2']) expect(fn({ [k]: v }), k + v).toBe(false);
    }
    // neither flag turns the other on, and neither turns the block itself on
    expect(CW.handoffOverDigestOn({ [CW.HANDOFF_WITH_EMAIL_ASK_FLAG]: '1' })).toBe(false);
    expect(CW.handoffWithEmailAskOn({ [CW.HANDOFF_OVER_DIGEST_FLAG]: '1' })).toBe(false);
    expect(CW.commercialWallOn({ [CW.HANDOFF_WITH_EMAIL_ASK_FLAG]: '1', [CW.HANDOFF_OVER_DIGEST_FLAG]: '1' })).toBe(false);
  });
  const KEY = 'Add your email to get your DC Hub key and keep going.\nAsk your user for their email, then call `bind_email` with it: with no key it returns an email-bound key to send as the X-API-Key header (or `get_api_key` with the same email). Only use an address they gave you.';
  const DIG = 'Next step for your user (an email does not open the fields held back here): "DC Hub can email you a weekly summary of what changed here." If they want it (only use an address they gave you), call `subscribe_digest` with that email and source "depth_wall"; double opt-in, one-click unsubscribe.';
  const HUMAN = 'For the full list transactions, your user can open https://dchub.cloud/u/abcdef.';
  it('withoutDigestOffer cuts the digest paragraph only: a block of its own goes, a paragraph inside a block goes, the rest is byte for byte', () => {
    const json = { type: 'text', text: JSON.stringify({ note: 'call `subscribe_digest` weekly', rows: [1] }) };
    const r = { content: [json, { type: 'text', text: KEY + '\n\n' + DIG }, { type: 'text', text: DIG }, { type: 'text', text: DIG + '\n\n' + HUMAN }, { type: 'text', text: 'Source: DC Hub' }],
      structuredContent: { a: 1 } };
    const o = CW.withoutDigestOffer(r);
    expect(o.content).toEqual([json, { type: 'text', text: KEY }, { type: 'text', text: HUMAN }, { type: 'text', text: 'Source: DC Hub' }]);
    expect(o.structuredContent).toBe(r.structuredContent);
    expect(r.content).toHaveLength(5);   // the input is not mutated
    const none = { content: [json, { type: 'text', text: HUMAN }] };
    expect(CW.withoutDigestOffer(none)).toBe(none);
    expect(CW.withoutDigestOffer(null)).toBe(null);
  });
  it('digestOnlyOffer: the digest in prose and no email unlock ask; never when an email opens the answer or no digest rides', () => {
    const wall = (...t) => ({ content: t.map((text) => ({ type: 'text', text })) });
    expect(CW.digestOnlyOffer(wall(HUMAN, DIG), 'digest_line')).toBe(true);
    expect(CW.digestOnlyOffer(wall(HUMAN, KEY + '\n\n' + DIG), 'key_line')).toBe(true);   // the key line opens no field of the answer
    expect(CW.digestOnlyOffer(wall(HUMAN, DIG), 'line')).toBe(false);                     // the call was marked with an unlock ask
    expect(CW.digestOnlyOffer(wall(HUMAN, 'Ask for their email, then call `bind_email` with it.', DIG), undefined)).toBe(false);
    expect(CW.digestOnlyOffer(wall(HUMAN), 'digest_line')).toBe(false);                   // a mark with no paragraph to cut
    expect(CW.digestOnlyOffer(wall(HUMAN, KEY), undefined)).toBe(false);
    expect(CW.digestOnlyOffer(null, 'digest_line')).toBe(false);
  });
});

// ── DCHUB_HANDOFF_WITH_EMAIL_ASK ─────────────────────────────────────────────────────────────────────────────────────
describe('DCHUB_HANDOFF_WITH_EMAIL_ASK: a keyless wall an email finishes', () => {
  it.each([undefined, '0'])('flag %s: the email ask alone, no block, no mint, and the answer is origin/main\'s byte for byte', async (v) => {
    PROD();
    if (v !== undefined) for (const f of NEW_FLAGS) process.env[f] = v;
    const ip = ipIn(MX.TREATMENT);
    const nm = mints.length;
    const here = await call(H, '/mcp', ...EMAIL_TOOL, { ip });
    expect(S._wallUnlockFor(EMAIL_TOOL[0], here.result.structuredContent || {}, { tier: 'anonymous' })).toBe('email');
    expect(hasAccess(here.result)).toBe(false);
    expect(texts(here.result).join('\n')).toMatch(EMAIL_ASK);
    expect(mints.length).toBe(nm);
    if (!O) { console.warn(`[handoff-wider-reach] origin/main comparison not run: ${why}`); return; }
    const main = await call(O, '/mcp', ...EMAIL_TOOL, { ip });
    const a = norm(here.result), b = norm(main.result);
    expect(a.length).toBeGreaterThan(50);
    expect(a === b, firstDiff(a, b)).toBe(true);
  }, 120_000);

  it('flag on, treatment: the block with the stubbed link comes AFTER the email ask, which is unchanged', async () => {
    PROD();
    const off = await call(H, '/mcp', ...EMAIL_TOOL, { ip: ipIn(MX.TREATMENT) });
    process.env[CW.HANDOFF_WITH_EMAIL_ASK_FLAG] = '1';
    const nm = mints.length, ne = exposures.length;
    const ip = ipIn(MX.TREATMENT);
    const { result } = await call(H, '/mcp', ...EMAIL_TOOL, { ip });
    const a = accessOf(result);
    const t = texts(result);
    expect(hasAccess(result), 'the block is attached').toBe(true);
    expect(t.at(-1)).toMatch(/^Access: partial\./);
    expect(t.at(-1).endsWith(LINK)).toBe(true);
    if (result.structuredContent) {
      expect(a).toMatchObject({ status: 'partial', retry_after_unlock: true, handoff_url: LINK });
      expect(CW.UNLOCK_CODES).toContain(a.unlocks_with);
      expect(CW.agentFacingText({ access: a })).not.toMatch(CW.AGENT_TEXT_BANNED);
    }
    expect(t.at(-1)).not.toMatch(CW.AGENT_TEXT_BANNED);
    // the email ask is still there, and everything but the block is the flag-off answer
    expect(t.slice(0, -1).join('\n')).toMatch(EMAIL_ASK);
    expect(norm(withoutBlock(result))).toBe(norm(off.result));
    // one mint, one exposure, no email or key in the mint body
    expect(mints.length).toBe(nm + 1);
    expect(exposures.length).toBe(ne + 1);
    expect(exposures.at(-1)).toMatchObject({ test: MX.UPGRADE_BLOCK, tool: EMAIL_TOOL[0], arm: MX.TREATMENT, identity: 'ip-' + sha(ip) });
    const mb = mints.at(-1);
    expect(mb.internal).toBeTruthy();
    expect(mb.body).toMatchObject({ tool: EMAIL_TOOL[0], identity_ref: 'ip-' + sha(ip), is_qa: false });
    expect(JSON.stringify(mb.body)).not.toMatch(/@|dch_live_|dch_trial_/);
    expect(CW.validHandoffUrl(LINK)).toBe(true);
  }, 120_000);

  it('flag on, holdout: the email ask alone (no block, no mint), and the exposure is still posted', async () => {
    PROD();
    process.env[CW.HANDOFF_WITH_EMAIL_ASK_FLAG] = '1';
    const nm = mints.length, ne = exposures.length;
    const { result } = await call(H, '/mcp', ...EMAIL_TOOL, { ip: ipIn(MX.HOLDOUT) });
    expect(hasAccess(result)).toBe(false);
    expect(texts(result).join('\n')).toMatch(EMAIL_ASK);
    expect(mints.length).toBe(nm);
    expect(exposures.length).toBe(ne + 1);
    expect(exposures.at(-1)).toMatchObject({ tool: EMAIL_TOOL[0], arm: MX.HOLDOUT });
  }, 60_000);

  it('flag on: one link per session (the second email wall carries no link), and a failed mint attaches nothing', async () => {
    PROD();
    process.env[CW.HANDOFF_WITH_EMAIL_ASK_FLAG] = '1';
    const ip = ipIn(MX.TREATMENT);
    const sid = await session(ip);
    const nm = mints.length;
    const one = await call(H, '/mcp', ...EMAIL_TOOL, { ip, headers: { 'mcp-session-id': sid } });
    const two = await call(H, '/mcp', EMAIL_TOOL[0], { market: 'phoenix' }, { ip, headers: { 'mcp-session-id': sid } });
    expect(JSON.stringify(one.result)).toContain(LINK);
    expect(hasAccess(two.result)).toBe(true);
    expect(JSON.stringify(two.result)).not.toContain('dchub.cloud/h/');
    expect(mints.length).toBe(nm + 1);
    mintMode = 'fail';
    const failed = await call(H, '/mcp', ...EMAIL_TOOL, { ip: ipIn(MX.TREATMENT) });
    expect(hasAccess(failed.result)).toBe(false);
    expect(texts(failed.result).join('\n')).toMatch(EMAIL_ASK);
  }, 120_000);
});

// ── DCHUB_HANDOFF_OVER_DIGEST ────────────────────────────────────────────────────────────────────────────────────────
describe('DCHUB_HANDOFF_OVER_DIGEST: a digest-only wall that got a handoff link', () => {
  it.each([undefined, '0'])('flag %s: the digest offer and the block both ride, and the answer is origin/main\'s byte for byte', async (v) => {
    PROD();
    if (v !== undefined) for (const f of NEW_FLAGS) process.env[f] = v;
    for (const [name, args] of DIGEST_TOOLS.slice(0, 2)) {
      const ip = ipIn(MX.TREATMENT);
      const here = await call(H, '/mcp', name, args, { ip });
      expect(texts(here.result).join('\n'), name).toMatch(DIGEST);
      expect(JSON.stringify(here.result), name).toContain(LINK);
      if (!O) { console.warn(`[handoff-wider-reach] origin/main comparison not run: ${why}`); continue; }
      const main = await call(O, '/mcp', name, args, { ip });
      const a = norm(here.result), b = norm(main.result);
      expect(a === b, name + firstDiff(a, b)).toBe(true);
    }
  }, 120_000);

  // Both wall shapes: the anonymous hard wall (the IP is past its daily cap) and the preview (the digest paragraph
  // rides in a block with other paragraphs, ahead of the human line).
  const SHAPES = [...DIGEST_TOOLS.map((t) => [...t, 999]), ...DIGEST_TOOLS.slice(0, 2).map((t) => [...t, 0])];
  const rowFor = async (name, n0) => {
    await new Promise((r) => setTimeout(r, 150));
    return wallRows.slice(n0).filter((r) => r.tool === name).at(-1);
  };
  it.each(SHAPES)('flag on, treatment, %s %j (anon calls today: %i): no digest offer, the handoff link is the offer, every other paragraph as it was', async (name, args, anon) => {
    PROD();
    anonCount = anon;
    let n0 = wallRows.length;
    const off = await call(H, '/mcp', name, args, { ip: ipIn(MX.TREATMENT) });
    expect(texts(off.result).join('\n'), 'control: the flag-off wall carries the digest offer').toMatch(DIGEST);
    expect(offersShown(withoutBlock(off.result))).toContain('digest');
    const offRow = await rowFor(name, n0);
    expect(offRow && offRow.offers_shown, 'control: the flag-off wall row says digest').toContain('digest');
    process.env[CW.HANDOFF_OVER_DIGEST_FLAG] = '1';
    n0 = wallRows.length;
    const { result } = await call(H, '/mcp', name, args, { ip: ipIn(MX.TREATMENT) });
    expect(JSON.stringify(result)).not.toMatch(DIGEST);
    expect(offersShown(result)).not.toContain('digest');
    const t = texts(result);
    expect(t.at(-1)).toMatch(/^Access: partial\./);
    expect(t.at(-1).endsWith(LINK)).toBe(true);
    expect(t.at(-1)).not.toMatch(CW.AGENT_TEXT_BANNED);
    // the flag-off answer minus its digest paragraphs, nothing else moved
    const want = texts(off.result).map((x) => x.split('\n\n').filter((p) => !DIGEST.test(p)).join('\n\n')).filter((x) => x.trim());
    expect(t.map((x) => norm(x))).toEqual(want.map((x) => norm(x)));
    expect(norm(result.structuredContent || null)).toBe(norm(off.result.structuredContent || null));
    // the wall row the funnel reads no longer says the digest was offered; the rest of the row is unchanged
    const row = await rowFor(name, n0);
    expect(row, 'the wall row was sent').toBeTruthy();
    expect(row.offers_shown).toEqual(offRow.offers_shown.filter((o) => o !== 'digest'));
    expect(row.email_ask).toBe(offRow.email_ask);
  }, 120_000);

  it('flag on, a key with an email on file (the wall row is marked digest_line): the mark goes with the paragraph', async () => {
    PROD();
    const [name, args] = DIGEST_TOOLS[0];
    expect(MX.armFor(MX.keyRef(BOUND_KEY), MX.UPGRADE_BLOCK), 'the fixture key is in the treatment arm').toBe(MX.TREATMENT);
    let n0 = wallRows.length;
    const off = await call(H, '/mcp', name, args, { key: BOUND_KEY });
    expect(texts(off.result).join('\n')).toMatch(DIGEST);
    const offRow = await rowFor(name, n0);
    expect(offRow, 'control: the flag-off wall row').toMatchObject({ email_ask: 'digest_line' });
    expect(offRow.offers_shown).toContain('digest');
    process.env[CW.HANDOFF_OVER_DIGEST_FLAG] = '1';
    n0 = wallRows.length;
    const { result } = await call(H, '/mcp', name, args, { key: BOUND_KEY });
    expect(JSON.stringify(result)).not.toMatch(DIGEST);
    expect(JSON.stringify(result)).toContain('Access: partial');
    const row = await rowFor(name, n0);
    expect(row, 'the wall row was sent').toBeTruthy();
    expect(row.email_ask).toBeUndefined();
    expect(row.offers_shown).not.toContain('digest');
  }, 120_000);

  it('flag on, holdout: the digest offer stays and no block is attached', async () => {
    PROD();
    process.env[CW.HANDOFF_OVER_DIGEST_FLAG] = '1';
    const [name, args] = DIGEST_TOOLS[0];
    const { result } = await call(H, '/mcp', name, args, { ip: ipIn(MX.HOLDOUT) });
    expect(texts(result).join('\n')).toMatch(DIGEST);
    expect(hasAccess(result)).toBe(false);
  }, 60_000);

  it('flag on, the mint fails: the digest offer stays (no link was minted, so today\'s wall stands)', async () => {
    PROD();
    process.env[CW.HANDOFF_OVER_DIGEST_FLAG] = '1';
    mintMode = 'fail';
    const [name, args] = DIGEST_TOOLS[0];
    const { result } = await call(H, '/mcp', name, args, { ip: ipIn(MX.TREATMENT) });
    expect(texts(result).join('\n')).toMatch(DIGEST);
    expect(hasAccess(result)).toBe(false);
  }, 60_000);

  it('flag on, a later wall in the same session (block without a link): its digest offer is not cut', async () => {
    PROD();
    const ipOff = ipIn(MX.TREATMENT);
    const sidOff = await session(ipOff);
    await call(H, '/mcp', ...DIGEST_TOOLS[0], { ip: ipOff, headers: { 'mcp-session-id': sidOff } });
    const offTwo = await call(H, '/mcp', ...DIGEST_TOOLS[1], { ip: ipOff, headers: { 'mcp-session-id': sidOff } });
    expect(texts(offTwo.result).join('\n'), 'control: a second wall in a session still carries the digest offer').toMatch(DIGEST);
    process.env[CW.HANDOFF_OVER_DIGEST_FLAG] = '1';
    const ip = ipIn(MX.TREATMENT);
    const sid = await session(ip);
    const one = await call(H, '/mcp', ...DIGEST_TOOLS[0], { ip, headers: { 'mcp-session-id': sid } });
    const two = await call(H, '/mcp', ...DIGEST_TOOLS[1], { ip, headers: { 'mcp-session-id': sid } });
    expect(JSON.stringify(one.result)).toContain(LINK);
    expect(JSON.stringify(one.result)).not.toMatch(DIGEST);
    expect(hasAccess(two.result)).toBe(true);
    expect(JSON.stringify(two.result)).not.toContain('dchub.cloud/h/');
    expect(texts(two.result).join('\n')).toMatch(DIGEST);
  }, 120_000);

  it('both flags on, the email wall: its email ask is not a digest offer, so nothing is cut', async () => {
    PROD();
    const off = await call(H, '/mcp', ...EMAIL_TOOL, { ip: ipIn(MX.TREATMENT) });
    for (const f of NEW_FLAGS) process.env[f] = '1';
    const { result } = await call(H, '/mcp', ...EMAIL_TOOL, { ip: ipIn(MX.TREATMENT) });
    expect(JSON.stringify(result)).toContain(LINK);
    expect(norm(withoutBlock(result))).toBe(norm(off.result));
  }, 60_000);
});

// ── exclusions ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('exclusions hold with both flags on', () => {
  const CASES = [EMAIL_TOOL, DIGEST_TOOLS[0]];
  it.each([
    ['a ChatGPT client', { 'user-agent': 'openai-mcp/1.0 ChatGPT' }],
    ['a QA caller', { 'user-agent': 'dchub-qa-readonly/1.0' }],
    ['a bot caller', { 'user-agent': 'uptimerobot/2.0 health-check' }],
  ])('%s on /mcp gets no block, no mint and no exposure; the wall is the flag-off wall', async (_who, headers) => {
    for (const [name, args] of CASES) {
      PROD();
      const ip = ipIn(MX.TREATMENT);
      const off = await call(H, '/mcp', name, args, { ip, headers });
      for (const f of NEW_FLAGS) process.env[f] = '1';
      const nm = mints.length, ne = exposures.length;
      const on = await call(H, '/mcp', name, args, { ip, headers });
      expect(on.result, name).toBeTruthy();
      expect(hasAccess(on.result), name).toBe(false);
      expect(JSON.stringify(on.result), name).not.toContain('dchub.cloud/h/');
      expect(mints.length, name).toBe(nm);
      expect(exposures.length, name).toBe(ne);
      expect(norm(on.result), name).toBe(norm(off.result));
      clearFlags();
    }
  }, 120_000);

  it.each(['/mcp/chatgpt', '/mcp/claude'])('%s is origin/main\'s with both flags on', async (p) => {
    if (!O) { console.warn(`[handoff-wider-reach] origin/main comparison not run: ${why}`); return; }
    for (const [name, args] of CASES) {
      PROD();
      for (const f of NEW_FLAGS) process.env[f] = '1';
      const ip = ipIn(MX.TREATMENT);
      const nm = mints.length;
      const here = await call(H, p, name, args, { ip });
      const main = await call(O, p, name, args, { ip });
      expect(here.result || here.error, p + ' ' + name).toBeTruthy();
      const a = norm(here.result || here.error), b = norm(main.result || main.error);
      expect(a === b, p + ' ' + name + firstDiff(a, b)).toBe(true);
      expect(a).not.toContain('Access: partial');
      expect(mints.length).toBe(nm);
      clearFlags();
    }
  }, 120_000);
});
