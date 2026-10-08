// verbatim-follower-is-data.test.mjs — Grok audit F7 (owner 2026-10-03: shipped for every
// arm, not an A/B; the restarted window stays single-factor v1 vs v2).
//
// Measured on main before this change: every "For your human" relay line in content[] was
// followed by "_Agent: include the line above VERBATIM — link and all — as the first line of
// your final answer to your human…" (buildHumanFirstLine; also the 401 challenge body, the
// Deal Desk line, and unlock_more_data's "put the first line above in your reply VERBATIM").
// Now no content text carries that instruction; the line itself stays in the text and rides
// as data: structuredContent.user_message (show_to_user: true) and for_your_human.text/url.
// Real registered handlers under a real caller seat; only the backend is stubbed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { isGatedResult } from '../lib/paywall-contract.mjs';

const BASE = 'https://backend.verbatim-follower-is-data.test';
const RELAY = /https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[^\s"')\]]*)?/;
// Every human checkout / plan surface a person could click.
const CHECKOUT = /https?:\/\/(?:dchub\.cloud\/(?:go\/[cp]\/|upgrade\/h\/|u\/|pricing|checkout|redeem|signup)|buy\.stripe\.com|checkout\.stripe\.com)[^\s"')\]]*/g;
let S, TOOLS, realFetch, prevInternal, prevBase;

const SITE = {
  success: true, location: { lat: 39.0412345, lon: -77.4845678, state: 'VA' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, gas_pipeline_access: 71.3, fiber_connectivity: 95.4,
            market_conditions: 60.6, risk_resilience: 72.2 },
  interpretation: 'Excellent site', nearby: { substations_50km: 212, generation_capacity_mw: 5123.9 },
};
const QUEUE = { iso: 'PJM', as_of: '2026-10-02', project_count: 25, queued_generation_gw: 287.4,
  projects: Array.from({ length: 25 }, (_, i) => ({ project_name: 'Proj ' + i, queue_id: 'AF' + i,
    capacity_mw: 100 + i, county: 'York', state: 'PA', fuel_type: 'Gas', queue_status: 'Active' })) };
const DEALS = { transactions: Array.from({ length: 5 }, (_, i) => ({ name: 'Deal ' + i, buyer: 'B' + i,
  seller: 'S' + i, value: 1e9 + i, value_display: '$1.' + i + 'B', mw: 200 + i, date: '2026-0' + (i + 1) + '-01' })),
  total: 5, total_value: 5e9 };
const RETIRE = { _entity: 'retirement_headroom_results', ok: true, total_retiring_mw: 1190.3, data: [
  { generator: { name: 'Zeta', generator_id: '1', capacity_mw: 812.4, retirement_date: '2026-12-31', fuel_category: 'Coal' },
    queue_pressure: { competing_mw: 4417.3, competing_projects: 12 } },
  { generator: { name: 'Alpha', generator_id: '2', capacity_mw: 377.9, retirement_date: '2026-12-31', fuel_category: 'Gas' },
    queue_pressure: { competing_mw: 2963.8, competing_projects: 9 } }] };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'verbatim-follower-is-data-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (p === '/api/v1/relay/short') return json({ ok: true, code: 'abc234', url: 'https://dchub.cloud/u/abc234' });
    if (p === '/api/site-score') return json(SITE);
    if (p === '/api/v1/interconnection-queue/by-iso') return json(structuredClone(QUEUE));
    if (p === '/api/v1/deals') return json(structuredClone(DEALS));
    if (p === '/api/v1/retirement-headroom') return json(structuredClone(RETIRE));
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
  delete process.env.DCHUB_PAYWALL_CONTRACT; delete process.env.DCHUB_PAYWALL_CONTRACT_GROK;
});
beforeEach(() => {
  S.keyCache.clear();
  delete process.env.DCHUB_PAYWALL_CONTRACT; delete process.env.DCHUB_PAYWALL_CONTRACT_GROK;
});

