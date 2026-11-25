// plan-limit-hit.mjs — execute_plan steps that hit a caller limit (2026-11-25).
// A capacity_grid plan whose first step (site_selection_canvas) hit the anonymous per-IP daily wall
// (error anon_hard_wall) was labelled status "executed", depth "preview"; its dependants (get_interconnection_queue,
// get_grid_intelligence) read "skipped_unresolved: no earlier or sibling step minted <iso>", and the plan nudged a
// report_finding coverage gap. Nothing was missing from DC Hub's data: the caller's limit stopped the step that
// produces the ISOs. A step whose body is a limit wall now carries limit_hit, and a dependant it starved says so.
// Pure; never throws.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The limit status a step's body reports (its `error`, one of `statuses`), else null. */
export function limitHitOf(body, statuses) {
  try {
    if (!isObj(body) || !statuses || typeof statuses.has !== 'function') return null;
    const e = typeof body.error === 'string' ? body.error : '';
    return e && statuses.has(e) ? e : null;
  } catch (_e) { return null; }
}

/** The executed entry, among the step's dependencies, that hit a limit, else null. */
export function limitBlocker(step, executed) {
  try {
    const deps = isObj(step) && Array.isArray(step.depends_on) ? step.depends_on : [];
    if (!deps.length || !Array.isArray(executed)) return null;
    return executed.find((e) => isObj(e) && e.limit_hit && deps.includes(e.step)) || null;
  } catch (_e) { return null; }
}

/** The skipped entry's note and blocked_by field when a dependency hit a limit. */
export function limitSkip(dep, missing, resetsAt) {
  const when = typeof resetsAt === 'string' && resetsAt ? ` (it resets at ${resetsAt})` : '';
  return {
    note: `step ${dep.step} ${dep.tool} hit this caller's DC Hub limit (${dep.limit_hit})${when}, so it returned no rows `
      + `to take <${missing}> from. This is an access limit, not missing data: run this step again after the reset or `
      + 'with a DC Hub key.',
    blocked_by: { step: dep.step, tool: dep.tool, limit: dep.limit_hit },
  };
}
