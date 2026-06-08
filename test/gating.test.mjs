// Unit tests for the MCP gating primitives — the revenue-critical, pure logic
// that has regressed repeatedly (the "2/22 grids" over-redaction, trial-preview
// incidents). Imported directly from server.mjs (which skips app.listen under
// VITEST). No network, no prod dependency.
import { describe, it, expect } from 'vitest';
import {
  trimForTrial, applyTierGate, FREE_FULL_TOOLS, PAID_ONLY_TOOLS, _isMetricKey,
} from '../server.mjs';

describe('trimForTrial — anonymous redaction (clean-data contract, 2026-06-07)', () => {
  // De-spam (Devin QA): gating must NOT pollute the data with promo strings —
  // arrays trim to the first row only (+ an honest side count), gated metrics
  // become null. The upgrade CTA lives once in the nudge header, not in the data.
  it('truncates arrays >1 to ONLY the first item + an honest side count (no inline promo)', () => {
    const out = trimForTrial({ grids: [{ iso: 'PJM' }, { iso: 'ERCOT' }, { iso: 'CAISO' }] });
    expect(Array.isArray(out.grids)).toBe(true);
    expect(out.grids).toHaveLength(1);
    expect(out.grids[0]).toEqual({ iso: 'PJM' });
    expect(out._grids_total_in_pro).toBe(3);
  });

  it('leaves a single-element array intact but NULLS metric scalars inside (no promo string)', () => {
    const out = trimForTrial({ rows: [{ iso: 'PJM', count: 5 }] });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].iso).toBe('PJM');
    expect(out.rows[0].count).toBe(null);
  });

  it('nulls aggregate metric scalars but keeps identifier fields', () => {
    const out = trimForTrial({
      count: 42, total_mw: 1000, gas_share_pct: 33.3,
      name: 'Northern Virginia', slug: 'northern-virginia', state: 'VA', iso: 'PJM',
    });
    expect(out.count).toBe(null);
    expect(out.total_mw).toBe(null);
    expect(out.gas_share_pct).toBe(null);
    expect(out.name).toBe('Northern Virginia');
    expect(out.slug).toBe('northern-virginia');
    expect(out.state).toBe('VA');
    expect(out.iso).toBe('PJM');
  });

  it('recurses into nested objects (stats:{...}) and nulls their metrics', () => {
    const out = trimForTrial({ stats: { total_mw: 999, region: 'east' } });
    expect(out.stats.total_mw).toBe(null);
    expect(out.stats.region).toBe('east');
  });

  it('passes through null / primitives unchanged', () => {
    expect(trimForTrial(null)).toBe(null);
    expect(trimForTrial(5)).toBe(5);
    expect(trimForTrial('hello')).toBe('hello');
  });
});

describe('_isMetricKey', () => {
  it('flags aggregate metric names', () => {
    for (const k of ['count', 'total_mw', 'gas_share_pct', 'renewable_rate', 'score', 'capacity', 'revenue', 'unique_callers'])
      expect(_isMetricKey(k), k).toBe(true);
  });
  it('does not flag identifier / descriptive keys', () => {
    for (const k of ['name', 'slug', 'iso', 'city', 'state', 'title', 'source', 'status'])
      expect(_isMetricKey(k), k).toBe(false);
  });
});

describe('applyTierGate — tier access', () => {
  it('paid + enterprise bypass all gating', () => {
    expect(applyTierGate('get_grid_intelligence', {}, 'paid', false, false).allowed).toBe(true);
    expect(applyTierGate('analyze_site', {}, 'enterprise', false, false).allowed).toBe(true);
  });
  it('blocks PAID_ONLY tools for anonymous free callers', () => {
    expect(applyTierGate('get_grid_intelligence', {}, 'free', false, false).allowed).toBe(false);
    expect(applyTierGate('analyze_site', {}, 'free', false, false).allowed).toBe(false);
  });
  it('allows free (non-paid) tools for anonymous callers', () => {
    expect(applyTierGate('get_grid_scoreboard', {}, 'free', false, false).allowed).toBe(true);
    expect(applyTierGate('get_news', {}, 'free', false, false).allowed).toBe(true);
  });
  it('keyed-free bonus unlocks the demand tools with an api key', () => {
    const g = applyTierGate('get_market_intel', {}, 'free', true, false);
    expect(g.allowed).toBe(true);
    expect(g.bonus).toBe(true);
  });
  it('a validated trial unlocks the always-preview Pro tools as a taste', () => {
    const g = applyTierGate('get_grid_intelligence', {}, 'free', false, true);
    expect(g.allowed).toBe(true);
    expect(g.trial_taste).toBe(true);
  });
});

