// lib/keyless-wall.mjs: the keyless wall, email first; the quota_wall_hit event (2026-10-16).
//
// Owner-approved conversion item (2026-10-16). Measured 30d to 10-16, external traffic only:
// 231 keyless identities against 35 keyed below the paid plan. The keyless analyze_site wall
// already led with the email unlock (mcp#880 w-siteruns / mcp#908 w-sitekey); the anonymous
// per-IP caps on the other land and site tools (find_sites, analyze_parcel,
// site_selection_canvas, execute_plan, and analyze_site's hard wall) still led with
// `claim_free_key` and a pack checkout. Here:
//
//   * keylessCapEmailResult: the anonymous-cap wall for a keyless caller WITH a transport
//     session leads with the email unlock page (a w-freekey relay: dchub-backend's
//     handoff_email_capture.unlock_eligible grants the email tier onto the session, and a keyed
//     caller is not subject to the anonymous per-IP limits). ONE offer line plus human_url;
//     `claim_free_key` stays as the last line for a person who would rather not give an email.
//     No plan name, no price, no "/mo". Kill switch DCHUB_KEYLESS_EMAIL_FIRST=0.
//   * keylessWallQuota: remaining_this_month (0: a keyless caller gets no full answers),
//     resets_at (the next UTC month start), basis. On every keyless email wall.
//   * quotaWallEventBody: one quota_wall_hit per walled call, POSTed to dchub-backend
//     /api/v1/mcp/funnel-event (routes/mcp_funnel_events). Kill switch DCHUB_QUOTA_WALL_EVENT=0.
//   * sessionIdentity: sk-<sha256(session)>, the keyless identity the Pro trial offer's
//     once-per-30-days rule keys on (dchub-backend routes/pro_trial_offer KEYLESS WALL TRIGGER).
//     Kill switch DCHUB_PRO_TRIAL_OFFER_KEYLESS=0.
import { createHash } from 'node:crypto';

const _off = (v) => /^(0|false|no|off)$/i.test(String(v || '').trim());

// The land and site tools this item covers (owner brief 2026-10-16).
export const LAND_SITE_TOOLS = new Set(['analyze_site', 'analyze_parcel', 'find_sites',
  'site_selection_canvas', 'execute_plan']);

// Statuses the gateway logs for a call it walled. Mirrored in dchub-backend
// routes/mcp_funnel_events.QUOTA_WALL_STATUSES (a test on each side pins the list).
export const QUOTA_WALL_STATUSES = new Set(['pro_wall', 'lp_wall', 'lp_free_spent', 'trial_used',
  'trial_cap_exceeded', 'anon_daily_cap', 'anon_hard_wall', 'blocked_paid_only',
  'monthly_quota_blocked', 'metered_enforced', 'credits_depleted']);

export function keylessEmailFirstOn(env = process.env) { return !_off(env.DCHUB_KEYLESS_EMAIL_FIRST); }
export function quotaWallEventOn(env = process.env) { return !_off(env.DCHUB_QUOTA_WALL_EVENT); }
export function keylessTrialOfferOn(env = process.env) { return !_off(env.DCHUB_PRO_TRIAL_OFFER_KEYLESS); }

export function realSession(sid) {
  const s = String(sid || '').trim();
  return s && s !== 'no-session' ? s : '';
}
export function sessionIdentity(sid) {
  const s = realSession(sid);
  return s ? 'sk-' + createHash('sha256').update(s).digest('hex') : '';
}

// The first instant of the next UTC calendar month, ISO 8601 (the month the free full site
// reports are counted in: dchub-backend routes/mcp_lp_free_runs.resets_at).
export function nextUtcMonthStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString().replace('.000Z', 'Z');
}
export function keylessWallQuota(now = new Date()) {
  return {
    remaining_this_month: 0,
    resets_at: nextUtcMonthStart(now),
    quota_basis: 'keyless callers get no full answers; resets_at is the next UTC month start, when the '
      + 'free full reports a key gets each month are counted again',
  };
}
// Adds the quota fields to a wall result's structuredContent (and to block 0's JSON when block 0
// is the JSON payload). Any failure returns the result unchanged.
export function withKeylessWallQuota(result, now = new Date()) {
  try {
    if (!result || typeof result !== 'object' || !result.structuredContent) return result;
    const q = keylessWallQuota(now);
    const out = { ...result, structuredContent: { ...result.structuredContent, ...q } };
    const b0 = Array.isArray(result.content) ? result.content[0] : null;
    if (b0 && b0.type === 'text' && typeof b0.text === 'string' && b0.text.trim().startsWith('{')) {
      try {
        const j = JSON.parse(b0.text);
        if (j && typeof j === 'object' && !Array.isArray(j)) {
          out.content = [{ ...b0, text: JSON.stringify({ ...j, ...q }) }, ...result.content.slice(1)];
        }
      } catch (_) { /* prose block: structuredContent carries it */ }
    }
    return out;
  } catch (_) { return result; }
}

export const KEYLESS_CAP_EMAIL_LINE = 'Keep going free by email → ';
export const KEYLESS_CAP_NO_EMAIL_LINE = 'If the user prefers not to give an email, call `claim_free_key` (one call, no email).';
export function keylessCapMessage(name) {
  return "You've reached the free anonymous limit for this IP today. Keep going free: show your human the "
    + 'link in human_url. Once they enter an email, this session’s next `' + name + '` call continues on the '
    + 'free tier for identified callers, which this anonymous limit does not apply to.';
}

