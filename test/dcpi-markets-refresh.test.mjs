// ── scripts/gen-dcpi-markets.mjs: the daily refresh is fail-closed (planner 5.17) ──
//
// daily-manifest-sync regenerates lib/dcpi-markets.data.mjs from
// /api/v1/dcpi/scores. A backend blip must never shrink the table execute_plan
// binds markets from. What fails here: an anonymous 10-row preview, a short
// list, a row with no slug/name/state, or a >10% drop being accepted; or the
// committed table no longer being what the script builds (a hand edit).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildRows, refuseReason } from '../scripts/gen-dcpi-markets.mjs';
import { DCPI_MARKETS } from '../lib/dcpi-markets.data.mjs';

const row = (slug, name = slug, state = 'TX', iso = 'ERCOT') => ({ market_slug: slug, market_name: name, state, iso });
const full = (n) => ({ _total_available: n, scores: Array.from({ length: n }, (_, i) => row('m' + i)) });
const current = DCPI_MARKETS;

describe('refuseReason', () => {
  it('refuses the anonymous preview (count < _total_available)', () => {
    expect(refuseReason({ _total_available: 336, scores: full(10).scores }, current)).toMatch(/partial list: 10 of 336/);
  });
  it('refuses a short list, a broken row, or no scores', () => {
    expect(refuseReason(full(120), null)).toMatch(/only 120 rows/);
    const b = full(320); b.scores[5] = { market_slug: 'x', state: 'TX' };
    expect(refuseReason(b, null)).toMatch(/missing slug, name or state/);
    expect(refuseReason({}, null)).toBe('no scores array');
  });
  it('refuses a list that drops more than 10% of the committed markets', () => {
    const kept = current.slice(0, Math.floor(current.length * 0.85)).map((r) => row(r[0], r[1], r[2][0], r[3]));
    const body = { _total_available: kept.length + 20, scores: [...kept, ...Array.from({ length: 20 }, (_, i) => row('new' + i))] };
    expect(refuseReason(body, current)).toMatch(/would drop \d+ of 336 committed markets/);
  });
  it('accepts the full list, including a few markets added and removed', () => {
    const body = { _total_available: current.length, scores: current.slice(2).map((r) => row(r[0], r[1], r[2][0], r[3])).concat([row('a1'), row('a2')]) };
    expect(refuseReason(body, current)).toBeNull();
  });
});

describe('the committed table is what the script builds', () => {
  it('rebuilding from the committed rows changes nothing but hand-kept aliases', () => {
    const rebuilt = buildRows(current.map((r) => ({ market_slug: r[0], market_name: r[1], state: r[2][0], iso: r[3] })));
    expect(rebuilt.map((r) => r.slice(0, 5))).toEqual(current.map((r) => r.slice(0, 5)));
    expect(rebuilt.map((r) => r[5])).toEqual(current.map((r) => r[5]));
  });
  it('the workflow runs the refresh with a key and stages the file', () => {
    const wf = readFileSync(new URL('../.github/workflows/daily-manifest-sync.yml', import.meta.url), 'utf8');
    expect(wf).toMatch(/DCHUB_KEY: \$\{\{ secrets\.DCHUB_MCP_PAID_KEY \}\}\n\s+run: node scripts\/gen-dcpi-markets\.mjs/);
    expect(wf).toMatch(/OWNED="[^"]*lib\/dcpi-markets\.data\.mjs/);
  });
});
