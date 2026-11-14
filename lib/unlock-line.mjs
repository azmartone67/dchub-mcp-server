// unlock-line.mjs -- ONE source for the free unlock path a tool response names (Grok live agent review
// 2026-11-13, item 4 "One unlock message").
//
// WHY. Claude, Grok and Mistral clients were told different things about how to unlock, sometimes inside one
// response: "call claim_free_key for the full free tier" (four walls), "a free 10-calls/day key" (the
// Claude-platform paywall line), "your key's free calls are used up" (a free key has no call count since B1,
// 2026-10-04), and a Land & Power wall that said a free key opens only a preview of analyze_site while the
// owner's analyze_site line says a free key runs a few full site reports a month. The published promise is the
// server instructions' FREE TIER paragraph (lib/tier-canon.mjs _freeTierRuleForGate + the decision and siting
// clauses); every sentence here is composed from the same canon, so no wall can state a number of its own.
//
// WHAT IS HERE. The sentences a wall uses to name the free path: the free key's allowance, the claim_free_key
// clause, the email ask, the analyze_site free-run line. No price, plan name, quota or gate is decided here:
// the numbers are read from lib/tier-canon.mjs; which wall is shown to whom stays where it was.
//
// test/unlock-line-ratchet.test.mjs pins every line against the canon paragraph and ratchets the copies that
// still live outside this module (it fails when one is added).
//
// Kill switch: DCHUB_UNLOCK_LINE_V1=0 restores the previous wording byte for byte (the *_LEGACY strings
// below), read once at import like the rest of the copy constants.

import { _freeKeyAllowanceText, _freeKeyOfferText, _fullAnswersPerToolPerDay, ANALYZE_SITE_FREE_LINE } from './tier-canon.mjs';

export const UNLOCK_LINE_FLAG = 'DCHUB_UNLOCK_LINE_V1';
export function unlockLineV1On(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[UNLOCK_LINE_FLAG]) || '').trim());
}
const V1 = unlockLineV1On();

// The free key's allowance, the canon's words: "previews plus N full answers per tool per day, M/day with an
// email" (tier-canon _freeKeyAllowanceText; the per-tool and per-day figures come from canonical/tier_limits.json).
export const freeKeyAllowance = () => _freeKeyAllowanceText();

// "a free key (<allowance>)" -- what claim_free_key returns, never "the full free tier".
export const freeKeyNoun = () => 'a free key (' + freeKeyAllowance() + ')';

// ── the email ask ────────────────────────────────────────────────────────────────────────────────────────────
// Owner-approved 2026-10-19 (Grok brief item 1), used where a bound email opens a fuller answer.
export const EMAIL_ASK_LEGACY = 'Ask your user for their email, then call `bind_email` with it to unlock the full answer.';
// Item 4 asks for a softer ask: the user decides, the agent never supplies an address of its own.
// Callers append "Only use an address they gave you." where they did before, so it is not repeated here.
export const EMAIL_ASK_SOFT = 'If your user would like the full answer, ask whether they want to share their email, '
  + 'then call `bind_email` with it.';
export const EMAIL_ASK = V1 ? EMAIL_ASK_SOFT : EMAIL_ASK_LEGACY;

// ── the claim_free_key clause, per wall ─────────────────────────────────────────────────────────────────────
// Keyless free-tool preview nudge (server.mjs applyTrialGuardIfFree).
const CLAIM_NUDGE_LEGACY = 'Call `claim_free_key` (no email) for the full free tier';
export const claimNudge = () => (V1 ? 'Call `claim_free_key` (no email needed) for ' + freeKeyNoun() : CLAIM_NUDGE_LEGACY);

// Clean-platform preview note (server.mjs, two arms: with and without "one call").
const PREVIEW_NOTE_LEGACY = (oneCall) => 'Free preview — a sample is shown. Call claim_free_key (free, no email'
  + (oneCall ? ', one call' : '') + ') for the full free tier, or show your human upgrade_url — it explains what this '
  + 'call found and how to unlock the rest.';
export const previewNote = (oneCall = false) => (V1
  ? 'Free preview — a sample is shown. Call claim_free_key (free, no email' + (oneCall ? ', one call' : '') + ') for '
    + freeKeyNoun() + ', or show your human upgrade_url — it explains what this call found and how to unlock the rest.'
  : PREVIEW_NOTE_LEGACY(oneCall));

// Anonymous aggregate-mask note (server.mjs).
const ANON_MASK_LEGACY = 'Anonymous tier — aggregate metrics masked. Unlock the full free tier in ONE MCP call: call the '
  + 'claim_free_key tool (no email), then SAVE the returned X-API-Key to your MCP config and reconnect.';
export const anonMaskNote = () => (V1
  ? 'Anonymous tier — aggregate metrics masked. Call the claim_free_key tool (no email needed) for ' + freeKeyNoun()
    + ', then SAVE the returned X-API-Key to your MCP config and reconnect.'
  : ANON_MASK_LEGACY);

// Paywall extras, the Claude-platform line (server.mjs buildPaywallExtras).
const CLAUDE_PLATFORM_LEGACY = '*(Claude.ai web can’t hold an API key — the credit-pack link above works in any '
  + 'browser. On Claude Code CLI you can instead call `claim_free_key` for a free 10-calls/day key.)*';
export const claudePlatformLine = () => (V1
  ? '*(Claude.ai web can’t hold an API key — the credit-pack link above works in any browser. On Claude Code '
    + 'CLI you can instead call `claim_free_key` for ' + freeKeyNoun() + '.)*'
  : CLAUDE_PLATFORM_LEGACY);

