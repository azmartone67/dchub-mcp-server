// depth-gate.test.mjs — r-depth-gate (2026-09-17).
//
// MEASURED, live, anonymous, on https://dchub.cloud/mcp the day this shipped:
//
//   analyze_site               composite_score 81.2 · limiting_factor.score 60
//   get_grid_intelligence      constraint_score 45.4 · excess_power_score 41.2
//   get_interconnection_queue  projects.top[] queue_id "CAISO-1402",
//                              project_name "ATLAS COMPLEX" — 3 rows
//
// against `quota_wall {blocked_month: 0, enforce: true}` and 66 agents / 479
// real external calls over 7d. A free screen answered the siting question
// outright, so nothing was left to buy and no wall was ever reached. The
// diagnosis is not "agents will not pay" — it is that they had no reason to.
//
// WHAT THIS PINS
//   * the DECISION number gates and the coarse BAND stays — free callers keep
//     BUILD / CAUTION / AVOID, which is the hook, and lose the 0-100 a go/no-go
//     is argued from;
//   * the queue's project IDENTIFIERS gate — they are strings, so every
//     numeric mask in this file walked straight past them;
//   * a gated field is never a BARE null: the `_..._in_pro` marker is what
//     separates "withheld" from "we could not compute this";
//   * the free-tier prose does not leak what the field gates — the headline
//     sentence is the single most relayed thing analyze_site returns;
//   * DCHUB_DEPTH_GATE=0 restores the previous surface exactly. Narrowing the
//     free class is a commercial trade with reach risk in both directions, so
//     the way back is tested, not asserted.
//
// Qualifies for the hard gate: pure functions, no network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// DEPTH_GATE is read at module scope, so the flag's two states are proven by
// re-importing the module under each value with a cache-busting query.
async function load(flag) {
  if (flag === undefined) delete process.env.DCHUB_DEPTH_GATE;
  else process.env.DCHUB_DEPTH_GATE = flag;
  return import('../server.mjs?depthgate=' + String(flag) + '-' + Math.random());
}

let saved;
beforeEach(() => { saved = process.env.DCHUB_DEPTH_GATE; });
afterEach(() => {
  if (saved === undefined) delete process.env.DCHUB_DEPTH_GATE;
  else process.env.DCHUB_DEPTH_GATE = saved;
});

describe('_gatesDepth — what the free tier stops answering', () => {
  it('gates every score a siting decision is made on', async () => {
    const { _gatesDepth } = await load(undefined);
    for (const k of ['composite_score', 'overall_score', 'constraint_score',
                     'excess_power_score', 'score', 'parcel_score',
                     'site_score', 'dcpi_score']) {
      expect(_gatesDepth(k), `${k} is still free`).toBe(true);
    }
  });

  it('★ gates the queue identifiers — the mask that could not see a string', async () => {
    const { _gatesDepth } = await load(undefined);
    for (const k of ['queue_id', 'project_name', 'queue_position',
                     'project_number', 'interconnection_request_id']) {
      expect(_gatesDepth(k), `${k} is still free`).toBe(true);
    }
  });

  it('never gates the field whose job is to say something is gated', async () => {
    const { _gatesDepth } = await load(undefined);
    for (const k of ['_composite_score_in_pro', '_results_total_in_pro',
                     'score_basis', 'composite_score_band', '_scores_note',
                     'headroom_preview', '_entity']) {
      expect(_gatesDepth(k), `${k} was gated — the honesty surface went with it`)
        .toBe(false);
    }
  });

  it('leaves the free-tier vocabulary alone', async () => {
    const { _gatesDepth } = await load(undefined);
    // Market name, verdict band, coarse geography: the brief keeps these free.
    for (const k of ['market', 'market_name', 'verdict', 'state', 'iso',
                     'distance_band', 'factor', 'interpretation']) {
      expect(_gatesDepth(k), `${k} should stay free`).toBe(false);
    }
  });

  it('★ DCHUB_DEPTH_GATE=0 gates nothing at all', async () => {
    const { _gatesDepth } = await load('0');
    for (const k of ['composite_score', 'queue_id', 'constraint_score']) {
      expect(_gatesDepth(k), `${k} still gated with the switch off`).toBe(false);
    }
  });

  it('defaults ON — an unset var enables the gate', async () => {
    const { _gatesDepth } = await load(undefined);
    expect(_gatesDepth('composite_score')).toBe(true);
  });
});

