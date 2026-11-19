// since-last-check.test.mjs — "since you last asked" facts on the resume line, and get_changes since:"last_session"
// (owner 2026-11-18, "lets do 1-6", items 1 and 4; lib/since-last-check.mjs).
//
// Pure decision tests against the shape dchub-backend routes/changes_feed.py serves (since_mode, watchlist echo,
// counts / counts_at_limit, diff lanes, dcpi_movers, portfolio), then the real /mcp handler over HTTP against a
// stub backend, no network (harness from test/resume-state.test.mjs).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import * as SL from '../lib/since-last-check.mjs';
import * as R from '../lib/retention.mjs';
import { LAST_SESSION_LINE, DAILY_CHECKIN_LINE } from '../lib/dchub-identity.mjs';

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

// Note F: no plan, price, allowance, credits or "free" in anything this feature emits.
const FORBIDDEN = /\b(paid|upgrade|trial|plans?|pricing|price|\$\s?\d|per month|subscription|free|credits?|calls? a day|answers? a day|per day|Pro|Developer|Enterprise)\b|\/day\b/i;

const DAY = 86400000;
const NOW = Date.parse('2026-11-18T15:00:00Z');
const LAST_MS = Date.parse('2026-11-12T09:30:00Z');
const MARKET = { slug: 'phoenix', name: 'Phoenix' };
const FILTERED = ['dcpi_movers', 'facilities_new', 'pipeline_new', 'pocket_listings_new', 'transactions_new'];

function feed(over = {}) {
  return {
    ok: true, since: '2026-11-12T09:30:00+00:00', since_mode: 'iso', limit_per_domain: 200,
    generated_at: '2026-11-18T14:59:00+00:00',
    counts: { transactions_new: 2, pipeline_new: 1, pocket_listings_new: 0, facilities_new: 3, news_new: 9,
              dcpi_movers: 1, facilities_imported: 0 },
    diff: {
      transactions_new: [{ market: 'Phoenix' }, { market: 'Phoenix' }],
      pipeline_new: [{ market: 'Phoenix' }],
      pocket_listings_new: [],
      facilities_new: [{ state: 'AZ' }, { state: 'AZ' }, { state: 'AZ' }],
      news_new: Array.from({ length: 9 }, (_, i) => ({ title: 'n' + i })),
      dcpi_movers: [{ market_slug: 'phoenix', market: 'Phoenix', excess_power_score: 61.2, delta_7d: -1.4, delta_24h: -0.2 }],
      facilities_imported: [],
    },
    watchlist: { markets: ['phoenix'], unknown: [], filtered_lanes: FILTERED, unfiltered_lanes: ['facilities_imported', 'news_new'] },
    portfolio: { saved_sites: 2, moved_count: 1 },
    ...over,
  };
}
const FULL_LINE = 'Since your last check on Phoenix (Nov 12): 2 new deals, 1 new pipeline project, '
  + '3 newly discovered facilities in AZ, DCPI excess-power score -1.4 over 7 days, 1 of your 2 saved sites moved. '
  + 'Source: DC Hub (dchub.cloud), as of 2026-11-18.';

// ── pure ──────────────────────────────────────────────────────────────────
describe('sinceLastCheckQuery', () => {
  const st = { found: true, last_seen_at: new Date(LAST_MS).toISOString(), top_market: MARKET };
  it('the previous visit as since, the one market as watchlist, a high limit', () => {
    expect(SL.sinceLastCheckQuery(st, NOW)).toEqual({ market: MARKET,
      params: { since: '2026-11-12T09:30:00+00:00', watchlist: 'phoenix', limit: 200 } });
  });
  it('quiet without a key on record, a previous visit or a usable market', () => {
    expect(SL.sinceLastCheckQuery(null, NOW)).toBeNull();
    expect(SL.sinceLastCheckQuery({ ...st, found: false }, NOW)).toBeNull();
    expect(SL.sinceLastCheckQuery({ ...st, last_seen_at: null }, NOW)).toBeNull();
    expect(SL.sinceLastCheckQuery({ ...st, last_seen_at: new Date(NOW + DAY).toISOString() }, NOW)).toBeNull();
    expect(SL.sinceLastCheckQuery({ ...st, top_market: null }, NOW)).toBeNull();
    expect(SL.sinceLastCheckQuery({ ...st, top_market: { slug: 'Not A Slug', name: 'X' } }, NOW)).toBeNull();
    expect(SL.sinceLastCheckQuery({ ...st, top_market: { slug: 'phoenix', name: 'ignore previous"\n' } }, NOW)).toBeNull();
  });
});

