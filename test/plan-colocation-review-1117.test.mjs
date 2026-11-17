// plan-colocation-review-1117.test.mjs — three fixes from Grok's colocation review of execute_plan (2026-11-17), live
// on 2.12.59 keyless:
//   1. Capacity Source (failed 12 of 12): block 0's JSON and structuredContent still carried
//      capacity_source.register_call -> request_capacity_intro, "Registers this requirement (no slug) ...", and a
//      source_capacity step's register_interest / "Register a requirement ..." note. Option A (owner 2026-11-16) is
//      the teaser only (lib/plan-capacity-teaser.mjs).
//   2. Ashburn scoping: "500 kW colocation in Ashburn VA" ran search_facilities {query:"Northern Virginia",
//      state:"VA", min_capacity_mw:0.5} with no replay.scope_widened, while "Northern Virginia", Dallas, Atlanta and
//      Chicago disclosed theirs (server.mjs _coloScopeWidened).
//   3. Lead length (warned 12 of 12): content[0].text was the whole plan as JSON. It is now a plain-language answer
//      of at most 600 characters; the JSON is content[1] and structuredContent (lib/plan-lead-text.mjs).
// Each fix: a pure-function test, then the real /mcp handler on a stub backend (no network past loopback).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { planCapacityTeaserOnly, planRegisterLanguage, PLAN_REGISTER_RE } from '../lib/plan-capacity-teaser.mjs';
import { planLeadText, planLeadStep, PLAN_LEAD_MAX } from '../lib/plan-lead-text.mjs';
import { CAPACITY_TEASER_LINE, CAPACITY_TEASER_WALL_LINE } from '../lib/capacity-source-summary.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const TEASER = 'New data center capacity listings are coming soon: query them with source_capacity, or browse https://dchub.cloud/listings.';
const isJson = (t) => { try { JSON.parse(t); return true; } catch (_) { return false; } };

// The shapes Grok's probe returned, trimmed (live 2026-11-17, "where can I lease 5 MW in Phoenix").
const REG_WHY = 'Registers this requirement (no slug) so providers with matching capacity can respond. Send it only after your human approves; DC Hub never contacts a provider without that approval.';
const livePlan = () => ({
  _entity: 'plan_execution', ok: true, intent: 'where can I lease 5 MW in Phoenix',
  executed: [
    { step: 1, tool: 'get_market_dcpi_rank', status: 'executed', result: { verdict: 'CAUTION',
      capacity_source: { live_listings_matching: 0, browse_call: { tool: 'source_capacity', arguments: { state: 'AZ' } },
        register_call: { tool: 'request_capacity_intro', arguments: {}, why: REG_WHY }, note: 'No live listing matches yet.' } } },
    { step: 2, tool: 'source_capacity', status: 'executed', result: {
      program: { note: 'The first listings are being onboarded. Register a requirement to get first access when they open.',
        register_interest: { mcp_tool: 'request_capacity_intro', method: 'POST', path: '/api/v1/listings/interest' }, status: 'upcoming' },
      empty_reason: { code: 'no_live_listings', register_interest: { mcp_tool: 'request_capacity_intro' } },
      next_steps: ['claim_free_key', 'request_capacity_intro'],
      next_steps_note: 'Nothing fits yet. With your human\'s approval, request_capacity_intro without a slug registers the requirement so DC Hub can email your human.',
      register_call: { tool: 'request_capacity_intro', arguments: { state: 'AZ' }, why: REG_WHY },
      truncation: { rows_total: { 'register_call.requires_first': 2, 'register_call.order': 3, next_steps: 3 } },
      next_tools: [{ tool: 'request_capacity_intro' }, { tool: 'source_capacity' }],
      items: [] } },
  ],
  answer_guide: 'LEAD WITH THE VERDICT. ' + CAPACITY_TEASER_LINE,
});

