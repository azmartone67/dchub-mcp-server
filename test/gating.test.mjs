// Unit tests for the MCP gating primitives — the revenue-critical, pure logic
// that has regressed repeatedly (the "2/22 grids" over-redaction, trial-preview
// incidents). Imported directly from server.mjs (which skips app.listen under
// VITEST). No network, no prod dependency.
import { describe, it, expect } from 'vitest';
import {
  trimForTrial, applyTierGate, FREE_FULL_TOOLS, PAID_ONLY_TOOLS, _isMetricKey,
} from '../server.mjs';

describe('trimForTrial — anonymous redaction', () => {
  it('truncates arrays >1 to first item + a _gated marker', () => {
    const out = trimForTrial({ grids: [{ iso: 'PJM' }, { iso: 'ERCOT' }, { iso: 'CAISO' }] });
    expect(Array.isArray(out.grids)).toBe(true);
    expect(out.grids).toHaveLength(2);
    expect(out.grids[0]).toEqual({ iso: 'PJM' });
    expect(String(out.grids[1]._gated)).toMatch(/more results.*sign up to unlock/);
    expect(out._grids_total_in_pro).toBe(3);
  });

  it('leaves a single-element array intact but still masks metric scalars inside', () => {
    const out = trimForTrial({ rows: [{ iso: 'PJM', count: 5 }] });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].iso).toBe('PJM');
    expect(String(out.rows[0].count)).toMatch(/sign up to unlock/);
  });

  it('masks aggregate metric scalars but keeps identifier fields', () => {
    const out = trimForTrial({
      count: 42, total_mw: 1000, gas_share_pct: 33.3,
      name: 'Northern Virginia', slug: 'northern-virginia', state: 'VA', iso: 'PJM',
    });
    expect(String(out.count)).toMatch(/sign up to unlock/);
    expect(String(out.total_mw)).toMatch(/sign up to unlock/);
    expect(String(out.gas_share_pct)).toMatch(/sign up to unlock/);
    expect(out.name).toBe('Northern Virginia');
    expect(out.slug).toBe('northern-virginia');
    expect(out.state).toBe('VA');
    expect(out.iso).toBe('PJM');
  });

  it('recurses into nested objects (stats:{...})', () => {
    const out = trimForTrial({ stats: { total_mw: 999, region: 'east' } });
    expect(String(out.stats.total_mw)).toMatch(/sign up to unlock/);
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
