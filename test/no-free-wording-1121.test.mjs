// Owner 2026-11-21: no "free" in its PRICE sense in anything DC Hub shows people and agents
// ("No prices or plan names in agent-facing text"). This guard renders the agent- and person-facing
// strings the 2026-11-21 sweep rewrote -- by calling the builders and reading the exported copy, never by
// regexing the source -- and fails on a word "free" in them.
//
// Ignored on purpose: the tool NAME claim_free_key (an identifier) and <code> spans. Kept elsewhere and
// NOT scanned here: the /mcp/chatgpt and directory-profile copy (frozen for OpenAI review), the
// kill-switch *_LEGACY restores, pricing/checkout copy that names a plan or the credit pack, and the
// shared backend canon sentence ANALYZE_SITE_FREE_LINE (byte for byte dchub-backend ai_surface_canon;
// changing it is a two-repo change). Tool descriptions on /mcp are scanned whole, with that one shared
// sentence and the non-price senses ("free text", "free grid capacity", "free up") taken out first.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

import * as claim from '../lib/claim-handoff.mjs';
import * as fdt from '../lib/free-decision-taste.mjs';
import * as gsl from '../lib/grid-sell-line.mjs';
import { HUMAN_EMAIL_REPLY } from '../lib/human-email-reply.mjs';
import * as kw from '../lib/keyless-wall.mjs';
import * as mn from '../lib/metered-note.mjs';
import { NEWS_SITE_REPORT_LINE } from '../lib/news-footer.mjs';
import * as psl from '../lib/paid-sell-line.mjs';
import * as pc from '../lib/paywall-contract.mjs';
import * as ret from '../lib/retention.mjs';
import * as soh from '../lib/site-owner-handoff.mjs';
import * as tc from '../lib/tier-canon.mjs';
import * as tm from '../lib/top-metros.mjs';
import * as ul from '../lib/unlock-line.mjs';
import * as um from '../lib/upgrade-missed.mjs';
import { DEPTH_TRIAL_LEAD } from '../lib/wall-depth-trial.mjs';
import * as wof from '../lib/wall-offer-floor.mjs';
import { CLAIM_ALT } from '../lib/wall-user-line.mjs';
import { CLAUDE_SITE_UNLOCK_COPY } from '../lib/claude-directory.mjs';
import * as kff from '../lib/keyless-first-full.mjs';
import * as ses from '../lib/siting-email-seat.mjs';
import { digestAskLine } from '../lib/depth-digest-ask.mjs';
import { legacyFreeWording } from '../lib/chatgpt-frozen-copy.mjs';

const FREE = /\bfree\b/i;
// claim_free_key is a tool name; <code>…</code> spans are identifiers too.
const clean = (s) => String(s).replace(/<code>[\s\S]*?<\/code>/g, '').replace(/claim_free_key/g, '');
const offenders = (strings) => strings
  .filter((s) => typeof s === 'string')
  .filter((s) => FREE.test(clean(s)));

