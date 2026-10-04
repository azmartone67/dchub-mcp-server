// retention-email-ask.test.mjs — growth plan §3 "Retention" (2026-09-28).
//
// claim_free_key and bind_email lead with ONE `Tell the user:` sentence the
// assistant repeats (the email ask; the masked address + a watch offer), then
// one `(agent: …)` line. The returning-key nudge (DCHUB_RETURN_NUDGE, default
// OFF) prepends a "Welcome back" line only for an eligible key, never for
// anonymous callers, our own traffic or the directory profiles, and never as a
// second Tell-the-user line.
//
// Real /mcp handler over HTTP against a stub backend, no network (harness from
// test/paywall-contract.test.mjs).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import * as R from '../lib/retention.mjs';
import { __test as OAUTH } from '../oauth.mjs';
import { _freeTierRuleText, _rungNum } from '../lib/tier-canon.mjs';

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'test-internal-key-not-a-real-secret';
const MINTED = 'dch_live_retentiontestminted0001';
// Keys the nudge tests present. Standing + validate answers per key.
const OLD_NOEMAIL = 'dch_live_retention_old_noemail_01';
const OLD_EMAIL = 'dch_live_retention_old_email_0001';
const OLD_ALERT = 'dch_live_retention_old_alert_0001';
const OLD_UNKNOWN = 'dch_live_retention_old_unknown_01';
const YOUNG = 'dch_live_retention_young_000001';
const DAY = 86400000;
const STANDING = {
  [OLD_NOEMAIL]: { found: true, age_days: 21, has_alert: false },
  [OLD_EMAIL]:   { found: true, age_days: 30, has_alert: false,
                   last_seen_at: new Date(Date.now() - 9 * DAY).toISOString(),
                   top_market: { slug: 'phoenix', name: 'Phoenix' } },
  [OLD_ALERT]:   { found: true, age_days: 30, has_alert: true },
  [OLD_UNKNOWN]: { found: true, age_days: 30 },                  // today's backend: no has_alert
  [YOUNG]:       { found: true, age_days: 2, has_alert: false },
  // Not what the backend does for a missing key — here so the anonymous guard
  // is what keeps an anonymous caller quiet, not an empty standing answer.
  '':            { found: true, age_days: 30, has_alert: false },
};
const EMAIL_OF = { [OLD_EMAIL]: 'jane@firm.com' };
let identifyBody = null;
let claimBody = null;
let standingHits = 0;
let claimResponse = null;

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