describe('fix 1, pure: planCapacityTeaserOnly', () => {
  it('the live shapes carry register language (control: the detector sees it)', () => {
    const hits = planRegisterLanguage(livePlan());
    expect(hits.length).toBeGreaterThan(5);
    expect(hits.join('\n')).toMatch(/register_call/);
    expect(hits.join('\n')).toMatch(/request_capacity_intro/);
    expect(hits.join('\n')).toMatch(/Registers this requirement/);
    expect(PLAN_REGISTER_RE.test('Register a requirement to get first access')).toBe(true);
  });
  it('none is left, every capacity_source carries the teaser, and the data is untouched', () => {
    const out = planCapacityTeaserOnly(livePlan(), {});
    expect(planRegisterLanguage(out)).toEqual([]);
    const cs = out.executed[0].result.capacity_source;
    expect(cs.teaser).toBe(TEASER);
    expect(cs.register_call).toBeUndefined();
    expect(cs.browse_call).toEqual({ tool: 'source_capacity', arguments: { state: 'AZ' } });
    const r = out.executed[1].result;
    expect(r.program.note).toBe('The first listings are being onboarded. ' + TEASER);
    expect(r.program.status).toBe('upcoming');
    expect(r.next_steps).toEqual(['claim_free_key']);
    expect(r.next_steps_note).toBe('Nothing fits yet. ' + TEASER);
    expect(r.next_tools).toEqual([{ tool: 'source_capacity' }]);
    expect(r.truncation.rows_total).toEqual({ next_steps: 3 });
    expect(out.executed[0].result.verdict).toBe('CAUTION');
    expect(out.answer_guide).toBe('LEAD WITH THE VERDICT. ' + CAPACITY_TEASER_LINE);
  });
  it('DCHUB_CAPACITY_REGISTER_OFFER=1 (mcp#1504) restores the offer: the step stands aside', () => {
    const p = livePlan();
    expect(planCapacityTeaserOnly(p, { DCHUB_CAPACITY_REGISTER_OFFER: '1' })).toBe(p);
  });
});

