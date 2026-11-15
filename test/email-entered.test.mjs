// email_entered (Grok -> Brain 2026-11-08, ask 3): the email a caller enters is credited to the wall it
// last hit (lib/email-entered.mjs).
//
//   A. the lib: which results count as an email entered (success only), the memo (session, then key,
//      then IP; 24 h), the event body (no email, wall '' when none was seen).
//   B. over the real server.mjs app (loopback, stub backend): a keyless grid wall with the email line,
//      then bind_email / claim_free_key {email} / subscribe_digest in the same session, each POST one
//      email_entered naming get_grid_intelligence + 'line'; the responses are byte-identical with the
//      event off; a failed bind sends none; a held-key claim sends none; the kill switch sends none.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { createLastWallMemo, emailEntered, emailEnteredEventBody, callerKeys } from '../lib/email-entered.mjs';
// These pin the keyless preview a caller meets AFTER its first full answer of the day on the energy tools
// (lib/keyless-first-full.mjs, owner 2026-11-14); test/keyless-first-full.test.mjs covers the first answer.
process.env.DCHUB_KEYLESS_FIRST_FULL = '0';

const WALL = { event: 'quota_wall_hit', tool: 'rank_markets', wall_status: 'trial_used', email_ask: 'line' };

describe('A. lib/email-entered', () => {
  it('counts a successful entry only', () => {
    const e = { email: 'h@x.io' };
    expect(emailEntered('bind_email', e, { structuredContent: { bound: true } })).toEqual({ path: 'bind_email', apiKey: '' });
    expect(emailEntered('bind_email', e, { structuredContent: { ok: false, bound: false } })).toBeNull();
    expect(emailEntered('bind_email', {}, { structuredContent: { bound: true } })).toBeNull();
    expect(emailEntered('bind_email', e, { structuredContent: { bind_email_path: 'keyless_mint_bind', api_key: 'dch_live_m' } }))
      .toEqual({ path: 'bind_email', apiKey: 'dch_live_m' });
    expect(emailEntered('claim_free_key', e, { structuredContent: { api_key: 'dch_live_m' } })).toEqual({ path: 'claim_free_key', apiKey: 'dch_live_m' });
    expect(emailEntered('claim_free_key', {}, { structuredContent: { api_key: 'dch_live_m' } })).toBeNull();
    for (const held of [{ already_keyed: true }, { already_held: true }, { reused: true }, { gate: 'bind_email_required' }]) {
      expect(emailEntered('claim_free_key', e, { structuredContent: { api_key: 'k', ...held } })).toBeNull();
    }
    expect(emailEntered('claim_free_key', e, { isError: true, structuredContent: { api_key: 'k' } })).toBeNull();
    const txt = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
    expect(emailEntered('subscribe_digest', e, txt({ ok: true, sent: true }))).toEqual({ path: 'subscribe_digest', apiKey: '' });
    expect(emailEntered('subscribe_digest', e, txt({ ok: false }))).toBeNull();
    expect(emailEntered('subscribe_digest', e, txt({ error: 'API 500' }))).toBeNull();
    expect(emailEntered('subscribe_digest', e, { content: [{ type: 'text', text: 'not json' }] })).toBeNull();
    expect(emailEntered('get_grid_data', e, { structuredContent: { bound: true } })).toBeNull();
  });

  it('the memo matches session first, then key, then IP, and forgets after 24 h', () => {
    let t = 1000;
    const m = createLastWallMemo({ now: () => t });
    expect(m.note({ session_id: 's1', client_ip: '198.51.100.7' }, WALL)).toBe(true);
    expect(m.get({ session_id: 's1' })).toMatchObject({ tool: 'rank_markets', status: 'trial_used', ask: 'line', match: 'session' });
    // Grok opens a new session per call: the IP still matches.
    expect(m.get({ session_id: 's2', client_ip: '198.51.100.7' })).toMatchObject({ tool: 'rank_markets', match: 'ip' });
    m.note({ api_key: 'dch_live_a' }, { ...WALL, tool: 'get_pipeline', email_ask: 'digest_line' });
    expect(m.get({}, 'dch_live_a')).toMatchObject({ tool: 'get_pipeline', ask: 'digest_line', match: 'key' });
    expect(m.get({ session_id: 'nope' })).toBeNull();
    expect(m.note({ session_id: 'no-session' }, WALL)).toBe(false);        // the shared literal is no session
    expect(m.note({ session_id: 's3' }, { event: 'email_ask_shown', tool: 'x' })).toBe(false);
    t += 24 * 60 * 60 * 1000 + 1;
    expect(m.get({ session_id: 's1' })).toBeNull();
  });

  it('keys hash the api key and the IP; neither is kept raw', () => {
    const ks = callerKeys({ session_id: 's', api_key: 'dch_live_secret', client_ip: '203.0.113.9' }).map((k) => k[1]);
    expect(ks[0]).toBe('s:s');
    expect(ks.join(' ')).not.toContain('dch_live_secret');
    expect(ks.join(' ')).not.toContain('203.0.113.9');
  });

  it('the event body carries no email and names no wall when none was seen', () => {
    const b = emailEnteredEventBody({ c: { session_id: 's1', platform: 'claude' }, path: 'bind_email', wall: null });
    expect(b).toMatchObject({ event: 'email_entered', path: 'bind_email', tool: '', email_ask: '', match: '', session_id: 's1' });
    expect(JSON.stringify(b)).not.toContain('@');
  });
});

