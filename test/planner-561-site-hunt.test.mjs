// planner-561-site-hunt.test.mjs -- planner 5.61 (owner head-to-head 2026-11-22), pure functions, no network.
//
// "find a Miami site for a 50 MW data center ... check power, zoning, moratorium, flood, environmental" routed to
// permitting (three get_permitting_intel reads for FL, no search areas). It now keeps the class it would have had,
// leads with find_sites around Miami (the land step, which also takes a one-place site hunt in fiber_power_pairing),
// and the moratorium read joins it.
import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { siteHuntAsk, siteHuntWording } from '../lib/site-hunt.mjs';

const MIAMI = 'find a Miami site for a 50 MW data center: no flood-prone land, within 2 miles of a 115 kV line, fiber nearby; check power, zoning, moratorium, flood, environmental';
const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.tool, s.args_hint]));
const tools = (p) => p.recommended_sequence.map((s) => s.tool);

describe('planner 5.61: a site hunt is a site search', () => {
  it('PLANNER_VERSION is 5.61', () => { expect(PLANNER_VERSION).toBe('5.62'); });

  it('the owner brief (with a moratorium check) is a site search around Miami, not permitting', () => {
    for (const ctx of [{}, { capacity_mw: 50, state: 'FL', market: 'miami' }]) {
      const p = _planQuery(MIAMI, ctx);
      expect(p.intent_class, show(p)).not.toBe('permitting');
      // find_sites leads, held to Miami: the geocoded town point, or the pinned market (never the whole state)
      const f = p.recommended_sequence[0];
      expect(f.tool, show(p)).toBe('find_sites');
      if (ctx.market) expect(f.args_hint, show(p)).toEqual({ market: 'miami', state: 'FL' });
      else { expect(f.geocode, show(p)).toBe('Miami, FL'); expect(f.args_hint.radius_km, show(p)).toBe(60); }
      expect(tools(p), show(p)).toContain('get_market_dcpi_rank');
      // the moratorium check the brief asked for rides along, held to FL, inside the default 6-step budget
      const i = p.recommended_sequence.findIndex((s) => s.tool === 'get_permitting_intel' && s.args_hint.class === 'moratorium');
      expect(i, show(p)).toBeGreaterThanOrEqual(0);
      expect(i, show(p)).toBeLessThan(6);
      expect(p.recommended_sequence[i].args_hint, show(p)).toEqual({ class: 'moratorium', state: 'FL' });
    }
  });

  it('a short site hunt with a moratorium word keeps the land flow and adds the moratorium read', () => {
    const p = _planQuery('find a site for a 50 MW data center near Miami, check moratorium and zoning', {});
    expect(p.intent_class, show(p)).toBe('capacity_search');
    expect(p.recommended_sequence[0].tool, show(p)).toBe('find_sites');
    expect(tools(p).filter((t) => t === 'get_permitting_intel').length, show(p)).toBe(2);
  });

  it('moratorium questions that name no site to find stay permitting', () => {
    for (const q of ['Which counties in Florida have data center moratoriums?',
      'is there a moratorium on data centers in Miami-Dade',
      'Which US states have data center moratoriums right now?']) {
      expect(_planQuery(q, {}).intent_class, q).toBe('permitting');
    }
  });

  it('a site screen at a point is not a site hunt', () => {
    const p = _planQuery('screen this site for a 50 MW data center at 25.85, -80.30: zoning and moratorium', {});
    expect(p.intent_class).not.toBe('permitting');
    expect(p.intent_class).not.toBe('siting_search');
  });

  it('siteHuntWording needs the finding verb and its target in one clause', () => {
    expect(siteHuntWording('find a Miami site')).toBe(true);
    expect(siteHuntWording('where should we build 100 MW')).toBe(true);
    expect(siteHuntWording('looking for land for a campus')).toBe(true);
    expect(siteHuntWording('find the moratorium; site rules')).toBe(false);
    expect(siteHuntWording('what is the moratorium status in Miami')).toBe(false);
  });

  it('siteHuntAsk needs a size and exactly one place', () => {
    expect(siteHuntAsk('find a site', { mw: 50, __namedMarkets: ['miami'], states: [] })).toBe(true);
    expect(siteHuntAsk('find a site', { mw: null, __namedMarkets: ['miami'], states: [] })).toBe(false);
    expect(siteHuntAsk('find a site', { mw: 50, __namedMarkets: ['miami', 'dallas'], states: [] })).toBe(false);
    expect(siteHuntAsk('find a site', { mw: 50, __namedMarkets: ['miami'], states: [], coords: { lat: 1, lon: 2 } })).toBe(false);
  });
});