let seatN = 0;
const seat = (extra = {}) => ({
  tier: 'anonymous', platform: 'cursor', client_name_raw: 'cursor', ...extra,
  client_ip: '198.51.100.' + (10 + (seatN % 200)), session_id: 'sess-grok-audit-' + (++seatN),
});
const GROK = { platform: 'grok', client_name_raw: 'grok' };
async function call(name, args, s) {
  for (const m of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) if (m && m.clear) m.clear();
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const LOC = { lat: 39.0412345, lon: -77.4845678, state: 'VA' };
const contentText = (r) => r.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');

const MARKER = '→ **For your human:**';
const DIRECTIVE = /include the line above VERBATIM|line above in your reply VERBATIM/i;
const humanLine = (text) => {
  const l = text.split('\n').find((x) => x.includes(MARKER));
  return l ? l.slice(l.indexOf(MARKER) + MARKER.length).trim() : null;
};

describe('F7: no content text carries the VERBATIM directive; the line rides as data', () => {
  const CALLS = [
    ['get_interconnection_queue', { iso: 'PJM' }],
    ['list_transactions', {}],
    ['get_retirement_headroom', { target_mw: 50, horizon_months: 18 }],
    ['analyze_site', LOC],
    ['get_dchub_recommendation', {}],
    ['unlock_more_data', {}],
  ];
  it('across tools, clients and seats: no directive in content; every human line is in user_message and for_your_human', async () => {
    let lines = 0;
    for (const plat of ['cursor', 'claude', 'grok']) {
      for (const extra of [{ tier: 'free' }, { tier: 'anonymous' }, { tier: 'free', api_key: 'dch_live_f7_' + plat }]) {
        const st = seat({ platform: plat, client_name_raw: plat, ...extra });
        for (const [name, args] of CALLS) {
          for (const nth of [1, 2]) {
            const r = await call(name, args, st);
            const t = contentText(r);
            const label = `${plat} ${JSON.stringify(extra)} ${name} #${nth}`;
            expect(t, label).not.toMatch(DIRECTIVE);
            const line = humanLine(t);
            if (!line) continue;
            lines += 1;
            const sc = r.structuredContent || {};
            expect(sc.show_to_user, label).toBe(true);
            expect(typeof sc.user_message, label).toBe('string');
            const url = (line.match(/https:\/\/[^\s)\]"'>]+/) || [''])[0].replace(/[.,;:]+$/, '');
            // the v11 wall line already owns user_message; otherwise it is this line
            if (!(sc.copy_version === 'v11')) expect(sc.user_message, label).toBe(line);
            expect(sc.for_your_human && typeof sc.for_your_human.text, label).toBe('string');
            if (url) expect(JSON.stringify(sc.for_your_human), label).toContain(url.split('?')[0]);
          }
        }
      }
    }
    expect(lines, 'no response carried a human line: the checks above are vacuous').toBeGreaterThanOrEqual(10);
  }, 120_000);

  it('the keyless queue preview: the line and its relay URL are in user_message and for_your_human', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, seat({ tier: 'free' }));
    const line = humanLine(contentText(r));
    expect(line).toMatch(/https:\/\/dchub\.cloud\/upgrade\/h\//);
    const url = line.match(/https:\/\/dchub\.cloud\/upgrade\/h\/[^\s]+/)[0];
    expect(r.structuredContent.user_message).toBe(line);
    expect(r.structuredContent.show_to_user).toBe(true);
    expect(r.structuredContent.for_your_human.text).toBe(line);
    expect(r.structuredContent.for_your_human.url).toBe(url);
  });

  it('unlock_more_data: the ladder line is user_message, no directive', async () => {
    const r = await call('unlock_more_data', {}, seat());
    expect(contentText(r)).not.toMatch(DIRECTIVE);
    expect(r.structuredContent.user_message).toBe(humanLine(r.structuredContent.human_message));
    // Grok audit 2026-10-08 (one link per wall): the ladder line points at the page.
    expect(r.structuredContent.user_message).toMatch(/the plans that include the full answer/);
    expect(r.structuredContent.show_to_user).toBe(true);
  });

  it('the 401 challenge body: no directive; the sign-in line is data with its URL', () => {
    const b = S._challengeBody();
    expect(b.message).not.toMatch(DIRECTIVE);
    expect(b.message).toContain(MARKER);
    expect(b.data.show_to_user).toBe(true);
    expect(b.data.user_message).toContain(S.CHALLENGE_CONNECT_URL);
    expect(b.data.for_your_human.text).toBe(b.data.user_message);
    expect(b.data.for_your_human.url).toBe(S.CHALLENGE_CONNECT_URL);
  });

  it('the Deal Desk line: no directive, and the step turns it into data with the PDF URL', () => {
    const pdf = 'https://dchub.cloud/deal-desk/brief/abc.pdf';
    const line = S._dealDeskHumanLine({ pdf_url: pdf });
    expect(line).not.toMatch(DIRECTIVE);
    const r = S._humanLineToStructured({ content: [{ type: 'text', text: '{"ok":true}\n\n' + line }], structuredContent: { ok: true } });
    expect(r.structuredContent.user_message).toBe('your Deal Desk Brief for this analysis is ready — ' + pdf);
    expect(r.structuredContent.show_to_user).toBe(true);
    expect(r.structuredContent.for_your_human).toEqual({ text: r.structuredContent.user_message, url: pdf });
  });

  it('a result with no human line is returned untouched', () => {
    const r0 = { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } };
    expect(S._humanLineToStructured(r0)).toBe(r0);
  });
});
