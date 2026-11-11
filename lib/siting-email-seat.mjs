// lib/siting-email-seat.mjs — item 1 (owner 2026-10-16): the siting tools follow the email.
//
// WHAT IT DECIDES
//   find_sites, site_selection_canvas and execute_plan, for a free-class key:
//     * no bound email  -> the SAME preview a keyless caller gets (find_sites: 3 candidates,
//       ~11 km coordinates, anchor name/operator/kV withheld; site_selection_canvas: the keyless
//       trim). execute_plan: see EXECUTE_PLAN STEPS below.
//     * a bound email   -> find_sites: every candidate at ~1 km, the anchor's operator and kV
//       still paid. site_selection_canvas / execute_plan: SITING_FREE_PLANS_PER_MONTH full
//       answers per tool per UTC month, counted by the backend's monthly counter (the one
//       analyze_site uses: POST /api/v1/mcp/lp-free-runs, dchub-backend
//       routes/mcp_lp_free_runs.py FREE_FULL_RUNS), then the no-email preview.
//   Keyless callers, paid plans and pack holders are untouched.
//
// EXECUTE_PLAN STEPS (owner 2026-11-11, "Yes, build it"): execute_plan's steps are loopback
// tools/calls. Until this change a key in the preview seat (no email; or an email whose monthly
// plan is spent or whose counter did not answer) ran them KEYLESS, so a plan gave a keyed caller
// the anonymous preview of every step: worse than calling the same tools directly. Now every
// step runs under the CALLER'S OWN KEY: it gets exactly what that key gets from that tool
// directly and spends that key's normal per-tool allowance, walls (human_url, offers) included.
// Nothing becomes unmetered and Pro-only fields stay withheld by each tool's own gate. The
// monthly execute_plan counter for email-bound keys is unchanged. Keyless callers (no key) and
// paid/pack holders are unchanged. Kill switch DCHUB_PLAN_STEPS_CALLER_KEY=0 (read per call)
// restores the keyless steps.
//
// FAIL CLOSED: the backend answers limit 0 for a tool its FREE_FULL_RUNS does not list, and
// the MCP side serves the preview on that answer and on any transport error, so this side
// can never hand out an unmetered full plan.
//
// Kill switch: DCHUB_NOEMAIL_PREVIEW_ONLY=0 restores the previous behaviour (read per call).
//
// Pure module: no ctx, no network. server.mjs owns the seat check and the dispatch.

export const NOEMAIL_PREVIEW_FLAG = 'DCHUB_NOEMAIL_PREVIEW_ONLY';
export const NOEMAIL_PREVIEW_TOOLS = Object.freeze(['find_sites', 'site_selection_canvas', 'execute_plan']);
// The two whose email-bound full answer is metered per month.
export const SITING_MONTHLY_TOOLS = Object.freeze(['site_selection_canvas', 'execute_plan']);
// Full answers per tool per UTC month for an email-bound key. The backend counter enforces it;
// its FREE_FULL_RUNS default for these two tools must equal this number (see the PR body).
export const SITING_FREE_PLANS_PER_MONTH = 1;

export function noEmailPreviewOn(env = process.env) {
  const v = env && env[NOEMAIL_PREVIEW_FLAG];
  return !/^(0|false|no|off)$/i.test(String(v === undefined || v === null ? '1' : v).trim());
}

// The sentence the free-tier rule carries while the switch is on. Built from the enforced
// number, never a literal. No plan name, no price.
export function sitingFreeClause(n = SITING_FREE_PLANS_PER_MONTH, { planCallerKey = false } = {}) {
  // Short on purpose: the lean handshake (and /mcp/grok on top of it) holds a 2,048-char budget
  // (test/initialize-instructions-length.test.mjs).
  // With the plan's steps under the caller's key, execute_plan is not a siting preview any more
  // (each step is that tool's own answer for the key), so the clause stops naming it.
  if (planCallerKey) {
    return 'Siting: no email, previews; an email adds every find_sites candidate and ' + n
      + ' full site_selection_canvas a month.';
  }
  return 'Siting: no email, previews; an email adds every find_sites candidate and ' + n
    + ' full site_selection_canvas and execute_plan each a month.';
}

export const PLAN_STEPS_CALLER_KEY_FLAG = 'DCHUB_PLAN_STEPS_CALLER_KEY';
// Default ON. '0' / 'false' / 'no' / 'off' restores the keyless steps.
export function planStepsCallerKeyOn(env = process.env) {
  const v = env && env[PLAN_STEPS_CALLER_KEY_FLAG];
  return !/^(0|false|no|off)$/i.test(String(v === undefined || v === null ? '1' : v).trim());
}

// The plan envelope's `_upgrade` when the steps ran under the caller's key from the preview
// seat. It claims nothing about a step it did not read: it names the steps that came back walled
// (walledSteps: [{step, tool}], read by server.mjs _isRelayWall on each step's own result) and
// never calls the rest full. No plan name, no price.
export function planCallerKeyUpgrade(seat, walledSteps, fr) {
  const spent = seat === 'email';
  const walled = (Array.isArray(walledSteps) ? walledSteps : [])
    .filter((w) => w && Number.isFinite(Number(w.step)) && typeof w.tool === 'string');
  const named = walled.map((w) => 'step ' + Number(w.step) + ' (' + w.tool + ')').join(', ');
  const counted = !!(fr && Number.isInteger(fr.limit) && fr.limit > 0);
  const message = 'Each step ran under this key, at that tool\'s own allowance for this key: the same '
    + 'answer as calling the tool directly.'
    + (walled.length
      ? ' Came back as a preview: ' + named + '; relay the human_url in that step\'s own result to '
        + 'your human.'
      : '')
    + (spent ? '' : ' Bind your human\'s email (bind_email {api_key, email}, free) for more full answers '
      + 'per tool per day.');
  return {
    tier: spent ? 'identified' : 'free',
    message,
    next_tool: spent ? 'unlock_more_data' : 'bind_email',
    steps_ran_under: 'your_key',
    ...(walled.length ? { walled_steps: walled.map((w) => ({ step: Number(w.step), tool: w.tool })) } : {}),
    ...(counted ? { free_full_runs: { used: fr.used, limit: fr.limit, remaining: 0, resets_at: fr.resets_at } } : {}),
  };
}

// One line on a full answer served from the monthly allowance.
// planCallerKey: execute_plan past its monthly run still runs each step under the key, so the
// tail does not promise a preview.
export function sitingFreeRunNote(fr, tool, { planCallerKey = false } = {}) {
  const day = String((fr && fr.resets_at) || '').slice(0, 10) || 'the 1st of next month';
  const tail = fr.remaining > 0
    ? `${fr.remaining} left; the count resets ${day}.`
    : (planCallerKey && tool === 'execute_plan'
      ? `That was the last one this month (resets ${day}); after it, each step still runs under this key at that tool's own allowance.`
      : `That was the last one this month: the next ${tool} call returns the preview until ${day}.`);
  return `Free full ${tool} ${fr.used} of ${fr.limit} this month (UTC). ${tail}`;
}
