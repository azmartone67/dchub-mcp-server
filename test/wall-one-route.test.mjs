// wall-one-route.test.mjs — Grok note K item 8 (2026-11-15): ONE route per wall (lib/wall-offers.mjs oneRoute).
//
// Before: a walled answer could stack the OAuth sign-in lead, the free email / digest floor and the depth trial, on
// top of its own human link, claim_free_key and checkout copy. Now wallOffers returns at most one offer: none when
// the answer already carries a free offer, else the free floor (email, or digest where an email opens nothing),
// else the sign-in, else the trial. Grok's fixed G3 copy (only the sign-in) is unchanged. The stacked composition is
// pinned in test/wall-offers.test.mjs under the kill switch DCHUB_WALL_ONE_ROUTE=0.
import { describe, it, expect } from 'vitest';
import { wallOffers, oneRoute, wallOneRouteOn } from '../lib/wall-offers.mjs';
import { OAUTH_SIGNIN_URL } from '../lib/wall-oauth-lead.mjs';

const ON = {};
const OFF = { DCHUB_WALL_ONE_ROUTE: '0' };
const ents = [
  { keyed: false, bound: false, signedIn: false, paid: false, held: '' },
  { keyed: true, bound: false, signedIn: false, paid: false, held: '' },
  { keyed: true, bound: true, signedIn: false, paid: false, held: '' },
  { keyed: true, bound: true, signedIn: true, paid: false, held: '' },
];
const tools = ['list_transactions', 'compare_isos', 'get_grid_intelligence', 'rank_markets'];
function* matrix() {
  for (const ent of ents) for (const tool of tools) for (const depth of [false, true]) for (const proOnly of [false, true])
    for (const link of ['', 'https://dchub.cloud/u/abcdef']) for (const workosEnabled of [false, true]) for (const freeOfferShown of [false, true])
      yield [ent, { tool, depth, proOnly, link, workosEnabled, freeOfferShown }];
}

describe('one route per wall (default)', () => {
  it('every input: at most one offer; none when a free offer is already shown; the floor whenever one is eligible', () => {
    let n = 0, stackedBefore = 0;
    for (const [ent, f] of matrix()) {
      const got = wallOffers(ent, { ...f, walled: true, env: ON });
      const old = wallOffers(ent, { ...f, walled: true, env: OFF });
      expect(got.length, JSON.stringify(f)).toBeLessThanOrEqual(1);
      if (f.freeOfferShown) expect(got).toEqual([]);
      const oldFloor = old.find((o) => o.place === 'floor');
      if (oldFloor) expect(got).toEqual([oldFloor]);              // the floor is the route, same line, same ask tag
      else if (!f.freeOfferShown && old.length) expect(got).toEqual([oneRoute(old)[0]]);
      if (old.length > 1) stackedBefore += 1;
      n += 1;
    }
    expect(n).toBe(512);
    expect(stackedBefore, 'CONTROL: the kill switch still stacks offers on some walls').toBeGreaterThan(50);
  });

  it('no default wall names the sign-in URL or the trial beside the floor', () => {
    for (const [ent, f] of matrix()) {
      const lines = wallOffers(ent, { ...f, walled: true, env: ON }).map((o) => o.line).join('\n');
      if (!f.freeOfferShown && wallOffers(ent, { ...f, walled: true, env: OFF }).some((o) => o.place === 'floor')) {
        expect(lines).not.toContain(OAUTH_SIGNIN_URL);
        expect(lines).not.toMatch(/7-day/);
      }
    }
  });

  it('Grok keeps its G3 sign-in block; an unwalled answer gets nothing', () => {
    const ent = ents[0];
    const g = wallOffers(ent, { tool: 'rank_markets', walled: true, workosEnabled: true, grok: true, env: ON });
    expect(g.map((o) => o.place)).toEqual(['lead']);
    expect(wallOffers(ent, { tool: 'rank_markets', walled: false, workosEnabled: true, env: ON })).toEqual([]);
  });

  it('oneRoute ranks floor, then lead, then the trial; the switch reads 0/false/off', () => {
    const o = (place) => ({ place, line: place });
    expect(oneRoute([o('below_link'), o('lead'), o('floor')])).toEqual([o('floor')]);
    expect(oneRoute([o('below_link'), o('lead')])).toEqual([o('lead')]);
    expect(oneRoute([o('below_link')])).toEqual([o('below_link')]);
    expect(oneRoute([])).toEqual([]);
    expect(wallOneRouteOn({})).toBe(true);
    for (const v of ['0', 'false', 'off', 'no']) expect(wallOneRouteOn({ DCHUB_WALL_ONE_ROUTE: v })).toBe(false);
  });
});
