// fiber-ownership-checked-1127.test.mjs — Grok fix-all 2026-11-27 item 10: the fiber answer says the curated
// baseline's carrier-ownership re-check (backend baseline.ownership_checked, be#9450) beside the baseline date,
// and keeps the baseline date (route miles were not re-measured).
import { it, expect } from 'vitest';
import { buildFiberAnswer } from '../lib/fiber-answer.mjs';

const Q = 'Which carriers have dark fiber in Northern Virginia?';
const metro = (baseline) => ({
  market: 'Northern Virginia', success: true, baseline,
  summary: { market: 'Northern Virginia', state: 'VA', tier: 'Tier 1', fiber_density_score: 100, total_carriers: 6,
    total_on_net_buildings: 1040, total_route_miles: 9000, key_carrier_hotels: ['Hotel Alpha'] },
  carriers: [{ carrier: 'Carrier One', route_miles_approx: 2800, on_net_buildings: 350 }],
});
const run = (baseline) => buildFiberAnswer({ intent: Q, intent_class: 'fiber' },
  [{ step: 1, tool: 'get_metro_fiber', args: { market: 'ashburn' }, status: 'executed', result: metro(baseline) }], null);
const text = (a) => [a.headline, ...(a.evidence || [])].join(' ');

it('names the 2026-11-26 ownership re-check beside the 2026-03-17 baseline', () => {
  const t = text(run({ as_of: '2026-03-17', as_of_kind: 'seed_date', ownership_checked: '2026-11-26' }));
  expect(t).toContain('curated metro baseline as of 2026-03-17 (carrier ownership and build status re-checked 2026-11-26), not a live feed');
});

it('says nothing extra when the backend sends no re-check date', () => {
  const t = text(run({ as_of: '2026-03-17', as_of_kind: 'seed_date' }));
  expect(t).toContain('curated metro baseline as of 2026-03-17, not a live feed');
  expect(t).not.toContain('re-checked');
});
