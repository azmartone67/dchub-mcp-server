// execute-plan-price-not-used-1125.test.mjs — Grok -> Brain 2026-11-25 item 2.
// Keyless execute_plan("... 120 MW sovereign AI cluster, and where is power cheapest?") ran site_selection_canvas,
// get_interconnection_queue x2 and get_grid_intelligence x2: no price step, and dropped_filters named only capacity_mw.
// A power-price question with no price step now says "Power prices were not used to rank" in dropped_filters,
// answer_guide (DROPPED) and intent_answer.not_established; a plan whose price step ran says nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { priceRankAsk, priceNotUsed, PRICE_NOT_USED_LINE } from '../lib/cross-domain-answer.mjs';
import { planGaps } from '../lib/finding-nudge.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const GROK = 'Which US markets have the most available power and the shortest time to power for a 120 MW sovereign AI cluster, and where is power cheapest?';

describe('priceRankAsk / priceNotUsed', () => {
  it('reads a cheapest-power question and the existing price wording', () => {
    for (const q of [GROK, 'where is electricity cheaper, Ohio or Indiana', 'lowest power prices for a 50 MW site',
      'cheapest power in PJM', 'what do power prices look like in Texas']) expect(priceRankAsk(q), q).toBe(true);
  });
  it('does not read cheap land, fast power or a plain grid question', () => {
    for (const q of ['cheapest land near Dallas', 'fastest power in ERCOT', 'most available power for 120 MW',
      'cheap colocation in Ashburn', 'the most available power and the cheapest land in Ohio']) expect(priceRankAsk(q), q).toBe(false);
  });
  it('names the gap when no price step came back, and only then', () => {
    const noPrice = [{ step: 1, tool: 'site_selection_canvas', status: 'executed' },
      { step: 2, tool: 'get_interconnection_queue', status: 'executed' }];
    expect(priceNotUsed(GROK, noPrice)).toEqual({ step: null, tool: 'execute_plan', param: 'power_price',
      kind: 'not_used', reason: PRICE_NOT_USED_LINE });
    expect(PRICE_NOT_USED_LINE).toMatch(/^Power prices were not used to rank/);
    expect(priceNotUsed(GROK, [...noPrice, { step: 3, tool: 'get_energy_prices', status: 'gated_preview' }])).toBeNull();
    expect(priceNotUsed(GROK, [...noPrice, { step: 3, tool: 'get_energy_prices', status: 'timed_out' }])).not.toBeNull();
    expect(priceNotUsed('most available power for 120 MW', noPrice)).toBeNull();
  });
  it('is not a report_finding gap (a planner limit, not missing data)', () => {
    expect(planGaps([], null, [priceNotUsed(GROK, [])], null)).toEqual([]);
  });
});

describe('execute_plan, Grok 2026-11-25 question, anonymous (real server.mjs on loopback)', () => {
  let H, fence;
  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness();
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('says power prices were not used to rank when no price step ran', async () => {
    const r = await H.call('/mcp', 'execute_plan', { intent: GROK },
      { 'user-agent': 'dchub-qa-brain/1125', 'x-dc-client-ip': '203.0.113.21' });
    const o = r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
    const tools = (o.executed || []).map((e) => e.tool);
    // The fix is the honest note; if a later planner adds a price step, this test must be revisited, not weakened.
    expect(tools.some((t) => ['get_energy_prices', 'get_gas_index', 'get_gas_economics'].includes(t)), JSON.stringify(tools)).toBe(false);
    expect(o.dropped_filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'execute_plan', param: 'power_price', kind: 'not_used', reason: PRICE_NOT_USED_LINE })]));
    expect(o.answer_guide).toContain('DROPPED — ');
    expect(o.answer_guide).toContain('Power prices were not used to rank: no energy-price step ran for this question');
    expect(o.answer_guide).not.toMatch(/step null/);
    if (o.intent_answer) expect(o.intent_answer.not_established).toContain(PRICE_NOT_USED_LINE);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
