// execute-plan-quality-1127.test.mjs — the agent-consensus round (Grok -> Brain paste,
// 2026-11-27 evening; planner 5.66, lib/plan-quality-1127.mjs).
//
// Five agents asked the four questions below, intent unchanged, and got answers that missed
// the market the Data Center Power Index (DCPI) ranks first. Each case asserts what the
// question needs, and the kill switch case proves each assertion can fail (it restores the
// 5.65 routing that produced the misses).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fastestPowerRankingAsk, multiFactorRankingAsk, filterRankRowsByIso, droppedSizeLine, rankIsoArg } from '../lib/plan-quality-1127.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';
import { NOTE_F_WORDS } from '../lib/continuity-ask.mjs';

const Q1 = 'Where can 100 MW get power fastest in ERCOT, by DCPI?';
const Q2 = 'Compare power availability and interconnection queue for Northern Virginia vs Columbus.';
const Q3 = 'Rank Texas counties by shortest time to power for a 200 MW load, with DCPI.';
const Q4 = 'Best US markets for a 50 MW AI data center by power, fiber and tax incentives.';

const BASE = 'https://backend.epq-1127.test';
let S, TOOLS, realFetch, prevInternal;
const seen = [];
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const RANK_ROWS = [
  { slug: 'midland-tx', city: 'Midland–Odessa', state: 'TX', iso: 'ERCOT', dcpi_verdict: 'BUILD', score: 80.6, as_of: '2026-11-28T00:37:11Z' },
  { slug: 'upper-peninsula-mi', city: 'Upper Peninsula MI', state: 'MI', iso: 'MISO', dcpi_verdict: 'BUILD', score: 77, as_of: '2026-11-28T00:37:21Z' },
  { slug: 'williston-nd', city: 'Williston, ND', state: 'ND', iso: 'MISO', dcpi_verdict: 'BUILD', score: 76.7, as_of: '2026-11-28T00:37:10Z' },
  { slug: 'abilene-tx', city: 'Abilene', state: 'TX', iso: 'ERCOT', dcpi_verdict: 'BUILD', score: 74, as_of: '2026-11-28T00:37:10Z' },
  { slug: 'ashburn-va', city: 'Ashburn', state: 'VA', iso: 'PJM', dcpi_verdict: 'AVOID', score: 20, as_of: '2026-11-28T00:37:10Z' },
];

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'epq-1127-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input && input.url ? input.url : input));
    const p = u.pathname;
    let bodyIn = null; try { bodyIn = init && init.body ? JSON.parse(init.body) : null; } catch (_) { bodyIn = null; }
    seen.push({ path: p, body: bodyIn, query: Object.fromEntries(u.searchParams) });
    let m;
    if (p === '/api/v1/dcpi/scores/midland') return new Response(JSON.stringify({ detail: 'market not found', suggestions: ['midrand', 'milan', 'mclean'] }), { status: 404, headers: { 'content-type': 'application/json' } });
    if ((m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p))) return json({ market_slug: m[1], verdict: 'BUILD', composite_score: 80.6, computed_at: '2026-11-28T00:37:11Z' });
    if (p === '/api/v1/mcp/tools/rank_markets') return json({ criteria: 'ai_ready', results: RANK_ROWS.map((r) => ({ ...r })) });
    return json({});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});

let n = 0;
const anon = () => ({ tier: 'free', platform: 'claude', client_name_raw: 'claude-code',
  client_ip: '203.0.117.' + (10 + (n % 200)), session_id: 'sess-epq-' + (++n) });
async function call(name, args, seat = anon()) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  expect(parsed.success, JSON.stringify(parsed.error || null)).toBe(true);
  return S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const textOf = (r) => (r.content || []).map((c) => c.text).join('\n');
const env = (k, v) => { const p = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; return () => { if (p === undefined) delete process.env[k]; else process.env[k] = p; }; };
const plan = (q) => S._planQuery(q, {});
const seq = (p) => p.recommended_sequence || [];
const tools = (p) => seq(p).map((s) => s.tool);
const allArgs = (p) => JSON.stringify(seq(p).map((s) => s.args_hint || {}));

describe('Q1 fastest power in ERCOT, by DCPI', () => {
  it('ranks markets by DCPI buildability, held to ERCOT', () => {
    const p = plan(Q1);
    expect(p.intent_class).toBe('market_ranking');
    const s1 = seq(p)[0];
    expect(s1.tool).toBe('rank_markets');
    expect(s1.args_hint).toMatchObject({ criteria: 'ai_ready', iso: 'ERCOT' });
    expect(tools(p)).toContain('get_market_dcpi_rank');
    expect(tools(p)).toContain('get_grid_intelligence');
    expect(allArgs(p)).not.toMatch(/ashburn|northern-virginia|"PJM"|"MISO"|"SPP"/i);
  });
});