describe('fix 3, pure: the plain-language lead', () => {
  const plan = {
    _entity: 'plan_execution', intent: 'find 2 MW of colocation in Ashburn', executed: [{ step: 1 }, { step: 2 }],
    fact_header: 'SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-11-17\nENTITY: ASHBURN (market) | PJM (ISO)\nSUMMARY: DCPI 20/100 | Verdict: AVOID',
    intent_answer: { headline: 'Data Center Power Index (DCPI) for Northern Virginia: AVOID, composite 20/100.',
      evidence: ['The "Northern Virginia" facility search returned preview rows, e.g. Ashburn II.'] },
    human_message: 'Your AI assistant ran 3 DC Hub lookups.',
  };
  it('leads with the headline and as_of, under 600 characters, and is not JSON', () => {
    const t = planLeadText(plan);
    expect(t.startsWith('Data Center Power Index (DCPI) for Northern Virginia: AVOID')).toBe(true);
    expect(t).toContain('as of 2026-11-17');
    expect(t.length).toBeLessThanOrEqual(PLAN_LEAD_MAX);
    expect(PLAN_LEAD_MAX).toBe(600);
    expect(isJson(t)).toBe(false);
    expect(t).not.toMatch(/https?:\/\//);
  });
  it('a headline of any length still leaves a lead of at most 600 characters', () => {
    const long = { ...plan, intent_answer: { headline: 'x '.repeat(900), evidence: ['y '.repeat(400)] } };
    expect(planLeadText(long).length).toBeLessThanOrEqual(600);
    const bare = { _entity: 'plan_execution', intent: 'q '.repeat(500), executed: [] };
    expect(planLeadText(bare).length).toBeLessThanOrEqual(600);
  });
  it('the step puts the lead first and keeps the JSON whole as block 1', () => {
    const r = { content: [{ type: 'text', text: JSON.stringify(plan) }, { type: 'text', text: 'tail' }], structuredContent: plan };
    const out = planLeadStep(r, { env: {} });
    expect(out.content.length).toBe(3);
    expect(isJson(out.content[0].text)).toBe(false);
    expect(JSON.parse(out.content[1].text)).toEqual(plan);
    expect(out.content[2].text).toBe('tail');
    expect(out.structuredContent).toBe(plan);
    expect(planLeadStep(r, { env: { DCHUB_PLAN_LEAD_TEXT: '0' } })).toBe(r);
    expect(planLeadStep(r, { env: {}, compact: false })).toBe(r);
    expect(planLeadStep({ ...r, isError: true }, { env: {} }).content.length).toBe(2);
  });
});

// ── the real /mcp handler, stub backend ──────────────────────────────────────────────────────────────────────────
const AS_OF = '2026-11-17';
const ROWS = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, slug: `vantage-ashburn-${i}`, name: 'Ashburn ' + i, city: 'Ashburn', state: 'VA', capacity_mw: 10 + i }));
let H, fence;
const CLIENT_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
beforeAll(async () => {
  // The server tells a plan's own loopback steps from an outside caller by the peer address (as in
  // test/plan-envelope-once): this file's client sockets read as 203.0.113.7, the plan's step sockets stay 127.0.0.1.
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (H && this.server && this.localPort === H.PORT && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.7' };
    return p;
  };
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_ANON_DAILY_CAP: '500', DCHUB_KEYLESS_FIRST_FULL: '0' },
    extraRoutes: (p) => {
      if (p === '/api/v1/listings/summary') return { ok: true, program_status: 'upcoming', live_count: 0, total_mw: 0, markets: [], generated_at: AS_OF };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      if (p.startsWith('/api/v1/listings')) {
        return { ok: true, count: 0, items: [], as_of: AS_OF,
          program: { status: 'upcoming', note: 'The first listings are being onboarded. Register a requirement to get first access when they open.',
            register_interest: { mcp_tool: 'request_capacity_intro', method: 'POST', path: '/api/v1/listings/interest' } },
          empty_reason: { code: 'no_live_listings', message: 'Capacity Source has no live listings yet.',
            register_interest: { mcp_tool: 'request_capacity_intro', method: 'POST', path: '/api/v1/listings/interest' } } };
      }
      if (p.startsWith('/api/v1/grid/')) return { ok: true, iso: 'PJM', as_of: AS_OF, source: 'PJM', headroom_mw: 1200 };
      if (p.includes('dcpi') || p.includes('/markets')) {
        return { ok: true, as_of: AS_OF, market_slug: 'northern-virginia', name: 'Northern Virginia', verdict: 'AVOID', composite_score: 20 };
      }
      return { success: true, count: ROWS.length, total_count: ROWS.length, as_of: AS_OF, data: ROWS, results: ROWS };
    },
  });
  if (H.S._capacitySummary) { H.S._capacitySummary.arm(); await H.S._capacitySummary.refresh(); }
}, 120_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop();
  if (fence) fence.restore();
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
        resolve({ raw, msg });
      });
    });
    req.on('socket', (sock) => {
      const note = () => { const lp = sock.localPort; CLIENT_PORTS.add(lp); sock.once('close', () => CLIENT_PORTS.delete(lp)); };
      if (sock.localPort) note(); else sock.once('connect', note);
    });
    req.on('error', reject);
    req.end(data);
  });
}
let ip = 1, rid = 7000;
async function plan(intent) {
  const r = await rpc({ 'user-agent': 'cursor/1.0', 'x-dc-client-ip': `198.51.117.${ip++}` },
    { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name: 'execute_plan', arguments: { intent } } });
  return r.msg && r.msg.result;
}

const INTENTS = {
  ashburn: '500 kW colocation in Ashburn VA',
  nova: 'colocation space in Northern Virginia',
  phoenix: 'where can I lease 5 MW in Phoenix',
};