describe('_scoreBand — the coarse answer that stays free', () => {
  it('maps a score to the DCPI vocabulary', async () => {
    const { _scoreBand } = await load(undefined);
    expect(_scoreBand(81.2)).toBe('BUILD');
    expect(_scoreBand(70)).toBe('BUILD');
    expect(_scoreBand(69.9)).toBe('CAUTION');
    expect(_scoreBand(45)).toBe('CAUTION');
    expect(_scoreBand(44.9)).toBe('AVOID');
    expect(_scoreBand(0)).toBe('AVOID');
  });

  it('★ a missing score is not AVOID', async () => {
    const { _scoreBand } = await load(undefined);
    // "We could not score this" rendering as the worst verdict would be a
    // fabricated finding about someone's site.
    for (const v of [null, undefined, NaN, Infinity, '70', {}]) {
      expect(_scoreBand(v), `${String(v)} produced a band`).toBeNull();
    }
  });
});

describe('the gate leaves a reason behind', () => {
  it('★ stamps _<field>_in_pro beside every null it writes', () => {
    // A bare null is indistinguishable from "unknown". The marker is the
    // whole difference between a paywall and a broken tool.
    const i = SRC.indexOf('} else if (_gatesDepth(k)) {');
    expect(i, '_gatesDepth is not applied in trimForTrial').toBeGreaterThan(-1);
    const branch = SRC.slice(i, i + 700);
    expect(branch).toContain('out[k] = null;');
    expect(branch).toContain('_in_pro`] = true;');
    expect(branch).toContain('_scoreBand(v)');
  });

  it('★ the headline SENTENCE does not leak what the field gates', () => {
    // Gating composite_score while the prose beside it still reads "81/100"
    // gates nothing: that string is what an agent relays to its human.
    const i = SRC.indexOf('const _headlineStr = _dg');
    expect(i, 'the headline sentence is not gate-aware').toBeGreaterThan(-1);
    const gated = SRC.slice(i, SRC.indexOf(': Math.round(score)', i));
    expect(gated).toContain('_scoreBand(score)');
    expect(gated).not.toContain('Math.round(score)');
    expect(gated).not.toContain('_lfScore');
  });

  it('★ the allowlist projection carries the marker and the band', () => {
    // This projection silently dropped capacity_requested_mw for months. A
    // field not named here does not reach a machine client, which would leave
    // composite_score as a bare null with nothing saying why.
    const i = SRC.indexOf('_composite_score_in_pro');
    expect(i).toBeGreaterThan(-1);
    const proj = SRC.slice(SRC.indexOf('site_headline: true, trial_preview: false'));
    expect(proj.slice(0, 1400)).toContain('_composite_score_in_pro');
    expect(proj.slice(0, 1400)).toContain('composite_score_band');
    expect(proj.slice(0, 1400)).toContain('score_basis');
  });

  it('the limiting factor keeps its NAME and loses its number', () => {
    const i = SRC.indexOf('if (DEPTH_GATE) {\n      limiting_factor.score = null;');
    expect(i, 'the limiting factor score is still free').toBeGreaterThan(-1);
    const branch = SRC.slice(i, i + 300);
    expect(branch).toContain('_score_in_pro');
    expect(branch).toContain('_scoreBand(_lfScore)');
    expect(branch).not.toContain('limiting_factor.factor = null');
  });
});
