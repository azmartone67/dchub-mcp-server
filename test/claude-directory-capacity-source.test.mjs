// claude-directory-capacity-source.test.mjs — owner decision 2026-09-29
//
// /mcp/claude lists source_capacity (Capacity Source browse, read-only) and
// serves /dchub:find_capacity. The two Capacity Source writes stay /mcp only.
// What that must and must not change, against a fake backend that answers the
// listings routes the way production did on 2026-09-29 (an anonymous browse
// whose body names claim_free_key, bind_email, request_capacity_intro and a
// sign-in URL) and reports live listings in Dallas:
//   1. source_capacity answers on /mcp/claude with the listing cards and their
//      kW figures, and none of the write/identity steps it cannot serve;
//   2. accept_capacity_terms and request_capacity_intro are "Unknown tool";
//   3. the capacity_source POINTER that /mcp adds to market and site answers is
//      not added on /mcp/claude (DC Hub promoting its own listings inside
//      another tool's answer). CONTROL: /mcp still adds it, same call.
//
// Hard-gate qualified: real server on 127.0.0.1 against a local stub, no egress.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CLAUDE_REMOVED } from '../lib/claude-directory.mjs';
import { startHarness, fenceNetwork, claudeProbePatterns, hitsOf } from './helpers/claude-directory-harness.mjs';

const DIR = '/mcp/claude';
const PATTERNS = claudeProbePatterns(CLAUDE_REMOVED);

// Shape of GET /api/v1/listings for an anonymous caller, 2026-09-29.
const LISTINGS = {
  ok: true, caller_tier: 'anonymous', can_see_pocket: false, count: 1, pocket_locked_count: 1, filters: {},
  caller_access: { granted: false, reason: 'sign_in_required', required: 'registered',
    unlock: { mcp_steps: ['claim_free_key', 'bind_email'], pricing_url: null,
      web_sign_in_url: 'https://dchub.cloud/login?redirect=%2Flistings' } },
  citation: { cite_as: 'DC Hub Capacity Source, dchub.cloud', source: 'DC Hub Capacity Source', url: 'https://dchub.cloud/listings' },
  items: [{
    id: 100004, slug: 'phoenix-2-mw-colocation-available-now', title: 'Phoenix — 2 MW colocation, available now',
    market: 'Phoenix', state: 'AZ', country: 'US', region: 'north_america', delivery_type: 'colocation',
    capacity_kw: 2000, capacity_mw: 2.0, contiguous_kw: 2000, min_contract_kw: null, available: '2026-09',
    locked: true, lock_reason: 'sign_in_required', access_required: 'registered', provider: null,
    updated_at: '2026-09-29T08:11:44Z', summary: '2 MW of contiguous colocation capacity in Phoenix, available now.',
  }],
  program: {
    name: 'DC Hub Capacity Source', status: 'live',
    how_it_works: [
      'Search listings by size (kW or MW) and location, and see when each was last updated, without an account.',
      'Sign in with a free account, or connect an identified AI agent, and accept the introduction terms once to see a listing\'s specs.',
      'Register for a listing. DC Hub sends the provider your company name and requirement.',
    ],
    register_interest: { mcp_tool: 'request_capacity_intro', method: 'POST', path: '/api/v1/listings/interest' },
  },
};
const SUMMARY = {
  ok: true, program_status: 'live', live_count: 2, total_mw: 80,
  latest_updated_at: '2026-09-28T14:00:00+00:00', generated_at: '2026-09-29T00:00:00+00:00',
  markets: [{ market: 'Dallas', state: 'TX', country: 'US', count: 2, mw: 80, delivery_types: ['powered_shell'] }],
  delivery_types: { powered_shell: 2 },
};

let H, fence;
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p) => {
      if (p === '/api/v1/listings/summary') return SUMMARY;
      if (p === '/api/v1/listings') return LISTINGS;
      return undefined;
    },
  });
  await H.S._capacitySummary.refresh();
  expect(H.S._capacitySummary.peek()).toBeTruthy();   // live, so the pointer CAN fire
}, 60_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

const payloadOf = (r) => JSON.parse(r.msg.result.content[0].text);

describe('source_capacity on /mcp/claude', () => {
  it('answers with the listing cards and their kW figures, and nothing it cannot serve', async () => {
    for (const args of [{}, { state: 'AZ', min_mw: 2 }]) {
      const r = await H.call(DIR, 'source_capacity', args);
      expect(r.msg.result, JSON.stringify(r.msg)).toBeTruthy();
      expect(r.msg.result.isError).not.toBe(true);
      const p = payloadOf(r);
      expect(p.items).toHaveLength(1);
      expect(p.items[0]).toMatchObject({ market: 'Phoenix', state: 'AZ', capacity_kw: 2000, contiguous_kw: 2000,
        delivery_type: 'colocation', slug: 'phoenix-2-mw-colocation-available-now' });
      // No write, key or sign-in step: request_capacity_intro, claim_free_key,
      // bind_email and the sign-in URL are all gone.
      expect(hitsOf(PATTERNS, r.raw)).toEqual([]);
      expect(r.raw).not.toMatch(/request_capacity_intro|accept_capacity_terms|bind_email|sign_in_url|login\?/);
    }
  });

  it('CONTROL: the same call on /mcp carries the steps /mcp/claude removes', async () => {
    const r = await H.call('/mcp', 'source_capacity', {});
    expect(r.raw).toMatch(/request_capacity_intro/);
    expect(r.raw).toMatch(/claim_free_key/);
  });

  it('the two Capacity Source writes are not callable on /mcp/claude', async () => {
    for (const n of ['accept_capacity_terms', 'request_capacity_intro']) {
      const r = await H.call(DIR, n, { slug: 'phoenix-2-mw-colocation-available-now' });
      expect(r.msg.error, n).toBeTruthy();
      expect(r.msg.error.message, n).toMatch(/^Unknown tool/);
    }
  });
});

describe('the capacity_source pointer stays off /mcp/claude', () => {
  const POINTER = /Capacity Source: \d+ live listing|"capacity_source"\s*:|cloud\.dchub\/capacity_source/;
  it('CONTROL: /mcp adds the pointer to find_sites state=TX (live Dallas listings)', async () => {
    const r = await H.call('/mcp', 'find_sites', { state: 'TX' });
    expect(r.raw).toMatch(POINTER);
  });
  it('/mcp/claude: the same call, and the other pointer tools, carry no pointer', async () => {
    for (const [name, args] of [['find_sites', { state: 'TX' }], ['get_market_intel', { market: 'dallas' }],
      ['get_market_context', { market: 'dallas' }], ['rank_markets', {}], ['site_selection_canvas', { region: 'TX' }]]) {
      const r = await H.call(DIR, name, args);
      expect(r.raw, name).not.toMatch(POINTER);
    }
  });
});
