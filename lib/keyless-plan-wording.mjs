// keyless-plan-wording.mjs -- a keyless tool result carries no plan, trial, upgrade or price wording and no
// pricing link (Grok Note V item 1 / Note F M1, 2026-11-16).
//
// WHY. Measured live 2026-11-16 on https://dchub.cloud/mcp with no key:
//   compare_sites      user_message / human_message / for_your_human.text: "DC Hub's paid plan has the full
//                      side-by-side comparison ... Start a 7-day trial: <link>"; the relay label
//                      "[Start a 7-day DC Hub trial]"; "hit DC Hub's paid data boundary"; error "pro_required".
//   deal_autopsy       autopsy.message "The autopsy read is the paid layer ... opens with a paid DC Hub plan for
//                      agents." (written by the data API, dchub-backend routes/deal_autopsy.py).
//   analyze_site       rates_note "Broker lease rates (CBRE/JLL): available on paid plans", rates_upgrade_url
//                      https://dchub.cloud/pricing, "(figure on paid plans)" (dchub-backend util/market_pricing.py).
//   get_intelligence_index / execute_plan  "the plans that return them are on the page behind the link",
//                      "the lowest plan that returns them is a free DC Hub key", "The plans that include the full
//                      CAISO brief are on this page".
// The wording comes from a dozen writers (wall-user-line, the relay builder, upgrade-missed, the sell lines, the
// data API) whose keyed copy is owner-approved and measured by copy_version. A keyless caller has no plan to be
// told about: what it can do next is free (an email, a free key, the link to see what its agent found).
//
// WHAT. The LAST step on a keyless result (server.mjs _sourceLineCb, after every other step), on the canonical
// surfaces: every string, in structuredContent and in every text block (block 0's JSON parsed and re-serialised
// only when something changed), goes through REWRITES, a fixed list of DC Hub's own sentences and their neutral
// form. Each neutral form names what was withheld and the free next step. Links to /pricing or /plans become
// https://dchub.cloud/connect and a #pricing anchor is dropped. `rates_upgrade_url` (a pricing link under a key
// that says upgrade) goes. The wall code `pro_required` becomes `full_access_required` (every reader of the old
// code runs inside the chain, before this step). Machine routing fields (_upgrade.next_tool, trial_preview,
// _wall, _gated, next_tool, human_url) are kept: they carry no wording.
//
// The sentence list is exact on purpose: a writer that changes its wording stops matching and the keyless guard
// (test/keyless-results-no-plan-wording.test.mjs, which runs the real handlers) goes red, instead of this step
// silently rewriting data. Keyed callers, the directory / Claude / core profiles and the clean platforms are left
// as they were (each keeps its own owner-approved or frozen copy), except dchub_services and the execute_plan
// front-desk footers: their SOURCE copy is neutral for every caller (keyed follow-up, 2026-11-16), so this step
// is a no-op on them and the guard scans a keyed caller on both.
// Note V keyed follow-up, part 2 (2026-11-16): the wall copy measured above (the Pro wall line, the relay labels and
// lead, the missed-field clauses, the sell lines, the paywall offer / retry hint, the provenance reasons) is now
// neutral at its source on /mcp for every caller, so those REWRITES entries are gone. What stays here: the data
// API's sentences (deal_autopsy, the broker-rate block), the link rewrites, the legacy proWallAgentMessage, and
// the keyless-only email offer appended to the Pro wall line.
//
// Kill switch DCHUB_KEYLESS_NO_PLAN_WORDING=0 (read per call): every keyless result as it was, byte for byte.

import { splitLeadingJson } from './facility-location.mjs';

export const KEYLESS_NO_PLAN_WORDING_FLAG = 'DCHUB_KEYLESS_NO_PLAN_WORDING';
export function keylessNoPlanWordingOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[KEYLESS_NO_PLAN_WORDING_FLAG]) || '').trim());
}

export const CONNECT_URL = 'https://dchub.cloud/connect';
// The keyless wall code (was `pro_required`).
export const WITHHELD_ERROR = 'full_access_required';
// The wall copy version a rewritten keyless person line carries, so the funnel's per-version split does not
// count the new line under v14.
export const KEYLESS_COPY_VERSION = 'v16';

// The deal_autopsy locked line. dchub-backend routes/deal_autopsy.py writes the same sentence (be PR, same day).
export const AUTOPSY_LOCKED = "The autopsy read (the real play on each deal: long-dated option, near-term build or "
  + "queue gamble) is not included in this preview. The deal flow and each market's Data Center Power Index (DCPI) "
  + 'verdict above are included.';
// dchub-backend util/market_pricing.py writes the same two strings for an agent answer (be PR, same day).
export const BROKER_RATES_WITHHELD = 'Broker lease rates (CBRE/JLL): withheld from this answer';
export const RATE_FIGURE_WITHHELD = '(figure withheld)';

