// email-nudge-once-1123.test.mjs: #1594 (QA 2026-11-23, Des Moines IA), item 4.
//
// The get_api_key email nudge ("Share an email with get_api_key to keep this answer...", lib/wall-identity-v2.mjs
// EMAIL_ASK_LEAD) rode every keyless answer in one /mcp session: analyze_site, execute_plan and find_sites each carried
// it. lib/email-nudge-once.mjs shows it once per MCP session id (no session: client name + IP /24 for 30 minutes).
// Copy and dedupe only: the structured get_api_key call stays, gating is unchanged, /mcp/chatgpt is unchanged.
// Over the real /mcp handler with DCHUB_WALL_IDENTITY_V2=1 (on in production since 2026-11-21).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { EMAIL_ASK_LEAD } from '../lib/wall-identity-v2.mjs';
import { createNudgeMemo, nudgeOnce, stripNudge, nudgeIdentity, PAIR_TTL_MS } from '../lib/email-nudge-once.mjs';
import { ipPrefix, clientNameOf } from '../lib/wall-device-match.mjs';

const UA = 'Claude-User/1.0 (+https://claude.ai)';
const CALLS = [
  ['execute_plan', { intent: 'find 100 MW sites near Des Moines' }],
  ['find_sites', { state: 'IA', min_mw: 50 }],
  ['execute_plan', { intent: 'find 100 MW sites near Des Moines' }],
];
let H, fence, netN = 10;
const prevFlag = process.env.DCHUB_EMAIL_NUDGE_ONCE;
beforeAll(async () => {
  fence = fenceNetwork();
  delete process.env.DCHUB_EMAIL_NUDGE_ONCE;
  H = await startHarness({ env: { DCHUB_WALL_IDENTITY_V2: '1' }, extraRoutes: (p) => {
    if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
    if (p === '/api/v1/mcp/full-cap/peek') return { ok: true, n: 0 };
    if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/n' + Math.random().toString(36).slice(2, 7) };
    return undefined;
  } });
}, 120_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
  if (prevFlag === undefined) delete process.env.DCHUB_EMAIL_NUDGE_ONCE; else process.env.DCHUB_EMAIL_NUDGE_ONCE = prevFlag;
});

const nudges = (r) => {
  const res = (r.msg && r.msg.result) || {};
  const text = (res.content || []).map((b) => b.text || '').join('\n');
  return { inText: text.split(EMAIL_ASK_LEAD).length - 1, inSc: JSON.stringify(res.structuredContent || {}).split(EMAIL_ASK_LEAD).length - 1, res };
};
// One MCP session (or none), three keyless calls on it.
async function run({ path = '/mcp', withSession = true, ip = null, clientName = 'Claude Code' } = {}) {
  const hdr0 = { 'user-agent': UA, 'x-forwarded-for': ip || `198.51.${netN++}.7` };
  let hdr = hdr0;
  if (withSession) {
    const init = await H.init(path, clientName, hdr0);
    const sid = init.headers.get('mcp-session-id');
    expect(sid, 'an MCP session').toBeTruthy();
    hdr = { ...hdr0, 'mcp-session-id': sid };
    await H.post(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, hdr);
  }
  const out = [];
  for (const [t, a] of CALLS) out.push({ tool: t, ...nudges(await H.call(path, t, a, hdr)) });
  return out;
}
const carrying = (rs) => rs.filter((r) => r.inText + r.inSc > 0).length;

describe('one nudge per MCP session (/mcp, keyless, real handler)', () => {
  it('the kill switch off: the nudge repeats (what QA saw; proves the check below is not vacuous)', async () => {
    process.env.DCHUB_EMAIL_NUDGE_ONCE = '0';
    try { expect(carrying(await run())).toBeGreaterThanOrEqual(2); } finally { delete process.env.DCHUB_EMAIL_NUDGE_ONCE; }
  });
  it('three keyless calls in one session: the nudge on the first that carries it, none after', async () => {
    const rs = await run();
    expect(carrying(rs)).toBe(1);
    expect(rs[0].inText + rs[0].inSc, 'the first call keeps it').toBeGreaterThan(0);
    // the structured next step is unchanged: find_sites still names get_api_key as its email_ask tool
    const fs = rs[1].res.structuredContent || {};
    if (fs.email_ask) expect(fs.email_ask.tool).toBe('get_api_key');
  });
  it('a second session gets its own one nudge', async () => {
    expect(carrying(await run())).toBe(1);
    expect(carrying(await run())).toBe(1);
  });
  // A sessionless HTTP call from this harness arrives over a loopback socket, which the server reads as an
  // execute_plan step (loopback_step), so the sessionless fallback is pinned on the server's real step directly.
  it('no session id: the same client name and IP /24 get it once; another /24 or client gets its own', () => {
    const step = H.S._emailNudgeOnceStep;
    const res = () => ({ content: [{ type: 'text', text: 'Answer. ' + EMAIL_ASK_LEAD + ' and get a daily change note.' }],
      structuredContent: { email_ask: { tool: 'get_api_key', copy: EMAIL_ASK_LEAD + ' and get a daily change note.' } } });
    const has = (r) => JSON.stringify(r).includes(EMAIL_ASK_LEAD);
    const c = (ip, name = 'Cursor') => ({ session_id: null, client_ip: ip, client_name_raw: name, platform: 'cursor' });
    expect(has(step(res(), c('198.18.40.11')))).toBe(true);
    expect(has(step(res(), c('198.18.40.99'))), 'same /24, same client: none').toBe(false);
    expect(has(step(res(), c('198.18.41.11'))), 'another /24').toBe(true);
    expect(has(step(res(), c('198.18.40.12', 'Windsurf'))), 'another client name').toBe(true);
    expect(has(step(res(), { ...c('198.18.42.1'), loopback_step: true })), 'a plan step: never touched').toBe(true);
    expect(has(step(res(), { ...c('198.18.42.1'), loopback_step: true })), 'a plan step: never touched').toBe(true);
  });
});

