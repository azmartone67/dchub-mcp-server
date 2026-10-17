// ranked_answer end to end: real server.mjs on loopback, stub backend (no network).
// The stub serves a capacity index whose #1 is a DCPI AVOID market, as production does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const UA = { 'user-agent': 'Claude-User' };
const row = (market, rank, city, state, dep, score) => ({ market, rank, city, state, score,
  deployable_mw: { value: dep }, ai_ready_mw: { value: 100 }, hyperscale_ready: true });
const MARKETS = [row('ashburn-va', 1, 'Ashburn', 'VA', 500, 450), row('columbus-oh', 2, 'Columbus', 'OH', 400, 300),
                 row('phoenix-az', 3, 'Phoenix', 'AZ', 150, 280)];
const VERDICT = { 'ashburn-va': ['AVOID', 26.7], ashburn: ['AVOID', 26.7], 'columbus-oh': ['BUILD', 71.2], columbus: ['BUILD', 71.2] };

let H, fence, sc, hits, chatgpt;
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => {
    if (p === '/api/v1/ai-capacity-index') return { ok: true, index_name: 'AI Compute Capacity Index', markets: MARKETS };
    const m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p);
    if (m && VERDICT[m[1]]) return { ok: true, market_slug: m[1], verdict: VERDICT[m[1]][0], composite_score: VERDICT[m[1]][1] };
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
  it('control: a market_ranking plan ran the index and DCPI-checked markets', () => {
    expect(sc.intent_class).toBe('market_ranking');
    expect(sc.executed.some((e) => e.tool === 'ai_capacity_index' && e.status === 'executed')).toBe(true);
    expect(sc.executed.some((e) => e.tool === 'get_market_dcpi_rank' && e.status === 'executed')).toBe(true);
  });
  it('ranked_answer leads with the AVOID #1 and names the best checked market', () => {
    const ra = sc.ranked_answer;
    expect(ra, 'ranked_answer present').toBeTruthy();
    expect(ra.requested_mw).toBe(200);
    expect(ra.headline).toContain('Ashburn, VA ranks #1 on AI capacity but DCPI says AVOID');
    expect(ra.headline).toContain('Best checked market: Columbus, OH, DCPI BUILD (71.2)');
    const ph = ra.markets.find((m) => m.market === 'phoenix-az');
    expect(ph.fits_requested_mw).toBe(false);
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
