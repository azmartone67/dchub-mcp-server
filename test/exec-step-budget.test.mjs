/**
 * execute_plan step budget — issue #210.
 *
 * get_refined_queue{iso:PJM} aborted at 12002ms inside execute_plan because the
 * per-step budget was 12000ms and the tool's own latency is 10983–13164ms. The
 * deadline sat INSIDE the tool's distribution, so the third and most specific
 * step of a PJM plan returned or vanished on a coin flip.
 *
 * The budget had been LOWERED to 12000 on 2026-08-19 to duck "Cloudflare's 15s
 * ROUTE_TIMEOUTS ceiling". That ceiling does not exist for this route:
 * ROUTE_TIMEOUTS['/mcp'] is 45_000 and POST /mcp is a non-idempotent write, so
 * it takes the full route budget rather than the 5s/15s split. Proved live
 * 2026-08-21 — research_task returned HTTP 200 / ok:true at 15893ms.
 *
 * Pure functions + source shape. No network, no DB, no server boot.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { _execStepBudget, _execAnswerGuide } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// Observed live 2026-08-21, get_refined_queue{iso:"PJM",min_mw:100}.
const OBSERVED_MAX_MS = 13164;
// dchub-frontend/_worker.js ROUTE_TIMEOUTS['/mcp'].
const EDGE_BUDGET_MS = 45000;

describe('execute_plan step budget (#210)', () => {
  it('gives a step more than the tool actually takes', () => {
    // The whole defect in one assertion: 12000 < 13164 aborted a working call.
    const full = _execStepBudget(0, Number.POSITIVE_INFINITY);
    expect(full).toBeGreaterThan(OBSERVED_MAX_MS);
    expect(full).toBeLessThan(EDGE_BUDGET_MS);
  });

  it('clamps a step to what is LEFT of the plan deadline', () => {
    // DEADLINE_MS is only a START gate — checked before a step is admitted and
    // never again. Unclamped, a step let in at 39.9s ran its full budget and
    // landed past the edge, losing the whole envelope instead of one leg.
    expect(_execStepBudget(39900, 40000, 20000)).toBe(100);
    expect(_execStepBudget(30000, 40000, 20000)).toBe(10000);
  });

  it('never returns a negative budget once the deadline has passed', () => {
    // A negative timeout aborts instantly and reads as an instant tool failure.
    expect(_execStepBudget(41000, 40000, 20000)).toBe(0);
  });

  it('yields the step budget when the deadline is far away', () => {
    expect(_execStepBudget(1000, 40000, 20000)).toBe(20000);
  });

  it('derives EVERY loopback budget — no call site carries a bare literal', () => {
    // The deferred retry hardcoded 15000, escaping the constant entirely; being
    // sequential AFTER the wave, its budget stacked on the wave's.
    const calls = [...SRC.matchAll(/_execLoopbackCall\(([^;]*?)\)\s*[.;]/g)]
      .map((m) => m[1])
      .filter((a) => a.includes(','));
    expect(calls.length).toBeGreaterThanOrEqual(2);   // both sites still exist
    for (const args of calls) {
      expect(args, `bare numeric budget in _execLoopbackCall(${args})`)
        .not.toMatch(/,\s*\d+\s*$/);
    }
  });

  it('labels OUR deadline as timed_out, never as failed', () => {
    // A timeout and a broken tool both landed as status:'failed', so an agent
    // could not tell "works, we stopped waiting" from "this is broken" — and
    // reported the subject as unavailable.
    const mappings = SRC.match(/\?\s*'timed_out'/g) || [];
    expect(mappings.length).toBe(2);                  // wave + deferred retry
    expect(SRC).not.toMatch(/'gated_preview'\s*:\s*'failed'/);
  });

  it('tells the composer that timed_out is not missing data', () => {
    const guide = _execAnswerGuide([]);
    expect(guide).toMatch(/timed_out/);
    expect(guide).toMatch(/not a failure/i);
    expect(guide).toMatch(/never report its subject as unavailable/i);
  });
});