let S, PORT, httpServer, stub, prevBase, prevSecret;
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const p = url.pathname;
      if (p === '/api/v1/keys/claim') {
        claimBody = await readBody(req);
        res.end(JSON.stringify(claimResponse || { ok: true, api_key: MINTED, tier: 'identified',
          email_captured: !!claimBody.email, email: claimBody.email || null,
          free_tier_summary: { daily_calls: 10 } }));
        return;
      }
      if (p === '/api/v1/keys/identify') {
        identifyBody = await readBody(req);
        res.end(JSON.stringify({ ok: true, identified: true, email: identifyBody.email }));
        return;
      }
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        const ok = key === MINTED || key in STANDING;
        res.end(JSON.stringify(ok ? { valid: true, tier: 'free', email: EMAIL_OF[key] || null } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/keys/standing') {
        standingHits += 1;
        const raw = url.searchParams.get('api_key') || '';
        const key = (raw === 'undefined' || raw === 'null') ? '' : raw;
        res.end(JSON.stringify(STANDING[key] || { found: false, returning: false, age_days: 0 }));
        return;
      }
      if (p === '/api/v1/changes/since') {
        res.end(JSON.stringify({ ok: true, diff: { dcpi_movers: [
          { market_slug: 'phoenix', market: 'Phoenix', excess_power_score: 61.2, delta_7d: -3.4 },
          { market_slug: 'dallas', market: 'Dallas', excess_power_score: 70.1, delta_7d: 1.2 } ] } }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [], items: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterEach(() => {
  delete process.env.DCHUB_RETURN_NUDGE;
  delete process.env.DCHUB_PAYWALL_CONTRACT;
  claimResponse = null;
  S._resetReturnNudgeState();
});

afterAll(async () => {
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function post(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}

let ipN = 10;
let rpcId = 10;
async function session(path, clientName, key, extra = {}) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}), ...extra };
  const init = await post(path, h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    async call(name, args) {
      const { body } = await post(path, h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
      const result = JSON.parse(body).result || {};
      const text = (result.content || []).map((c) => c.text || '').join('\n');
      return { body, result, text, first: ((result.content || [])[0] || {}).text || '', sc: result.structuredContent || {} };
    },
    async list() {
      const { body } = await post(path, h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/list', params: {} });
      return (JSON.parse(body).result || {}).tools || [];
    },
  };
}
const tellCount = (t) => R.countTellLines(t);

// ── claim_free_key ─────────────────────────────────────────────────────────
describe('claim_free_key success leads with the email ask', () => {
  it('line 1 is the exact Tell-the-user sentence, line 2 the agent line, the key and connect_url survive', async () => {
    const s = await session('/mcp', 'Claude Code');
    const r = await s.call('claim_free_key', { client_name: 'retention-test' });
    const lines = r.first.split('\n');
    expect(lines[0]).toBe('Tell the user: "I set up a free DC Hub key. If you want it to work in future chats, tell me an email to tie it to. It\'s used only for key recovery and receipts unless you also ask for alerts."');
    expect(lines[1]).toBe('(agent: pass an email only if the user typed it here, then call bind_email. Hosted clients: give the user connect_url to paste as the connector URL.)');
    expect(tellCount(r.text)).toBe(1);
    expect(r.text).not.toContain('One free step so this key is still yours tomorrow');   // one email ask, not two
    expect(r.sc.next_tool).toBe('bind_email');
    expect(r.text).toContain(MINTED);
    expect(r.sc.api_key).toBe(MINTED);
    expect(r.sc.connect_url).toContain(MINTED);
    expect(r.sc.persist_config).toBeTruthy();
    expect(r.result.isError).not.toBe(true);
  });

  it('limits agree with the published free-tier rule: daily full answers, no call total (B1)', async () => {
    const s = await session('/mcp', 'Claude Code');
    const r = await s.call('claim_free_key', { client_name: 'retention-test' });
    expect(r.sc.daily_limit).toBeNull();
    expect(r.sc.free_calls_total).toBeUndefined();
    expect(r.sc.daily_full_answers_per_tool).toBe(2);
    expect(r.sc.daily_limit_with_email).toBe(50);
    expect(r.sc.full_answers_per_tool_per_day_with_email).toBe(10);
    expect(r.sc.free_tier_rule).toBe('Anonymous: previews, no key needed. Free key: previews plus 2 full answers per tool per day. Add an email: 50 calls/day (up to 10 full answers per tool per day). Paid plans: dchub.cloud/pricing.');
    expect(r.text).not.toMatch(/Free tier = 10 calls\/day/);
  });

  it('with an email at claim: no ask (it was just given), bound rung reported', async () => {
    const s = await session('/mcp', 'Claude Code');
    const r = await s.call('claim_free_key', { client_name: 'retention-test', email: 'jane@firm.com' });
    expect(r.first.startsWith('Tell the user:')).toBe(false);
    expect(tellCount(r.text)).toBe(0);
    expect(r.sc.daily_limit).toBe(_rungNum('identified'));
    expect(r.sc.free_calls_total).toBeUndefined();
  });

  it('the paywall contract (Grok, or DCHUB_PAYWALL_CONTRACT=on) no longer rewrites it: one Tell line, connect_url kept', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    for (const client of ['grok', 'Claude Code']) {
      const s = await session('/mcp', client);
      const r = await s.call('claim_free_key', { client_name: 'retention-test' });
      expect(r.first.split('\n')[0]).toMatch(/^Tell the user: "I set up a free DC Hub key\./);
      expect(tellCount(r.text)).toBe(1);
      expect(r.sc.connect_url).toContain(MINTED);
      expect(r.sc.paywall_contract).toBeUndefined();
    }
  });
});

// ── bind_email ─────────────────────────────────────────────────────────────
describe('bind_email success leads with the masked address and a watch offer', () => {
  it('exact first line (masked, neutral market), agent line names real tools, one Tell line', async () => {
    const s = await session('/mcp', 'Claude Code', OLD_NOEMAIL);
    const r = await s.call('bind_email', { email: 'jane@firm.com' });
    const lines = r.first.split('\n');
    expect(lines[0]).toBe('Tell the user: "Done. Your DC Hub key is tied to j•••@firm.com and can be recovered. Want me to watch anything? I can email you when a market\'s power score moves, when a site you saved changes, or weekly with what changed in the markets you asked about."');
    expect(lines[1]).toBe('(agent: set_market_alert market=<slug> channel=email · save_site then set_site_alert saved_site_id=<id> notify_email=jane@firm.com · subscribe_digest email=jane@firm.com (confirm link). Only after an explicit yes.)');
    expect(lines[0]).not.toContain('jane@');
    expect(tellCount(r.text)).toBe(1);
    expect(r.sc.bound).toBe(true);
    expect(r.sc.daily_limit).toBe(50);
    expect(r.sc.full_answers_per_tool_per_day).toBe(10);
    expect(r.sc.free_tier_rule).toBe(_freeTierRuleText());
    expect(r.text).toContain('Free with an email: 50 calls/day (up to 10 full answers per tool per day).');
  });

  it('the agent line names tools and params that exist on /mcp', async () => {
    const s = await session('/mcp', 'Claude Code');
    const tools = Object.fromEntries((await s.list()).map((t) => [t.name, Object.keys((t.inputSchema || {}).properties || {})]));
    expect(tools.set_market_alert).toEqual(expect.arrayContaining(['market', 'channel']));
    expect(tools.save_site).toBeDefined();
    expect(tools.set_site_alert).toEqual(expect.arrayContaining(['saved_site_id', 'notify_email']));
    expect(tools.subscribe_digest).toEqual(expect.arrayContaining(['email']));
    const agent = R.bindAgentText('a@b.co', null);
    for (const [tool, params] of [['set_market_alert', ['market', 'channel']], ['set_site_alert', ['saved_site_id', 'notify_email']], ['subscribe_digest', ['email']]]) {
      expect(agent).toContain(tool);
      for (const p of params) expect(agent).toContain(p + '=');
    }
  });

  it('failure path is unchanged: no Tell line', async () => {
    const s = await session('/mcp', 'Claude Code', OLD_NOEMAIL);
    const r = await s.call('bind_email', { email: '' });
    expect(tellCount(r.text)).toBe(0);
  });
});

describe('maskEmail', () => {
  it('first char + ••• + @domain; malformed masks whole', () => {
    expect(R.maskEmail('jane@firm.com')).toBe('j•••@firm.com');
    expect(R.maskEmail('J.Doe+x@sub.firm.co.uk')).toBe('J•••@sub.firm.co.uk');
    expect(R.maskEmail('nope')).toBe('•••');
    expect(R.maskEmail('@firm.com')).toBe('•••');
    expect(R.maskEmail('a@')).toBe('•••');
  });
});

// ── returning-key nudge ────────────────────────────────────────────────────
const TOOL = 'get_changes';
describe('returning-key nudge', () => {
  it('flag off (default): no standing read, no line — same result object', async () => {
    const before = standingHits;
    const s = await session('/mcp', 'Claude Code', OLD_NOEMAIL);
    const r = await s.call(TOOL, { since: '7d' });
    expect(r.text).not.toMatch(/Welcome back/);
    expect(standingHits).toBe(before);
    const obj = { content: [{ type: 'text', text: 'x' }] };
    expect(await S._returnNudgeStep(obj, TOOL, {})).toBe(obj);
  });

  it('flag off and flag on-but-ineligible give byte-identical content', async () => {
    const off = await (await session('/mcp', 'Claude Code', OLD_ALERT)).call(TOOL, { since: '7d' });
    process.env.DCHUB_RETURN_NUDGE = 'on';
    const on = await (await session('/mcp', 'Claude Code', OLD_ALERT)).call(TOOL, { since: '7d' });
    const strip = (t) => t.replace(/"(generated_at|retrieved_at|as_of|served_at|request_id|timestamp)":"[^"]*"/g, '');
    expect(strip(on.first)).toBe(strip(off.first));
  });

  it('no email bound → the "Give me an email" line, prepended, answer intact, once a week', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    const s = await session('/mcp', 'Claude Code', OLD_NOEMAIL);
    const r = await s.call(TOOL, { since: '7d' });
    expect(r.first.split('\n')[0]).toBe('Tell the user: "Welcome back. Give me an email and I\'ll keep this key recoverable and tell you when the markets you ask about change."');
    expect(tellCount(r.text)).toBe(1);
    expect(r.first).toContain('"ok":true');
    const again = await s.call(TOOL, { since: '7d' });
    expect(again.text).not.toMatch(/Welcome back/);
  });

  it('email bound + a real move in the key\'s market → the DCPI line', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    const s = await session('/mcp', 'Claude Code', OLD_EMAIL);
    const r = await s.call(TOOL, { since: '7d' });
    expect(r.first.split('\n')[0]).toBe('Tell the user: "Welcome back. Since your last check 9 days ago, Phoenix\'s DCPI score moved −3.4 points. Want an email next time it moves?"');
    expect(tellCount(r.text)).toBe(1);
  });

  it('skipped: key with an alert, alert state unknown (today\'s backend), key under 7 days', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    for (const k of [OLD_ALERT, OLD_UNKNOWN, YOUNG]) {
      const r = await (await session('/mcp', 'Claude Code', k)).call(TOOL, { since: '7d' });
      expect(r.text, k).not.toMatch(/Welcome back/);
    }
  });

  it('never for anonymous callers or our own traffic', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    const anon = await (await session('/mcp', 'Claude Code')).call(TOOL, { since: '7d' });
    expect(anon.text).not.toMatch(/Welcome back/);
    for (const client of ['dchub-growth-audit', 'hub-grok-bot', 'dchub-internal', 'claude-code-mpp-check']) {
      S._resetReturnNudgeState();
      const r = await (await session('/mcp', client, OLD_NOEMAIL)).call(TOOL, { since: '7d' });
      expect(r.text, client).not.toMatch(/Welcome back/);
    }
  });

  // Mutation-checked 2026-09-28: dropping the profile check in
  // nudgeEligibleCaller makes /mcp/chatgpt and /mcp/claude fail here. /mcp/core
  // stays quiet even then — its delegates run outside the /mcp tool wrapper —
  // so for core this is a regression check, not proof of the guard.
  it('never on the directory profiles (/mcp/chatgpt, /mcp/claude, /mcp/core)', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    for (const path of ['/mcp/chatgpt', '/mcp/claude', '/mcp/core']) {
      S._resetReturnNudgeState();
      const s = await session(path, 'Claude Code', OLD_NOEMAIL);
      const names = (await s.list()).map((t) => t.name);
      expect(names.length, path).toBeGreaterThan(0);
      const pick = names.includes('search') ? ['search', { query: 'phoenix' }] : [names[0], {}];
      const r = await s.call(pick[0], pick[1]);
      expect(r.body.length, path).toBeGreaterThan(0);
      expect(r.text, path).not.toMatch(/Welcome back/);
    }
  });

  it('never a second Tell-the-user line: a paywall-contract wall already has one, the nudge stays out', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    const s = await session('/mcp', 'Claude Code', OLD_NOEMAIL);
    const r = await s.call('analyze_site', { lat: 33.45, lon: -112.07 });
    expect(r.first.split('\n')[0]).toMatch(/^Tell the user: "/);
    expect(tellCount(r.text)).toBe(1);
    expect(r.text).not.toMatch(/Welcome back/);
    // and the key's one weekly chance was not spent on a call that could not show it
    const next = await s.call(TOOL, { since: '7d' });
    expect(next.first.split('\n')[0]).toMatch(/^Tell the user: "Welcome back\./);
  });
});