// The anonymous-cap wall, email first. `link` is the page link (the /u/ short of a w-freekey
// relay, or the long relay when the short mint failed). `base` is the structuredContent the
// wall would have carried: its limit facts (error, binding_limit, limit, retry_after, tool,
// current_tier) are kept, its checkout and sign-up links are not (one link per wall).
const _KEEP = ['error', 'tool', 'current_tier', 'binding_limit', 'limit', 'soft_cap', 'retry_after',
  'remaining_today', 'remaining_today_basis'];
export function keylessCapEmailResult({ name, link, base = {}, isError = false, copyVersion = '', now = new Date() }) {
  if (!link) return null;
  const line = KEYLESS_CAP_EMAIL_LINE + link;
  const kept = {};
  for (const k of _KEEP) if (base[k] !== undefined) kept[k] = base[k];
  const sc = {
    ...kept,
    tool: name,
    message: keylessCapMessage(name),
    unlock_kind: 'email_cap',
    human_url: link, upgrade_url: link,
    user_message: line, show_to_user: true,
    ...(copyVersion ? { copy_version: copyVersion } : {}),
    next_tool: 'claim_free_key',
    free_key_unlock: { tool: 'claim_free_key', email_required: false, note: KEYLESS_CAP_NO_EMAIL_LINE },
    for_your_human: {
      message: 'Your AI assistant reached DC Hub’s free anonymous limit. Open this link to keep going free by email:',
      url: link, text: line, render: 'verbatim_link_required',
      markdown: '[Keep going free on DC Hub by email](' + link + ')',
      _agent_instruction: 'Share this link with your user: the `markdown` field above is a ready clickable link to it.',
    },
    ...keylessWallQuota(now),
  };
  const text = [line, keylessCapMessage(name), KEYLESS_CAP_NO_EMAIL_LINE].join('\n\n');
  return { content: [{ type: 'text', text }], isError: !!isError, structuredContent: sc };
}

// The soft cap keeps serving its trimmed preview; only its _upgrade nudge changes, to the
// same email-first ask. `trimmed` is the preview object; returns a new object.
export function keylessSoftCapEmailUpgrade(trimmed, { name, link, now = new Date() }) {
  if (!link || !trimmed || typeof trimmed !== 'object') return trimmed;
  const up = (trimmed._upgrade && typeof trimmed._upgrade === 'object') ? trimmed._upgrade : {};
  const line = KEYLESS_CAP_EMAIL_LINE + link;
  return {
    ...trimmed,
    _upgrade: {
      tier: 'anon_daily_cap',
      message: line + ' ' + keylessCapMessage(name) + ' ' + KEYLESS_CAP_NO_EMAIL_LINE,
      unlock_kind: 'email_cap',
      human_url: link,
      next_tool: 'claim_free_key',
      remaining_today: up.remaining_today === undefined ? 0 : up.remaining_today,
      ...(up.remaining_today_basis ? { remaining_today_basis: up.remaining_today_basis } : {}),
      binding_limit: up.binding_limit || 'anon_ip_daily',
      ...keylessWallQuota(now),
    },
    human_url: link,
    user_message: line,
    show_to_user: true,
  };
}

// Which email ask a walled response carried (wall email option E, owner 2026-10-26), sent as
// `email_ask` on its quota_wall_hit; dchub-backend routes/mcp_funnel_events.WALL_ASK_KINDS
// mirrors the list. link_exit = the email link AND the no-email claim_free_key line, link = the
// email link alone, line = the grid/queue wall's email line, bind_field = only the trial
// bind_email field. The wall builders mark the call's context; bind_field never replaces a
// stronger mark (it rides in nearly every keyed gated envelope).
export const WALL_ASK_KINDS = new Set(['link_exit', 'link', 'line', 'bind_field']);
export function markEmailAsk(c, kind) {
  try {
    if (!c || typeof c !== 'object' || !WALL_ASK_KINDS.has(kind)) return;
    if (kind === 'bind_field' && c._emailAsk) return;
    c._emailAsk = kind;
  } catch (_) { /* telemetry never touches a response */ }
}
// One quota_wall_hit for dchub-backend routes/mcp_funnel_events. null when the call is not a
// wall. The api key travels to the backend, which stores only its pk-<sha256> ref.
export function quotaWallEventBody({ c = {}, name, status, paidBlocked = false, isQa = false, platform = '' }) {
  const s = String(status || '');
  if (!QUOTA_WALL_STATUSES.has(s) && !paidBlocked) return null;
  return {
    event: 'quota_wall_hit',
    tool: String(name || ''),
    wall_status: QUOTA_WALL_STATUSES.has(s) ? s : 'other',
    paid_blocked: !!paidBlocked,
    session_id: realSession(c.session_id),
    api_key: c.api_key || '',
    platform: String(platform || c.platform || ''),
    user_agent: String(c.client_ua || c.user_agent || '').slice(0, 300),
    is_qa: !!isQa,
    ...(WALL_ASK_KINDS.has(c._emailAsk) ? { email_ask: c._emailAsk } : {}),
  };
}
