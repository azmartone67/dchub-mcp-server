// fiber-routing-1124.test.mjs — Grok Brain note 2026-11-24, item 10a-c (server 2.12.63, planner 5.63).
//
//   a  A fiber ask at an address or lat/lon led with a PeeringDB facility count ("PeeringDB within about 56 km ...:
//      50 facilities"); "350 E Cermak, Chicago" never ran get_fiber_readiness. Now the address is geocoded, readiness
//      runs there, and the on-net / near-net read (km + source) leads; the peering count is evidence.
//   b  "which internet exchanges and carrier hotels are in Northern Virginia" ran a facility search / colocation plan
//      with no get_peering_intel. Now IX / peering / carrier-hotel asks are the fiber class.
//   c  "fiber routes and latency from Phoenix to Los Angeles" read Phoenix only and skipped plan_fiber_leadin. Now both
//      ends are read and the pair's latency floor runs; a measured route latency is said to be not served.
// Step results are stubs shaped like the live tool responses; names and figures are fixtures, not DC Hub data.
import { describe, it, expect } from 'vitest';
import { _planQuery } from '../server.mjs';
import { ixAsk, routePair, fiberAddress, fiberKind } from '../lib/plan-routing.mjs';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';

const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const stepOf = (p, tool) => p.recommended_sequence.find((s) => s.tool === tool);

describe('10a: a fiber ask at a building or a point reads that place', () => {
  it('"350 E Cermak, Chicago" (no street-type word): readiness and peering wait on the geocoded address', () => {
    const p = _planQuery('Is 350 E Cermak, Chicago on-net for fiber?', {});
    expect(p.intent_class).toBe('fiber');
    expect(tools(p)[0]).toBe('get_fiber_readiness');
    const r = stepOf(p, 'get_fiber_readiness');
    expect(r.geocode).toBe('350 E Cermak, Chicago, IL');
    expect(r.geocode_basis).toBe('address');
    expect(stepOf(p, 'get_peering_intel').geocode).toBe('350 E Cermak, Chicago, IL');
    expect(stepOf(p, 'get_metro_fiber').args_hint).toEqual({ market: 'Chicago' });
  });
  it('a full street address keeps its city and state when the question ends in "?"', () => {
    const p = _planQuery('What fiber is available at 350 E Cermak Rd, Chicago, IL?', {});
    expect(p.intent_class).toBe('fiber');
    expect(stepOf(p, 'get_fiber_readiness').geocode).toBe('350 E Cermak Rd, Chicago, IL');
    expect(tools(p)).not.toContain('plan_fiber_leadin');
  });
  it('a year is never a house number; a whole-site ask stays a site analysis', () => {
    expect(fiberAddress('fiber in 2026 Phoenix', {})).toBeNull();
    expect(fiberAddress('top 10 Carrier hotels in Dallas with fiber', {})).toBeNull();
    expect(fiberAddress('which of the 25 Largest buildings in Dallas are on-net', {})).toBeNull();
    expect(_planQuery('Evaluate the site at 39.04, -77.49 for power, water and fiber', {}).intent_class).toBe('site_analysis');
  });
});

describe('10b: internet exchange / peering / carrier hotel asks are fiber asks', () => {
  it('fb-e: IX and carrier hotels in Northern Virginia read peering at the metro core, no facility search', () => {
    const p = _planQuery('which internet exchanges and carrier hotels are in Northern Virginia', {});
    expect(p.intent_class).toBe('fiber');
    expect(tools(p)).toContain('get_peering_intel');
    expect(tools(p)).toContain('get_metro_fiber');
    expect(tools(p)).not.toContain('search_facilities');
  });
  it('"IX" as a word (upper case) is an interconnection ask; "six" or "mix" is not', () => {
    expect(_planQuery('IX options in Ashburn', {}).intent_class).toBe('fiber');
    expect(ixAsk('IX options in Ashburn')).toBe(true);
    expect(ixAsk('the six largest campuses')).toBe(false);
    expect(ixAsk('generation mix in Texas')).toBe(false);
  });
  it('a colocation-space ask at carrier hotels keeps its own plan', () => {
    expect(ixAsk('colocation pricing at carrier hotels in Dallas')).toBe(false);
    expect(ixAsk('Which Chicago carrier hotels have the most peering for a cross-connect?')).toBe(false);
    expect(_planQuery('colocation pricing at carrier hotels in Dallas', {}).intent_class).not.toBe('fiber');
    expect(_planQuery('carrier hotel colocation space available in Dallas', {}).intent_class).not.toBe('fiber');
  });
});

