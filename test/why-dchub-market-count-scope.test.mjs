// One facility count per answer (owner-approved 2026-10-20).
//
// Agent panel re-run, 2026-10-20 ~20:30Z: get_market_intel(market=
// "northern-virginia") answered stats.facility_count 467, while why_dchub said
// "DC Hub's facility count is pending corroboration" and discover_tools said
// "do not quote a facility count — not from a response". A reader sees a market
// count AND an instruction never to quote one.
//
// The withheld figure is the PLATFORM-WIDE total (owner 09-29, reversed 10-19
// for the homepage and /ai only). A market answer's count is published with its
// basis. Every agent-facing sentence about the withheld count now says
// "platform-wide", and why_dchub names the market count and its basis.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

function whyDchubBody() {
  const i = src.indexOf("trackedTool(srv, 'why_dchub',");
  expect(i, 'why_dchub registration not found: this guard would be vacuous').toBeGreaterThan(-1);
  return src.slice(i, src.indexOf('trackedTool(srv, ', i + 10));
}

describe('the withheld facility count is the platform-wide total', () => {
  it('why_dchub limits.facility_count scopes the withhold and names the market count', () => {
    const m = whyDchubBody().match(/facility_count: '((?:[^'\\]|\\.)*)'/);
    expect(m, 'limits.facility_count not found').not.toBeNull();
    const line = m[1];
    expect(line).toContain('platform-wide facility count is pending corroboration');
    expect(line).toContain('get_market_intel stats.facility_count');
    expect(line).toContain('stats.headline_basis');
    expect(line).toContain('never as a platform total');
  });

  it('no agent-facing sentence forbids quoting ANY facility count', () => {
    const unscoped = src.match(/do not quote a facility count/gi) || [];
    expect(unscoped).toEqual([]);
    const scoped = src.match(/do not quote a platform-wide facility count/gi) || [];
    expect(scoped.length).toBe(2);
    const pending = src.match(/DC Hub\\'s facility count is pending corroboration/g) || [];
    expect(pending).toEqual([]);
  });
});