// Paywall extras, an unbound key (server.mjs buildPaywallExtras _isTrial). Since B1 a free key has no call
// count to use up, so the line no longer says one was.
const UNBOUND_KEY_LEGACY = (identPerDay) => '\u{1F511} *Your DC Hub key’s free calls are used up. To keep going '
  + 'FREE (' + identPerDay + ' calls/day) and so this key works next session, call the **`bind_email`** tool with your '
  + 'operator’s email — full/unlimited data is the credit pack above.*';
export const unboundKeyLine = (identPerDay) => (V1
  ? '\u{1F511} *To keep going free with this key, and so it works next session, call the **`bind_email`** tool with '
    + 'your operator’s email (an email adds ' + identPerDay + ' calls/day, up to ' + identFullPerTool()
    + ' full answers per tool per day) — the credit pack above adds more.*'
  : UNBOUND_KEY_LEGACY(identPerDay));
// "up to N" from the canon (the same figure the FREE TIER paragraph prints).
const identFullPerTool = () => { const n = _fullAnswersPerToolPerDay('identified'); return n === null ? 'n/a' : n; };

// ── analyze_site, the Land & Power wall's free-key clause ───────────────────────────────────────────────────
// Keyless analyze_site (server.mjs _lpWallResult). The owner's analyze_site line (ANALYZE_SITE_FREE_LINE,
// 2026-10-11/14) says a free key runs a few full site reports a month; the wall said a free key opens only the
// preview. With the LP free runs on (DCHUB_LP_FREE_RUNS, default on) the wall now quotes the owner's line.
// Other Land & Power tools (compare_sites, get_composite_site_score) keep the preview clause: no free run
// covers them. OWNER DECISION in the PR: which promise the keyless wall makes.
export const LP_PREVIEW_CLAUSE = 'A free key opens the preview '
  + '(verdicts, bands, names and counts, every score and figure null): call `claim_free_key`.';
export const LP_PREVIEW_TEXT_CLAUSE = 'or call `claim_free_key` (one call, no email) for the preview: '
  + 'verdicts and bands, no scores or figures.';
export const ANALYZE_SITE_KEY_CLAUSE = 'Call `claim_free_key` (one call, no email) for a free key. ' + ANALYZE_SITE_FREE_LINE;
export const ANALYZE_SITE_KEY_TEXT_CLAUSE = 'or call `claim_free_key` (one call, no email) for a free key. ' + ANALYZE_SITE_FREE_LINE;
export function lpFreeKeyClause(name, { lpFreeRuns = true, text = false } = {}) {
  if (V1 && name === 'analyze_site' && lpFreeRuns) return text ? ANALYZE_SITE_KEY_TEXT_CLAUSE : ANALYZE_SITE_KEY_CLAUSE;
  return text ? LP_PREVIEW_TEXT_CLAUSE : LP_PREVIEW_CLAUSE;
}

// Every canonical line this module hands out (V1), for the ratchet test.
export function unlockLines() {
  return {
    freeKeyAllowance: freeKeyAllowance(), freeKeyNoun: freeKeyNoun(), EMAIL_ASK_SOFT,
    claimNudge: claimNudge(), previewNote: previewNote(false), previewNoteOneCall: previewNote(true),
    anonMaskNote: anonMaskNote(), claudePlatformLine: claudePlatformLine(), ANALYZE_SITE_KEY_CLAUSE,
  };
}
// The free key's offer clause alone ("previews plus N full answers per tool per day"), re-exported so a wall
// never composes it by hand.
export const freeKeyOffer = () => _freeKeyOfferText();

// ── withheld, not absent ────────────────────────────────────────────────────────────────────────────────────
// Item 4 add-on (2026-11-13, Grok item 3): a figure this tier does not see is WITHHELD, and says so with the same
// free path every wall names; "no row" / UNMEASURED is kept for real absence.
// The grid taste's DCPI band basis when the ISO row exists but its averages are withheld at this tier.
// `clause` is the FREE TIER paragraph's own grid/queue/market-intel clause, as lib/free-decision-taste.mjs builds it
// for the enforced allowance (freeDecisionClause(cap), or the preview-only clause), so the basis quotes the canon.
export const DCPI_BAND_WITHHELD_BASIS = (clause) => 'WITHHELD at this access level: DC Hub scores this ISO '
  + 'in the Data Center Power Index (DCPI), but its constraint and excess-power averages are not shown on a preview.'
  + (clause ? ' ' + clause : '');
// Rows a backend nulled under a top-level `_locked_fields` list get the per-row `_<f>_in_pro` marker (the depth
// gate's convention; lib/plan-free-fields.mjs renames it `_<f>_withheld`) when the row carries the key as null and
// no marker of its own. Pure: returns a new payload, never mutates (a callAPI result can be a cache entry).
export function markLockedRowFields(payload, rowKeys = ['results', 'data']) {
  if (!V1 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const locked = Array.isArray(payload._locked_fields) ? payload._locked_fields.filter((f) => typeof f === 'string' && /^[a-z][a-z0-9_]*$/.test(f)) : [];
  if (!locked.length) return payload;
  let out = null;
  for (const rk of rowKeys) {
    const rows = payload[rk];
    if (!Array.isArray(rows)) continue;
    let changed = false;
    const next = rows.map((r) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return r;
      let o = null;
      for (const f of locked) {
        if (Object.prototype.hasOwnProperty.call(r, f) && r[f] === null
            && r['_' + f + '_in_pro'] === undefined && r['_' + f + '_withheld'] === undefined) {
          if (!o) o = { ...r };
          o['_' + f + '_in_pro'] = true;
        }
      }
      if (o) { changed = true; return o; }
      return r;
    });
    if (changed) { if (!out) out = { ...payload }; out[rk] = next; }
  }
  return out || payload;
}
