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
import { readFileSync } from 'node:fs';
import * as R from '../lib/retention.mjs';
import { __test as OAUTH } from '../oauth.mjs';
import { _freeTierRuleText, _rungNum, _fullAnswersPerToolPerDay } from '../lib/tier-canon.mjs';
// This file pins the analyze_site wall / preview, which serves once a caller's daily full site runs
// are spent (DCHUB_KEYLESS_SITE_FULL, owner 2026-11-01); test/keyless-site-full-daily.test.mjs pins the runs.
process.env.DCHUB_KEYLESS_SITE_FULL = '0';

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
// Keys only the email_ask_shown tests use: events from earlier tests are fire-and-forget
// and can land late, so these tests count events for their OWN key only.
const EV_ONE = 'dch_live_retention_event_once_01';
const EV_OFF = 'dch_live_retention_event_off_001';
const DAY = 86400000;
const STANDING = {
  [OLD_NOEMAIL]: { found: true, age_days: 21, has_alert: false },
  [OLD_EMAIL]:   { found: true, age_days: 30, has_alert: false,
                   last_seen_at: new Date(Date.now() - 9 * DAY).toISOString(),
                   top_market: { slug: 'phoenix', name: 'Phoenix' } },
  [OLD_ALERT]:   { found: true, age_days: 30, has_alert: true },
  [OLD_UNKNOWN]: { found: true, age_days: 30 },                  // today's backend: no has_alert
  [YOUNG]:       { found: true, age_days: 0.1, has_alert: false },     // claimed this session
  [EV_ONE]:      { found: true, age_days: 21, has_alert: false },
  [EV_OFF]:      { found: true, age_days: 21, has_alert: false },
  // Not what the backend does for a missing key — here so the anonymous guard
  // is what keeps an anonymous caller quiet, not an empty standing answer.
  '':            { found: true, age_days: 30, has_alert: false },
};
const EMAIL_OF = { [OLD_EMAIL]: 'jane@firm.com' };
let identifyBody = null;
let claimBody = null;
let standingHits = 0;
let claimResponse = null;
const askEvents = [];   // POST /api/v1/mcp/funnel-event bodies with event=email_ask_shown
// Production payloads (read-only, 2026-10-25): /api/v1/grid/intelligence/MISO and
// /api/v1/interconnection-queue/by-iso?iso=MISO. The option-A wall test runs the real handler on
// them: mcp#1143's line passed a hand-built wall and never fired on a real one.
const FIXTURE = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const GRID_MISO = FIXTURE('grid-intelligence-miso.json');
const QUEUE_MISO = FIXTURE('interconnection-queue-by-iso-miso.json');
let mintShort = false;   // the option-A tests turn on a /u/ mint; the rest of the file keeps long links
let shortN = 0;
const SHORT_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';

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
      if (p === '/api/v1/grid/intelligence/MISO') { res.end(GRID_MISO); return; }
      if (p === '/api/v1/interconnection-queue/by-iso' && url.searchParams.get('iso') === 'MISO') { res.end(QUEUE_MISO); return; }
      if (p === '/api/v1/relay/short' && mintShort) {
        await readBody(req);
        let n = ++shortN, code = '';
        for (let i = 0; i < 6; i++) { code += SHORT_ALPHA[n % SHORT_ALPHA.length]; n = Math.floor(n / SHORT_ALPHA.length); }
        res.end(JSON.stringify({ ok: true, url: 'https://dchub.cloud/u/' + code }));
        return;
      }
      if (p === '/api/v1/mcp/funnel-event') {
        const b = await readBody(req);
        if (b && b.event === 'email_ask_shown') askEvents.push({ body: b, key: req.headers['x-internal-key'] });
        res.end('{"ok":true}');
        return;
      }
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
        // Owner 2026-10-31: a mover's excess_power_score is a DCPI sub-score (Pro and above), so a free
        // answer that carries one is partial and the nudge stays out of it. This file pins the nudge on
        // a full answer: the movers carry their move (delta_7d), not the score.
        res.end(JSON.stringify({ ok: true, diff: { dcpi_movers: [
          { market_slug: 'phoenix', market: 'Phoenix', delta_7d: -3.4 },
          { market_slug: 'dallas', market: 'Dallas', delta_7d: 1.2 } ] } }));
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
  // Before the import: server.mjs reads DCHUB_INTERNAL_KEY once at load, and the
  // email_ask_shown emitter sends nothing without it.
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  S = await import('../server.mjs');
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
    // Option B (owner 2026-10-25): the ask names what the email opens; the number is the canon's.
    expect(_fullAnswersPerToolPerDay('identified')).toBeGreaterThan(0);
    expect(lines[0]).toBe('Tell the user: "I set up a free DC Hub key. For grid, queue and market data it shows previews only. '
      + 'Tell me your email and it unlocks ' + _fullAnswersPerToolPerDay('identified') + ' full answers a day on those, '
      + 'and keeps working in your future chats. Your email is used only for this key and receipts."');
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

  it('no email bound → the "Add an email" line with the bound rung, prepended, answer intact, once a day', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    const s = await session('/mcp', 'Claude Code', OLD_NOEMAIL);
    const r = await s.call(TOOL, { since: '7d' });
    expect(_rungNum('identified')).toBeGreaterThan(0);
    expect(r.first.split('\n')[0]).toBe('Tell the user: "Welcome back. Add an email and I\'ll keep this key recoverable, raise it to '
      + _rungNum('identified') + ' calls a day, and tell you when the markets you ask about change."');
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

  it('skipped: key with an alert, key claimed today; alert state unknown no longer blocks the email ask', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    for (const k of [OLD_ALERT, YOUNG]) {
      const r = await (await session('/mcp', 'Claude Code', k)).call(TOOL, { since: '7d' });
      expect(r.text, k).not.toMatch(/Welcome back/);
    }
    const u = await (await session('/mcp', 'Claude Code', OLD_UNKNOWN)).call(TOOL, { since: '7d' });
    expect(u.first.split('\n')[0]).toMatch(/^Tell the user: "Welcome back\. Add an email/);
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
    // and the key's one daily chance was not spent on a call that could not show it
    const next = await s.call(TOOL, { since: '7d' });
    expect(next.first.split('\n')[0]).toMatch(/^Tell the user: "Welcome back\./);
  });
});

