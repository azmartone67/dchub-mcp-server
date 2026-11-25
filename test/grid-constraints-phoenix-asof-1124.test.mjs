// grid-constraints-phoenix-asof-1124.test.mjs -- Grok Brain note 2026-11-24 item 6 residual (re-checked live after
// mcp#1734): the p5 grid-constraints answer read at 19:02 America/Phoenix carried as_of 2026-11-25, because a fact
// kept its UTC machine day (the grid-demand fact does so by design, #1721) and the answer took the newest fact date.
// No answer from lib/power-rotation-1123.mjs is dated after today in America/Phoenix.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildGridConstraintsAnswer } from '../lib/power-rotation-1123.mjs';

const ctx = { intent_class: 'grid_constraints', state: 'VA', place_label: 'Loudoun County, VA' };
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const ROW = { iso: 'PJM', kv: 500, owner: 'Dominion', status: 'Planned', description: 'Rebuild Elmont - Chickahominy 500 kV line' };
const ip = (asOf) => ex(4, 'get_infra_projects', { type: 'transmission', state: 'VA' },
  { as_of: asOf, summary: { as_of: { transmission: asOf }, by_type: { transmission: { matching: 1, by_status: { Planned: 1 } } } },
    transmission_projects: [ROW] });

afterEach(() => { vi.useRealTimers(); });

describe('grid_constraints as_of is never after today in America/Phoenix', () => {
  it('00:40Z on 11-25 (17:40 Phoenix on 11-24): a fact dated with the UTC day 11-25 is clamped to 11-24', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T00:40:00Z'));
    const a = buildGridConstraintsAnswer(ctx, [ip('2026-11-25')]);
    expect(a.as_of).toBe('2026-11-24');
    expect(a.source).toMatch(/as of 2026-11-24;/);
    expect(a.source).not.toMatch(/2026-11-25/);
  });
  it('a past date is untouched', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T00:40:00Z'));
    expect(buildGridConstraintsAnswer(ctx, [ip('2026-11-19')]).as_of).toBe('2026-11-19');
  });
  it('after 07:00Z the Phoenix day has rolled over: 11-25 stays 11-25', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T08:00:00Z'));
    expect(buildGridConstraintsAnswer(ctx, [ip('2026-11-25')]).as_of).toBe('2026-11-25');
  });
});
