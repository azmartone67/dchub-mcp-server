// lib/upgrade-missed.mjs — the upgrade prompt names what THIS answer hid and the
// lowest rung that opens it. (owner-approved 2026-09-29)
//
// WHY. A masked or preview answer carried a generic plan list ("Full set + every
// premium tool: $10 ... or Developer ...") or, on several keyed masks, no human
// prompt at all. Worse, some named a rung that does not open what was hidden:
// measured 2026-09-29 through the real handlers, a keyless get_retirement_headroom
// and get_gas_economics both said "call claim_free_key" while the MW / gas prices
// they hid are Developer / Pro, and a free key changes nothing about them.
//
// THE RULE. Two sentences: what this answer hid, and the lowest rung that opens
// ALL of it. Every name comes from evidence the gate left in THIS response:
//   · explicit markers: `_locked_fields`, `tier_masked.fields`, `_<k>_in_pro`,
//     `_<k>_total_in_pro` (+ the sibling array's shown length);
//   · the per-request log of keys a gate nulled while holding a real figure
//     (recorded at the null site, never inferred from a null — a null has more
//     than one cause).
// The rung is computed, never looked up per tool: the caller passes the gate
// predicates the handler actually applied, each a function of a seat, and the
// first rung above the caller's own seat at which EVERY predicate opens wins.
// Nothing known → null, and the caller keeps its existing generic wording.
//
// No monthly price, ever (owner rule 09-27): the only price named is the $10
// pack. The pack is sold as credits, not as an "unlock" (r-sku-wall), so the rung
// sentence says what a rung comes WITH, never what it unlocks.
//
// Pure module: no ctx, no network. server.mjs supplies the markers, the log, the
// predicates and the caller's seat.


/** The rungs DC Hub sells, cheapest first. Starter is not sold (no-starter-offer). */
export const RUNGS = Object.freeze([
  Object.freeze({ id: 'free_key', seat: Object.freeze({ tier: 'free', keyed: true, credits: 0 }) }),
  Object.freeze({ id: 'pack', seat: Object.freeze({ tier: 'free', keyed: true, credits: 1000 }) }),
  Object.freeze({ id: 'developer', seat: Object.freeze({ tier: 'developer', keyed: true, credits: 0 }) }),
  Object.freeze({ id: 'pro', seat: Object.freeze({ tier: 'pro', keyed: true, credits: 0 }) }),
]);
const RUNG_INDEX = Object.fromEntries(RUNGS.map((r, i) => [r.id, i]));

/**
 * Index of the first rung the caller does NOT already hold. A pack holder is
 * past 'pack'; a Starter key is past the pack (the pack is below Starter's
 * paid plan); Developer is past everything but Pro.
 */
export function rungFloor({ keyed, tier, credits } = {}) {
  const t = String(tier || '').trim().toLowerCase();
  if (!keyed) return 0;
  if (t === 'pro' || t === 'founding' || t === 'team' || t === 'enterprise' || t === 'internal'
      || t === 'admin' || t === 'research_seed') return RUNGS.length;
  if (t === 'developer' || t === 'paid') return RUNG_INDEX.pro;
  if (t === 'starter' || t === 'metered') return RUNG_INDEX.developer;
  if (Number(credits) > 0) return RUNG_INDEX.developer;
  return RUNG_INDEX.pack;
}

/**
 * The lowest rung at or above `floor` at which every predicate in `opens` holds.
 * `opens` must be non-empty: with no gate known there is no honest answer.
 * A predicate that throws counts as closed at that rung.
 */
export function lowestRung({ opens, floor = 0 } = {}) {
  if (!Array.isArray(opens) || !opens.length) return null;
  for (let i = Math.max(0, floor); i < RUNGS.length; i++) {
    const seat = RUNGS[i].seat;
    let all = true;
    for (const fn of opens) {
      let ok = false;
      try { ok = fn(seat) === true; } catch (_) { ok = false; }
      if (!ok) { all = false; break; }
    }
    if (all) return RUNGS[i].id;
  }
  return null;
}