describe('Q2 power availability and queue, Northern Virginia vs Columbus', () => {
  it('reads both DCPI cards, grid headroom for PJM, and a queue tool; never state=VA', () => {
    const p = plan(Q2);
    expect(p.intent_class).toBe('market_comparison');
    const ts = tools(p);
    expect(ts.filter((t) => t === 'get_market_dcpi_rank')).toHaveLength(2);
    expect(ts).toContain('get_grid_intelligence');
    expect(ts.some((t) => t === 'get_interconnection_queue' || t === 'get_refined_queue')).toBe(true);
    const grid = seq(p).find((s) => s.tool === 'get_grid_intelligence');
    expect(grid.args_hint).toEqual({ iso: 'PJM' });
    expect(grid.why).toMatch(/grid-wide \(ISO\) context/);
    expect(allArgs(p)).toContain('northern-virginia');
    expect(allArgs(p)).not.toMatch(/"state":"VA"/);
  });
});

describe('Q3 Texas, shortest time to power, 200 MW', () => {
  it('stays on the state canvas (it ranks Midland–Odessa) with the size passed', () => {
    const p = plan(Q3);
    expect(p.intent_class).toBe('market_ranking');
    expect(seq(p)[0]).toMatchObject({ tool: 'site_selection_canvas', args_hint: { region: 'TX', capacity_mw: 200 } });
  });
  it('a size the canvas did not apply is named in the lead when DCHUB_EXECUTE_PLAN_DROP_LINE=1 (default off)', () => {
    const P = { _entity: 'plan_execution', intent: Q3, executed: [],
      intent_answer: { headline: 'Midland–Odessa, TX: BUILD (DCPI 80.6), as of 2026-11-27.' },
      dropped_filters: [{ step: 1, tool: 'site_selection_canvas', param: 'capacity_mw', asked: 200, kind: 'not_applied', reason: 'not sized' }] };
    expect(planLeadText(P)).not.toMatch(/Not applied/);
    const on = env('DCHUB_EXECUTE_PLAN_DROP_LINE', '1');
    try {
      const lead = planLeadText(P);
      expect(lead.startsWith('Midland–Odessa')).toBe(true);
      expect(lead).toContain('Not applied: the 200 MW size on site_selection_canvas.');
      expect(lead.indexOf('Not applied')).toBeLessThan(lead.indexOf('Source: DC Hub'));
      const kill = env('DCHUB_EXECUTE_PLAN_QUALITY_DISABLE', '1');
      try { expect(planLeadText(P)).not.toMatch(/Not applied/); } finally { kill(); }
    } finally { on(); }
  });
});

describe('Q4 best US markets by power, fiber and tax', () => {
  it('runs all three families in one plan, led by the DCPI ranking', () => {
    const p = plan(Q4);
    expect(p.intent_class).toBe('market_ranking');
    expect(seq(p)[0]).toMatchObject({ tool: 'rank_markets', args_hint: { criteria: 'ai_ready' } });
    const ts = tools(p);
    expect(ts).toContain('get_metro_fiber');
    expect(ts).toContain('get_tax_incentives');
    const tax = seq(p).find((s) => s.tool === 'get_tax_incentives');
    expect(tax.depends_on).toEqual([1]);
    expect(tax.args_hint.state).toMatch(/^<finalist_state/);
  });
  it('rank_markets rows mint finalist states for the tax step', () => {
    expect(S._EXEC_TOOL_MINTS.rank_markets).toMatchObject({ rowsKey: 'results', field: 'state', kind: 'finalist_state' });
  });
});

describe('kill switch DCHUB_EXECUTE_PLAN_QUALITY_DISABLE=1 restores the 5.65 routing', () => {
  it('Q1 goes back to grid_headroom, Q2 loses the grid step, Q4 goes back to incentives_tax', () => {
    const restore = env('DCHUB_EXECUTE_PLAN_QUALITY_DISABLE', '1');
    try {
      expect(plan(Q1).intent_class).toBe('grid_headroom');
      expect(tools(plan(Q1))).not.toContain('rank_markets');
      expect(tools(plan(Q2))).not.toContain('get_grid_intelligence');
      expect(plan(Q4).intent_class).toBe('incentives_tax');
    } finally { restore(); }
  });
});

describe('neighbours that must not move', () => {
  it('a one-place timeline and a one-state tax ask keep their classes', () => {
    expect(fastestPowerRankingAsk('How long to get power for 100 MW in Dallas?')).toBe(false);
    expect(multiFactorRankingAsk('What data center tax incentives does Georgia offer?', { state: 'GA' })).toBe(false);
    expect(plan('What data center tax incentives does Georgia offer?').intent_class).toBe('incentives_tax');
    expect(plan('How much power headroom does ERCOT have?').intent_class).toBe('grid_headroom');
    expect(plan('Compare Dallas vs Phoenix for a GPU training cluster').intent_class).toBe('market_comparison');
    expect(tools(plan('Compare Dallas vs Phoenix for a GPU training cluster'))).not.toContain('get_grid_intelligence');
  });
});

