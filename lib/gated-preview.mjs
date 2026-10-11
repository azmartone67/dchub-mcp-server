// ── analyze_site gated_preview (conversion panel 2026-10-11) ────────────────────
// Nine assistants (Grok x2, ChatGPT, Gemini, DeepSeek, Qwen, Copilot, Mistral, Perplexity) read the
// keyless analyze_site wall and agreed on the cause of 0 unlock-page visits from 159 walls: the host
// summarizes the teaser, says "detailed data unavailable" and drops the link. The wall it read said
// "needs a paid DC Hub plan" / "Start a 7-day trial" beside a free email link, carried
// error:"pro_required", and ordered "First line ... Then stop", which a host is free to ignore.
//
// This step reshapes that wall, and only that wall (analyze_site, unlock_kind email | email_key), into
// a successful partial answer that names what it is in the vocabulary execute_plan already uses:
//   status: "gated_preview", preview {verdict, power_infrastructure}, missing [sections],
//   human_message (one sentence holding the link), human_url, offer {price_usd: 0, card_required: false},
//   request_id.
// content[0] is the human_message with the link as a markdown link on its own line, so the link is part
// of the answer a host summarizes, not metadata beside it. The agent line asks, it does not command.
// No plan name and no price but "free" (mcp#891).
//
// Runs as the last step before _flagUpstreamError, so no earlier stamp can rewrite it. Directory,
// Claude-directory and core profiles keep their own rules (the ChatGPT listing is frozen for review).
// Kill switch: DCHUB_GATED_PREVIEW=0 returns the earlier wall byte for byte.
import { randomUUID } from 'crypto';

export function gatedPreviewOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String(env.DCHUB_GATED_PREVIEW || ''));
}