// 2026-10-24: one email_ask_shown funnel event per response that carried the
// line: the denominator for the bind readout. Never for a quiet call, never
// with the raw key leaving except to the internal endpoint.
describe('email_ask_shown event', () => {
  const settle = () => new Promise((r) => setTimeout(r, 300));
  const mine = (k) => askEvents.filter((e) => e.body && e.body.api_key === k);
  it('one event per ask, none for the quiet repeat, none for an ineligible key', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    const s = await session('/mcp', 'Claude Code', EV_ONE);
    const r = await s.call(TOOL, { since: '7d' });
    expect(r.first.split('\n')[0]).toMatch(/^Tell the user: "Welcome back\. Add an email/);
    await settle();
    expect(mine(EV_ONE).length).toBe(1);
    const e = mine(EV_ONE)[0];
    expect(e.key).toBe(SECRET);
    expect(e.body).toMatchObject({ event: 'email_ask_shown', tool: TOOL, kind: 'no_email', api_key: EV_ONE, is_qa: false });
    await s.call(TOOL, { since: '7d' });
    await settle();
    expect(mine(EV_ONE).length).toBe(1);
    const before = mine(OLD_ALERT).length;
    await (await session('/mcp', 'Claude Code', OLD_ALERT)).call(TOOL, { since: '7d' });
    await settle();
    expect(mine(OLD_ALERT).length).toBe(before);
  });

  it('kill switch DCHUB_EMAIL_ASK_EVENT=0: the line still shows, no event', async () => {
    process.env.DCHUB_RETURN_NUDGE = 'on';
    process.env.DCHUB_EMAIL_ASK_EVENT = '0';
    try {
      const r = await (await session('/mcp', 'Claude Code', EV_OFF)).call(TOOL, { since: '7d' });
      expect(r.first.split('\n')[0]).toMatch(/^Tell the user: "Welcome back\./);
      await settle();
      expect(mine(EV_OFF).length).toBe(0);
    } finally { delete process.env.DCHUB_EMAIL_ASK_EVENT; }
  });

  it('body builder refuses keyless callers and unknown kinds', () => {
    expect(R.emailAskEventBody({ c: {}, name: 'x', kind: 'no_email' })).toBeNull();
    expect(R.emailAskEventBody({ c: { api_key: 'k' }, name: 'x', kind: 'other' })).toBeNull();
    expect(R.emailAskEventBody({ c: { api_key: 'k' }, name: 'x', kind: 'moved' }).kind).toBe('moved');
  });
});

// ── Option B kill switch + option A's wall line (owner 2026-10-25) ───────────
describe('claim ask: kill switch restores the recovery wording', () => {
  it('DCHUB_CLAIM_BENEFIT_ASK=0', async () => {
    process.env.DCHUB_CLAIM_BENEFIT_ASK = '0';
    try {
      const r = await (await session('/mcp', 'Claude Code')).call('claim_free_key', { client_name: 'retention-test' });
      expect(r.first.split('\n')[0]).toBe('Tell the user: "' + R.CLAIM_TELL_TEXT + '"');
    } finally { delete process.env.DCHUB_CLAIM_BENEFIT_ASK; }
  });
  it('no canon number: the line drops it rather than guess', () => {
    for (const bad of [null, undefined, 0, -1, 2.5, 'ten']) {
      expect(R.claimBenefitText(bad), String(bad)).toContain('it unlocks full answers on those');
    }
  });
});

describe('wall email line (option A, agent half)', () => {
  // The wall's ONE human line, through the real /mcp handler on production payloads, with the /u/
  // mint answering as production does. Keyless and a free key with no email; both tools.
  const HUMAN = '→ **For your human:**';
  const humanLines = (t) => t.split('\n').filter((l) => l.includes(HUMAN) || /^\s*(\*\*)?Tell the user:/.test(l));
  const wallCall = async (tool, key, extra) => {
    S._resetReturnNudgeState();
    return (await session('/mcp', 'Claude Code', key, { 'user-agent': 'Claude-User', ...extra })).call(tool, { iso: 'MISO' });
  };
  beforeAll(() => { mintShort = true; });
  afterAll(() => { mintShort = false; });

  it('a free, email-less caller on a real grid / queue wall: the one human line is the email unlock, on the /u/ link', async () => {
    // Code-default transport (walls and previews isError). The prod transport (both 0, block 0 split
    // to pure JSON) is test/wall-email-line-prod-transport.test.mjs: DCHUB_PREVIEW_ISERROR is read at load.
    for (const tool of R.WALL_EMAIL_TELL_TOOLS) {
      for (const key of [undefined, OLD_UNKNOWN]) {
        const at = tool + ' ' + (key ? 'free key' : 'keyless');
        const r = await wallCall(tool, key);
        const url = r.sc.human_url;
        expect(url, at).toMatch(/^https:\/\/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}$/);
        expect(humanLines(r.text), at).toEqual([HUMAN + ' ' + R.wallEmailLineText(url)]);
        expect(tellCount(r.text), at).toBe(0);                       // no Tell-the-user line was added
        expect(r.sc.human_message, at).toBe(R.wallEmailLineText(url));
        expect(r.sc.user_message, at).toBe(R.wallEmailLineText(url));
        expect(r.text, at).not.toMatch(/paid DC Hub plan|plans that include/);
      }
    }
  });

  it('the line is the owner-approved wording, verbatim', () => {
    expect(R.wallEmailLineText('https://dchub.cloud/u/abc234')).toBe(
      "DC Hub held back part of this answer. Reply with your email and I'll unlock the full data free, "
      + 'in this chat and future ones. Your email is used only for this key and receipts. '
      + 'Or open this link: https://dchub.cloud/u/abc234');
  });

  it('never: email bound, get_market_intel, kill switch; the wall keeps its own one line', async () => {
    const held = /held back part of this answer/;
    const bound = await wallCall('get_grid_intelligence', OLD_EMAIL);
    expect(bound.text).not.toMatch(held);
    const mi = await wallCall('get_market_intel', undefined);
    expect(mi.text).not.toMatch(held);
    process.env.DCHUB_WALL_EMAIL_TELL = '0';
    try {
      for (const tool of R.WALL_EMAIL_TELL_TOOLS) {
        const r = await wallCall(tool, undefined);
        expect(r.text, tool).not.toMatch(held);
        expect(humanLines(r.text).length, tool).toBe(1);             // the wall's own line, unchanged
      }
    } finally { delete process.env.DCHUB_WALL_EMAIL_TELL; }
  });

  it('step guards: no session, identified, capacity, keyless cap, foreign link, no human line', () => {
    const URL = 'https://dchub.cloud/upgrade/h/abc.0123456789abcdef0123456789abcdef';
    const wall = (extra = {}, line = HUMAN + ' this answer hid x; open ' + URL + ' to see.') => {
      const sc = { ok: true, tool: 'get_grid_intelligence', free_preview_only: true, preview_is_partial: true,
                   withheld: ['constraint_score'], _upgrade: { tier: 'free' }, human_url: URL, human_message: 'x', ...extra };
      return { content: [{ type: 'text', text: JSON.stringify(sc) }, ...(line ? [{ type: 'text', text: line }] : [])], structuredContent: sc };
    };
    const base = { api_key: 'dch_live_wall_line_0001', session_id: '3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b',
                   tier: 'free', platform: 'claude', client_ua: 'Claude-User' };
    const run = (c, res) => S._ctxALS.run({ ...base, ...c }, () => S._wallEmailLineStep(res, 'get_grid_intelligence'));
    expect(run({}, wall()).content[1].text).toBe(HUMAN + ' ' + R.wallEmailLineText(URL));   // the positive control
    const tell = run({}, wall({}, 'Tell the user: "open ' + URL + '"'));
    expect(tell.content[1].text).toBe('Tell the user: "' + R.wallEmailLineText(URL) + '"');  // the paywall contract's form
    const same = (c, res) => expect(run(c, res)).toBe(res);
    same({ session_id: '' }, wall());
    same({ tier: 'identified' }, wall());
    same({ email: 'a@b.co' }, wall());
    same({}, wall({ _upgrade: { remaining_today: 0 } }));                 // capacity: checkout stays first
    same({}, wall({ unlock_kind: 'email_cap' }));                         // keyless cap: its own email copy
    same({}, wall({ human_url: 'https://evil.example/u/x' }));
    same({}, wall({}, null));                                             // no human line, no linked copy: untouched
    const repeat = wall({ human_message: 'hit the paid data boundary. ' + URL, user_message: 'x' }, null);
    const rep = run({}, repeat);                                          // r-relay-cap repeat: no line is added,
    expect(rep.content).toBe(repeat.content);                             // the text is untouched,
    expect(rep.structuredContent.human_message).toBe(R.wallEmailLineText(URL));   // the linked copy follows
    expect(rep.structuredContent.user_message).toBe('x');                 // an unlinked copy is left alone
    same({}, wall({}, HUMAN + ' a line with another link https://dchub.cloud/plans'));
  });
});