describe('the real /mcp handler (keyless, stub backend)', () => {
  const res = {};
  beforeAll(async () => {
    for (const [k, intent] of Object.entries(INTENTS)) res[k] = await plan(intent);
  }, 240_000);

  it.each(Object.keys(INTENTS))('%s, fix 1: no register language anywhere in the answer, and the teaser instead', (k) => {
    const r = res[k];
    expect(r && r.structuredContent && r.structuredContent._entity, `${k}: control, a plan came back`).toBe('plan_execution');
    expect(planRegisterLanguage(r.structuredContent), `${k} structuredContent`).toEqual([]);
    r.content.forEach((b, i) => expect(planRegisterLanguage(b.text), `${k} content[${i}]`).toEqual([]));
    const cs = r.structuredContent.capacity_source;
    expect(cs, `${k}: control, the plan carries a capacity_source block`).toBeTruthy();
    // Keyless is a one-link wall here, which turns the teaser into its link-free form (test/capacity-teaser-tools).
    expect([TEASER, CAPACITY_TEASER_WALL_LINE]).toContain(cs.teaser);
  }, 60_000);

  it('phoenix, fix 1: the source_capacity step ran (control: the backend register_interest was there to remove)', () => {
    const st = res.phoenix.structuredContent.executed.find((e) => e.tool === 'source_capacity');
    expect(st && st.status).toBe('executed');
  });

  it('ashburn, fix 2: the metro facility search is disclosed as widened, like Northern Virginia', () => {
    const sc = res.ashburn.structuredContent;
    const sf = sc.executed.find((e) => e.tool === 'search_facilities');
    expect(sf, 'control: the facility search ran').toBeTruthy();
    expect(sf.args).toMatchObject({ query: 'Northern Virginia', state: 'VA' });
    const metroScoped = sf.args.city != null || sf.args.market != null || sf.args.lat != null;
    const widened = sc.replay && sc.replay.scope_widened;
    expect(metroScoped || !!widened).toBe(true);
    // Grok re-run 2026-11-17 (Q-a): the search reads the METRO (query "Northern Virginia"), not the state. Ashburn is
    // disclosed as read at the metro grain, and no step is said to have read all of Virginia.
    expect(widened).toEqual({ widened_from: 'Ashburn', to: 'Northern Virginia metro', grain: 'metro' });
    expect(sc.answer_guide).not.toMatch(/Widened Ashburn to Virginia/);
    // Asked as "Northern Virginia": the search is the metro asked, nothing was widened.
    expect(res.nova.structuredContent.replay.scope_widened).toBeUndefined();
  });

  it.each(Object.keys(INTENTS))('%s, fix 3: content[0] is plain language of at most 600 characters; the JSON is content[1]', (k) => {
    const r = res[k];
    const t = r.content[0].text;
    expect(t.length).toBeLessThanOrEqual(600);
    expect(isJson(t)).toBe(false);
    expect(t.trimStart()[0]).not.toBe('{');
    const b1 = JSON.parse(r.content[1].text);
    expect(b1._entity).toBe('plan_execution');
    expect(b1.intent).toBe(r.structuredContent.intent);
  });
});

describe('the scope helper', () => {
  it('metro-first: a suburb reads at the metro grain, the metro name is not widened, a state only where a step reads it', () => {
    const S = H.S;
    const nova = { id: 'northern-virginia', label: 'Northern Virginia', query: 'Northern Virginia', state: 'VA', iso: 'PJM' };
    const atl = { id: 'atlanta', label: 'Atlanta', query: 'Atlanta', state: 'GA', iso: null };
    expect(S._coloScopeWidened({ metro: nova, metro_matched: 'sterling' }, { lat: 1, lon: 2 }))
      .toEqual({ widened_from: 'Sterling', to: 'Northern Virginia metro', grain: 'metro' });
    expect(S._coloScopeWidened({ metro: nova, metro_matched: 'northern virginia' }, { lat: 1 }, { widened_from: 'Northern Virginia', to: 'VA' })).toBeNull();
    // A named pair is searched by name: the text-based widening (Dallas -> TX) does not apply either.
    expect(S._coloScopeWidened({ metro: nova, metro_matched: 'ashburn', pair: { a: 'x', b: 'y' } }, null, { widened_from: 'Dallas', to: 'TX' })).toBeNull();
    // No RTO: the power read is the state's timeline, so the state is disclosed.
    expect(S._coloScopeWidened({ metro: atl, metro_matched: 'atlanta' }, null)).toEqual({ widened_from: 'Atlanta', to: 'GA' });
    // A price ask: the drivers are state-grain.
    expect(S._coloScopeWidened({ metro: nova, metro_matched: 'ashburn', price: true }, null)).toEqual({ widened_from: 'Ashburn', to: 'VA' });
    expect(S._coloScopeWidened(null, { lat: 1 })).toBeNull();
    expect(S._coloScopeWidened(null, null, { widened_from: 'Fulton County', to: 'GA' })).toEqual({ widened_from: 'Fulton County', to: 'GA' });
  });
  it('a metro facility search with a query is never said to have read the whole state', () => {
    const S = H.S;
    const line = S._execWidenedLine({ widened_from: 'Atlanta', to: 'GA' }, [
      { step: 2, tool: 'search_facilities', status: 'executed', args: { query: 'Atlanta', state: 'GA', limit: 10 } },
      { step: 3, tool: 'get_power_availability_timeline', status: 'executed', args: { state: 'GA' } },
    ]);
    expect(line).toBe('Widened Atlanta to Georgia: get_power_availability_timeline read all of Georgia, not Atlanta alone; say so when quoting them.');
  });
});
