// wall-offer-floor-v2.mjs: an offer on every wall (Grok funnel spec F2, 2026-11-22). Flag DCHUB_WALL_OFFER_FLOOR_V2,
// default OFF. (DCHUB_WALL_OFFER_FLOOR, the name in the spec, is the floor's existing kill switch and has been ON since
// 2026-11-11; this flag adds two rules on top of it.)
//
// MEASURED before this change (live /api/v1/mcp/funnel 2026-11-22 ~20:00Z, and the real /mcp handler with the plain stub):
//   . offer_rate_allowed_7d: 887 of 911 walls the floor is allowed on carry a free offer (97.4%, target 95% met). The
//     walls with no offer are exempt by design: grok 48, clean 23, profile 20, plan_step 2 (93 of the spec's 99).
//   . Grok (contract G3): a walled Grok answer gets only the sign-in block; get_facility and rank_markets reached Grok
//     with offers_shown "pro" and no email ask at all.
//   . get_facility: 41 walls of one identity in 7d, 1 key_line then 40 digest_line. The free-key line is asked once per
//     (session, tool) (owner 2026-11-09), so every repeat wall of a depth tool offered the weekly digest only.
//
// WHAT, flag on:
//   R1 (spec F2a, Grok): a walled Grok answer that still carries no free offer after the G3 block gets the key line
//      (lib/wall-key-line.mjs keyLine) as its floor, tagged key_line. Not for a caller with an email on file or a paid
//      caller (an email gets them nothing more). The G3 copy itself is unchanged; the line is added after it.
//   R2 (spec F2c): the same identity walled on the same tool for the 3rd time or more within 24h reads the key line
//      again, ahead of the digest offer, even though it was already asked this session. Walls 1 and 2 are as today.
// Not touched: the directory / Claude / core profiles (frozen copy), a clean platform, /mcp/chatgpt, an execute_plan
// step. Enforcement, quota and caps are not read or written here: this only adds text to an answer already walled.
// No price, plan name, "free", credit, trial wording or per-day figure is added (the key line is option A copy).

export const FLOOR_V2_FLAG = 'DCHUB_WALL_OFFER_FLOOR_V2';
export const REPEAT_WALL_MIN = 3;
export const REPEAT_WALL_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_KEYS = 20000;

export function wallOfferFloorV2On(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[FLOOR_V2_FLAG]) || '').trim());
}

// R1: whether a walled Grok answer gets the key line as its floor.
export function grokKeyFloorEligible({ shownOffers = [], bound = false, paid = false, line = '' } = {}) {
  const shown = Array.isArray(shownOffers) ? shownOffers : [];
  const hasFree = shown.some((k) => k === 'email_unlock' || k === 'digest' || k === 'email_key');
  return !!line && !bound && !paid && !hasFree;
}

// R2: walls per (identity, tool), last 24h. In-process, bounded; a restart forgets (the rule then waits for 3 again).
export function createRepeatWallCounter({ now = () => Date.now(), windowMs = REPEAT_WALL_WINDOW_MS, maxKeys = MAX_KEYS } = {}) {
  const hits = new Map();
  return {
    // Records one wall and returns how many this identity had on this tool in the window, this one included.
    record(identity, tool) {
      if (!identity || !tool) return 0;
      const k = identity + '\u0000' + tool;
      const t = now();
      const list = (hits.get(k) || []).filter((x) => t - x < windowMs);
      list.push(t);
      hits.delete(k);
      hits.set(k, list);
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
      return list.length;
    },
    size() { return hits.size; },
  };
}

export function isRepeatWall(count, min = REPEAT_WALL_MIN) {
  return Number(count) >= min;
}
