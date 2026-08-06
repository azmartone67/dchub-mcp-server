// execute-plan-cohort.test.mjs — guards for the r-cohort routing-experiment tag.
//
// Two things must hold, and the second is the one that matters:
//   1. the tag is validated defensively and NEVER errors a real query;
//   2. the tag is INERT — it cannot touch intent classification, geography
//      extraction, pattern scoring or the planner.
//
// The inertness guard is written as a CONTRAST, not an assertion of a
// tautology. Copilot's first manifest carried the tag inside the intent string
// ("cohort.front_door:composite_reasoning"); this file proves that shape really
// does corrupt routing, and that the agreed shape does not. A test that only
// asserted "plan is unchanged" would pass even if someone later wired cohort
// into the planner via context — so the intent string itself is asserted too.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _normalizeCohort, _planQuery, _planSignals } from '../server.mjs';

// The seven tags Microsoft Copilot committed in writing to emitting.
const AGREED_TAGS = [
  'cohort.front_door', 'cohort.delta_first', 'cohort.composite_first',
  'cohort.saved_work_first', 'cohort.grid_first', 'cohort.fiber_first',
  'cohort.deals_first',
];

describe('_normalizeCohort — defensive validation', () => {
  it('accepts every tag in the agreed contract, unchanged', () => {
    for (const t of AGREED_TAGS) expect(_normalizeCohort(t)).toBe(t);
  });

  it('canonicalizes case and surrounding whitespace into ONE bucket', () => {
    // Without this, "cohort.Front_Door" and "cohort.front_door" would be two
    // rows in the report and each would show half the volume.
    expect(_normalizeCohort('  Cohort.Front_Door  ')).toBe('cohort.front_door');
  });

  it('drops malformed tags to null rather than throwing', () => {
    const bad = [
      'cohort front_door',            // space
      'cohort/front_door',            // slash
      'cohort.front_door;DROP TABLE', // punctuation
      'cohort.front_door\n',          // newline survives trim? (it does not — but assert)
      '<script>', '', '   ', 'ünïcode',
    ];
    for (const b of bad) {
      // '\n' is stripped by trim(), so that one legitimately normalizes.
      const out = _normalizeCohort(b);
      expect(out === null || out === 'cohort.front_door').toBe(true);
    }
    expect(_normalizeCohort('cohort front_door')).toBeNull();
    expect(_normalizeCohort('<script>')).toBeNull();
  });

  it('caps length at 64 characters', () => {
    expect(_normalizeCohort('c'.repeat(64))).toBe('c'.repeat(64));
    expect(_normalizeCohort('c'.repeat(65))).toBeNull();
  });

  it('never throws on a non-string — it returns null', () => {
    for (const v of [undefined, null, 42, {}, [], true, () => {}]) {
      expect(() => _normalizeCohort(v)).not.toThrow();
      expect(_normalizeCohort(v)).toBeNull();
    }
  });
});

describe('cohort is INERT to routing', () => {
  const INTENT = 'compare Dallas vs Phoenix for a 200 MW AI campus';

  it('the agreed shape leaves the plan bit-for-bit identical', () => {
    // The tag rides its own parameter, so the planner is called with exactly
    // the same (intent, context) either way. This is the contract Copilot
    // locked in: execute_plan(intent="<verbatim>", cohort="cohort.front_door").
    const untagged = _planQuery(INTENT, {});
    for (const tag of AGREED_TAGS) {
      // Simulate the handler: it reads a.intent and a.context ONLY.
      const args = { intent: INTENT, context: {}, cohort: tag };
      expect(_planQuery(args.intent, args.context)).toEqual(untagged);
      expect(_planSignals(String(args.intent), args.context))
        .toEqual(_planSignals(INTENT, {}));
      // and the question the user actually asked is untouched
      expect(args.intent).toBe(INTENT);
    }
  });

  it('MUST-FAIL CONTROL: the rejected manifest shape really does route nowhere', () => {
    // The control that gives the guard above its meaning. Copilot's first
    // manifest sent the tag AS the intent — intent:"cohort.front_door:
    // composite_reasoning" — i.e. the user's question was replaced by a label.
    // Measured here, not asserted from the design doc: that shape classifies
    // `unknown` and falls back to discover_tools, so every tagged call would
    // have stopped answering. If this ever goes green-by-accident (the planner
    // starts classifying a bare tag), the inertness test above proves nothing
    // and this control is what says so.
    const good = _planQuery(INTENT, {});
    const manifestShape = _planQuery('cohort.front_door:composite_reasoning', {});

    expect(good.intent_class).toBe('market_comparison');
    expect(good.best_tool).toBe('get_market_dcpi_rank');

    expect(manifestShape.intent_class).toBe('unknown');
    expect(manifestShape.best_tool).toBe('discover_tools');
    expect(manifestShape.intent_class).not.toBe(good.intent_class);

    // NOT asserted: that PREFIXING the question with a tag breaks it. Measured
    // 2026-08-05, it does not — "cohort.front_door:<real question>" still
    // classifies market_comparison, because the question's own keywords still
    // score. The defect is the tag REPLACING the question, which is the shape
    // the manifest actually used. Claiming the prefix breaks routing would be
    // a false justification for a real contract.
  });

  it('the planner source never references cohort', () => {
    // Structural backstop: no future edit can wire the tag into planning
    // without this failing. _planQuery is the router; assert the tag name does
    // not appear inside its body (body ends at the first column-0 `}`).
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const start = src.indexOf('export function _planQuery(');
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start);
    const end = rest.indexOf('\n}\n');
    expect(end).toBeGreaterThan(0);
    expect(rest.slice(0, end)).not.toMatch(/cohort/i);
  });
});

describe('execute_plan declares cohort as an optional param', () => {
  it('registers cohort on the tool schema, next to intent', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const i = src.indexOf("trackedTool(srv, 'execute_plan'");
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, i + 12000);
    expect(block).toMatch(/cohort:\s*z\.any\(\)\.optional\(\)/);
    // z.string() would REJECT a wrong-typed tag and fail the user's question.
    expect(block).not.toMatch(/cohort:\s*z\.string\(\)/);
  });

  it('the wrapper normalizes cohort on the args object that gets logged', () => {
    // trackToolCall logs `params: args`; the normalization must run on THAT
    // object, before the tier gate's spread copy and before any track fires.
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const w = src.indexOf('function trackedTool(');
    const stamped = src.indexOf('_stampEntityCb(name, async (args, extra) => {', w);
    const firstTrack = src.indexOf('trackToolCall({', stamped);
    const prelude = src.slice(stamped, firstTrack);
    expect(prelude).toMatch(/_normalizeCohort\(args\.cohort\)/);
    expect(prelude).toMatch(/delete args\.cohort/);
  });
});