const APOS = "(?:'|’)";
// [pattern, replacement (a string with no $-backreference, or a function)]. Order matters: longer sentences first.
export const REWRITES = Object.freeze([
  // compare_sites / Pro-only walls: the SOURCE line is neutral for every caller (lib/wall-user-line.mjs proWallLine,
  // Note V keyed follow-up 2026-11-16); a keyless caller's line also offers the free key, said once.
  [/(This preview leaves out .+?\. Open \S+ to see what your agent found)\./g,
    (_, line) => line + ', or reply with your email for a free DC Hub key.'],
  // (The relay link labels, the relay lead's "paid data boundary", the missed-rung clauses, the sell lines, the
  // paywall contract's pro offer and retry hint, the relay's agent instruction and the provenance reasons had entries
  // here until the Note V keyed follow-up, 2026-11-16: their source copy is neutral for every caller now, so nothing is
  // left to rewrite; test/keyless-results-no-plan-wording.test.mjs scans keyed callers on them too.)
  // agent message on a Pro-only wall (server.mjs proWallAgentMessage)
  [/ needs a paid DC Hub plan; this response is a preview\./g, ' is not included at this access level; this response is a preview.'],
  // the data API's deal_autopsy locked line (dchub-backend routes/deal_autopsy.py, before be PR)
  [/(?:🎯 )?The autopsy read is the paid layer\..*? opens with (?:a paid DC Hub plan for agents|[^.]*?)\./g, AUTOPSY_LOCKED],
  // the data API's broker-rate masks (dchub-backend util/market_pricing.py, before be PR)
  [/Broker lease rates \(CBRE\/JLL\): available on paid plans/g, BROKER_RATES_WITHHELD],
  [/\(figure on paid plans\)/g, RATE_FIGURE_WITHHELD],
  // (dchub_services and the execute_plan front-desk footers built from it had three entries here until the keyed
  // follow-up, 2026-11-16: lib/dchub-services.mjs now writes neutral copy for every caller, so nothing is left to
  // rewrite; test/keyless-results-no-plan-wording.test.mjs scans a keyed caller too.)
  // links: a pricing or plans page becomes /connect; a #pricing anchor goes
  // (the query, e.g. ?via=agent-referral&src=services, is attribution and stays)
  [/https:\/\/(?:www\.)?dchub\.cloud\/(?:pricing|plans)(?:\.html)?(\?[^\s"'<>)\]#]*)?(?:#[\w-]*)?/g,
    (_, query) => CONNECT_URL + (query || '')],
  [/(https:\/\/(?:www\.)?dchub\.cloud\/[^\s"'<>)\]#]*)#pricing\b/g, (_, url) => url],
]);

// What a keyless result may not say (the guard's regex; also used by the step's own self-check in tests).
// Case-insensitive words, plus prices in DC Hub's shapes. Data prices ($/MWh, deal values) are not DC Hub
// prices: the guard applies PRICE only outside data rows.
export const BANNED_WORDING = /\bpaid\b|\btrials?\b|\bupgrade\b|\bpricing\b|\/plans\b|#pricing|\bsubscription\b|\bcheckout\b|\b(?:the|a|any|our|lowest|full-access|higher|cheapest)\s+plans?\b|\bDC Hub plans?\b(?!\s+(?:the|a|an|its|each|and)\b)|\bplans? (?:that|with|for agents)\b|\bon (?:a )?plans?\b|\bpro_required\b/i;
export const PLAN_NAME = /\b(?:Pro|Developer|Starter|Enterprise|Founding|Founder|Lite)\b/;
export const PRICE = /\$\s?\d/;

export function neutralKeylessString(s) {
  if (typeof s !== 'string' || !s) return s;
  let t = s;
  for (const [re, to] of REWRITES) { re.lastIndex = 0; t = t.replace(re, to); }
  return t;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const DROP_KEYS = new Set(['rates_upgrade_url']);

function walk(v, depth = 0) {
  if (depth > 60 || v == null) return v;
  if (typeof v === 'string') {
    if (v === 'pro_required') return WITHHELD_ERROR;
    return neutralKeylessString(v);
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (DROP_KEYS.has(k)) continue;
    out[k] = walk(x, depth + 1);
  }
  return out;
}

function stampVersion(sc, before) {
  if (!isObj(sc) || typeof sc.copy_version !== 'string') return sc;
  if (!isObj(before) || before.user_message === sc.user_message) return sc;
  return { ...sc, copy_version: KEYLESS_COPY_VERSION };
}

// The step. `skip`: a keyed caller, an execute_plan loopback step, or a surface that keeps its own copy.
export function keylessPlanWordingStep(result, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !keylessNoPlanWordingOn(env)) return result;
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    let changed = false;
    const content = result.content.map((b) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') return b;
      const sp = splitLeadingJson(b.text);
      let text;
      if (sp && (isObj(sp.json) || Array.isArray(sp.json))) {
        const j = walk(sp.json);
        const js = JSON.stringify(j);
        const body = js === JSON.stringify(sp.json) ? b.text.slice(sp.head.length, b.text.length - sp.rest.length) : js;
        text = neutralKeylessString(sp.head) + body + neutralKeylessString(sp.rest);
      } else {
        text = neutralKeylessString(b.text);
      }
      if (text === b.text) return b;
      changed = true;
      return { ...b, text };
    });
    let sc = result.structuredContent;
    if (isObj(sc)) {
      const next = stampVersion(walk(sc), sc);
      if (JSON.stringify(next) !== JSON.stringify(sc)) { sc = next; changed = true; }
    }
    if (!changed) return result;
    return { ...result, content, ...(result.structuredContent !== undefined ? { structuredContent: sc } : {}) };
  } catch (_) { return result; }   // copy only: never break a response
}
