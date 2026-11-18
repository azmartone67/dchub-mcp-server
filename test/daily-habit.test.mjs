// Daily habit + one-call email identity (owner approved 2026-11-17 21:51 MST; lib/daily-habit.mjs).
//
// Pins, over the real server.mjs app on loopback with a stub backend (no network):
//   - get_changes sends window + watchlist beside since; a backend that rejects window (or ignores a 7d one)
//     is asked once more with since=<now - window>; since alone still works as before;
//   - dchub://daily is listed beside dchub://instructions and reads GET /api/v1/daily (failure -> text, no throw);
//   - execute_plan and the single-market answers carry next_tools -> get_changes {window:'1d', watchlist:[slug]};
//   - both instruction texts carry the daily line;
//   - the wall's one-call ask: the owner's sentence verbatim, the claim tool by its constant, market passed;
//   - claim_free_key forwards market, surfaces `following`, and still counts as email_entered;
//   - dchub_services lists the sample dataset with no price or plan text.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { CLAIM_TOOL } from '../lib/claim-handoff.mjs';
import { DAILY_CHECKIN_LINE } from '../lib/dchub-identity.mjs';
import { DCHUB_SERVICES, servicesFor } from '../lib/dchub-services.mjs';
import * as D from '../lib/daily-habit.mjs';
import { emailEntered, emailEnteredEventBody } from '../lib/email-entered.mjs';

// Agent-facing copy names no plan, no price and no allowance.
const FORBIDDEN = /\b(paid|upgrade|trial|plans?|pricing|price|\$\s?\d|per month|subscription|free tier|free key|free answers?|calls? a day|answers? a day|per day|Pro|Developer|Enterprise)\b/i;
const UA = { 'user-agent': 'Claude-User' };
const KEYED = { ...UA, 'x-api-key': PRO_KEY };

let H, fence;
let changesMode = 'echo';                 // echo | reject_window | ignore_window
let dailyMode = 'ok';                     // ok | down
const queries = [];                       // [path, URLSearchParams] for the reads we pin
let claimBody = null;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body, u) => {
      if (p === '/api/v1/changes/since' || p === '/api/v1/changes') {
        queries.push([p, u.searchParams]);
        const w = u.searchParams.get('window');
        if (w && changesMode === 'reject_window') return { status: 400, body: { error: 'unknown parameter: window' } };
        const echo = changesMode === 'ignore_window' || !w ? {} : { window: w, watchlist: (u.searchParams.get('watchlist') || '').split(',').filter(Boolean) };
        return { ok: true, since: u.searchParams.get('since') || '24h', since_mode: 'x', generated_at: '2026-11-18T00:00:00Z', ...echo, diff: {}, counts: {} };
      }
      if (p === '/api/v1/daily') {
        queries.push([p, u.searchParams]);
        if (dailyMode === 'down') return { status: 503, body: { error: 'down' } };
        return { as_of: '2026-11-18', generated_at: '2026-11-18T06:00:00Z', window: '1d',
          items: [{ kind: 'dcpi_mover', market: 'dallas', title: 'DCPI up 3', detail: 'excess power improved', as_of: '2026-11-18', source: 'DC Hub DCPI', scope: 'market' }] };
      }
      if (p === '/api/v1/keys/claim') {
        claimBody = body;
        return { ok: true, api_key: 'dch_live_DAILYHABITkey0123456789', tier: 'free', email_captured: true,
                 ...(body && body.market ? { following: { market: body.market, daily_url: 'https://dchub.cloud/daily?m=' + body.market } } : {}) };
      }
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { changesMode = 'echo'; dailyMode = 'ok'; queries.length = 0; claimBody = null; });

const body0 = (r) => { const res = (r.msg && r.msg.result) || {}; try { return JSON.parse(res.content[0].text); } catch (_) { return res.structuredContent || {}; } };
const changesQs = () => queries.filter(([p]) => p.startsWith('/api/v1/changes')).map(([, q]) => Object.fromEntries(q.entries()));