// ── B. the real app ────────────────────────────────────────────────────────────
const UA = { 'user-agent': 'Claude-User' };
const MINTED = 'dch_live_minted_for_email_entered_test';
let H, fence, ipN = 0, identifyOk = true, claimOk = true;

async function settle(quietMs = 250, maxMs = 5000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function session(ip) {
  const hdr = { ...UA, 'x-dc-client-ip': ip || `198.51.100.${++ipN}` };
  const init = await H.init('/mcp', 'claude-ai', hdr);
  return { ...hdr, 'mcp-session-id': init.headers.get('mcp-session-id') };
}
async function call(hdr, name, args) {
  const before = H.hits.length;
  const r = await H.call('/mcp', name, args, hdr);
  await settle();
  const res = (r.msg && r.msg.result) || {};
  return { res, events: H.hits.slice(before).filter((h) => h.path === '/api/v1/mcp/funnel-event' && h.body).map((h) => h.body) };
}
const entered = (r) => r.events.filter((e) => e.event === 'email_entered');

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p) => {
      if (p === '/api/v1/keys/claim') return claimOk ? { ok: true, api_key: MINTED, tier: 'identified' } : { status: 500, body: { error: 'down' } };
      if (p === '/api/v1/keys/identify') return identifyOk ? { ok: true, identified: true, email: 'h@x.io' } : { ok: false, message: 'rejected' };
      if (p === '/api/v1/opt-in/request') return { ok: true, sent: true };
      return undefined;
    },
  });
  H.S._readDeadline.signal = () => AbortSignal.timeout(120_000);
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { identifyOk = true; claimOk = true; delete process.env.DCHUB_EMAIL_ENTERED_EVENT; });

describe('B. email_entered over the real app', () => {
  it('a keyless grid wall, then bind_email in that session: one email_entered naming the wall and its ask', async () => {
    const hdr = await session();
    const w = await call(hdr, 'get_grid_intelligence', { iso: 'PJM' });
    const hit = w.events.find((e) => e.event === 'quota_wall_hit');
    expect(hit).toMatchObject({ tool: 'get_grid_intelligence', email_ask: 'line' });
    const b = await call(hdr, 'bind_email', { email: 'h@x.io' });
    expect(entered(b)).toHaveLength(1);
    expect(entered(b)[0]).toMatchObject({ event: 'email_entered', path: 'bind_email', tool: 'get_grid_intelligence',
                                          wall_status: hit.wall_status, email_ask: 'line', match: 'session', api_key: MINTED });
    expect(JSON.stringify(entered(b)[0])).not.toContain('h@x.io');
  });

  it('subscribe_digest after a wall is credited to it; a call that is not an email entry sends none', async () => {
    const hdr = await session();
    await call(hdr, 'get_interconnection_queue', { iso: 'PJM' });
    const d = await call(hdr, 'subscribe_digest', { email: 'h@x.io' });
    expect(entered(d)).toHaveLength(1);
    expect(entered(d)[0]).toMatchObject({ path: 'subscribe_digest', tool: 'get_interconnection_queue' });
    const n = await call(hdr, 'search_facilities', { query: 'ashburn' });
    expect(entered(n)).toEqual([]);
  });

  it('no wall seen: the entry is still counted, with no tool', async () => {
    const hdr = await session();
    const c = await call(hdr, 'claim_free_key', { email: 'h@x.io', client_name: 'email-entered-test' });
    expect(entered(c)).toHaveLength(1);
    expect(entered(c)[0]).toMatchObject({ path: 'claim_free_key', tool: '', match: '' });
  });

  it('a failed mint-bind sends none; a refused keyed bind sends none; a keyed bind sends one; the kill switch sends none', async () => {
    const anon = await session();
    await call(anon, 'get_grid_intelligence', { iso: 'PJM' });
    claimOk = false;
    expect(entered(await call(anon, 'bind_email', { email: 'h@x.io' }))).toEqual([]);
    const hdr = { ...(await session()), 'x-api-key': PRO_KEY };
    identifyOk = false;
    expect(entered(await call(hdr, 'bind_email', { email: 'h@x.io' }))).toEqual([]);
    identifyOk = true;
    const ok = await call(hdr, 'bind_email', { email: 'h@x.io' });
    expect(entered(ok)).toHaveLength(1);
    expect(entered(ok)[0]).toMatchObject({ path: 'bind_email', api_key: PRO_KEY });
    process.env.DCHUB_EMAIL_ENTERED_EVENT = '0';
    expect(entered(await call(hdr, 'bind_email', { email: 'h@x.io' }))).toEqual([]);
  });

  it('the response is the same with the event on and off (telemetry only)', async () => {
    const norm = (r) => JSON.stringify(r.res).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'SID')
    .replace(/\/go\/c\/[A-Za-z0-9._-]+/g, '/go/c/TOKEN')   // signed per session
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, 'TS');
    const ip = '203.0.113.77';
    const on = await call(await session(ip), 'bind_email', { email: 'h@x.io' });
    process.env.DCHUB_EMAIL_ENTERED_EVENT = '0';
    const off = await call(await session(ip), 'bind_email', { email: 'h@x.io' });
    expect(entered(on)).toHaveLength(1);
    expect(entered(off)).toEqual([]);
    expect(norm(on)).toBe(norm(off));
  });
});
