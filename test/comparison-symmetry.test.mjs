// comparison-symmetry.test.mjs — A HEAD-TO-HEAD MUST BRIEF BOTH SIDES (2026-08-31).
//
// THE DEFECT. market_comparison's step 3 was a SINGLE step carrying
// `estimated_calls: 2` and a rationale promising "one call per market, parallel",
// with an args_hint naming market A only. A step is executed once, with one args
// object. Measured live on "compare Dallas vs Phoenix for a GPU training cluster":
//
//     executed: get_market_dcpi_rank(dallas), get_market_dcpi_rank(phoenix),
//               get_market_intel(dallas)
//     replay D3: "Optional depth on both markets … one call per market, parallel."
//
// Phoenix never got a market brief. The envelope an agent composes its answer
// from ASSERTED both markets were covered, so an agent doing exactly the right
// thing — reading the replay and trusting it — produced a lopsided comparison
// with no way to notice. That is worse than a missing step: it is a missing step
// the response denies.
//
// `estimated_calls` is a COST HINT. Nothing reads it and fans out. Sides A and B
// are symmetric in steps 1-2 for the only reason that works — they are two steps.
//
// WHY NO EXISTING TEST CAUGHT IT. planner-eval asserts intent_class + LEAD tool;
// plan-query asserts schema and routing. Both are satisfied by a plan that leads
// with get_market_dcpi_rank and then silently covers one side. Nothing asserted
// what a comparison must CONTAIN.
//
// THE INVARIANT, stated so it cannot be satisfied vacuously: for a resolved
// comparison pair, every per-market tool in the plan must appear once for EACH
// side. Adding a tool for one market and not the other fails, and so does
// deleting the second DCPI read.
import { describe, it, expect } from 'vitest';
import { _planQuery } from '../server.mjs';

/** Market-ish argument names a per-market step carries. */
const MARKET_ARGS = ['market', 'market_slug', 'metro', 'metro_slug'];

function steps(plan) {
  const s = plan.recommended_sequence || plan.sequence || [];
  expect(Array.isArray(s), 'planner returned no step array — cannot check symmetry').toBe(true);
  expect(s.length, 'planner returned an EMPTY plan; a vacuous pass is not a pass').toBeGreaterThan(0);
  return s;
}

/** tool -> set of market values it is planned against. */
function perMarketCoverage(plan) {
  const cover = new Map();
  for (const st of steps(plan)) {
    const args = st.args_hint || st.args || {};
    for (const k of MARKET_ARGS) {
      if (typeof args[k] === 'string' && args[k]) {
        if (!cover.has(st.tool)) cover.set(st.tool, new Set());
        cover.get(st.tool).add(args[k].toLowerCase());
      }
    }
  }
  return cover;
}

const PAIRS = [
  { intent: 'compare Dallas vs Phoenix for a GPU training cluster', a: 'dallas', b: 'phoenix' },
  { intent: 'compare Phoenix vs Columbus for hyperscale', a: 'phoenix', b: 'columbus' },
  { intent: 'Ashburn versus Atlanta, which is better for 100 MW', a: 'ashburn', b: 'atlanta' },
];

describe('market_comparison covers both sides', () => {
  for (const { intent, a, b } of PAIRS) {
    it(`${JSON.stringify(intent)} briefs both markets with every per-market tool`, () => {
      const plan = _planQuery(intent);
      expect(plan.intent_class).toBe('market_comparison');
      const cover = perMarketCoverage(plan);
      expect(cover.size, 'no step carried a per-market argument — the check would be vacuous')
        .toBeGreaterThan(0);

      for (const [tool, markets] of cover) {
        // A tool planned against exactly one side of a resolved pair is the defect.
        const hasA = [...markets].some((m) => m.includes(a));
        const hasB = [...markets].some((m) => m.includes(b));
        expect(hasA && hasB,
          `${tool} is planned for ${JSON.stringify([...markets])} but this is a `
          + `${a} vs ${b} head-to-head. A per-market tool run on one side only produces an `
          + `asymmetric comparison while the replay claims both were covered. Add a second `
          + `STEP for the other market — estimated_calls does not fan out.`).toBe(true);
      }
    });

    it(`${JSON.stringify(intent)} promises no more calls than it plans`, () => {
      // The exact shape of the original bug: a step whose cost hint exceeds the
      // one call it can make. estimated_calls > 1 on a single-args step means the
      // plan is describing work it will not do.
      for (const st of steps(_planQuery(intent))) {
        const args = st.args_hint || st.args || {};
        const marketArgs = MARKET_ARGS.filter((k) => typeof args[k] === 'string' && args[k]);
        if (marketArgs.length <= 1) {
          expect(st.estimated_calls == null || st.estimated_calls <= 1,
            `step ${st.step} (${st.tool}) declares estimated_calls=${st.estimated_calls} but carries `
            + `${marketArgs.length} market argument(s). A step executes ONCE with ONE args object; `
            + `nothing reads estimated_calls and fans out. Split it into one step per market.`).toBe(true);
        }
      }
    });
  }
});

describe('the guard can fail', () => {
  it('MUST-FAIL CONTROL: a one-sided plan is rejected by the symmetry rule', () => {
    // The pre-fix plan, reconstructed: DCPI for both, intel for side A only.
    const oneSided = {
      intent_class: 'market_comparison',
      recommended_sequence: [
        { step: 1, tool: 'get_market_dcpi_rank', args_hint: { market_slug: 'dallas' }, estimated_calls: 1 },
        { step: 2, tool: 'get_market_dcpi_rank', args_hint: { market_slug: 'phoenix' }, estimated_calls: 1 },
        { step: 3, tool: 'get_market_intel', args_hint: { market: 'dallas' }, estimated_calls: 2 },
      ],
    };
    const cover = perMarketCoverage(oneSided);
    const intel = cover.get('get_market_intel');
    expect(intel, 'control did not apply — get_market_intel absent from the fixture').toBeTruthy();
    const hasBoth = [...intel].some((m) => m.includes('dallas')) && [...intel].some((m) => m.includes('phoenix'));
    expect(hasBoth, 'the one-sided pre-fix plan was NOT detected as asymmetric').toBe(false);
  });

  it('MUST-FAIL CONTROL: estimated_calls=2 on a single-market step is rejected', () => {
    const st = { step: 3, tool: 'get_market_intel', args_hint: { market: 'dallas' }, estimated_calls: 2 };
    const marketArgs = MARKET_ARGS.filter((k) => typeof st.args_hint[k] === 'string');
    expect(marketArgs.length).toBe(1);
    expect(st.estimated_calls <= 1, 'the pre-fix cost-hint mismatch was NOT detected').toBe(false);
  });
});
