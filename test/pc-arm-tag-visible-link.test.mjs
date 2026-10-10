// pc-arm-tag-visible-link.test.mjs — Grok audit F2 (2026-10-02; shipped by owner decision 10-03).
// Tagging ?pc on the visible link is what routes v2/grok users to the contract relay page
// (backend human_relay.py:748). Without it the 2026-09-29 A/B was control vs control (void).
//
// Measured on main before this change, through the real registered handlers below: for a Grok
// keyless analyze_site the person's line and for_your_human.url carried the /upgrade/h relay
// WITHOUT ?pc=grok. The contract tagged its own relay, then _paywallContractStep replaced it with
// the untagged link from the person's line, so Grok's relay opens could not be split by arm.
// Real registered handlers under a real caller seat; only the backend is stubbed.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { isGatedResult } from '../lib/paywall-contract.mjs';

const BASE = 'https://backend.pc-arm-tag-visible-link.test';
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
const mintBodies = [];
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'pc-arm-tag-visible-link-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (p === '/api/v1/relay/short') {
      // F5: the relay-first line shortens the relay; remember what was sent for shortening.
      try { mintBodies.push(JSON.parse(String((input && input.body) || (init && init.body) || '{}'))); } catch { /* not JSON */ }
      return json({ ok: true, code: 'abc234', url: 'https://dchub.cloud/u/abc234' });
    }
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
  // These pin the arm tag on the LONG relay. F5 (short /u link) is switched off here and
  // covered by the 'F2 + F5' case below and test/wall-user-line.test.mjs.
  process.env.DCHUB_RELAY_SHORT_LINK = '0';
  mintBodies.length = 0;
});
afterEach(() => { delete process.env.DCHUB_RELAY_SHORT_LINK; });

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

describe('F2: the arm tag rides the link people see', () => {
  it('Grok keyless analyze_site: content[0] relay ends ?pc=grok and equals for_your_human.url', async () => {
    const r = await call('analyze_site', LOC, seat(GROK));
    expect(r.structuredContent.paywall_contract).toBe('grok');
    const seen = r.content[0].text.match(RELAY);
    expect(seen, 'no /upgrade/h relay in content[0]').toBeTruthy();
    expect(seen[0]).toMatch(/\?pc=grok$/);
    const fyh = r.structuredContent.for_your_human;
    expect(fyh.url).toBe(seen[0]);
    expect(r.structuredContent.user_message).toContain(seen[0]);
    if (typeof fyh.markdown === 'string') expect(fyh.markdown.endsWith('(' + seen[0] + ')')).toBe(true);
    // one relay token, everywhere: no untagged copy of the same link anywhere
    const all = JSON.stringify(r);
    const bare = seen[0].replace(/\?pc=grok$/, '');
    expect(all.split(bare).length - 1).toBe(all.split(seen[0]).length - 1);
  });

  it('_withWallUserLine (relay-first branch) tags the line, for_your_human and upgrade_url at the source', async () => {
    const wall = { content: [{ type: 'text', text: 'body' }], structuredContent: { _wall: true } };
    const r = await S._ctxALS.run(seat(GROK), () => S._withWallUserLine(wall, 'analyze_site', { offer: 'pro' }));
    const seen = r.content[0].text.split('\n')[0].match(RELAY)[0];
    expect(seen).toMatch(/\?pc=grok$/);
    expect(r.structuredContent.for_your_human.url).toBe(seen);
    expect(r.structuredContent.upgrade_url).toBe(seen);
    expect(r.structuredContent.for_your_human.markdown.endsWith('(' + seen + ')')).toBe(true);
  });

  it('_paywallContractStep tags a person\'s line that arrives untagged (whatever path built it)', () => {
    const bare = 'https://dchub.cloud/upgrade/h/c2Vzcy14fGFuYWx5emVfc2l0ZXxmcmVlfDE.0123456789abcdef0123456789abcdef';
    const line = "DC Hub's paid plan has the full site analysis for this location: power, gas, fiber, market and risk scores, nearby substations and power cost. Start a 7-day trial: " + bare;
    const wall = { content: [{ type: 'text', text: line }], isError: true,
      structuredContent: { _wall: true, error: 'pro_required', tool: 'analyze_site', user_message: line,
                           show_to_user: true, copy_version: 'v13', for_your_human: { url: bare } } };
    const r = S._ctxALS.run(seat(GROK), () => S._paywallContractStep(wall, 'analyze_site'));
    expect(r.content[0].text.startsWith(line.replace(bare, bare + '?pc=grok'))).toBe(true);
    expect(r.structuredContent.user_message).toContain(bare + '?pc=grok');
    expect(r.structuredContent.for_your_human.url).toBe(bare + '?pc=grok');
    expect(JSON.stringify(r.content)).not.toMatch(new RegExp(bare.replace(/[.?]/g, '\\$&') + '(?!\\?pc=)'));
  });

  it('v2 arm (DCHUB_PAYWALL_CONTRACT=on): the seen relay carries ?pc=v2', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    const r = await call('analyze_site', LOC, seat());
    const seen = r.content[0].text.match(RELAY)[0];
    expect(seen).toMatch(/\?pc=v2$/);
    expect(r.structuredContent.for_your_human.url).toBe(seen);
  });

  it('no arm (contract off, non-Grok client): nothing is tagged and the relay is the raw minted one', async () => {
    const r = await call('analyze_site', LOC, seat());
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/[?&]pc=/);
    const seen = r.content[0].text.match(RELAY)[0];
    const fyh = r.structuredContent.for_your_human;
    expect(fyh.url).toBe(seen);
    expect(fyh.markdown).toBe('[🔓 Start a 7-day DC Hub trial](' + seen + ')');
    expect(fyh.render).toBe('verbatim_link_required');
  });

  it('F2 + F5: the short /u link wraps the TAGGED relay, so the arm rides inside the /u target', async () => {
    delete process.env.DCHUB_RELAY_SHORT_LINK;
    const r = await call('analyze_site', LOC, seat(GROK));
    const first = r.content[0].text.split('\n')[0];
    expect(first).toContain('https://dchub.cloud/u/abc234');
    expect(first).not.toMatch(RELAY);
    expect(r.structuredContent.for_your_human.url).toBe('https://dchub.cloud/u/abc234');
    const relayMint = mintBodies.find((b) => b && b.relay_url);
    expect(relayMint, 'the relay was sent for shortening').toBeTruthy();
    expect(relayMint.relay_url).toMatch(/\/upgrade\/h\/[^?]+\?(?:.*&)?pc=grok$/);
  });
});
