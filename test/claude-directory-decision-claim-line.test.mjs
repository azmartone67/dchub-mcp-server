// claude-directory-decision-claim-line.test.mjs — ITEM 3 PROPOSAL (owner draft 2026-10-16).
//
// Item 3 adds a one-step claim_free_key line to KEYLESS decision-tool previews on /mcp. /mcp/claude
// lists none of the key tools (claim_free_key is in CLAUDE_REMOVED) and its gated results must keep
// ending with the neutral partial line from mcp#975, with no plan or price wording and nothing over
// 100,000 characters. This pins both halves for the three decision tools, keyless:
//   /mcp         (control) the claim line is there, so the step is live in this harness;
//   /mcp/claude  no claim_free_key anywhere, the last text block is CLAUDE_PLANS_NOTICE exactly once,
//                no plan name, no price, no link to a plans or checkout page, under 100,000 chars.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CLAUDE_PLANS_NOTICE } from '../lib/claude-directory.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const GI = { demand_mw: 95021, demand_period: '2026-10-07T23', generation_mix_period: '2026-10-07T03',
  generation_mix: { NG: { mw: 33582 }, NUC: { mw: 27692 }, WND: { mw: 5943 } }, peak_mw: 95021, min_mw: 74723,
  demand_24h: [{ period: '2026-10-07T22', mw: 90000 }, { period: '2026-10-07T23', mw: 95021 }] };
const CMP = { isos: [{ iso: 'PJM', avg_constraint: 49.2, avg_excess: 28.8, avg_time_to_power_months: 30.3 }] };
const QUEUE = { iso: 'PJM', as_of: '2026-10-07', queued_generation_gw: 135.1, queued_load_total_gw: 135.1,
  queued_load_total_gw_basis: 'generation_queue', project_count: 972, source_name: 'PJM queue',
  projects: [{ queue_id: 'AG1-100', capacity_mw: 100 }] };
const MARKET = { success: true, market: { id: 'northern-virginia', name: 'Northern Virginia', cities: ['Ashburn'] },
  stats: { facility_count: 857, total_power_mw: 13366 }, as_of: '2026-10-06T14:22:31Z',
  siting: { dcpi: { verdict: 'CAUTION', as_of: '2026-10-07' }, iso: { code: 'PJM' } },
  top_providers: [{ name: 'Provider 0' }] };
const ARGS = { get_grid_intelligence: { region_id: 'PJM' }, get_interconnection_queue: { iso: 'PJM' },
  get_market_intel: { market: 'northern-virginia' } };
const PLAN = /\b(Developer|Pro|Starter|Enterprise|Founding)\b/;
const PRICE = /\$\s?\d|\/mo\b|[Pp]er month|stripe\.com|1,000 (?:API )?credits|[Oo]ne-time pack|dchub\.cloud\/(?:plans|pricing|go\/c)/;

let H, fence;
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => {
    if (p === '/api/v1/grid/intelligence/PJM') return GI;
    if (p === '/api/v1/dcpi/iso-comparison') return CMP;
    if (p === '/api/v1/interconnection-queue/by-iso') return QUEUE;
    if (p === '/api/v1/interconnection-queue/snapshot') return { by_iso: [QUEUE] };
    if (p === '/api/v1/grid/extended/PJM') return { available: false };
    if (p === '/api/v1/markets/northern-virginia') return MARKET;
    return undefined;
  } });
});
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

const texts = (r) => ((r.msg && r.msg.result && r.msg.result.content) || []).filter((c) => c.type === 'text').map((c) => c.text);
async function keyless(path, name) {
  const init = await H.init(path, path === '/mcp/claude' ? 'claude-ai' : 'cursor', { 'x-forwarded-for': '203.0.113.' + (40 + Math.floor(Math.random() * 150)) });
  const sid = init.headers.get('mcp-session-id');
  return H.call(path, name, ARGS[name], sid ? { 'mcp-session-id': sid } : {});
}

describe('item 3: the keyless decision-tool claim line', () => {
  for (const name of Object.keys(ARGS)) {
    it(`${name}: on /mcp the line is served (control)`, async () => {
      const r = await keyless('/mcp', name);
      expect(texts(r).join('\n'), r.raw.slice(0, 600)).toMatch(name === 'get_market_intel'
        ? /Free, one call[^\n]*`claim_free_key`/   // market intel: a bound email does not deepen it, plain line
        : /Ask your user for their email, then call `bind_email` with it to unlock the full answer\.[^\n]*`bind_email`[^\n]*`claim_free_key`/);   // Grok/owner 10-17: email first
    });
    it(`${name}: on /mcp/claude no claim line, the neutral partial line ends it, no plan or price, under 100K`, async () => {
      const r = await keyless('/mcp/claude', name);
      const t = texts(r);
      expect(t.length, r.raw.slice(0, 600)).toBeGreaterThan(0);
      expect(r.raw).not.toContain('claim_free_key');
      expect(t.filter((x) => x === CLAUDE_PLANS_NOTICE)).toEqual([CLAUDE_PLANS_NOTICE]);
      expect(t[t.length - 1]).toBe(CLAUDE_PLANS_NOTICE);
      expect(t.join('\n')).not.toMatch(PLAN);
      expect(r.raw).not.toMatch(PRICE);
      expect(r.raw.length).toBeLessThan(100000);
    });
  }
});