// Each entry is [label, () => string | string[]]; a builder that throws fails the test (no silent skip).
const URL = 'https://dchub.cloud/u/x';
const BUILDERS = [
  ['CLAIM_ALT_TAIL', () => claim.CLAIM_ALT_TAIL],
  ['SESSIONLESS_EMAIL_ASK_LEAD', () => claim.SESSIONLESS_EMAIL_ASK_LEAD],
  ['claimHandoffText anon', () => claim.claimHandoffText({ status: 'anon_daily_cap', allowance: tc._freeKeyAllowanceText() })],
  ['claimHandoffText', () => claim.claimHandoffText({})],
  ['FREE_DECISION_CLAUSE_PREVIEW_ONLY', () => fdt.FREE_DECISION_CLAUSE_PREVIEW_ONLY],
  ['freeDecisionClause', () => fdt.freeDecisionClause(10)],
  ['gridAgentLine', () => [gsl.gridAgentLine('PJM', 3), gsl.gridAgentLine('PJM', 3, undefined, true, URL)]],
  ['GRID_AGENT_EMAIL_TAIL', () => gsl.GRID_AGENT_EMAIL_TAIL],
  ['gridSellLine', () => gsl.gridSellLine({ iso: 'ERCOT', withheld: ['queue_depth_gw', 'avg_time_to_power_months', 'constraint_score'], url: URL })],
  ['fiberSellLine', () => gsl.fiberSellLine({ place: 'Dallas', hid: ['carriers'], url: URL, shown: 3, total: 9 })],
  ['fiberAgentLine', () => [gsl.fiberAgentLine('Dallas'), gsl.fiberAgentLine('Dallas', true, URL)]],
  ['lastFreeLine', () => Object.values(gsl.lastFreeLine({ tool: 'get_grid_intelligence', link: URL, perPack: 1000 }) || {})],
  ['day2DigestLine', () => Object.values(gsl.day2DigestLine({ tool: 'get_grid_intelligence', what: 'PJM' }) || {})],
  ['HUMAN_EMAIL_REPLY', () => HUMAN_EMAIL_REPLY],
  ['keylessWallQuota', () => JSON.stringify(kw.keylessWallQuota(new Date('2026-11-21T00:00:00Z')))],
  ['keylessCapWallQuota', () => JSON.stringify(kw.keylessCapWallQuota(new Date('2026-11-21T00:00:00Z')))],
  ['meteredTrialNote', () => [
    mn.meteredTrialNote({ paidTaste: false, limited: false, call: 1, cap: 2, name: 'get_market_intel', bound: false, frozen: false }),
    mn.meteredTrialNote({ paidTaste: false, limited: true, call: 2, cap: 2, name: 'get_market_intel', bound: false, frozen: false }),
  ]],
  ['NEWS_SITE_REPORT_LINE', () => NEWS_SITE_REPORT_LINE],
  ['marketIntelSellLine', () => psl.marketIntelSellLine({ market: 'Dallas', hid: ['providers', 'pipeline_mw'], providersTotal: 40, providersShown: 5, url: URL })],
  ['compareIsosSellLine', () => psl.compareIsosSellLine({ isos: ['PJM', 'ERCOT'], perIso: [{ _queue_depth_gw_in_pro: true, _headroom_in_pro: true }, { _queue_depth_gw_in_pro: true }], url: URL })],
  ['rankMarketsSellLine', () => psl.rankMarketsSellLine({ criteria: 'best_overall', region: 'us', total: 20, shown: 5, scoreHidden: true, mwHidden: false, url: URL })],
  ['paidAgentLine', () => [psl.paidAgentLine('get_market_intel', 3), psl.paidAgentLine('get_market_intel', 3, true, URL)]],
  ['humanText', () => [
    pc.humanText({ tool: 'analyze_site', completeness: { complete: false }, headline: { verdict: 'BUILD', weakest_factor: 'water' }, offer: null, url: URL, remaining: 0 }),
    pc.humanText({ tool: 'analyze_site', completeness: { complete: true }, headline: null, offer: null, url: URL, remaining: 3 }),
  ]],
  ['buildAgentHints', () => JSON.stringify(pc.buildAgentHints({ tool: 'analyze_site', hosted: false, offer: null, hasHeadline: true }))],
  ['lpHeadlineFields neutral', () => JSON.stringify(pc.lpHeadlineFields({ verdict: 'BUILD', weakest_factor: 'water' }, { neutral: true }))],
  // CLAIM_TELL_TEXT is the DCHUB_CLAIM_BENEFIT_ASK=0 kill-switch restore, pinned verbatim (kept by design).
  ['claimBenefitText', () => ret.claimBenefitText(10, {})],
  ['wallEmailFreekeyLineText', () => ret.wallEmailFreekeyLineText(URL, {})],
  ['wallEmailLineText', () => ret.wallEmailLineText(URL, {})],
  ['siteOwnerBlock+Line', () => { const b = soh.siteOwnerBlock('analyze_site', { lat: 39, lon: -77 }); return [JSON.stringify(b), soh.siteOwnerLine(b)]; }],
  ['FREE_OFFER_LAND_POWER', () => [tc.FREE_OFFER_LAND_POWER, tc._freeOffersLine()]],
  ['ANALYZE_SITE_KEY_ADDS / EMAIL_SAME', () => [tc.ANALYZE_SITE_KEY_ADDS, tc.ANALYZE_SITE_EMAIL_SAME]],
  ['_freeKeyOfferText / _freeKeyAllowanceText / _unboundKeyLadderText', () => [tc._freeKeyOfferText(), tc._freeKeyAllowanceText(), tc._unboundKeyLadderText()]],
  ['top-metros', () => [tm.TOP_METRO_ACCESS_BASIS, tm.TOP_METRO_PARTIAL_BASIS, tm.openScoresDefinition({ definition: 'x' }) && JSON.stringify(tm.openScoresDefinition({ definition: 'x' }))]],
  ['unlock-line V1', () => [ul.freeKeyNoun(), ul.previewNote(false), ul.previewNote(true), ul.LP_PREVIEW_CLAUSE,
    ul.analyzeSiteKeyClause({ lpFreeRuns: true, dailyCap: 2 }), ul.analyzeSiteKeyTextClause({ lpFreeRuns: true, dailyCap: 2 }),
    ul.anonMaskNote(), ul.claudePlatformLine(), ul.claimNudge()]],
  ['upgrade-missed', () => [um.NEUTRAL_FREE_KEY_CLAUSE]],
  ['DEPTH_TRIAL_LEAD', () => DEPTH_TRIAL_LEAD],
  ['wall-offer-floor', () => Object.entries(wof).filter(([, v]) => typeof v === 'string').map(([, v]) => v)],
  ['CLAIM_ALT', () => CLAIM_ALT],
  ['CLAUDE_SITE_UNLOCK_COPY', () => Object.values(CLAUDE_SITE_UNLOCK_COPY).map((f) => JSON.stringify(f(URL)))],
  ['firstFullBlock', () => [JSON.stringify(kff.firstFullBlock('get_grid_intelligence', 1, 10)), JSON.stringify(kff.firstFullBlock('get_grid_intelligence', 1, 0))]],
  ['sitingFreeRunNote', () => ses.sitingFreeRunNote({ used: 1, limit: 3, resets_at: '2026-12-01T00:00:00Z' }, 'analyze_site')],
  ['digestAskLine', () => digestAskLine('get_market_intel')],
];

