// keyless-wall-grok-audit.test.mjs — Grok's audit of the keyless paywall output (2026-10-02)
//
// F2 (?pc= arm tag on the visible link) is HELD until the A/B window ends (~10-13, owner)
// and lives on its own branch; nothing here asserts either way about the tag.
//
// Measured on main before these fixes, through the real registered handlers below:
//   F10 Grok's relay label said "$10 one-time" on every tool, including Land & Power /
//       Pro-only tools the $10 pack does not open (raw relay: DCHUB_PAYWALL_CONTRACT_GROK=0).
//   F8  the keyless Pro hint read "Pro opens this tool; retry the same call".
//   F6  a keyless get_interconnection_queue preview carried THREE checkout URLs in content:
//       /go/c $10 pack, /go/c Developer, /upgrade/h relay; a repeat call in the same
//       session carried two (/go/c pack + /go/c Developer); the repeat now keeps the pack
//       pointer only (r-relay-cap keeps the wall pointer and re-sends no relay).
// Real registered handlers under a real caller seat; only the backend is stubbed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { isGatedResult } from '../lib/paywall-contract.mjs';

const BASE = 'https://backend.keyless-wall-grok-audit.test';
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
  process.env.DCHUB_INTERNAL_KEY = 'keyless-wall-grok-audit-internal-key';
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

describe('F10: the Grok label never prices a tool the $10 pack does not open', () => {
  it('Grok keyless analyze_site (contract on): for_your_human.markdown names Pro, no $10', async () => {
    const r = await call('analyze_site', LOC, seat(GROK));
    const md = r.structuredContent.for_your_human.markdown;
    expect(typeof md, 'no markdown: the check below would be vacuous').toBe('string');
    expect(md).not.toContain('$10');
    expect(md).toContain('DC Hub Pro');
  });

  it('the Grok markdown links the same URL the person\'s line and for_your_human.url carry', async () => {
    const r = await call('analyze_site', LOC, seat(GROK));
    // F5: the person's link is the /u short link to the relay (the long relay when the mint fails).
    const seen = r.content[0].text.match(new RegExp('https://dchub\\.cloud/u/[2-9a-hj-km-np-z]{6}|' + RELAY.source))[0];
    expect(seen).toBe('https://dchub.cloud/u/abc234');
    const fyh = r.structuredContent.for_your_human;
    expect(fyh.url).toBe(seen);
    expect(fyh.markdown).toBe(S.GROK_RELAY_LABEL_PRO + '(' + seen + ')');
  });

  it('Grok keyless analyze_site with the contract off for Grok (raw relay): no $10 either', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT_GROK = '0';
    const r = await call('analyze_site', LOC, seat(GROK));
    const md = r.structuredContent.for_your_human.markdown;
    expect(typeof md).toBe('string');
    expect(md).not.toContain('$10');
  });

  it('the label helper: Pro on Land & Power / Pro-only tools, $10 on pack tools, Claude untouched', () => {
    for (const t of ['analyze_site', 'compare_sites', 'get_dchub_recommendation']) {
      expect(S._relayLinkLabel('grok', t), t).toBe(S.GROK_RELAY_LABEL_PRO);
      expect(S._relayLinkLabel('grok', t), t).not.toContain('$10');
    }
    // Owner 2026-10-08: the queue sells Developer (never the pack): its Grok label names that rung, no price
    expect(S._relayLinkLabel('grok', 'get_interconnection_queue')).toBe(S.GROK_RELAY_LABEL_DEV);
    expect(S.GROK_RELAY_LABEL_DEV).not.toContain('$');
    expect(S._relayLinkLabel('grok', 'list_transactions')).toBe(S.GROK_RELAY_LABEL);
    expect(S._relayLinkLabel('grok')).toBe(S.GROK_RELAY_LABEL);
    expect(S._relayLinkLabel('claude', 'analyze_site')).toBe('[🔓 Start a 7-day DC Hub Pro trial]');
    expect(S._relayLinkLabel('claude', 'get_facility')).toBe('[🔓 Open DC Hub — see what I found]');
  });
});

describe('F8: the keyless Pro hint says who acts first', () => {
  it('Grok keyless analyze_site: the hint does not tell the agent to retry now', async () => {
    const r = await call('analyze_site', LOC, seat(GROK));
    const h = r.structuredContent.agent_hints.summary;
    expect(h.startsWith('Pro opens this tool; retry')).toBe(false);
    expect(h).toMatch(/^after your user starts Pro, retry the same call; until then use the free headline above\./);
    expect(contentText(r)).toContain('(agent: ' + h + ')');
    expect(contentText(r)).toMatch(/Free headline: weakest factor /);   // the headline it points at is there
  });

  it('a Pro wall with no headline does not point at one', async () => {
    const r = await call('get_dchub_recommendation', {}, seat(GROK));
    const h = r.structuredContent.agent_hints.summary;
    expect(h).toMatch(/^after your user starts Pro, retry the same call\. /);
    expect(h).not.toContain('headline');
  });
});

describe('F6: a keyless gated preview carries exactly one checkout URL', () => {
  const PREVIEWS = [
    ['get_interconnection_queue', { iso: 'PJM' }],
    ['list_transactions', {}],
    ['get_retirement_headroom', { target_mw: 50, horizon_months: 18 }],
  ];
  for (const plat of ['cursor', 'claude', 'grok']) {
    it(`${plat}: first and repeat call, every gated preview has one checkout URL (the relay on a first call)`, async () => {
      let gated = 0;
      for (const [name, args] of PREVIEWS) {
        const st = seat({ tier: 'free', platform: plat, client_name_raw: plat });
        for (const nth of ['first', 'repeat']) {
          const r = await call(name, args, st);
          if (!isGatedResult(r)) continue;
          gated += 1;
          const urls = contentText(r).match(CHECKOUT) || [];
          expect(urls, `${plat} ${name} ${nth}:\n${contentText(r).slice(-1500)}`).toHaveLength(1);
          // first call: the relay page (relay-first). A repeat in the same session keeps its
          // wall's own /go/c pointer and re-sends no relay (r-relay-cap, owner 2026-09-21).
          expect(urls[0], `${plat} ${name} ${nth}`).toMatch(nth === 'first'
            ? /^https:\/\/dchub\.cloud\/upgrade\/h\// : /^https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c)\//);
        }
      }
      expect(gated, `${plat}: no gated preview, the checks above are vacuous`).toBeGreaterThanOrEqual(4);
    });
  }

  it('the queue preview keeps data first and the person\'s line trailing', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, seat({ tier: 'free' }));
    const t = r.content[0].text;
    expect(t.trimStart().startsWith('{')).toBe(true);
    const line = t.indexOf('→ **For your human:**');
    expect(line).toBeGreaterThan(t.indexOf('This answer hid'));
    expect(t.slice(line)).toMatch(RELAY);
    // Owner 2026-10-08: the rung named is Developer (the pack is not what returns these fields),
    // and it points at the one link
    expect(t).toMatch(/DC Hub Developer/);
    expect(t).not.toMatch(/\$10 one-time/);
    expect(t).not.toContain('dchub.cloud/go/c/');
  });

  it('a keyed caller keeps its key-bound /go/c checkout (not rewritten)', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' },
      seat({ tier: 'free', api_key: 'dch_live_grok_audit_keyed_' + seatN }));
    expect(contentText(r)).toMatch(/https:\/\/dchub\.cloud\/go\/c\//);
  });
});
