// lib/siting-email-seat.mjs — item 1 (owner 2026-10-16): the siting tools follow the email.
//
// WHAT IT DECIDES
//   find_sites, site_selection_canvas and execute_plan, for a free-class key:
//     * no bound email  -> the SAME preview a keyless caller gets (find_sites: 3 candidates,
//       ~11 km coordinates, anchor name/operator/kV withheld; site_selection_canvas: the keyless
//       trim; execute_plan: every step runs keyless, so each step is the keyless preview).
//     * a bound email   -> find_sites: every candidate at ~1 km, the anchor's operator and kV
//       still paid. site_selection_canvas / execute_plan: SITING_FREE_PLANS_PER_MONTH full
//       answers per tool per UTC month, counted by the backend's monthly counter (the one
//       analyze_site uses: POST /api/v1/mcp/lp-free-runs, dchub-backend
//       routes/mcp_lp_free_runs.py FREE_FULL_RUNS), then the no-email preview.
//   Keyless callers, paid plans and pack holders are untouched.
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
export function sitingFreeClause(n = SITING_FREE_PLANS_PER_MONTH) {
  // Short on purpose: the lean handshake (and /mcp/grok on top of it) holds a 2,048-char budget
  // (test/initialize-instructions-length.test.mjs).
  return 'Siting: no email, previews; an email adds every find_sites candidate and ' + n
    + ' full site_selection_canvas and execute_plan each a month.';
}

// One line on a full answer served from the monthly allowance.
export function sitingFreeRunNote(fr, tool) {
  const day = String((fr && fr.resets_at) || '').slice(0, 10) || 'the 1st of next month';
  const tail = fr.remaining > 0
    ? `${fr.remaining} left; the count resets ${day}.`
    : `That was the last one this month: the next ${tool} call returns the preview until ${day}.`;
  return `Free full ${tool} ${fr.used} of ${fr.limit} this month (UTC). ${tail}`;
}