describe('asks outside this round route exactly as before (class with the change == class with the kill switch)', () => {
  const NEIGHBOURS = [
    'What is the time to power for the Dallas market?',
    'Where can I get 100 MW of power fastest near Dallas?',
    'Fastest sites in Texas for a 100 MW data center',
    'How soon can I get 100 MW in Phoenix?',
    'Where can 100 MW of capacity with power land by 2027?',
    'Is Phoenix a good place to build a data center?',
    'Rank markets for a 200 MW AI campus in Texas within 24 months',
    'What is the fuel mix in ERCOT right now?',
    'Top 10 US markets for a GPU cluster',
    'Where in Texas can I get grid power fastest for a 100 MW data center?',
    '200 MW in Atlanta (Georgia Power) vs Ashburn: time to power',
    'Which markets have the best combination of fiber and power?',
    'Best markets for fiber and power pairing',
    'What data center tax incentives does Ohio offer for a 50 MW build?',
  ];
  it.each(NEIGHBOURS)('%s', (q) => {
    const on = plan(q);
    const restore = env('DCHUB_EXECUTE_PLAN_QUALITY_DISABLE', '1');
    let off; try { off = plan(q); } finally { restore(); }
    expect(on.intent_class).toBe(off.intent_class);
    expect(tools(on)).toEqual(tools(off));
  });
});

describe('rank_markets iso is a hard filter', () => {
  it('unit: keeps only rows on the grid, in rank order, then the limit', () => {
    const out = filterRankRowsByIso({ results: RANK_ROWS }, 'ercot', 10);
    expect(out.results.map((r) => r.slug)).toEqual(['midland-tx', 'abilene-tx']);
    expect(out.iso_filter).toMatchObject({ iso: 'ERCOT', rows_read: 5, rows_on_grid: 2, rows_returned: 2 });
    expect(rankIsoArg('ISO-NE')).toBe('ISONE');
    expect(rankIsoArg('Texas')).toBe(null);
  });
  it('handler: reads the widest page and returns ERCOT markets only, Midland first', async () => {
    seen.length = 0;
    const r = await call('rank_markets', { criteria: 'ai_ready', region: 'us', iso: 'ERCOT', limit: 3 });
    const req = seen.find((x) => x.path === '/api/v1/mcp/tools/rank_markets');
    expect(req, 'rank_markets was not read').toBeTruthy();
    expect(Number((req.body && req.body.limit) ?? req.query.limit)).toBe(50);
    const t = textOf(r);
    expect(t).toContain('midland-tx');
    expect(t).not.toMatch(/ashburn-va|upper-peninsula-mi|williston-nd/);
  });
});

describe('an iso the filter does not know is named, not dropped', () => {
  it('iso=Texas: no filter, and iso_filter.applied is false', async () => {
    const r = await call('rank_markets', { criteria: 'ai_ready', iso: 'Texas', limit: 3 });
    expect(textOf(r)).toMatch(/"iso_filter":\{"iso":"Texas","applied":false/);
  });
});

describe('get_market_dcpi_rank resolves a plain market name', () => {
  it('"Midland" reads midland-tx after the backend misses; a slug the backend answers is never rewritten', async () => {
    seen.length = 0;
    const r = await call('get_market_dcpi_rank', { market_slug: 'Midland' });
    expect(seen.map((x) => x.path).filter((x) => x.startsWith('/api/v1/dcpi/scores/'))).toEqual(['/api/v1/dcpi/scores/midland', '/api/v1/dcpi/scores/midland-tx']);
    expect(textOf(r)).toMatch(/midland-tx/);
    expect(textOf(r)).not.toMatch(/midrand|market not found/);
    for (const given of ['dallas', 'northern-virginia', 'columbus-oh', 'dallas-tx']) {
      seen.length = 0;
      await call('get_market_dcpi_rank', { market_slug: given });
      expect(seen.map((x) => x.path).filter((x) => x.startsWith('/api/v1/dcpi/scores/'))).toEqual([`/api/v1/dcpi/scores/${given}`]);
    }
    const restore = env('DCHUB_EXECUTE_PLAN_QUALITY_DISABLE', '1');
    try {
      seen.length = 0;
      await call('get_market_dcpi_rank', { market_slug: 'Midland' });
      expect(seen.map((x) => x.path)).toContain('/api/v1/dcpi/scores/midland');
    } finally { restore(); }
  });
});

describe('copy rules on the new agent-facing lines', () => {
  it('no price, plan-name or allowance words', () => {
    const lines = [
      droppedSizeLine([{ step: 1, tool: 'site_selection_canvas', param: 'capacity_mw', asked: 200, kind: 'not_applied' }]),
      filterRankRowsByIso({ results: [] }, 'ERCOT', 5).iso_filter.note,
      ...seq(plan(Q1)).map((s) => s.why), plan(Q1).planner_rationale,
      ...seq(plan(Q4)).map((s) => s.why), plan(Q4).planner_rationale,
      ...seq(plan(Q2)).filter((s) => s.tool === 'get_grid_intelligence').map((s) => s.why),
    ];
    for (const l of lines) {
      expect(typeof l).toBe('string');
      expect(l, l).not.toMatch(NOTE_F_WORDS);
    }
  });
});