describe('get_changes window + watchlist', () => {
  it('passes window and watchlist to the backend, and since alone still works', async () => {
    await H.call('/mcp', 'get_changes', { window: '1d', watchlist: ['Dallas', 'northern-virginia', 'bad slug!'] }, KEYED);
    expect(changesQs()).toEqual([{ window: '1d', watchlist: 'dallas,northern-virginia' }]);
    queries.length = 0;
    await H.call('/mcp', 'get_changes', { since: '7d', limit: 5 }, KEYED);
    expect(changesQs()).toEqual([{ since: '7d', limit: '5' }]);
  });
  it('a backend that rejects window is asked once more with since=<now - 1d>', async () => {
    changesMode = 'reject_window';
    const t0 = Date.now();
    const r = await H.call('/mcp', 'get_changes', { window: '1d', watchlist: ['dallas'] }, KEYED);
    const qs = changesQs();
    expect(qs.length).toBe(2);
    expect(qs[0].window).toBe('1d');
    expect(Object.keys(qs[1])).toEqual(['since']);
    const age = t0 - Date.parse(qs[1].since);
    expect(age).toBeGreaterThan(24 * 3600e3 - 120e3);
    expect(age).toBeLessThan(24 * 3600e3 + 120e3);
    expect(body0(r).ok).toBe(true);
    expect(body0(r).window_applied_as).toBe('since=' + qs[1].since);
  });
  it('a backend that ignores a 7d window is re-asked with since=<now - 7d>; an ignored 1d is the same default and is not', async () => {
    changesMode = 'ignore_window';
    await H.call('/mcp', 'get_changes', { window: '7d' }, KEYED);
    const qs = changesQs();
    expect(qs.length).toBe(2);
    expect(Date.now() - Date.parse(qs[1].since)).toBeGreaterThan(7 * 24 * 3600e3 - 120e3);
    queries.length = 0;
    await H.call('/mcp', 'get_changes', { window: '1d' }, KEYED);
    expect(changesQs().length).toBe(1);
  });
  it('the schema declares window (enum) and watchlist (array), and the description names the daily check-in', async () => {
    const t = ((await H.list('/mcp', UA)).msg.result.tools).find((x) => x.name === 'get_changes');
    expect(t.inputSchema.properties.window.enum).toEqual(['1d', '7d']);
    expect(t.inputSchema.properties.watchlist.type).toBe('array');
    expect(t.description).toContain("window:'1d' is the daily check-in");
    expect(JSON.stringify(t)).not.toMatch(FORBIDDEN);
  });
});

describe('dchub://daily', () => {
  it('is listed beside dchub://instructions and reads GET /api/v1/daily', async () => {
    const init = await H.init('/mcp', 'claude-ai', UA);
    const h = { ...UA, 'mcp-session-id': init.headers.get('mcp-session-id') };
    const list = (await H.post('/mcp', { jsonrpc: '2.0', id: 2, method: 'resources/list' }, h)).msg.result.resources.map((r) => r.uri);
    expect(list).toContain('dchub://instructions');
    expect(list).toContain('dchub://daily');
    const c = (await H.post('/mcp', { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'dchub://daily' } }, h)).msg.result.contents[0];
    expect(c.mimeType).toBe('text/markdown');
    expect(c.text).toMatch(/^# DC Hub Daily \(as of 2026-11-18\)/);
    expect(c.text).toContain('- Dallas: DCPI up 3 excess power improved (dcpi_mover, as of 2026-11-18, DC Hub DCPI)');
    expect(queries.some(([p]) => p === '/api/v1/daily')).toBe(true);
  });
  it('a backend failure reads as text that names the same check-in, never a throw', async () => {
    dailyMode = 'down';
    const res = H.S.createServer(null, '')._registeredResources['dchub://daily'];
    const c = await H.S._ctxALS.run({}, async () => (await res.readCallback(new URL('dchub://daily'), {})).contents[0]);
    expect(c.text).toBe(D.DAILY_UNAVAILABLE_TEXT);
    expect(c.text).toContain('get_changes with window 1d');
  });
});

const DAILY = (slug) => ({ tool: 'get_changes', args: { window: '1d', ...(slug ? { watchlist: [slug] } : {}) } });
describe('next_tools -> the daily check-in', () => {
  it.each([
    ['get_market_dcpi_rank', { market_slug: 'dallas' }],
    ['get_market_intel', { market: 'dallas' }],
    ['get_market_context', { market: 'dallas' }],
  ])('%s (one market) carries get_changes {window 1d, watchlist [slug]}', async (tool, args) => {
    const r = await H.call('/mcp', tool, args, KEYED);
    const nt = (body0(r).next_tools || []).filter((e) => e && e.tool === 'get_changes');
    expect(nt).toEqual([DAILY('dallas')]);
  });
  it('execute_plan carries it for the pinned market, once', async () => {
    const r = await H.call('/mcp', 'execute_plan', { intent: 'is dallas a good data center market', market: 'dallas' }, KEYED);
    const nt = (body0(r).next_tools || []).filter((e) => e && e.tool === 'get_changes');
    expect(nt).toEqual([DAILY('dallas')]);
  });
  it('attachDailyNext appends after an existing entry and never duplicates', () => {
    const o = { next_tools: [{ tool: 'report_finding' }] };
    D.attachDailyNext(o, ['Dallas']);
    D.attachDailyNext(o, ['phoenix']);
    expect(o.next_tools).toEqual([{ tool: 'report_finding' }, DAILY('dallas')]);
    expect(D.attachDailyNext({ next_tools: 'x' }, ['dallas'])).toEqual({ next_tools: 'x' });
    expect(D.attachDailyNext({}, [])).toEqual({ next_tools: [DAILY('')] });
  });
});