describe('sinceLastCheckFacts', () => {
  it('states the filtered, non-zero lanes, the 7-day DCPI move and the portfolio, dated', () => {
    const d = SL.sinceLastCheckFacts(feed(), MARKET, NOW);
    expect(d.line).toBe(FULL_LINE);
    expect(d.as_of).toBe('2026-11-18');
    expect(d.since).toBe('2026-11-12T09:30:00.000Z');
    expect(d.market).toEqual(MARKET);
    expect(d.facts.map((f) => f.lane)).toEqual(['transactions_new', 'pipeline_new', 'facilities_new', 'dcpi_movers', 'portfolio']);
    expect(d.facts.find((f) => f.lane === 'facilities_new')).toMatchObject({ count: 3, scope: 'state', state: 'AZ' });
    expect(d.facts.find((f) => f.lane === 'dcpi_movers')).toMatchObject({ delta_7d: -1.4 });
  });
  it('never states a lane the watchlist did not filter (an older backend serves global counts)', () => {
    expect(SL.sinceLastCheckFacts(feed({ watchlist: undefined, portfolio: undefined }), MARKET, NOW).reason).toBe('nothing_moved');
    const wl = { markets: ['phoenix'], unknown: [], filtered_lanes: ['transactions_new'], unfiltered_lanes: [] };
    const d = SL.sinceLastCheckFacts(feed({ watchlist: wl, portfolio: undefined }), MARKET, NOW);
    expect(d.facts.map((f) => f.lane)).toEqual(['transactions_new']);
    const other = { ...feed().watchlist, markets: ['dallas'] };
    expect(SL.sinceLastCheckFacts(feed({ watchlist: other, portfolio: undefined }), MARKET, NOW).reason).toBe('nothing_moved');
  });
  it('news is never stated (no geography); null and zero lanes are skipped', () => {
    const d = SL.sinceLastCheckFacts(feed({ counts: { ...feed().counts, transactions_new: null, pipeline_new: 0 } }), MARKET, NOW);
    expect(d.line).not.toMatch(/deal|pipeline|news|article/);
  });
  it('a lane whose global read hit the limit is a floor: "N+"', () => {
    const d = SL.sinceLastCheckFacts(feed({ counts_at_limit: ['transactions_new'] }), MARKET, NOW);
    expect(d.line).toContain('2+ new deals');
    expect(d.facts[0].floor).toBe(true);
  });
  it('a state lane with mixed or missing states says "the market\'s state"', () => {
    const diff = { ...feed().diff, facilities_new: [{ state: 'AZ' }, { state: 'NV' }, {}] };
    expect(SL.sinceLastCheckFacts(feed({ diff }), MARKET, NOW).line).toContain("3 newly discovered facilities in the market's state");
  });
  it('the DCPI move is stated only for the watched market, and only as a 7-day move', () => {
    const diff = { ...feed().diff, dcpi_movers: [{ market_slug: 'dallas', delta_7d: 3 }] };
    expect(SL.sinceLastCheckFacts(feed({ diff }), MARKET, NOW).line).not.toMatch(/DCPI/);
    expect(SL.sinceLastCheckFacts(feed(), MARKET, NOW).line).toMatch(/DCPI excess-power score -1\.4 over 7 days/);
  });
  it('nothing real, no line: a quiet window, a clamped or unparsed since, an error body', () => {
    const quiet = feed({ counts: { transactions_new: 0, pipeline_new: 0, facilities_new: 0, dcpi_movers: 0 },
      diff: { transactions_new: [], pipeline_new: [], facilities_new: [], dcpi_movers: [] }, portfolio: { saved_sites: 2, moved_count: 0 } });
    expect(SL.sinceLastCheckFacts(quiet, MARKET, NOW).reason).toBe('nothing_moved');
    expect(SL.sinceLastCheckFacts(feed({ since_mode: 'clamped-30d' }), MARKET, NOW).reason).toBe('since_not_applied');
    expect(SL.sinceLastCheckFacts(feed({ since_mode: 'parse-error-fallback-24h' }), MARKET, NOW).reason).toBe('since_not_applied');
    expect(SL.sinceLastCheckFacts({ error: 'API 500' }, MARKET, NOW).reason).toBe('unreadable');
    expect(SL.sinceLastCheckFacts(null, MARKET, NOW).reason).toBe('unreadable');
    expect(SL.sinceLastCheckFacts(feed(), null, NOW).reason).toBe('no_market');
  });
  it('fold: one block, the resume line first', () => {
    expect(SL.foldIntoResumeLine('(agent: x.)', 'Since y.')).toBe('(agent: x.) Since y.');
    expect(SL.foldIntoResumeLine('(agent: x.)', '')).toBe('(agent: x.)');
  });
});

