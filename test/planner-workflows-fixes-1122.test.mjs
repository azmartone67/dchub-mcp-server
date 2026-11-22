// planner-workflows-fixes-1122.test.mjs — planner 5.60 (/workflows spec §7, 2026-11-22).
//
// Three flagship /workflows prompts planned the wrong reads, measured live on 2.12.61 / planner 5.59:
//   §7.1 "Compare Northern Virginia, Columbus and Atlanta for a 200 MW ..." read two DCPI cards and dropped Atlanta.
//        Northern Virginia is a metro, not a DCPI index market, so the multi-market match held two names and the
//        "more than two" fan-out never ran.
//   §7.2 "Where do fiber routes, substations and candidate data center sites overlap around Hillsboro, Oregon?" ran
//        fiber reads only (no substation or site step), and with no lat/lon get_fiber_readiness was skipped_unresolved.
//   §7.3 "Evaluate the infrastructure risks of a proposed 300 MW data center investment in Atlanta ..." routed to
//        water_climate: no power and no fiber step.
// Markets used here are Ashburn / Northern Virginia, Columbus, Atlanta and Hillsboro only.
import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';

const seq = (p) => {
  const s = p.recommended_sequence || [];
  expect(s.length, 'planner returned an empty plan').toBeGreaterThan(0);
  return s;
};
const tools = (p) => seq(p).map((s) => s.tool);
const dcpiSlugs = (p) => seq(p).filter((s) => s.tool === 'get_market_dcpi_rank').map((s) => s.args_hint && s.args_hint.market_slug);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

describe('planner 5.60', () => {
  it('bumps the planner version', () => {
    expect(PLANNER_VERSION).toBe('5.61');
  });
});

describe('§7.1 a three-market comparison reads every market', () => {
  it('"Northern Virginia, Columbus and Atlanta" (no states) reads three DCPI cards, Atlanta included', () => {
    const p = _planQuery('Compare Northern Virginia, Columbus and Atlanta for a 200 MW hyperscale data center investment');
    expect(p.intent_class).toBe('market_comparison');
    const slugs = dcpiSlugs(p);
    expect(slugs).toContain('atlanta');
    expect(slugs).toContain('columbus');
    expect(slugs.some((s) => s === 'northern-virginia' || s === 'ashburn')).toBe(true);
    expect(new Set(slugs).size).toBeGreaterThanOrEqual(3);
  });
  it('a two-market comparison is unchanged: two DCPI cards', () => {
    const p = _planQuery('Compare Columbus and Atlanta for a 100 MW campus');
    expect(p.intent_class).toBe('market_comparison');
    expect(dcpiSlugs(p).sort()).toEqual(['atlanta', 'columbus']);
  });
});

describe('§7.2 a fiber + substations + sites ask reads the overlap', () => {
  const Q = 'Where do fiber routes, substations and candidate data center sites overlap around Hillsboro, Oregon?';
  for (const [label, ctx] of [
    ['with no lat/lon (market only)', { market: 'hillsboro', state: 'OR' }],
    ['with lat/lon', { market: 'hillsboro', state: 'OR', lat: 45.5229, lon: -122.9898 }],
  ]) {
    it(label, () => {
      const p = _planQuery(Q, ctx);
      expect(p.intent_class).toBe('fiber');
      const t = tools(p);
      expect(t).toContain('get_fiber_intel');
      expect(t).toContain('find_sites');
      expect(t).toContain('get_infrastructure');
      expect(t.length).toBeLessThanOrEqual(6);   // fits the default budget
      const fr = seq(p).find((s) => s.tool === 'get_fiber_readiness');
      expect(fr, 'get_fiber_readiness planned').toBeTruthy();
      expect(isNum(fr.args_hint.lat) && isNum(fr.args_hint.lon), 'readiness has a real point, not a placeholder').toBe(true);
      const fs = seq(p).find((s) => s.tool === 'find_sites');
      expect(isNum(fs.args_hint.lat) && isNum(fs.args_hint.lon)).toBe(true);
    });
  }
  it('a fiber ask naming a metro but no point resolves the metro centroid', () => {
    const p = _planQuery('Fiber routes in Columbus');
    const fr = seq(p).find((s) => s.tool === 'get_fiber_readiness');
    expect(fr && isNum(fr.args_hint.lat) && isNum(fr.args_hint.lon)).toBe(true);
  });
  it('a metro centroid never becomes the lead-in route\'s site (plan_fiber_leadin keeps the placeholder)', () => {
    const p = _planQuery('Fiber routes in Columbus');
    const li = seq(p).find((s) => s.tool === 'plan_fiber_leadin');
    expect(li, 'plan_fiber_leadin planned').toBeTruthy();
    expect(li.args_hint.from).toBe('<site "lat,lng" or address>');
  });
  it('a fiber ask that names no substation or site adds neither', () => {
    const p = _planQuery('Fiber routes in Columbus');
    expect(tools(p)).not.toContain('find_sites');
    expect(tools(p)).not.toContain('get_infrastructure');
  });
});

describe('§7.3 an investment risk read is due_diligence and reads power and fiber', () => {
  const CORE = ['get_market_dcpi_rank', 'get_fiber_readiness', 'get_water_risk', 'get_disaster_risk', 'get_permitting_intel'];
  const POWER = ['get_grid_intelligence', 'get_power_availability_timeline'];
  for (const [q, ctx, slug] of [
    ['Evaluate the infrastructure risks of a proposed 300 MW data center investment in Atlanta, Georgia: power, water, climate, fiber and permitting',
      { market: 'atlanta', state: 'GA', lat: 33.749, lon: -84.388, capacity_mw: 300 }, 'atlanta'],
    ['Due diligence on a 200 MW data center campus investment in Ashburn, Virginia', {}, 'ashburn'],
    ['Evaluate the infrastructure risks of a proposed 300 MW data center investment in Columbus, Ohio', {}, 'columbus'],
  ]) {
    it(q.slice(0, 70), () => {
      const p = _planQuery(q, ctx);
      expect(p.intent_class).toBe('due_diligence');
      const first6 = tools(p).slice(0, 6);
      for (const t of CORE) expect(first6, `${t} in the default six`).toContain(t);
      expect(first6.some((t) => POWER.includes(t)), 'a grid power read in the default six').toBe(true);
      expect(dcpiSlugs(p)).toContain(slug);
      const fr = seq(p).find((s) => s.tool === 'get_fiber_readiness');
      expect(isNum(fr.args_hint.lat) && isNum(fr.args_hint.lon)).toBe(true);
      expect(tools(p).length).toBeLessThanOrEqual(8);
    });
  }
  it('Atlanta (no US RTO) reads the state timeline; Ashburn (PJM) reads the ISO', () => {
    const a = _planQuery('Evaluate the infrastructure risks of a proposed 300 MW data center investment in Atlanta, Georgia', { market: 'atlanta', state: 'GA' });
    expect(tools(a)).toContain('get_power_availability_timeline');
    const b = _planQuery('Due diligence on a 200 MW data center campus investment in Ashburn, Virginia');
    const g = seq(b).find((s) => s.tool === 'get_grid_intelligence');
    expect(g && g.args_hint.iso).toBe('PJM');
  });
  it('a plain water / flood question stays water_climate', () => {
    expect(_planQuery('What is the flood and water risk near Atlanta, Georgia?').intent_class).toBe('water_climate');
  });
});