describe('nudgeDecision (pure)', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');   // a Monday
  const base = { found: true, age_days: 14, has_alert: false };
  it('fails closed on every missing field', () => {
    expect(R.nudgeDecision({ standing: { ...base, found: false }, now }).kind).toBeNull();
    expect(R.nudgeDecision({ standing: { found: true, age_days: 14 }, email: 'a@b.co', now }).reason).toBe('alert_state_unknown');
    expect(R.nudgeDecision({ standing: { ...base, age_days: 6.9 }, email: 'a@b.co', now }).reason).toBe('key_younger_than_7d');
    expect(R.nudgeDecision({ standing: base, email: 'a@b.co', now }).reason).toBe('last_seen_unknown');
    expect(R.nudgeDecision({ standing: { ...base, last_seen_at: '2026-10-05T08:00:00Z' }, email: 'a@b.co', now }).reason).toBe('not_first_call_this_week');
    const seen3 = { ...base, last_seen_at: '2026-10-02T08:00:00Z', top_market: { slug: 'phoenix', name: 'Phoenix' } };
    expect(R.nudgeDecision({ standing: seen3, email: 'a@b.co', movers: [{ market_slug: 'phoenix', delta_7d: 5 }], now }).reason).toBe('last_check_under_7d');
    const seen9 = { ...seen3, last_seen_at: '2026-09-26T08:00:00Z' };
    expect(R.nudgeDecision({ standing: seen9, email: 'a@b.co', movers: [{ market_slug: 'dallas', delta_7d: 5 }], now }).reason).toBe('no_real_move');
    expect(R.nudgeDecision({ standing: seen9, email: 'a@b.co', movers: [{ market_slug: 'phoenix', delta_7d: 0.4 }], now }).reason).toBe('no_real_move');
    expect(R.nudgeDecision({ standing: seen9, email: 'a@b.co', movers: [{ market_slug: 'phoenix', delta_7d: 2 }], now }).line)
      .toBe('Tell the user: "Welcome back. Since your last check 9 days ago, Phoenix\'s DCPI score moved +2 points. Want an email next time it moves?"');
  });
  it('no-email line names the market when known, and the bound rung when given', () => {
    const phx = { ...base, top_market: { slug: 'phoenix', name: 'Phoenix' } };
    expect(R.nudgeDecision({ standing: phx, now }).line)
      .toBe('Tell the user: "Welcome back. Add an email and I\'ll keep this key recoverable and tell you when Phoenix changes."');
    expect(R.nudgeDecision({ standing: phx, now, identifiedPerDay: 50 }).line)
      .toBe('Tell the user: "Welcome back. Add an email and I\'ll keep this key recoverable, raise it to 50 calls a day, and tell you when Phoenix changes."');
    for (const bad of [null, 0, -5, 'n/a', NaN]) {
      expect(R.nudgeDecision({ standing: phx, now, identifiedPerDay: bad }).line, String(bad)).not.toMatch(/calls a day/);
    }
  });

  // Owner 2026-10-24: "ask at the 2nd-day return". The no-email ask fires on a
  // key's first call of a later UTC day than its claim, not after 7 days.
  it('2nd-day return: no-email ask on the first call of a later UTC day', () => {
    const t = Date.parse('2026-10-24T09:00:00Z');
    const ok = (st) => R.nudgeDecision({ standing: { found: true, ...st }, now: t, identifiedPerDay: 50 });
    // claimed yesterday 20:00Z, back today 09:00Z (13 h): asks
    expect(ok({ age_days: 0.5, has_alert: false, last_seen_at: '2026-10-23T20:05:00Z' }).kind).toBe('no_email');
    // claimed today 03:00Z: not a return yet
    expect(ok({ age_days: 0.3, has_alert: false }).reason).toBe('key_claimed_today');
    // claimed yesterday 23:00Z, still going at 01:00Z: one session over midnight, not a return
    expect(R.nudgeDecision({ standing: { found: true, age_days: 0.1, has_alert: false },
      now: Date.parse('2026-10-24T01:00:00Z') }).reason).toBe('key_claimed_today');
    // already called earlier today: the first call of the day had its chance
    expect(ok({ age_days: 3, has_alert: false, last_seen_at: '2026-10-24T07:00:00Z' }).reason).toBe('not_first_call_today');
    // last call yesterday: asks again today (one line a day, not a week)
    expect(ok({ age_days: 3, has_alert: false, last_seen_at: '2026-10-23T23:59:00Z' }).kind).toBe('no_email');
    // alert state unknown does not block the email ask; an alert does
    expect(ok({ age_days: 3 }).kind).toBe('no_email');
    expect(ok({ age_days: 3, has_alert: true }).reason).toBe('has_alert');
    // missing or junk age stays quiet
    expect(ok({ has_alert: false }).reason).toBe('key_claimed_today');
    expect(ok({ age_days: 'x', has_alert: false }).reason).toBe('key_claimed_today');
  });

  it('UTC day boundaries', () => {
    expect(R.utcDay(Date.parse('2026-10-23T23:59:59Z'))).toBe('2026-10-23');
    expect(R.utcDay(Date.parse('2026-10-24T00:00:00Z'))).toBe('2026-10-24');
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

// ── bind_email on a keyless session mints + binds (Grok/owner 2026-10-17, mcp#1004) ──
describe('bind_email keyless mint+bind', () => {
  it('no key on the session: one call mints a key with the email bound (claim path), no identify call', async () => {
    const s = await session('/mcp', 'Claude Code');
    identifyBody = null; claimBody = null;
    const r = await s.call('bind_email', { email: 'jane@firm.com' });
    expect(claimBody && claimBody.email, 'the mint carried the email').toBe('jane@firm.com');
    expect(identifyBody, 'nothing to bind on a keyless session, so no identify call').toBeNull();
    expect(r.first.startsWith('No key on this session, so `bind_email` minted a free DC Hub key with this email bound (one call). ')).toBe(true);
    expect(r.text).toContain(MINTED);
    expect(r.sc.bind_email_path).toBe('keyless_mint_bind');
  });

  it('CONTROL: a session that holds a key takes the bind path unchanged (identify, no mint)', async () => {
    const s = await session('/mcp', 'Claude Code', OLD_NOEMAIL);
    identifyBody = null; claimBody = null;
    const r = await s.call('bind_email', { email: 'jane@firm.com' });
    expect(identifyBody && identifyBody.email).toBe('jane@firm.com');
    expect(claimBody, 'no mint for a keyed session').toBeNull();
    expect(r.sc.bind_email_path).toBeUndefined();
  });

  it('CONTROL: an explicit api_key binds that key even on a keyless session', async () => {
    const s = await session('/mcp', 'Claude Code');
    identifyBody = null; claimBody = null;
    await s.call('bind_email', { email: 'jane@firm.com', api_key: OLD_NOEMAIL });
    expect(identifyBody && identifyBody.email, 'the explicit key goes to identify (bind), not to a mint').toBe('jane@firm.com');
    expect(claimBody).toBeNull();
  });
});