describe('instructions', () => {
  it('both texts carry the daily line, and the served handshake does too', async () => {
    expect(DAILY_CHECKIN_LINE).toBe('For a daily check-in, call get_changes with window 1d.');
    expect(H.S._INSTRUCTIONS).toContain(DAILY_CHECKIN_LINE);
    expect(H.S._INSTRUCTIONS_LEAN).toContain(DAILY_CHECKIN_LINE);
    for (const p of ['/mcp', '/mcp/grok']) {
      const i = (await H.init(p, 'claude-ai', UA)).msg.result.instructions;
      expect(i, p).toContain(DAILY_CHECKIN_LINE);
    }
  });
});

describe('one-call identity: the wall ask', () => {
  it('copy is exact, with and without a market', () => {
    expect(D.dailyEmailAsk('northern-virginia')).toBe('Give your email to keep this answer and get daily changes for Northern Virginia.');
    expect(D.dailyEmailAsk('')).toBe('Give your email to keep this answer and get daily changes.');
    expect(D.dailyEmailAsk('not a slug!')).toBe('Give your email to keep this answer and get daily changes.');
  });
  it('the ONE call is the claim tool (by its constant) with {email, market}', () => {
    expect(D.dailyClaimAsk('dallas')).toEqual({ tool: CLAIM_TOOL, arguments: { email: D.EMAIL_PLACEHOLDER, market: 'dallas' } });
    expect(D.dailyClaimAsk('')).toEqual({ tool: CLAIM_TOOL, arguments: { email: D.EMAIL_PLACEHOLDER } });
    const t = D.dailyClaimAgentText('dallas');
    expect(t).toContain('"' + D.dailyEmailAsk('dallas') + '"');
    expect(t).toContain('`' + CLAIM_TOOL + '` with {email, market: "dallas"}');
    const wall = H.S._sessionlessCapEmailAsk({ client_ip: '203.0.113.5', session_id: '', _wallMarket: 'dallas' }, 'search_facilities', { wide: true });
    expect(wall.startsWith(t)).toBe(true);
  });
  it('no agent-facing string here names a plan, a price or an allowance', () => {
    const texts = [D.dailyEmailAsk('dallas'), D.dailyEmailAsk(''), D.dailyClaimAgentText('dallas'), D.dailyClaimAgentText(''),
      D.DAILY_UNAVAILABLE_TEXT, D.renderDaily({ items: [] }), DAILY_CHECKIN_LINE,
      H.S._sessionlessCapEmailAsk({ client_ip: '203.0.113.5', session_id: '', _wallMarket: 'dallas' }, 'search_facilities', { wide: true })];
    for (const t of texts) expect(t, t).not.toMatch(FORBIDDEN);
  });
});

describe('one-call identity: claim_free_key {email, market}', () => {
  it('forwards market, surfaces following + the daily next_tools entry, and counts as email_entered', async () => {
    const r = await H.call('/mcp', 'claim_free_key', { email: 'owner@example.org', market: 'Dallas', client_name: 'daily-test' },
      { ...UA, 'x-dc-client-ip': '198.51.100.77' });
    expect(claimBody).toMatchObject({ email: 'owner@example.org', market: 'dallas' });
    const sc = r.msg.result.structuredContent;
    expect(sc.following).toEqual({ market: 'dallas', daily_url: 'https://dchub.cloud/daily?m=dallas' });
    expect(sc.next_tools.filter((e) => e.tool === 'get_changes')).toEqual([DAILY('dallas')]);
    expect(r.msg.result.content.map((b) => b.text).join('\n')).toContain('Following Dallas: daily changes at https://dchub.cloud/daily?m=dallas.');
    // email_entered: a claim with market still counts, and names the market
    const hit = emailEntered('claim_free_key', { email: 'owner@example.org', market: 'Dallas' }, r.msg.result);
    expect(hit).toEqual({ path: 'claim_free_key', apiKey: 'dch_live_DAILYHABITkey0123456789', market: 'dallas' });
    expect(emailEnteredEventBody({ path: hit.path, apiKey: hit.apiKey, market: hit.market })).toMatchObject({ event: 'email_entered', path: 'claim_free_key', market: 'dallas' });
  });
  it('the claim schema declares market; no market sent -> no market forwarded, no following', async () => {
    const t = ((await H.list('/mcp', UA)).msg.result.tools).find((x) => x.name === CLAIM_TOOL);
    expect(t.inputSchema.properties.market.type).toBe('string');
    const r = await H.call('/mcp', 'claim_free_key', { email: 'owner2@example.org', client_name: 'daily-test-2' },
      { ...UA, 'x-dc-client-ip': '198.51.100.78' });
    expect(claimBody.market).toBeUndefined();
    expect(r.msg.result.structuredContent.following).toBeUndefined();
  });
});

describe('dchub_services: sample dataset', () => {
  it('lists it with the licence link and no price or plan text', () => {
    const s = DCHUB_SERVICES.find((x) => x.id === 'sample_dataset');
    expect(s.name).toBe('Sample dataset for a market');
    expect(s.link).toBe('https://dchub.cloud/partners?via=agent-referral&src=services#licence');
    expect(JSON.stringify(s)).not.toMatch(FORBIDDEN);
    expect(servicesFor('a sample dataset for Dallas').services[0].id).toBe('sample_dataset');
  });
});
