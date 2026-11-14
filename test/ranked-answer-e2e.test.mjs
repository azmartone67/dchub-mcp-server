// ranked_answer end to end: real server.mjs on loopback, stub backend (no network).
// 5.27 (live QA 2026-11-14): the AI-campus ranking leads with rank_markets criteria=ai_ready. The
// stub's #1 row is a DCPI AVOID market (the case the QA saw at the top of the old capacity-index
// lead), and the answer must lead with the best buildable market instead.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

// Owner 2026-10-20: gated answers mint no key by default (DCHUB_AUTO_TRIAL_MINT).
// This file exercises the opt-in mint path, so it turns the switch on for itself.
const __prevAutoTrialMint = process.env.DCHUB_AUTO_TRIAL_MINT;
beforeAll(() => { process.env.DCHUB_AUTO_TRIAL_MINT = '1'; });
afterAll(() => {
  if (__prevAutoTrialMint === undefined) delete process.env.DCHUB_AUTO_TRIAL_MINT;
  else process.env.DCHUB_AUTO_TRIAL_MINT = __prevAutoTrialMint;
});


const UA = { 'user-agent': 'Claude-User' };
const row = (market, rank, city, state, dep, score) => ({ market, rank, city, state, score,
  deployable_mw: { value: dep }, ai_ready_mw: { value: 100 }, hyperscale_ready: true });
const MARKETS = [row('ashburn-va', 1, 'Ashburn', 'VA', 500, 450), row('columbus-oh', 2, 'Columbus', 'OH', 400, 300),
                 row('phoenix-az', 3, 'Phoenix', 'AZ', 150, 280)];
const RANK_ROWS = [
  { rank: 1, market: 'Ashburn', slug: 'ashburn-va', state: 'VA', dcpi_verdict: 'AVOID', score: 26.7 },
  { rank: 2, market: 'Columbus', slug: 'columbus-oh', state: 'OH', dcpi_verdict: 'BUILD', score: 71.2 },
  { rank: 3, market: 'Phoenix', slug: 'phoenix-az', state: 'AZ', dcpi_verdict: 'CAUTION', score: 52 }];
const VERDICT = { 'ashburn-va': ['AVOID', 26.7], ashburn: ['AVOID', 26.7], 'columbus-oh': ['BUILD', 71.2], columbus: ['BUILD', 71.2] };

let H, fence, sc, hits, chatgpt;
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => {
    if (p === '/api/v1/ai-capacity-index') return { ok: true, index_name: 'AI Compute Capacity Index', markets: MARKETS };
    if (p === '/api/v1/mcp/tools/rank_markets') return { criteria: 'ai_ready', region: 'us', count: 3, results: RANK_ROWS };
    const m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p);
    if (m && VERDICT[m[1]]) return { ok: true, market_slug: m[1], iso: 'PJM', as_of: '2026-11-13', verdict: VERDICT[m[1]][0], composite_score: VERDICT[m[1]][1] };
    return undefined;
  } });
  const before = H.hits.length;
  const init = await H.init('/mcp', 'claude-ai', UA);
  const sid = init.headers.get('mcp-session-id');
  const res = await H.call('/mcp', 'execute_plan', { intent: 'rank markets for a 200 MW AI campus' }, { ...UA, 'mcp-session-id': sid });
  hits = H.hits.slice(before);
  const init2 = await H.init('/mcp/chatgpt', 'chatgpt', { 'user-agent': 'openai-mcp' });
  const res2 = await H.call('/mcp/chatgpt', 'execute_plan', { intent: 'rank markets for a 200 MW AI campus' },
    { 'user-agent': 'openai-mcp', 'mcp-session-id': init2.headers.get('mcp-session-id') });
  chatgpt = res2.raw;
  const line = res.raw.split('\n').find((l) => l.startsWith('data:')) || res.raw;
  sc = JSON.parse(line.replace(/^data:\s*/, '')).result.structuredContent;
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('execute_plan market_ranking envelope', () => {
  it('control: a market_ranking plan ran rank_markets ai_ready and DCPI-checked markets', () => {
    expect(sc.intent_class).toBe('market_ranking');
    const rk = sc.executed.find((e) => e.tool === 'rank_markets' && e.status === 'executed');
    expect(rk, JSON.stringify(sc.executed.map((e) => [e.tool, e.status]))).toBeTruthy();
    expect(rk.args).toMatchObject({ criteria: 'ai_ready' });
    expect(sc.executed.some((e) => e.tool === 'ai_capacity_index')).toBe(false);
    expect(sc.executed.some((e) => e.tool === 'get_market_dcpi_rank' && e.status === 'executed')).toBe(true);
  });
  it('ranked_answer leads with the best buildable market, never the AVOID #1', () => {
    const ra = sc.ranked_answer;
    expect(ra, 'ranked_answer present').toBeTruthy();
    expect(ra.requested_mw).toBe(200);
    expect(ra.source).toBe('rank_markets_ai_ready');
    expect(ra.headline.startsWith('Best checked market: Columbus, OH, DCPI BUILD (71.2)'), ra.headline).toBe(true);
    expect(ra.headline).toContain('Ashburn, VA ranks #1 on this ranking but DCPI says AVOID');
    expect(ra.markets[0].verdict).toBe('BUILD');
    expect(ra.markets[ra.markets.length - 1].verdict).toBe('AVOID');
  });
  it('answer_guide does not lead with the AVOID market', () => {
    // Ashburn is read first (step-1 row order); the guide still lists Columbus BUILD first.
    expect(sc.answer_guide).toMatch(/RANKING FOR WHERE TO BUILD — DCPI verdicts in this run, best first: columbus-oh: BUILD \(71\.2\) · ashburn-va: AVOID/);
  });
  it('the relay is the one link the response already carries', () => {
    const url = sc.ranked_answer.relay && sc.ranked_answer.relay.url;
    expect(url).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\//);
    expect(url).toBe(sc.human_url);
  });
});

describe('/mcp/chatgpt is frozen', () => {
  it('control: the same call there ran a plan', () => { expect(chatgpt).toMatch(/plan_execution/); });
  it('carries no ranked_answer', () => { expect(chatgpt).not.toMatch(/ranked_answer/); });
});