// ── what was hidden ─────────────────────────────────────────────────────────
// Plain words for the keys gates null most. Anything unmapped falls back to the
// key with underscores as spaces and a unit suffix spelled out.
const LABELS = {
  capacity_mw: 'capacity (MW)', mw: 'MW', total_mw: 'total MW', total_gw: 'total GW',
  project_name: 'project names', name: 'names',
  value: 'deal values', value_display: 'deal values', total_value: 'total deal value',
  total_projects: 'the project total', total: 'the total', count: 'the count',
  total_retiring_mw: 'total retiring MW', competing_mw: 'competing queue MW',
  overall_score: 'the overall score', composite_score: 'the composite score', score: 'scores',
  scores: 'factor scores', power_infrastructure: 'factor scores', gas_pipeline_access: 'factor scores',
  fiber_connectivity: 'factor scores', market_conditions: 'factor scores', risk_resilience: 'factor scores',
  industrial_cents_kwh: 'power cost', commercial_cents_kwh: 'power cost',
  nearest_carrier_km: 'fiber distances', distance_km: 'distances',
  henry_hub_spot_usd_mmbtu: 'Henry Hub spot', hub_spot_usd_mmbtu: 'hub spot price',
  basis_diff_usd_mmbtu: 'basis differential', delivered_industrial_usd_mmbtu: 'delivered gas prices',
  delivered_electric_usd_mmbtu: 'delivered gas prices', gas_price_used_usd_mmbtu: 'the gas price used',
  scenarios_usd_per_mwh: 'the $/MWh scenarios', usd_mmbtu: 'the burner-tip price',
  'burner_tip.usd_mmbtu': 'the burner-tip price',
  headroom_mw: 'headroom (MW)', time_to_power_months: 'time to power',
  avg_queue_wait_months: 'queue wait', avg_curtailment_pct: 'curtailment', grid_emergencies_30d: 'grid emergencies',
};
// What a generic row array holds, per tool (wording only; never a gate).
const TOOL_NOUNS = { search_facilities: 'facilities', get_facility: 'facilities', list_transactions: 'deals',
  hyperscaler_deals: 'deals', rank_markets: 'markets', find_sites: 'sites', rank_sites: 'sites',
  get_fiber_intel: 'routes', get_pipeline: 'projects', get_interconnection_queue: 'projects',
  get_refined_queue: 'projects', get_retirement_headroom: 'generators' };
const GENERIC_ROWS = new Set(['data', 'results', 'items', 'rows']);
const NOUNS = { projects: 'projects', transactions: 'deals', deals: 'deals', data: 'rows', results: 'results',
  markets: 'markets', sites: 'sites', facilities: 'facilities', routes: 'routes', items: 'rows' };

const MAX_LABELS = 3;
const _posInt = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n === Math.floor(n);

/** A field path or key as the plain words for it. */
export function fieldLabel(key) {
  const raw = String(key || '').trim();
  if (!raw) return '';
  if (LABELS[raw]) return LABELS[raw];
  const leaf = raw.replace(/\[\]/g, '').split('.').pop();
  if (LABELS[leaf]) return LABELS[leaf];
  let s = leaf.replace(/^_+|_+$/g, '');
  let unit = '';
  const m = /_(mw|gw|kw|km|mi|pct|usd_mmbtu|usd_per_mwh|cents_kwh|months)$/.exec(s);
  if (m) {
    unit = { mw: 'MW', gw: 'GW', kw: 'kW', km: 'km', mi: 'mi', pct: '%', usd_mmbtu: '$/MMBtu',
      usd_per_mwh: '$/MWh', cents_kwh: '¢/kWh', months: 'months' }[m[1]];
    s = s.slice(0, -m[0].length);
  }
  s = s.replace(/_/g, ' ').trim();
  if (!/^[A-Za-z0-9 .&/-]{1,40}$/.test(s)) return '';
  return unit ? (s ? s + ' (' + unit + ')' : unit) : s;
}

/**
 * Collect what THIS payload hid. `maskedLog` is the per-request list of keys a
 * gate nulled while they held a figure. Returns null when nothing was hidden.
 *
 * `strict` (the relay line, 2026-09-29): a field marker counts only when the
 * masked log shows a gate nulled that key while it held a figure. Some markers
 * are stamped whether or not there was a value (trimForTrial's headroom, depth
 * and DCPI branches write `_<k>_in_pro` on a null too), so a marker alone can
 * name a field this answer never had. Row counts (`_<k>_total_in_*`) are
 * measured and count either way.
 */
export function collectMissed(payload, maskedLog, { strict = false } = {}) {
  const keys = [];
  const logged = new Set((Array.isArray(maskedLog) ? maskedLog : [])
    .map((k) => String(k || '').trim().replace(/\[\]/g, '').split('.').pop()));
  const addKey = (k) => {
    const s = String(k || '').trim();
    if (!s || keys.includes(s)) return;
    if (strict && !logged.has(s.replace(/\[\]/g, '').split('.').pop())) return;
    keys.push(s);
  };
  let rows = null;   // { field, shown, total }
  const scan = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { for (const x of o.slice(0, 50)) scan(x, depth + 1); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === '_locked_fields' && Array.isArray(v)) { v.forEach(addKey); continue; }
      if (k === 'tier_masked' && v && Array.isArray(v.fields)) { v.fields.forEach(addKey); continue; }
      const tot = /^_(.+)_total_in_(?:pro|developer)$/.exec(k);
      if (tot) {
        const arr = o[tot[1]];
        if (_posInt(v) && Array.isArray(arr) && v > arr.length && (!rows || v - arr.length > rows.total - rows.shown)) {
          rows = { field: tot[1], shown: arr.length, total: v };
        }
        continue;
      }
      const inPro = /^_(.+)_in_pro$/.exec(k);
      if (inPro && v === true) { addKey(inPro[1]); continue; }
      if (v && typeof v === 'object') scan(v, depth + 1);
    }
  };
  scan(payload, 0);
  if (Array.isArray(maskedLog)) maskedLog.forEach(addKey);
  const labels = [];
  for (const k of keys) {
    const l = fieldLabel(k);
    if (l && !labels.includes(l)) labels.push(l);
  }
  if (!labels.length && !rows) return null;
  return { keys, labels, rows };
}