describe('resolveChangesSince (get_changes since:"last_session")', () => {
  const st = { found: true, last_seen_at: new Date(LAST_MS).toISOString() };
  it('keyed with a previous visit: that visit', () => {
    expect(SL.resolveChangesSince({ since: 'last_session', keyed: true, standing: st, now: NOW }))
      .toMatchObject({ since: '2026-11-12T09:30:00+00:00', basis: 'last_session' });
    expect(SL.resolveChangesSince({ since: ' LAST_SESSION ', keyed: true, standing: st, now: NOW }).basis).toBe('last_session');
  });
  it('keyed with none on record: 7d; keyless: 7d; each says which', () => {
    for (const standing of [null, { found: true, last_seen_at: null }, { found: false, last_seen_at: st.last_seen_at }]) {
      expect(SL.resolveChangesSince({ since: 'last_session', keyed: true, standing, now: NOW })).toMatchObject({ since: '7d', basis: 'fallback_7d' });
    }
    expect(SL.resolveChangesSince({ since: 'last_session', keyed: false, standing: st, now: NOW })).toMatchObject({ since: '7d', basis: 'keyless_7d' });
  });
  it('any other since is not touched', () => {
    for (const since of [undefined, '', '24h', '7d', '2026-11-01']) expect(SL.resolveChangesSince({ since, keyed: true, standing: st })).toBeNull();
  });
});

describe('copy and switches', () => {
  it('no plan, price, allowance, credits or "free"; never a Tell-the-user line', () => {
    const texts = [FULL_LINE, SL.sinceLastCheckFacts(feed({ counts_at_limit: ['transactions_new'] }), MARKET, NOW).line,
      SL.sinceLastCheckFacts(feed({ diff: { ...feed().diff, facilities_new: [{}, {}, {}] } }), MARKET, NOW).line,
      LAST_SESSION_LINE,
      ...['last_session', 'fallback_7d', 'keyless_7d'].map((b) => SL.resolveChangesSince({ since: 'last_session',
        keyed: b !== 'keyless_7d', standing: b === 'last_session' ? { found: true, last_seen_at: '2026-11-12T00:00:00Z' } : null }).note),
      ...SL.SINCE_LANES.flatMap(([, one, many]) => [one, many])];
    for (const t of texts) {
      expect(t, t).not.toMatch(FORBIDDEN);
      expect(R.countTellLines(t), t).toBe(0);
    }
  });
  it('the instructions sentence is neutral and names the tool', () => {
    expect(LAST_SESSION_LINE).toBe('get_changes since="last_session" returns what moved since your previous visit.');
    expect(LAST_SESSION_LINE).not.toMatch(/\bnow\b|must|always|first/i);
    expect(DAILY_CHECKIN_LINE).toBe('For a daily check-in, call get_changes with window 1d.');
  });
  it('kill switches default on, off on 0/off/false/no', () => {
    expect(SL.sinceLastCheckOn({})).toBe(true);
    expect(SL.changesLastSessionOn({})).toBe(true);
    for (const v of ['0', 'off', 'false', 'no', ' OFF ']) {
      expect(SL.sinceLastCheckOn({ DCHUB_SINCE_LAST_CHECK: v })).toBe(false);
      expect(SL.changesLastSessionOn({ DCHUB_CHANGES_LAST_SESSION: v })).toBe(false);
    }
  });
});

// ── the real handler ──────────────────────────────────────────────────────
const SECRET = 'test-internal-key-not-a-real-secret';
const FACTS = 'dch_live_since_facts_00000000001';
const QUIET = 'dch_live_since_quiet_00000000001';
const BROKE = 'dch_live_since_broke_00000000001';
const NOMKT = 'dch_live_since_nomkt_00000000001';
const LAST_ISO = new Date(Date.now() - 6 * DAY).toISOString();
const PHX = { found: true, age_days: 20, has_alert: true, last_seen_at: LAST_ISO,
              saved_state: { saved_sites: 0, shortlist_sites: 0, watches: 0 }, top_market: MARKET };