describe('FREE_FULL_TOOLS — flagship hook exemption (regression guard: 2/22 grids)', () => {
  it('get_grid_scoreboard is a free-full hook (must stay exempt from the anon trim)', () => {
    expect(FREE_FULL_TOOLS.has('get_grid_scoreboard')).toBe(true);
  });
  it('a Pro tool is NOT a free-full hook', () => {
    expect(FREE_FULL_TOOLS.has('get_grid_intelligence')).toBe(false);
    expect(PAID_ONLY_TOOLS.has('get_grid_intelligence')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tier gate integrity (BIDIRECTIONAL). Now that both tiers are testable,
// pin the whole contract in one place so a one-sided regression can't ship:
//   • free gets the teaser with ZERO PAID_ONLY leak,
//   • enterprise/paid get the FULL grant (no teaser/taste/bonus flags),
// asserted across EVERY tool in PAID_ONLY_TOOLS — not a hand-picked sample — so
// adding a paid tool without honouring the gate fails CI. Pure logic, no network.
describe('cross-tier gate integrity (bidirectional) — free teaser vs enterprise full', () => {
  const PAID = [...PAID_ONLY_TOOLS];

  it('enterprise + paid get a FULL grant for EVERY PAID_ONLY tool (no teaser/taste/bonus)', () => {
    for (const tool of PAID) {
      for (const tier of ['enterprise', 'paid']) {
        const g = applyTierGate(tool, {}, tier, false, false);
        expect(g.allowed, `${tool} @ ${tier} should be allowed`).toBe(true);
        // a genuine full grant carries none of the gated-path markers
        expect(g.trial_taste, `${tool} @ ${tier} must not be a trial taste`).toBeFalsy();
        expect(g.bonus, `${tool} @ ${tier} must not be a keyed-free bonus`).toBeFalsy();
      }
    }
  });

  it('anonymous free leaks ZERO PAID_ONLY tools (every paid tool blocked outright)', () => {
    for (const tool of PAID) {
      const g = applyTierGate(tool, {}, 'free', false, false);
      expect(g.allowed, `${tool} @ free-anon must be blocked`).toBe(false);
    }
  });

  it('keyed free opens ONLY the bonus demand-tools; the paid decision tools stay gated', () => {
    let bonus = 0, blocked = 0;
    for (const tool of PAID) {
      const g = applyTierGate(tool, {}, 'free', true, false);
      if (g.allowed) { expect(g.bonus, `${tool} keyed-free open must be a bonus`).toBe(true); bonus++; }
      else blocked++;
    }
    expect(bonus, 'there is a keyed-free bonus subset').toBeGreaterThan(0);
    expect(blocked, 'most paid tools stay gated even with a free key').toBeGreaterThan(bonus);
  });

  it('free-full flagship hooks are reachable on free and never overlap PAID_ONLY', () => {
    for (const hook of FREE_FULL_TOOLS) {
      expect(PAID_ONLY_TOOLS.has(hook), `${hook} must not be paid-only`).toBe(false);
      expect(applyTierGate(hook, {}, 'free', false, false).allowed, `${hook} reachable on free`).toBe(true);
    }
  });

  it('the free teaser (trimForTrial) nulls aggregate metrics & truncates arrays — no full-data leak', () => {
    const out = trimForTrial({
      count: 426900, total_mw: 426900, capacity: 999,
      projects: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      name: 'ERCOT queue', iso: 'ERCOT',
    });
    expect(out.count).toBe(null);
    expect(out.total_mw).toBe(null);
    expect(out.capacity).toBe(null);
    expect(out.projects).toHaveLength(1);
    expect(out._projects_total_in_pro).toBe(3);
    // identifiers survive — the teaser stays useful without leaking the metrics
    expect(out.iso).toBe('ERCOT');
    expect(out.name).toBe('ERCOT queue');
  });
});