// The monthly full-report allowance a free key gets (dchub-backend routes/mcp_lp_free_runs.py,
// DCHUB_LP_FREE_RUNS_ANALYZE_SITE, default 3). Mirrored, not fetched: set both if it changes.
export function siteFreeRunsPerMonth(env = process.env) {
  const n = Number.parseInt(String(env.DCHUB_LP_FREE_RUNS_ANALYZE_SITE || ''), 10);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

const KINDS = new Set(['email', 'email_key']);
const RELAY_URL_RE = /https:\/\/dchub\.cloud\/(?:upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}|u\/[2-9a-hj-km-np-z]{6})(?:\?[^\s"'\\)\]}>]*)?/;
const LABELS = { overall_score: 'overall score', fiber_connectivity: 'fiber connectivity',
  gas_pipeline_access: 'gas pipeline access', market_conditions: 'market conditions',
  risk_resilience: 'risk and resilience' };
const DEFAULT_MISSING = ['overall_score', 'fiber_connectivity', 'gas_pipeline_access', 'market_conditions',
  'risk_resilience'];
// Keys that said "paid", "pro" or gave orders on the earlier wall; the gated_preview says it once, plainly.
// user_message / show_to_user stay, holding the human_message (clients that read those fields see it).
const DROP_KEYS = ['error', 'required_plan', 'upgrade', 'upgrade_url', 'agent_message', 'agent_instruction'];

export const GATED_PREVIEW_AGENT_LINE = 'This is a partial result. When results are partial, show the user '
  + 'human_message and its link. Please do not fill in the withheld numbers.';
export const GATED_PREVIEW_LINK_TEXT = 'Unlock the full site report free';

export function gatedPreviewLead(env = process.env) {
  return 'This is a preview, not the full site report. Unlock it free by email ('
    + siteFreeRunsPerMonth(env) + ' full reports a month, no card):';
}
export function gatedPreviewHumanMessage(url, env = process.env) {
  return gatedPreviewLead(env) + ' ' + url;
}

const label = (k) => LABELS[k] || String(k).replace(/_/g, ' ');

export function gatedPreviewStep(result, name, ctx = {}, opts = {}) {
  try {
    if (name !== 'analyze_site' || !gatedPreviewOn(opts.env)) return result;
    // The wall's isError is a transport choice (_wallIsError; prod runs DCHUB_WALL_ISERROR=0); a
    // gated_preview is a successful partial answer on every transport.
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const sc0 = result.structuredContent;
    if (!sc0 || typeof sc0 !== 'object' || Array.isArray(sc0) || !KINDS.has(sc0.unlock_kind)) return result;
    if (opts.skipProfiles && ctx && opts.skipProfiles.includes(ctx.profile)) return result;
    const m = typeof sc0.human_url === 'string' ? RELAY_URL_RE.exec(sc0.human_url) : null;
    const url = m ? m[0] : '';
    if (!url) return result;   // no relay link: nothing to hand over, leave the wall as it was
    const t = (sc0.site_teaser && typeof sc0.site_teaser === 'object') ? sc0.site_teaser : null;
    const missingKeys = (t && Array.isArray(t.locked) && t.locked.length) ? t.locked : DEFAULT_MISSING;
    const missing = missingKeys.map(label);
    const preview = t ? { verdict: t.verdict || null, power_infrastructure: t.power_infrastructure || null } : null;
    const human_message = gatedPreviewHumanMessage(url, opts.env);
    const request_id = (typeof sc0.request_id === 'string' && sc0.request_id) || ('sr_' + randomUUID().replace(/-/g, '').slice(0, 20));
    const sc = {};
    for (const [k, v] of Object.entries(sc0)) if (!DROP_KEYS.includes(k)) sc[k] = v;
    Object.assign(sc, {
      ok: true,
      status: 'gated_preview',
      human_message,
      human_url: url,
      user_message: human_message,
      show_to_user: true,
      ...(preview ? { preview_bands: preview } : {}),
      missing,
      offer: { price_usd: 0, card_required: false, full_reports_per_month: siteFreeRunsPerMonth(opts.env), unlock: 'email' },
      request_id,
      agent_hint: GATED_PREVIEW_AGENT_LINE,
      for_your_human: { message: human_message, url, text: human_message,
        markdown: '[' + GATED_PREVIEW_LINK_TEXT + '](' + url + ')' },
    });
    if (t) sc.site_teaser = { ...t, unlock_url: url };
    // What the agent reads about the unlock, per kind, without "paid" anywhere. The key page does not
    // email the key unless DCHUB_UNLOCK_KEY_EMAIL is on in dchub-backend, so this does not promise it.
    sc.message = (preview ? 'Without a key, `analyze_site` returns the verdict band and the power band. ' : '')
      + (sc0.unlock_kind === 'email_key'
        ? 'The full site report is free: the link in human_url takes an email and shows a free key; with that key '
          + 'as X-API-Key the next `analyze_site` call returns the full report.'
        : 'The full site report is free: once your user enters an email at the link in human_url, this '
          + 'session\u2019s next `analyze_site` call returns the full report.');
    if (sc.limiting_factor && typeof sc.limiting_factor === 'object') {
      sc.limiting_factor = { ...sc.limiting_factor, note: 'The weakest factor is named free; scores and the other factor bands come with the full site report.' };
    }
    const previewLine = preview
      ? 'Preview: verdict ' + (preview.verdict || 'not rated') + '; power infrastructure '
        + (preview.power_infrastructure || 'not rated') + '. Missing from this preview: ' + missing.join(', ') + '.'
      : 'Missing from this preview: ' + missing.join(', ') + '.';
    const altLine = sc0.unlock_kind === 'email_key' || sc0.next_tool === 'claim_free_key'
      ? 'If the user would rather not give an email: call `claim_free_key` (one call, no email), send the key it '
        + 'returns as X-API-Key, and call `analyze_site` again.'
      : 'If the user would rather not give an email, call `claim_free_key` (one call, no email).';
    const content = [
      // The sentence, then the link once, as a markdown link on its own line (one link in the text).
      { type: 'text', text: gatedPreviewLead(opts.env) + '\n\n[' + GATED_PREVIEW_LINK_TEXT + '](' + url + ')\n\n' + previewLine },
      { type: 'text', text: altLine },
      { type: 'text', text: '(agent) ' + GATED_PREVIEW_AGENT_LINE },
    ];
    return { ...result, isError: false, content, structuredContent: sc };
  } catch (_) { return result; }   // reshaping copy is never worth failing a response over
}
