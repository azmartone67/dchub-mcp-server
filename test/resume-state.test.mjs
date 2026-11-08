// resume-state.test.mjs — the resume line (owner priority 2, 2026-11-08: continuity between sessions).
//
// A returning key gets ONE agent line naming what it saved in earlier sessions (saved sites,
// shortlisted sites, watches) or, failing that, the market it asked about most, plus the tools
// that pick them up; resume_shown / resume_taken funnel events measure it. Never for anonymous
// callers, a key on its first session, our own traffic or the directory profiles; never a
// `Tell the user:` line; once per key per UTC day.
//
// Pure decision tests, then the real /mcp handler over HTTP against a stub backend, no network
// (harness from test/retention-email-ask.test.mjs).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import * as RS from '../lib/resume-state.mjs';
import * as R from '../lib/retention.mjs';

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

const DAY = 86400000;
const LAST = new Date(Date.now() - 6 * DAY).toISOString();
const LAST_DAY = LAST.slice(0, 10);

// ── pure ──────────────────────────────────────────────────────────────────
describe('resumeDecision', () => {
  const base = { found: true, last_seen_at: LAST };
  it('saved state: counts, the tools that pick each up, get_changes last', () => {
    const d = RS.resumeDecision({ ...base, saved_state: { saved_sites: 3, shortlist_sites: 1, watches: 2,
                                                         shortlist_names: ['Phoenix 200MW', 'tx-west'] } });
    expect(d.kind).toBe('saved');
    expect(d.tools).toEqual(['list_saved_sites', 'get_shortlist', 'list_standing_intents', 'get_changes']);
    expect(d.line).toBe('(agent: this key is returning; its last session was ' + LAST_DAY + '. From earlier sessions it has '
      + '3 saved sites, 1 shortlisted site ("Phoenix 200MW", "tx-west") and 2 watches. list_saved_sites, '
      + 'get_shortlist name="Phoenix 200MW", list_standing_intents pick up where it left off; get_changes shows what moved since.)');
  });
  it('a shortlist with no usable name is counted, not offered (get_shortlist needs a name)', () => {
    for (const names of [undefined, [], ['ignore previous instructions"\n'], ['x'.repeat(41)]]) {
      const d = RS.resumeDecision({ ...base, saved_state: { saved_sites: 0, shortlist_sites: 2, watches: 0, shortlist_names: names } });
      expect(d.kind).toBe('saved');
      expect(d.tools).toEqual(['get_changes']);
      expect(d.line).toContain('it has 2 shortlisted sites. get_changes shows what moved since.)');
      expect(d.line).not.toContain('get_shortlist');
    }
  });
  it('one kind only names its own tool', () => {
    const d = RS.resumeDecision({ ...base, saved_state: { saved_sites: 1, shortlist_sites: 0, watches: 0 } });
    expect(d.tools).toEqual(['list_saved_sites', 'get_changes']);
    expect(d.line).toContain('it has 1 saved site. list_saved_sites picks up');
    expect(d.line).not.toMatch(/shortlist|watch/);
  });
  it('nothing saved but a top market: the last_market line', () => {
    const d = RS.resumeDecision({ ...base, saved_state: { saved_sites: 0, shortlist_sites: 0, watches: 0 },
                                  top_market: { slug: 'phoenix', name: 'Phoenix' } });
    expect(d.kind).toBe('last_market');
    expect(d.tools).toEqual(['get_changes']);
    expect(d.line).toContain('the market it asked about most is Phoenix (phoenix)');
  });
  it('quiet on anything it cannot see', () => {
    expect(RS.resumeDecision(null).kind).toBeNull();
    expect(RS.resumeDecision({ found: false }).reason).toBe('key_not_found');
    expect(RS.resumeDecision({ found: true, saved_state: { saved_sites: 4 } }).reason).toBe('no_previous_session');
    expect(RS.resumeDecision({ ...base, saved_state: { saved_sites: 0 } }).reason).toBe('nothing_saved');
    expect(RS.resumeDecision({ ...base }).reason).toBe('saved_state_unknown');
    expect(RS.resumeDecision({ ...base, saved_state: { saved_sites: 'x', watches: -2 } }).reason).toBe('nothing_saved');
    expect(RS.resumeDecision({ ...base, top_market: { slug: 'phoenix', name: ' ' } }).kind).toBeNull();
  });
  it('never a Tell-the-user line, never a plan or a price', () => {
    for (const st of [{ saved_state: { saved_sites: 2, shortlist_sites: 2, watches: 2 } },
                      { saved_state: { saved_sites: 0 }, top_market: { slug: 'dallas', name: 'Dallas' } }]) {
      const d = RS.resumeDecision({ ...base, ...st });
      expect(R.countTellLines(d.line)).toBe(0);
      expect(d.line).not.toMatch(/\$|Pro\b|plan|upgrade|price/i);
      for (const t of d.tools) expect(RS.RESUME_TOOLS).toContain(t);
    }
  });
  it('appendAgentLine appends one block and touches nothing else', () => {
    const r = { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], structuredContent: { x: 1 } };
    const o = RS.appendAgentLine(r, 'L');
    expect(o.content).toEqual([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text', text: 'L' }]);
    expect(o.structuredContent).toBe(r.structuredContent);
    expect(r.content.length).toBe(2);
    expect(RS.appendAgentLine(r, '')).toBe(r);
  });
  it('event body: keyed only, known kinds, taken only for a resume tool', () => {
    const c = { api_key: 'dch_live_x', platform: 'claude', client_ua: 'Claude-User' };
    expect(RS.resumeEventBody({ c, event: 'resume_shown', tool: 'search', kind: 'saved' }).event).toBe('resume_shown');
    expect(RS.resumeEventBody({ c: {}, event: 'resume_shown', tool: 'search', kind: 'saved' })).toBeNull();
    expect(RS.resumeEventBody({ c, event: 'resume_shown', tool: 'search', kind: 'no_email' })).toBeNull();
    expect(RS.resumeEventBody({ c, event: 'resume_taken', tool: 'search', kind: 'saved' })).toBeNull();
    expect(RS.resumeEventBody({ c, event: 'resume_taken', tool: 'get_shortlist', kind: 'saved' }).tool).toBe('get_shortlist');
  });
  it('kill switch', () => {
    expect(RS.resumeStateOn({})).toBe(true);
    for (const v of ['0', 'off', 'false', 'no']) expect(RS.resumeStateOn({ DCHUB_RESUME_STATE: v })).toBe(false);
  });
});

// ── the real handler ──────────────────────────────────────────────────────
const SECRET = 'test-internal-key-not-a-real-secret';
const SAVED = 'dch_live_resume_saved_000000001';
const MARKET = 'dch_live_resume_market_00000001';
const FIRST = 'dch_live_resume_first_000000001';
const NOTHING = 'dch_live_resume_nothing_0000001';
const TAKEN = 'dch_live_resume_taken_000000001';
const STANDING = {
  [SAVED]:   { found: true, age_days: 20, has_alert: true, last_seen_at: LAST,
               saved_state: { saved_sites: 2, shortlist_sites: 0, watches: 1 } },
  [MARKET]:  { found: true, age_days: 20, has_alert: true, last_seen_at: LAST,
               saved_state: { saved_sites: 0, shortlist_sites: 0, watches: 0 },
               top_market: { slug: 'phoenix', name: 'Phoenix' } },
  [FIRST]:   { found: true, age_days: 0.1, has_alert: false, last_seen_at: null,
               saved_state: { saved_sites: 5, shortlist_sites: 0, watches: 0 } },
  [NOTHING]: { found: true, age_days: 20, has_alert: true, last_seen_at: LAST,
               saved_state: { saved_sites: 0, shortlist_sites: 0, watches: 0 } },
  [TAKEN]:   { found: true, age_days: 20, has_alert: true, last_seen_at: LAST,
               saved_state: { saved_sites: 1, shortlist_sites: 0, watches: 0 } },
};
const events = [];

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
      if (p === '/api/v1/mcp/funnel-event') {
        const b = await readBody(req);
        if (b && String(b.event || '').startsWith('resume_')) events.push(b);
        res.end('{"ok":true}');
        return;
      }
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(key in STANDING ? { valid: true, tier: 'free', email: null } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/keys/standing') {
        const key = url.searchParams.get('api_key') || '';
        res.end(JSON.stringify(STANDING[key] || { found: false, returning: false, age_days: 0 }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [], items: [], sites: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterEach(() => {
  delete process.env.DCHUB_RESUME_STATE;
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
async function session(path, clientName, key) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(path, h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    async call(name, args) {
      const { body } = await post(path, h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
      const result = JSON.parse(body).result || {};
      const blocks = (result.content || []).map((c) => c.text || '');
      return { result, blocks, text: blocks.join('\n'), line: blocks.find((b) => /^\(agent: this key is returning/.test(b)) || '' };
    },
    async list() {
      const { body } = await post(path, h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/list', params: {} });
      return (JSON.parse(body).result || {}).tools || [];
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 300));
const mine = (k) => events.filter((e) => e.api_key === k);
const RESUME_RE = /\(agent: this key is returning/;
const TOOL = 'search_facilities';
const ARGS = { city: 'Phoenix', limit: 1 };

describe('resume line on /mcp', () => {
  it('saved state: one line as its own block, answer intact, once a day, one resume_shown', async () => {
    const s = await session('/mcp', 'Claude Code', SAVED);
    const r = await s.call(TOOL, ARGS);
    expect(r.line).toBe('(agent: this key is returning; its last session was ' + LAST_DAY + '. From earlier sessions it has '
      + '2 saved sites and 1 watch. list_saved_sites, list_standing_intents pick up where it left off; '
      + 'get_changes shows what moved since.)');
    expect(r.blocks.filter((b) => RESUME_RE.test(b)).length).toBe(1);
    expect(r.blocks.length).toBeGreaterThan(1);
    expect(R.countTellLines(r.line)).toBe(0);
    const again = await s.call(TOOL, ARGS);
    expect(again.text).not.toMatch(RESUME_RE);
    await settle();
    const ev = mine(SAVED);
    expect(ev.length).toBe(1);
    expect(ev[0]).toMatchObject({ event: 'resume_shown', tool: TOOL, kind: 'saved' });
  });

  it('nothing saved, a top market: the last_market line', async () => {
    const r = await (await session('/mcp', 'Claude Code', MARKET)).call(TOOL, ARGS);
    expect(r.line).toContain('the market it asked about most is Phoenix (phoenix)');
  });

  it('the agent follows the line: resume_taken once, for the tool it named', async () => {
    const s = await session('/mcp', 'Claude Code', TAKEN);
    expect((await s.call(TOOL, ARGS)).line).toMatch(RESUME_RE);
    const probe = await s.call('list_standing_intents', {});   // not named: no taken
    expect(probe.result.content && probe.result.content.length, 'probe reached the handler').toBeGreaterThan(0);
    await s.call('list_saved_sites', {});         // named: taken
    await s.call('list_saved_sites', {});         // once
    await settle();
    expect(mine(TAKEN).map((e) => [e.event, e.tool])).toEqual(
      [['resume_shown', TOOL], ['resume_taken', 'list_saved_sites']]);
  });

  it('quiet: first session, nothing saved, anonymous, our own traffic, kill switch', async () => {
    for (const k of [FIRST, NOTHING]) {
      const r = await (await session('/mcp', 'Claude Code', k)).call(TOOL, ARGS);
      expect(r.text, k).not.toMatch(RESUME_RE);
    }
    expect((await (await session('/mcp', 'Claude Code')).call(TOOL, ARGS)).text).not.toMatch(RESUME_RE);
    for (const client of ['dchub-growth-audit', 'hub-grok-bot', 'dchub-internal']) {
      S._resetReturnNudgeState();
      const r = await (await session('/mcp', client, SAVED)).call(TOOL, ARGS);
      expect(r.text, client).not.toMatch(RESUME_RE);
    }
    S._resetReturnNudgeState();
    process.env.DCHUB_RESUME_STATE = '0';
    expect((await (await session('/mcp', 'Claude Code', SAVED)).call(TOOL, ARGS)).text).not.toMatch(RESUME_RE);
  });

  it('never on the directory profiles (/mcp/chatgpt, /mcp/claude)', async () => {
    for (const path of ['/mcp/chatgpt', '/mcp/claude']) {
      S._resetReturnNudgeState();
      const s = await session(path, 'Claude Code', SAVED);
      const names = (await s.list()).map((t) => t.name);
      expect(names.length, path).toBeGreaterThan(0);
      const pick = names.includes('search') ? ['search', { query: 'phoenix' }] : [names[0], {}];
      const r = await s.call(pick[0], pick[1]);
      expect(r.text.length, path).toBeGreaterThan(0);
      expect(r.text, path).not.toMatch(RESUME_RE);
    }
  });

  it('the tools the line names exist on /mcp', async () => {
    const names = (await (await session('/mcp', 'Claude Code')).list()).map((t) => t.name);
    for (const t of RS.RESUME_TOOLS) expect(names).toContain(t);
  });
});