describe('/mcp/chatgpt unchanged', () => {
  it('no nudge there before or after (0 mentions)', async () => {
    const rs = await run({ path: '/mcp/chatgpt', withSession: false, clientName: 'openai-mcp' });
    for (const r of rs) expect(r.inText + r.inSc, r.tool).toBe(0);
  });
  it('the step leaves a directory-profile result untouched even when it carries the sentence', async () => {
    const { DIRECTORY_PROFILE } = await import('../lib/chatgpt-directory.mjs');
    const res = { content: [{ type: 'text', text: EMAIL_ASK_LEAD + ' and get a daily change note.' }] };
    const c = { session_id: 'sess-chatgpt-1', profile: DIRECTORY_PROFILE, client_ip: '198.18.50.1' };
    expect(H.S._emailNudgeOnceStep(res, c)).toBe(res);
    expect(H.S._emailNudgeOnceStep(res, c)).toBe(res);
  });
});

describe('lib', () => {
  const LINE = EMAIL_ASK_LEAD + ' and get a daily change note for Des Moines Ia.';
  const RES = () => ({
    content: [{ type: 'text', text: JSON.stringify({ a: 1, email_ask: { tool: 'get_api_key', arguments: { email: 'x' }, copy: LINE },
      next_tools: [{ tool: 'get_api_key', args: {}, say: LINE }] }) }, { type: 'text', text: 'Answer. ' + LINE + ' More.' }],
    structuredContent: { a: 1, email_ask: { tool: 'get_api_key', arguments: { email: 'x' }, copy: LINE }, note: 'Keep. ' + LINE },
  });
  it('stripNudge takes the sentence out everywhere and keeps the structured call', () => {
    const out = stripNudge(RES());
    expect(JSON.stringify(out)).not.toContain(EMAIL_ASK_LEAD);
    expect(out.structuredContent.email_ask).toEqual({ tool: 'get_api_key', arguments: { email: 'x' } });
    expect(out.structuredContent.note).toBe('Keep.');
    expect(JSON.parse(out.content[0].text).next_tools[0]).toEqual({ tool: 'get_api_key', args: {} });
    expect(out.content[1].text).toBe('Answer. More.');
  });
  it('nudgeOnce: first per identity kept, later stripped; the pair window is 30 minutes', () => {
    let t = 0;
    const memo = createNudgeMemo({ now: () => t });
    const r1 = RES();
    expect(nudgeOnce(r1, 'pair:x', memo)).toBe(r1);
    expect(JSON.stringify(nudgeOnce(RES(), 'pair:x', memo))).not.toContain(EMAIL_ASK_LEAD);
    t += PAIR_TTL_MS + 1;
    const r3 = RES();
    expect(nudgeOnce(r3, 'pair:x', memo)).toBe(r3);
    const r4 = RES();
    expect(nudgeOnce(r4, '', memo), 'no identity: unchanged').toBe(r4);
  });
  it('nudgeIdentity: the session first, else the /24 + client name, else none', () => {
    const deps = { ipPrefix, clientNameOf, realSession: (s) => (s && s !== 'no-session' ? s : '') };
    expect(nudgeIdentity({ session_id: 'abc', client_ip: '198.18.1.2' }, deps)).toBe('sid:abc');
    const a = nudgeIdentity({ session_id: 'no-session', client_ip: '198.18.1.2', client_name_raw: 'Cursor' }, deps);
    expect(a).toMatch(/^pair:/);
    expect(nudgeIdentity({ client_ip: '198.18.1.200', client_name_raw: 'Cursor' }, deps)).toBe(a);
    expect(nudgeIdentity({ client_ip: '198.18.1.200', client_name_raw: 'Windsurf' }, deps)).not.toBe(a);
    expect(nudgeIdentity({ client_ip: '127.0.0.1' }, deps)).toBe('');
  });
});