function _list(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/** Sentence one: what was hidden. */
export function missedSentence(missed, tool) {
  if (!missed) return null;
  const labels = missed.labels || [];
  // Never "and 1 other field": one more label costs less than that phrase.
  const shownLabels = labels.slice(0, labels.length === MAX_LABELS + 1 ? MAX_LABELS + 1 : MAX_LABELS);
  const rest = labels.length - shownLabels.length;
  const parts = rest > 0 ? [...shownLabels, rest + ' other field' + (rest === 1 ? '' : 's')] : shownLabels;
  const r = missed.rows;
  const noun = r ? ((GENERIC_ROWS.has(r.field) && TOOL_NOUNS[tool]) || NOUNS[r.field] || TOOL_NOUNS[tool] || 'rows') : '';
  const more = r ? (r.total - r.shown) + ' more ' + noun : '';
  if (parts.length && r) return 'This answer hid ' + _list(parts) + ', and ' + more + '.';
  if (parts.length) return 'This answer hid ' + _list(parts) + '.';
  return 'This answer showed ' + r.shown + ' of ' + r.total + ' ' + noun + '.';
}

/** Sentence two, without its link: the rung. Never a monthly price. */
export function rungSentence(rung) {
  switch (rung) {
    case 'free_key': return 'A free DC Hub key (claim_free_key, no email) returns them';
    case 'pack': return 'The plans that return them are listed behind the link';
    // v14 (owner 2026-10-10): the rung is described, never named.
    case 'developer': return 'They come with a paid DC Hub plan';
    case 'pro': return 'They come with the DC Hub plan that includes every tool';
    default: return null;
  }
}

/**
 * The whole thing: { missed, rung, text } or null. `text` is sentence one plus
 * sentence two ending in a period; a caller that carries a link appends it.
 */
export function missedUpgrade({ payload, maskedLog, opens, floor, tool, strict = false } = {}) {
  const missed = collectMissed(payload, maskedLog, { strict });
  if (!missed) return null;
  const rung = lowestRung({ opens, floor });
  const how = rungSentence(rung);
  const what = missedSentence(missed, tool);
  if (!rung || !how || !what) return null;
  return { missed, rung, what, how, text: what + ' ' + how + '.' };
}

// ── The relay line (→ **For your human:**) — owner-approved 2026-09-29 ──────
// The one line an agent relays verbatim to its human names what THIS answer
// hid and the lowest plan that returns it. Same evidence as missedUpgrade: the
// labels are the fields the gate stripped from this response, the plan is the
// rung computed from the gate predicates the call applied. Fields only: the row
// count stays the continuation experiment's treatment clause (lib/continuation),
// so the two arms still differ by exactly that. No monthly price; the only
// price named is the $10 pack, and nothing here calls the pack an unlock.
const RELAY_PLAN = Object.freeze({
  free_key: 'a free DC Hub key', pack: 'the one-time credit pack', developer: 'a paid DC Hub plan', pro: 'the DC Hub plan with every tool',
});
export function relayPlanName(rung) {
  return RELAY_PLAN[rung] || null;
}
/** "MW, scores and lease rate" from a missed object's labels, or null. */
export function hiddenFieldsPhrase(missed) {
  const labels = (missed && Array.isArray(missed.labels)) ? missed.labels : [];
  if (!labels.length) return null;
  const shown = labels.slice(0, labels.length === MAX_LABELS + 1 ? MAX_LABELS + 1 : MAX_LABELS);
  const rest = labels.length - shown.length;
  return _list(rest > 0 ? [...shown, rest + ' other field' + (rest === 1 ? '' : 's')] : shown);
}
/**
 * The relay line's clause: "this answer hid MW and scores; the lowest plan that
 * returns them is DC Hub Developer", or null when either half is unknown (the caller keeps its line).
 * Canon (Jonathan, 2026-10-04): the $10 pack is API capacity and is never named as the thing
 * that returns gated fields, for any tool. A pack rung points at the page that lists the plans.
 */
export const PLANLESS_WALL_COPY = 'The fields above are in a paid DC Hub plan; the page shows the options';
export function relayMissedClause(mu, opts = {}) {
  if (!mu) return null;
  const fields = hiddenFieldsPhrase(mu.missed);
  const plan = relayPlanName(mu.rung);
  if (!fields || !plan) return null;
  // Depth walls (owner 2026-10-08): no plan name, no price - the page behind the link shows the options.
  if (opts.planless) return 'this answer hid ' + fields + '; those fields are in a paid DC Hub plan, and the page shows the options';
  if (mu.rung === 'pack') return 'this answer hid ' + fields + '; the plans that return them are on the page behind the link';
  return 'this answer hid ' + fields + '; the lowest plan that returns them is ' + plan;
}