describe('10c: a route ask reads both ends', () => {
  it('fb-d: Phoenix to Los Angeles reads long-haul routes at both ends and the pair latency floor', () => {
    const p = _planQuery('fiber routes and latency from Phoenix to Los Angeles', {});
    expect(p.intent_class).toBe('fiber');
    expect(tools(p)).toEqual(['get_fiber_intel', 'get_fiber_intel', 'cluster_sites_by_latency']);
    const fi = p.recommended_sequence.filter((s) => s.tool === 'get_fiber_intel').map((s) => s.args_hint.market);
    expect(fi).toEqual(['phoenix', 'los-angeles']);
    expect(stepOf(p, 'cluster_sites_by_latency').args_hint.sites).toMatch(/:phoenix;.*:los-angeles$/);
    // no step waits on a value nothing mints (the old plan_fiber_leadin "<site lat,lng>" placeholder)
    for (const s of p.recommended_sequence) expect(JSON.stringify(s.args_hint)).not.toMatch(/</);
  });
  it('"between X and Y" is a route ask too; one metro or a lead-in ask is not', () => {
    expect(routePair('fiber latency between Dallas and Houston').b.id).toBe('houston');
    expect(routePair('fiber routes in Dallas')).toBeNull();
    expect(routePair('Plan diverse fiber lead-in routes from Dallas to Houston')).toBeNull();
    expect(fiberKind('fiber latency between Dallas and Houston', {})).toBe('route');
  });
});

// ---- the answer, from stubbed step results ----
const PEERING = (lat, lon) => ({
  success: true, source: 'PeeringDB', location: { lat, lng: lon, radius_deg: 0.5 },
  connectivity: { facilities_nearby: 50, total_networks: 900, total_ix_presence: 70,
    top_facilities: [
      { name: 'Facility A', city: 'X', net_count: 210, ix_count: 9 },
      { name: 'Facility B', city: 'X', net_count: 120, ix_count: 4 },
      { name: 'Facility C', city: 'X', net_count: 64, ix_count: 2 },
    ] },
  freshness: { served_at: '2026-11-24T03:00:00Z' },
});
const ex = (tool, args, result, step) => ({ step, tool, args, status: 'executed', ms: 10, result });

