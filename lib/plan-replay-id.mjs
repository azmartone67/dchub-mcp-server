// execute_plan's replay and plan id on every envelope (Grok live proof, 2026-11-16, item 8).
//
// The execute_plan description promises "replay (decisions with executed/failed status)" in the
// envelope, and the discovery text says every plan returns "an auditable replay". Measured live
// 2026-11-16 (planner 5.31): the keyed and preview envelopes carried `replay`, but the keyless first
// full answer of the day (lib/keyless-first-full.mjs compactFirstPlan, a ~12.5 KB budget) dropped it,
// and no envelope carried an id an agent could quote to name the plan it ran.
//
//   planId()        a STABLE id: the same question (normalised intent + context, minus the rerun token
//                   and the cohort tag) under the same planner version and intent class gives the same
//                   id, for every caller and tier. It names the plan, not the run, and holds no personal
//                   data (a SHA-256 prefix; nothing secret is mixed in, so anyone can recompute it).
//   compactReplay() the replay cut to what the description promises (each decision's id, step, kind,
//                   status and decision) for the budgeted first answer. The full rationale stays on
//                   keyed and preview envelopes and on plan_query.
//
// PURE: no I/O, never throws.

import { createHash } from 'node:crypto';
import { canon, normIntent, RERUN_CONTEXT_KEY } from './plan-rerun.mjs';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

export function planId({ intent, context, intentClass, plannerVersion } = {}) {
  try {
    const ctx = isObj(context) ? { ...context } : {};
    delete ctx[RERUN_CONTEXT_KEY]; delete ctx.cohort; delete ctx.compact;
    const basis = 'plan|' + String(plannerVersion || '') + '|' + String(intentClass || '') + '|'
      + normIntent(intent) + '|' + canon(ctx);
    return 'plan_' + createHash('sha256').update(basis).digest('hex').slice(0, 16);
  } catch (_) { return null; }
}

export const COMPACT_REPLAY_NOTE = 'Compact replay: each decision with its executed/failed status. The full rationale, '
  + 'rejected tools and execution graph come back on plan_query with the same intent, or on a keyed execute_plan.';

export function compactReplay(replay) {
  try {
    if (!isObj(replay)) return null;
    const decisions = (Array.isArray(replay.decisions) ? replay.decisions : []).filter(isObj).map((d) => ({
      id: d.id,
      ...(d.step !== undefined ? { step: d.step } : {}),
      kind: d.kind, status: d.status, decision: d.decision,
      ...(d.status_note ? { status_note: d.status_note } : {}),
    }));
    return {
      ...(replay.plan_id ? { plan_id: replay.plan_id } : {}),
      schema_version: replay.schema_version,
      planner_version: replay.planner_version,
      intent_class: replay.intent_class,
      decisions,
      ...(Array.isArray(replay.rejected) ? { rejected_tools: replay.rejected.filter(isObj).map((r) => r.tool).filter(Boolean) } : {}),
      compact: true,
      note: COMPACT_REPLAY_NOTE,
    };
  } catch (_) { return null; }
}