const STANDING = {
  [FACTS]: PHX, [QUIET]: PHX, [BROKE]: PHX,
  [NOMKT]: { ...PHX, top_market: null, saved_state: { saved_sites: 1, shortlist_sites: 0, watches: 0 } },
};
const events = [];
const changesCalls = [];

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
      const key = req.headers['x-api-key'] || '';
      if (p === '/api/v1/mcp/funnel-event') {
        const b = await readBody(req);
        if (b && String(b.event || '').startsWith('resume_')) events.push(b);
        res.end('{"ok":true}');
        return;
      }
      if (p === '/api/v1/keys/validate') {
        const k = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(k in STANDING ? { valid: true, tier: 'free', email: null } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/keys/standing') {
        const k = url.searchParams.get('api_key') || '';
        res.end(JSON.stringify(STANDING[k] || { found: false, returning: false, age_days: 0 }));
        return;
      }
      if (p === '/api/v1/changes/since') {
        const q = Object.fromEntries(url.searchParams.entries());
        changesCalls.push({ key, q });
        if (key === BROKE) { res.statusCode = 500; res.end('{"error":"boom"}'); return; }
        const since = q.since || '';
        const mode = /^\d{4}-/.test(since) ? 'iso' : (since ? 'shorthand-' + since : 'default-24h');
        if (key === QUIET || !q.watchlist) {
          res.end(JSON.stringify({ ok: true, since: since || 'x', since_mode: mode, counts: { transactions_new: 0 },
            diff: { transactions_new: [] }, total_changes: 0, generated_at: new Date().toISOString(),
            ...(q.watchlist ? { watchlist: { markets: [q.watchlist], unknown: [], filtered_lanes: FILTERED, unfiltered_lanes: [] } } : {}) }));
          return;
        }
        res.end(JSON.stringify(feed({ since, since_mode: mode, generated_at: new Date().toISOString() })));
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
  delete process.env.DCHUB_SINCE_LAST_CHECK;
  delete process.env.DCHUB_CHANGES_LAST_SESSION;
  S._resetReturnNudgeState();
  changesCalls.length = 0;
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
      let json = null;
      try { json = JSON.parse(blocks[0] || ''); } catch (_) { json = null; }
      return { result, blocks, json, text: blocks.join('\n'), sc: result.structuredContent || {},
               line: blocks.find((b) => /^\(agent: this key is returning/.test(b)) || '' };
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 300));
const mine = (k) => events.filter((e) => e.api_key === k);
const TOOL = 'search_facilities';
const ARGS = { city: 'Phoenix', limit: 1 };
const SINCE_RE = /Since your last check on/;

describe('since-last-check facts on /mcp (folded into the resume line)', () => {
  it('a returning key with a market: the facts ride the resume line, once, and in structuredContent', async () => {
    const s = await session('/mcp', 'Claude Code', FACTS);
    const r = await s.call(TOOL, ARGS);
    expect(r.line).toMatch(/^\(agent: this key is returning; its last session was \d{4}-\d{2}-\d{2} and the market it asked about most is Phoenix \(phoenix\)\. get_changes shows what moved since\.\) Since your last check on Phoenix \(/);
    expect(r.line).toContain('): 2 new deals, 1 new pipeline project, 3 newly discovered facilities in AZ, DCPI excess-power score -1.4 over 7 days, 1 of your 2 saved sites moved. Source: DC Hub (dchub.cloud), as of ');
    expect(r.blocks.filter((b) => SINCE_RE.test(b)).length).toBe(1);   // one line, inside the resume block
    expect(R.countTellLines(r.text)).toBe(0);
    expect(r.sc.since_last_check).toMatchObject({ market: MARKET, facts: expect.any(Array) });
    expect(r.sc.since_last_check.facts.map((f) => f.lane)).toEqual(['transactions_new', 'pipeline_new', 'facilities_new', 'dcpi_movers', 'portfolio']);
    expect(changesCalls).toHaveLength(1);
    expect(changesCalls[0].q).toMatchObject({ watchlist: 'phoenix', limit: '200' });
    expect(Date.parse(changesCalls[0].q.since)).toBe(Date.parse(LAST_ISO.replace(/\.\d{3}Z$/, 'Z')));
    // once a day, like the resume line
    const again = await s.call(TOOL, ARGS);
    expect(again.text).not.toMatch(SINCE_RE);
    await settle();
    expect(mine(FACTS).filter((e) => e.event === 'resume_shown')).toEqual([expect.objectContaining({ kind: 'last_market', since_facts: true })]);
  });

  it('nothing moved: the resume line alone, since_facts false', async () => {
    const r = await (await session('/mcp', 'Claude Code', QUIET)).call(TOOL, ARGS);
    expect(r.line).toMatch(/get_changes shows what moved since\.\)$/);
    expect(r.text).not.toMatch(SINCE_RE);
    expect(r.sc.since_last_check).toBeUndefined();
    await settle();
    expect(mine(QUIET).find((e) => e.event === 'resume_shown')).toMatchObject({ since_facts: false });
  });

  it('a failed read never blocks or breaks the answer', async () => {
    const r = await (await session('/mcp', 'Claude Code', BROKE)).call(TOOL, ARGS);
    expect(r.line).toMatch(/get_changes shows what moved since\.\)$/);
    expect(r.text).not.toMatch(SINCE_RE);
  });

  it('no market on record: no lookup at all, the event carries no since_facts', async () => {
    const r = await (await session('/mcp', 'Claude Code', NOMKT)).call(TOOL, ARGS);
    expect(r.line).toContain('it has 1 saved site');
    expect(changesCalls.filter((c) => c.q.watchlist)).toHaveLength(0);
    await settle();
    const ev = mine(NOMKT).find((e) => e.event === 'resume_shown');
    expect(ev).toBeTruthy();
    expect('since_facts' in ev).toBe(false);
  });

  it('kill switch DCHUB_SINCE_LAST_CHECK=0: the resume line as before, no lookup', async () => {
    process.env.DCHUB_SINCE_LAST_CHECK = '0';
    const r = await (await session('/mcp', 'Claude Code', FACTS)).call(TOOL, ARGS);
    expect(r.line).toMatch(/get_changes shows what moved since\.\)$/);
    expect(r.text).not.toMatch(SINCE_RE);
    expect(changesCalls.filter((c) => c.q.watchlist)).toHaveLength(0);
  });

  it('keyless and directory callers: never', async () => {
    expect((await (await session('/mcp', 'Claude Code')).call(TOOL, ARGS)).text).not.toMatch(SINCE_RE);
    for (const path of ['/mcp/chatgpt', '/mcp/claude']) {
      S._resetReturnNudgeState();
      const r = await (await session(path, 'Claude Code', FACTS)).call('search', { query: 'phoenix' });
      expect(r.text, path).not.toMatch(SINCE_RE);
    }
  });
});