describe('no "free" (price sense) in the copy the 2026-11-21 sweep rewrote', () => {
  it.each(BUILDERS)('%s', (_label, build) => {
    const out = [].concat(build()).filter((s) => typeof s === 'string' && s.length);
    expect(out.length, 'the builder rendered nothing: a check over nothing proves nothing').toBeGreaterThan(0);
    expect(offenders(out)).toEqual([]);
  });
});

describe('server.mjs exported copy', () => {
  let S;
  beforeAll(async () => { S = await import('../server.mjs'); });
  it('wall headlines, tier answers and site lines carry no "free"', () => {
    const strings = [
      ...S.HARD_WALL_HEADLINES,
      ...Object.values(S.FREE_ANSWER_BY_TIER),
      S.SITE_KEY_LINK_MESSAGE, S.COMPARE_KEYLESS_MESSAGE, S.COMPARE_FREE_KEY_LINE,
      S.COMPOSITE_KEYLESS_MESSAGE, S.REPORT_KEYLESS_MESSAGE, S.SITE_NOSID_KEY_LINE,
      // OPTIN_NOTE_PREFIX / OPTIN_VALUE are not here: the opt-in card is shared canon with dchub-backend
      // mcp_gatekeeper._optin_cta_block (test/optin-cta-parity.test.mjs), changed only in both repos at once.
    ];
    expect(strings.filter((s) => typeof s === 'string' && s.length).length).toBeGreaterThan(10);
    expect(offenders(strings)).toEqual([]);
  });
});

