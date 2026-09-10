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
import { _execStepBudget, _execAnswerGuide, _DEAL_DESK_TIMEOUT_MS } from '../server.mjs';

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

  it('★ EVERY outbound call inside the handler rides the plan budget', () => {
    // The rule was written for _execLoopbackCall and the next outbound call
    // walked straight past it. The deal-desk mint (#398) POSTed with a fixed
    // 8000ms AFTER the steps, so a run that legally finished at ~40s reached
    // 48s — past EDGE_BUDGET_MS, where the edge discards the whole envelope
    // rather than one leg. Same defect as #210, one call site over.
    //
    // So the guard is on the HANDLER, not on one function name: every awaited
    // call in execute_plan's body that takes a timeout must derive it from
    // _execStepBudget. A literal here is the bug.
    const body = SRC.slice(SRC.indexOf("trackedTool(srv, 'execute_plan',"),
                           SRC.indexOf("trackedTool(srv, 'search_facilities',"));
    const timed = [...body.matchAll(/_execStepBudget\(((?:[^()]|\([^()]*\))*)\)/g)];
    // A floor: this scan must never pass by finding nothing to check.
    expect(timed.length).toBeGreaterThanOrEqual(3);   // wave + retry + mint
    for (const [, args] of timed) {
      // Each one clamps against the elapsed time AND the plan deadline, rather
      // than against a constant that cannot know how much is left.
      expect(args).toMatch(/Date\.now\(\)\s*-\s*t0/);
      expect(args).toMatch(/DEADLINE_MS/);
    }
    // …and the mint's own ceiling is the third argument, never the whole budget.
    expect(body).toMatch(/_execStepBudget\(Date\.now\(\) - t0, DEADLINE_MS, _DEAL_DESK_TIMEOUT_MS\)/);
    // The plan's own worst case must still land inside the edge's route budget.
    expect(40000 + _DEAL_DESK_TIMEOUT_MS).toBeGreaterThan(EDGE_BUDGET_MS);  // why the clamp exists
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