describe('10a: the lead is the on-net / near-net read at the place the caller gave', () => {
  const steps = (lat, lon, ready) => [
    ex('get_fiber_readiness', { lat, lon }, ready, 1),
    ex('get_peering_intel', { lat, lon }, PEERING(lat, lon), 2),
  ];
  it('fb-c: a lat/lon ask leads near-net + km + source; the PeeringDB count moves to evidence', () => {
    const a = buildIntentAnswer({ intent: 'Is there fiber near 39.0438, -77.4874?', intent_class: 'fiber', point_given: true },
      steps(39.0438, -77.4874, { near_net_bucket: 'near-net', nearest_carrier_km: 0.48 }), null);
    expect(a.headline).toMatch(/^Fiber at 39\.0438, -77\.4874: near-net, nearest carrier 0\.48 km \(PeeringDB carrier presence \+ FCC fiber coverage/);
    expect(a.headline).not.toMatch(/facilities/);
    expect(a.evidence.some((e) => /^PeeringDB within about 56 km .*50 facilities/.test(e))).toBe(true);
  });
  it('fb-a: a geocoded address leads on-net, said at the address', () => {
    const a = buildIntentAnswer({ intent: 'Is 350 E Cermak, Chicago on-net for fiber?', intent_class: 'fiber', point_given: true,
      address: '350 E Cermak, Chicago, IL' }, steps(41.8537, -87.6186, { near_net_bucket: 'on-net', nearest_carrier_km: 0.05 }), null);
    expect(a.headline).toMatch(/^Fiber at 350 E Cermak, Chicago, IL: on-net, nearest carrier 0\.05 km/);
  });
  it('a readiness read at a metro core (no point given) does not lead', () => {
    const a = buildIntentAnswer({ intent: 'fiber in Phoenix', intent_class: 'fiber' },
      steps(33.4484, -112.074, { near_net_bucket: 'on-net', nearest_carrier_km: 0 }), null);
    expect(a.headline).not.toMatch(/^Fiber at/);
  });
});

describe('10b: an IX / carrier hotel lead names at least three facilities', () => {
  it('names the facilities the peering read ranked, not a facility count', () => {
    const a = buildIntentAnswer({ intent: 'which internet exchanges and carrier hotels are in Northern Virginia', intent_class: 'fiber' },
      [ex('get_peering_intel', { lat: 39.0438, lon: -77.4874 }, PEERING(39.0438, -77.4874), 1)], null);
    expect(a.headline).toMatch(/Facility A.*Facility B.*Facility C/);
    expect(a.headline).not.toMatch(/\d+ facilities matching/);
  });
});

describe('10c: a route answer names a route or says route latency is not served', () => {
  const feat = (name) => ({ type: 'Feature', properties: { name, carrier: 'C', route_type: 'longhaul' } });
  const FI = (names, total) => ({ type: 'FeatureCollection', features: names.map(feat), _features_total_available: total,
    provenance: { as_of: '2026-03-15' } });
  const LAT = { pairs: [{ from: 'phoenix', to: 'los-angeles', distance_km: 574.3, floor_rtt_us: 5627.8, est_rtt_us: 7878.9 }] };
  const Q = 'fiber routes and latency from Phoenix to Los Angeles';
  it('a route in both end reads leads, with the round-trip estimate, and one not_established line', () => {
    const a = buildIntentAnswer({ intent: Q, intent_class: 'fiber' }, [
      ex('get_fiber_intel', { route_type: 'longhaul', market: 'phoenix' }, FI(['Core [LA - Phoenix] seg22', 'Other seg1'], 120), 1),
      ex('get_fiber_intel', { route_type: 'longhaul', market: 'los-angeles' }, FI(['Core [LA - Phoenix] seg3'], 80), 2),
      ex('cluster_sites_by_latency', { sites: 's' }, LAT, 3),
    ], null);
    expect(a.headline).toMatch(/^Long-haul fiber routes on record touching both Phoenix and Los Angeles: Core \[LA - Phoenix\] /);
    expect(a.headline).toMatch(/estimated fiber round trip 7\.9 ms, physics floor 5\.6 ms over 574 km/);
    expect(a.not_established).toHaveLength(1);
    expect(a.not_established[0]).toMatch(/measured route latency between Phoenix and Los Angeles is not served/);
    expect(a.headline).not.toMatch(/nearest carrier 0 km/);
  });
  it('no route and no latency read: the withheld sentence', () => {
    const a = buildIntentAnswer({ intent: Q, intent_class: 'fiber' }, [
      ex('get_fiber_intel', { route_type: 'longhaul', market: 'phoenix' }, FI(['A seg1'], 1), 1),
    ], null);
    expect(a.headline).toBe('DC Hub returned no fiber route or route latency between Phoenix and Los Angeles in this read.');
    expect(a.not_established).toEqual(['Route latency between Phoenix and Los Angeles is not served by DC Hub in this read.']);
  });
});