describe('/mcp tools/list and resources/list', () => {
  let httpServer, stub, prevBase, tools, resources;
  beforeAll(async () => {
    await new Promise((resolve) => {
      stub = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
      stub.listen(0, '127.0.0.1', resolve);
    });
    prevBase = process.env.DCHUB_API_BASE;
    process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
    const S = await import('../server.mjs');
    await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
    const port = httpServer.address().port;
    const rpc = async (method) => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp?catalog=full`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
      });
      const raw = await res.text();
      const body = raw.includes('data: ')
        ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
      return JSON.parse(body).result;
    };
    tools = (await rpc('tools/list')).tools;
    resources = await rpc('resources/list').then((r) => r.resources).catch(() => []);
  });
  afterAll(async () => {
    await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
    await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
    if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
    else process.env.DCHUB_API_BASE = prevBase;
  });
  // Non-price senses and the one shared backend sentence, taken out before the scan.
  const nonPrice = (s) => String(s)
    .split(tc.ANALYZE_SITE_FREE_LINE).join('')
    .replace(/\bfree[- ]text\b/gi, '')
    .replace(/\bfree grid capacity\b/gi, '')
    .replace(/\bfree up\b/gi, '');
  const texts = (v, out = []) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => texts(x, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k !== 'name' && k !== 'enum' && k !== 'const') texts(x, out); }
    return out;
  };
  it('lists the full catalog (a scan over a short list proves little)', () => {
    expect(tools.length).toBeGreaterThan(60);
  });
  it('no tool description, input or output schema text says "free" in the price sense', () => {
    const bad = [];
    for (const t of tools) {
      for (const s of texts({ d: t.description, i: t.inputSchema, o: t.outputSchema })) {
        if (FREE.test(clean(nonPrice(s)))) bad.push(t.name + ': ' + s.slice(0, 160));
      }
    }
    expect(bad).toEqual([]);
  });
  it('no resource name or description says "free"', () => {
    const bad = (resources || []).flatMap((r) => [r.name, r.description]).filter((s) => typeof s === 'string' && FREE.test(clean(s)));
    expect(bad).toEqual([]);
  });
});

// /mcp/chatgpt is frozen byte for byte: on that profile the sell steps map the new sell lines back to the
// origin/main wording (lib/chatgpt-frozen-copy.mjs). Each mapped line differs from the new one by the restored
// word only, and the origin/main lead is back.
describe('lib/chatgpt-frozen-copy.mjs restores the origin/main sell wording on /mcp/chatgpt', () => {
  const CASES = [
    ['gridSellLine', gsl.gridSellLine({ iso: 'ERCOT', withheld: ['queue_depth_gw', 'avg_time_to_power_months', 'constraint_score'], url: URL }), 'This free DC Hub preview of ERCOT hides ', 'This free DC Hub', 'This DC Hub'],
    ['fiberSellLine', gsl.fiberSellLine({ place: 'Dallas', hid: ['carriers'], url: URL, shown: 3, total: 9 }), 'This free DC Hub fiber preview of Dallas', 'This free DC Hub', 'This DC Hub'],
    ['marketIntelSellLine', psl.marketIntelSellLine({ market: 'Dallas', hid: ['providers', 'pipeline_mw'], providersTotal: 40, providersShown: 5, url: URL }), 'This free DC Hub preview of the Dallas market hides ', 'This free DC Hub', 'This DC Hub'],
    ['compareIsosSellLine', psl.compareIsosSellLine({ isos: ['PJM', 'ERCOT'], perIso: [{ _queue_depth_gw_in_pro: true, _headroom_in_pro: true }, { _queue_depth_gw_in_pro: true }], url: URL }), 'This free DC Hub comparison of PJM and ERCOT hides ', 'This free DC Hub', 'This DC Hub'],
    ['rankMarketsSellLine', psl.rankMarketsSellLine({ criteria: 'best_overall', region: 'us', total: 20, shown: 5, scoreHidden: true, mwHidden: false, url: URL }), 'This free DC Hub ', 'This free DC Hub', 'This DC Hub'],
    ['gridAgentLine', gsl.gridAgentLine('PJM', 3), 'get_grid_intelligence returned a free preview of PJM: ', 'returned a free preview', 'returned a preview'],
    ['fiberAgentLine', gsl.fiberAgentLine('Dallas'), 'get_fiber_intel returned a free preview of Dallas. ', 'returned a free preview', 'returned a preview'],
    ['paidAgentLine', psl.paidAgentLine('get_market_intel', 3), 'get_market_intel returned a free preview: ', 'returned a free preview', 'returned a preview'],
    ['paidAgentLine repeat', psl.paidAgentLine('get_market_intel', 3, true, URL), 'get_market_intel returned a free preview. ', 'returned a free preview', 'returned a preview'],
    ['GRID_AGENT_EMAIL_TAIL', gsl.GRID_AGENT_EMAIL_TAIL, 'Your user can unlock the full brief free with their email (the step above). ', 'full brief free with', 'full brief with'],
    ['lastFreeLine human', gsl.lastFreeLine({ tool: 'get_grid_intelligence', link: URL, perPack: 1000 }).human, 'That was the last free full DC Hub grid brief on this key today.', 'last free full', 'last included full'],
    ['lastFreeLine agent', gsl.lastFreeLine({ tool: 'get_grid_intelligence', link: URL, perPack: 1000 }).agent, 'This is your last free full get_grid_intelligence answer today; ', 'last free full', 'last included full'],
    ['day2DigestLine human', gsl.day2DigestLine({ tool: 'get_grid_intelligence', what: 'PJM' }).human, 'Want a free weekly email on ', 'a free weekly', 'a weekly'],
  ];
  it.each(CASES)('%s', (_n, now, oldLead, oldWord, newWord) => {
    expect(typeof now === 'string' && now.length > 0, 'control: the builder returned a line').toBe(true);
    expect(FREE.test(clean(now))).toBe(false);
    const back = legacyFreeWording(now);
    expect(back.startsWith(oldLead), back).toBe(true);
    expect(back.replace(oldWord, newWord)).toBe(now);
  });
  it('a line it does not know is returned unchanged', () => {
    for (const s of ['Source: DC Hub (dchub.cloud)', 'This answer is a preview.', '', null]) expect(legacyFreeWording(s)).toBe(s);
  });
});