describe('get_changes since:"last_session" on /mcp', () => {
  const lastChangesSince = () => (changesCalls.filter((c) => !c.q.watchlist).pop() || {}).q || {};
  it('keyed: the backend is asked since the previous visit, and the answer says so', async () => {
    const r = await (await session('/mcp', 'Claude Code', FACTS)).call('get_changes', { since: 'last_session' });
    expect(Date.parse(lastChangesSince().since)).toBe(Date.parse(LAST_ISO.replace(/\.\d{3}Z$/, 'Z')));
    expect(r.json.since_resolved).toMatchObject({ requested: 'last_session', basis: 'last_session' });
  });
  it('keyless: 7d, and the answer says so', async () => {
    const r = await (await session('/mcp', 'Claude Code')).call('get_changes', { since: 'last_session' });
    expect(lastChangesSince().since).toBe('7d');
    expect(r.json.since_resolved).toMatchObject({ requested: 'last_session', used: '7d', basis: 'keyless_7d' });
  });
  it('any other since is passed through and not annotated', async () => {
    const r = await (await session('/mcp', 'Claude Code', FACTS)).call('get_changes', { since: '24h' });
    expect(lastChangesSince().since).toBe('24h');
    expect(r.json.since_resolved).toBeUndefined();
  });
  it('kill switch DCHUB_CHANGES_LAST_SESSION=0: passed through unchanged', async () => {
    process.env.DCHUB_CHANGES_LAST_SESSION = '0';
    const r = await (await session('/mcp', 'Claude Code', FACTS)).call('get_changes', { since: 'last_session' });
    expect(lastChangesSince().since).toBe('last_session');
    expect(r.json.since_resolved).toBeUndefined();
  });
});