describe('nudgeDecision (pure)', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');   // a Monday
  const base = { found: true, age_days: 14, has_alert: false };
  it('fails closed on every missing field', () => {
    expect(R.nudgeDecision({ standing: { ...base, found: false }, now }).kind).toBeNull();
    expect(R.nudgeDecision({ standing: { found: true, age_days: 14 }, now }).reason).toBe('alert_state_unknown');
    expect(R.nudgeDecision({ standing: { ...base, age_days: 6.9 }, now }).kind).toBeNull();
    expect(R.nudgeDecision({ standing: base, email: 'a@b.co', now }).reason).toBe('last_seen_unknown');
    expect(R.nudgeDecision({ standing: { ...base, last_seen_at: '2026-10-05T08:00:00Z' }, now }).reason).toBe('not_first_call_this_week');
    const seen3 = { ...base, last_seen_at: '2026-10-02T08:00:00Z', top_market: { slug: 'phoenix', name: 'Phoenix' } };
    expect(R.nudgeDecision({ standing: seen3, email: 'a@b.co', movers: [{ market_slug: 'phoenix', delta_7d: 5 }], now }).reason).toBe('last_check_under_7d');
    const seen9 = { ...seen3, last_seen_at: '2026-09-26T08:00:00Z' };
    expect(R.nudgeDecision({ standing: seen9, email: 'a@b.co', movers: [{ market_slug: 'dallas', delta_7d: 5 }], now }).reason).toBe('no_real_move');
    expect(R.nudgeDecision({ standing: seen9, email: 'a@b.co', movers: [{ market_slug: 'phoenix', delta_7d: 0.4 }], now }).reason).toBe('no_real_move');
    expect(R.nudgeDecision({ standing: seen9, email: 'a@b.co', movers: [{ market_slug: 'phoenix', delta_7d: 2 }], now }).line)
      .toBe('Tell the user: "Welcome back. Since your last check 9 days ago, Phoenix\'s DCPI score moved +2 points. Want an email next time it moves?"');
  });
  it('no-email line names the market when known', () => {
    expect(R.nudgeDecision({ standing: { ...base, top_market: { slug: 'phoenix', name: 'Phoenix' } }, now }).line)
      .toBe('Tell the user: "Welcome back. Give me an email and I\'ll keep this key recoverable and tell you when Phoenix changes."');
  });
  it('ISO week boundaries', () => {
    expect(R.isoWeek(Date.parse('2026-10-04T23:59:59Z'))).toBe('2026-W40');
    expect(R.isoWeek(Date.parse('2026-10-05T00:00:00Z'))).toBe('2026-W41');
    expect(R.isoWeek(Date.parse('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });
});

// ── email_source (backend be#5836) ─────────────────────────────────────────
describe('email_source sent to /keys/identify and /keys/claim', () => {
  afterEach(() => { delete process.env.DCHUB_OAUTH_ENABLED; OAUTH._tokens.clear(); });

  it('bind_email on an API-key request sends agent_supplied', async () => {
    identifyBody = null;
    const s = await session('/mcp', 'Claude Code', OLD_NOEMAIL);
    await s.call('bind_email', { email: 'jane@firm.com' });
    expect(identifyBody.email).toBe('jane@firm.com');
    expect(identifyBody.email_source).toBe('agent_supplied');
  });

  it('a raw key sent as a Bearer is still agent_supplied (bearer channel is not OAuth)', async () => {
    identifyBody = null;
    const s = await session('/mcp', 'Claude Code', null, { authorization: 'Bearer ' + OLD_NOEMAIL });
    await s.call('bind_email', { email: 'jane@firm.com' });
    expect(identifyBody.email_source).toBe('agent_supplied');
  });

  it('bind_email on an OAuth-authenticated request sends oauth', async () => {
    process.env.DCHUB_OAUTH_ENABLED = 'on';
    OAUTH._tokens.set('dcht_retention_test_token', { api_key: OLD_NOEMAIL, tier: 'free', expires: 0 });
    identifyBody = null;
    const s = await session('/mcp', 'Claude Code', null, { authorization: 'Bearer dcht_retention_test_token' });
    await s.call('bind_email', { email: 'jane@firm.com' });
    expect(identifyBody.email_source).toBe('oauth');
  });

  it('claim_free_key sends email_source only with an email', async () => {
    const s = await session('/mcp', 'Claude Code');
    await s.call('claim_free_key', { client_name: 'retention-test' });
    expect(claimBody.email).toBeUndefined();
    expect('email_source' in claimBody).toBe(false);
    const s2 = await session('/mcp', 'Claude Code');
    await s2.call('claim_free_key', { client_name: 'retention-test', email: 'jane@firm.com' });
    expect(claimBody.email_source).toBe('agent_supplied');
  });

  it('never human_typed: nothing on this server can know it', () => {
    for (const c of [null, {}, { auth_source: 'header' }, { auth_source: 'bearer' }, { auth_oauth: 'yes' }]) {
      expect(R.emailSourceFor(c)).toBe('agent_supplied');
    }
    expect(R.emailSourceFor({ auth_oauth: true })).toBe('oauth');
  });
});
