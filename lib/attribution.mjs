// ── attribution: TOP-LEVEL citation + provenance on every envelope ─────────
//
// THE MEASUREMENT THIS ACTS ON (adoption shell, live probe 2026-08-12)
// A real keyless execute_plan against production returned an envelope whose
// top-level keys were:
//   _entity ok intent intent_class planner_version executed
//   _executed_total_in_pro minted totals replay answer_guide next_recipe
//   _source _upgrade
// No `citation`. No `provenance`. `cite_as` appeared ZERO times in the whole
// response. Two other probed surfaces each carried one or the other, never
// both. An agent composing an answer reads the TOP of the object — anything
// that requires walking a step tree is missed, and attribution that is missed
// never reaches the human.
//
// WHY THE EXISTING STAMPERS MISSED IT
// server.mjs already had withCitation + withProvenance, but both sit INSIDE
// the tool body, and that body exits early on a dozen preview/tease/wall
// branches (anon trim, anon daily cap, gate.capped, depth tease, paywall,
// monthly quota). Exactly the GATED responses — the ones that most need to say
// "this is 1 of N" — returned before the stamp. withProvenance additionally
// (and correctly) refuses to fabricate: it mirrors a backend `provenance` block
// and returns byte-identical when there is none, which for a composed
// execute_plan envelope is always.
//
// So this module stamps at the ONE point every return path has merged, and it
// DERIVES the block from what the response actually contains rather than
// stamping boilerplate.
//
// THE ANTI-INFLATION CONTRACT — the whole reason this file is careful:
// a generic citation stamped on every payload is WORSE than none, because it
// makes a provenance claim the data may not support. Therefore:
//   • as_of is only ever a timestamp READ OUT of this payload. When the payload
//     carries none, as_of is null and as_of_basis says UNMEASURED — never
//     today's date, never the serve time dressed up as a data date.
//   • verification_counts are only ever summed from REAL backend provenance
//     blocks found in the payload. None found → the key is OMITTED, not zeroed.
//     (A flattering zero is a bug — house rule, three-valued reporting.)
//   • completeness is three-valued: partial_preview / unrestricted / unknown.
//     We only say "unrestricted" when the caller's tier actually removes the
//     gates AND no gating marker is present. Otherwise "unknown" — we do not
//     know what the backend withheld upstream of us.
//   • a gated or preview response says so IN the citation an agent quotes, not
//     only in a side field it can skip.

export const ATTR_SOURCE  = 'DC Hub';
export const ATTR_URL     = 'https://dchub.cloud';
export const ATTR_LICENSE = 'CC-BY-4.0';
export const ATTR_CITE_AS = 'DC Hub, dchub.cloud';

// ── basis_class: CM-1 "provenance on every number" (envelope v1.1) ─────────
// The backend's provenance envelope stays provenance_version 1 and gains, as
// additive v1.1 fields, `basis_class` (how the figure came to be),
// `provenance_revision: "1.1"` and an optional per-field `fields` map
// ({name: {basis_class, source, as_of}}). This is the ONE place the enum
// lives; result-shaping and the tests import it from here.
//
// Same anti-inflation contract as as_of below: a class is only ever READ from
// a backend block. This server cannot tell a measured figure from an estimated
// one by looking at it, so when no backend block names a valid class the
// answer is "unknown", never a guess. A response with no source timestamp is
// "unknown" for the same reason (nothing upstream dated or classed it).
export const BASIS_CLASSES = Object.freeze([
  'measured', 'derived', 'estimated', 'published', 'cited', 'unknown',
]);
const _BASIS_SET = new Set(BASIS_CLASSES);
export const PROVENANCE_REVISION = '1.1';

export function isBasisClass(v) {
  return typeof v === 'string' && _BASIS_SET.has(v);
}

// ── envelope 1.2 vocabulary (G-2, 2026-10-06), READER SIDE ONLY ─────────────
// Nothing emits revision 1.2 yet and PROVENANCE_REVISION above stays '1.1'. The
// enum and both alias maps are pinned to canonical/provenance_envelope_1_2.json,
// a byte copy of dchub-backend routes/provenance_envelope_1_2.json (the sha256 is
// asserted on both sides). A backend block may state `basis` (1.2) beside the v1.1
// `basis_class`; when only `basis` is valid, the v1.1 class is its alias.
export const BASIS_12 = Object.freeze([
  'filed', 'stated', 'measured', 'derived', 'estimated', 'modelled', 'mixed', 'unknown',
]);
export const BASIS_12_TO_V11 = Object.freeze({
  filed: 'published', stated: 'cited', measured: 'measured', derived: 'derived',
  estimated: 'estimated', modelled: 'derived', mixed: 'unknown', unknown: 'unknown',
});
export function isBasis12(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(BASIS_12_TO_V11, v);
}
// The v1.1 class for a 1.2 basis, or null when it is not on the enum.
export function basisV11Alias(v) {
  return isBasis12(v) ? BASIS_12_TO_V11[v] : null;
}
// The class a backend block states: its v1.1 `basis_class`, else the alias of its
// 1.2 `basis`, else null. Never a guess.
function statedClass(block) {
  if (!block || typeof block !== 'object') return null;
  if (isBasisClass(block.basis_class)) return block.basis_class;
  return basisV11Alias(block.basis);
}

// Walk budget. execute_plan envelopes nest deeply (steps → results → rows);
// an unbounded walk on a pathological payload is a latency bug on the hot
// path. These caps are generous relative to real envelopes (~10KB) and make
// the walk O(1) in the worst case.
const MAX_NODES = 4000;
const MAX_DEPTH = 12;

// Keys that carry a DATA timestamp — when the underlying facts were current.
// `retrieved_at` / `served_at` are deliberately EXCLUDED: they describe when we
// answered, not when the data was true, and conflating the two is precisely the
// inflation this module exists to prevent.
//
// ★ SCOPE SPLIT (2026-08-28) — a collection-level `as_of` may only come from a
// COLLECTION-level timestamp. The two sets below are not stylistic; they are
// the difference between a dataset's vintage and one row's vintage.
//
// THE DEFECT THIS FIXES, measured live on `search_facilities` (authenticated,
// country=GB, limit=25): the backend correctly emits NO `as_of` for this
// surface — routes/provenance.py's own contract says "omit for live
// row-level-dated collections". Every returned row carried `last_updated`, so
// the walk below collected 25 per-RECORD dates and published the oldest as the
// COLLECTION's data date. That number is an artifact of the query, not of the
// data: the served SQL orders by `confidence DESC, power_mw DESC` — nothing to
// do with time — so the same registry answered 2026-01 for a GB slice and
// 2026-07 for an IE slice, and the value moves with `limit`/`offset`/filters
// on a corpus that did not change. Meanwhile the ingest layer really was
// running daily (/api/v1/ops/deadman), so the figure also defamed live data.
//
// Fixing the underlying column would NOT have fixed this. MIN-over-an-
// arbitrary-page is wrong in KIND, not in input: a per-record fact cannot be
// promoted to a collection claim by choosing a different row from the page.
// (Taking MAX instead would only hide it behind a fresher-looking number.)
//
// COLLECTION-scoped: describe a dataset or a feed. Admissible ANYWHERE,
// including inside an array — a composed `execute_plan` envelope carries one
// per step, and "no fresher than the stalest leg" is the right read there.
const COLLECTION_AS_OF_KEYS = new Set([
  'as_of', 'as_of_date', 'data_as_of', 'generated_at', 'snapshot_date',
]);

// RECORD-scoped: describe ONE row. Admissible ONLY outside an array element,
// where such a key genuinely describes the envelope/feed rather than a row.
// Inside a result array they are per-record dates and stay per-record.
const RECORD_AS_OF_KEYS = new Set([
  'updated_at', 'last_updated', 'published_at', 'effective_date',
]);

const AS_OF_KEYS = new Set([...COLLECTION_AS_OF_KEYS, ...RECORD_AS_OF_KEYS]);

const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;          // tolerate clock skew
const MAX_AGE_MS     = 25 * 365 * 24 * 60 * 60 * 1000; // reject absurd epochs

function parseStamp(v) {
  const i = parseStampInfo(v);
  return i ? i.ms : null;
}

// G-2 (2026-10-05): a source stamp with no zone is read as UTC so the result never depends on
// the server's timezone, but it is never DISPLAYED with an invented `Z`: the stamp keeps its
// zoneless spelling and the provenance block says `as_of_zone: "unstated"`. Hour-only stamps
// ("2026-10-03T16", the EIA period spelling) used to fail Date.parse and read as undated.
const _HOUR_ONLY = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/;
const _ZONELESS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
function parseStampInfo(v) {
  if (typeof v !== 'string' || v.length < 4) return null;
  const h = _HOUR_ONLY.exec(v);
  if (h) {
    const ms = Date.parse(`${h[1]}T${h[2]}:00:00Z`);
    return Number.isFinite(ms) ? { ms, zoneless: true } : null;
  }
  if (_ZONELESS.test(v)) {
    const ms = Date.parse(v.replace(' ', 'T') + 'Z');
    return Number.isFinite(ms) ? { ms, zoneless: true } : null;
  }
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  return { ms, zoneless: false };
}
// How a stamp is shown: stated zones print as UTC ISO; zoneless ones drop the Z we would invent.
const _show = (s) => (s.zoneless ? s.iso.replace(/\.000Z$/, '').replace(/Z$/, '') : s.iso);

// Generic bounded walker shared by every collector below.
// `inRecord` is true once the walk has descended into an ARRAY ELEMENT — i.e.
// the visited key belongs to one row of a collection, not to the collection.
// Only the as_of collector consults it; the other visitors ignore the argument.
function walk(root, visit) {
  let nodes = 0;
  const seen = new Set();
  const rec = (node, depth, inRecord) => {
    if (node === null || typeof node !== 'object') return;
    if (depth > MAX_DEPTH || nodes > MAX_NODES) return;
    if (seen.has(node)) return;                 // cycle guard
    seen.add(node);
    nodes += 1;
    if (Array.isArray(node)) {
      for (const v of node) rec(v, depth + 1, true);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      visit(k, v, node, depth, inRecord);
      rec(v, depth + 1, inRecord);
    }
  };
  rec(root, 0, false);
}

// ── as_of ──────────────────────────────────────────────────────────────────
// Collect every plausible COLLECTION-level DATA timestamp in the payload, and
// separately count the per-RECORD ones we deliberately declined to promote.
// Returns { stamps: [], suppressed: [...] } when the payload carries no
// collection date — the UNMEASURED case, which the caller must not paper over.
// `suppressed` exists so the basis can say WHICH kind of nothing this is: a
// response with no dates at all and a response whose dates are all per-record
// are both UNMEASURED, but for different reasons an agent should be told apart.
function collectStamps(payload, now = Date.now()) {
  const stamps = [];
  const suppressed = new Set();
  try {
    walk(payload, (k, v, _parent, _depth, inRecord) => {
      if (!AS_OF_KEYS.has(k)) return;
      const info = parseStampInfo(v);
      if (info === null) return;
      const ms = info.ms;
      if (ms > now + FUTURE_SKEW_MS) return;    // implausible future — don't claim it
      if (ms < now - MAX_AGE_MS) return;        // implausible past
      // A record-scoped key inside an array element dates ONE ROW. Promoting it
      // to the collection would make `as_of` a function of which rows this page
      // happened to return — see the SCOPE SPLIT note above.
      if (inRecord && !COLLECTION_AS_OF_KEYS.has(k)) { suppressed.add(k); return; }
      stamps.push({ key: k, iso: new Date(ms).toISOString(), ms, zoneless: info.zoneless });
    });
  } catch (_) { /* fail soft — an empty list is the honest fallback */ }
  return { stamps, suppressed: [...suppressed] };
}

// Public shape unchanged (an array of admissible stamps) — callers that only
// need the timestamps keep working.
export function collectTimestamps(payload, now = Date.now()) {
  return collectStamps(payload, now).stamps;
}

// ── verification counts ────────────────────────────────────────────────────
// Only ever read from a REAL backend `provenance.verification_counts` block.
// Returns null when none exists anywhere in the payload.
export function collectVerificationCounts(payload) {
  let verified = 0, tracked = 0, blocks = 0;
  try {
    walk(payload, (k, v) => {
      if (k !== 'provenance' || !v || typeof v !== 'object' || Array.isArray(v)) return;
      const vc = v.verification_counts;
      if (!vc || typeof vc !== 'object' || Array.isArray(vc)) return;
      const nv = Number(vc.verified), nt = Number(vc.tracked);
      if (!Number.isFinite(nv) && !Number.isFinite(nt)) return;
      blocks += 1;
      if (Number.isFinite(nv)) verified += nv;
      if (Number.isFinite(nt)) tracked += nt;
    });
  } catch (_) { return null; }
  if (!blocks) return null;                     // OMIT, never zero-fill
  return { verified, tracked, _summed_from_blocks: blocks };
}

// ── basis_class derivation ─────────────────────────────────────────────────
// Read every VALID basis_class carried by a backend `provenance` block in the
// payload (an execute_plan envelope carries one per step). One class across
// all of them → that class. None, or blocks that disagree → "unknown": a
// composed answer whose legs were measured and estimated is not "measured",
// and picking one leg's class would overstate the rest.
export function deriveBasisClass(payload) {
  const seen = new Set();
  try {
    walk(payload, (k, v) => {
      if (k !== 'provenance' || !v || typeof v !== 'object' || Array.isArray(v)) return;
      const c = statedClass(v);
      if (c) seen.add(c);
    });
  } catch (_) { /* fail soft: "unknown" is the honest fallback */ }
  if (seen.size === 1) {
    const only = [...seen][0];
    return { basis_class: only, basis: `read from the backend provenance block (${only})` };
  }
  if (seen.size > 1) {
    return { basis_class: 'unknown',
      basis: `backend blocks in this response disagree (${[...seen].sort().join(', ')}), so no single class applies` };
  }
  return { basis_class: 'unknown',
    basis: 'no backend provenance block in this response names a basis class; this server does not guess one' };
}

// Per-field map from a backend block: keep every entry, but an entry whose
// class is not in the enum reads "unknown". source/as_of pass through as sent;
// nothing is filled in here, so no as_of is ever invented for a field.
function normalizeFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const out = {};
  for (const [name, f] of Object.entries(fields)) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
    const bc = statedClass(f) || 'unknown';
    const entry = bc === f.basis_class ? { ...f } : { ...f, basis_class: bc };
    if (entry.basis !== undefined && !isBasis12(entry.basis)) entry.basis = 'unknown';
    out[name] = entry;
  }
  return out;
}

// ── gating / preview detection ─────────────────────────────────────────────
// Every marker the server actually emits when it withholds data. Sourced from
// the real trim paths in server.mjs (trimForTrial stamps `_<key>_total_in_pro`
// and `_<key>_in_pro`; the anon/cap/tease branches stamp `_upgrade`,
// `_upgrade_notice`, `_free_preview`; execute_plan step results carry
// `truncated:true`; gated steps carry status `gated_preview`).
//
// ★ 2026-08-12, found by LIVE probe after the first deploy — not by the tests.
// A real keyless analyze_site came back with completeness "unknown" while its
// own envelope said `preview_is_partial: true`, `trial_preview`, `locked` and
// `upgrade`. The detector only knew the UNDERSCORED `_upgrade` form emitted by
// trimForTrial, so the whole PAYWALL/TRIAL-PREVIEW family — which uses bare
// keys — read as ungated. "unknown" is not a false claim, so nothing was
// fabricated, but a 1-of-N preview that declines to say it is one is exactly
// the under-reporting requirement 4 exists to prevent. These are the bare-key
// markers that family actually emits.
const PREVIEW_NOTE_RE = /free[- ]tier|free preview|showing\s+\d+\s+of\s+\d+|sign up to unlock|upgrade for full/i;
// Bare (non-underscored) markers from the paywall / trial-preview branches.
const BARE_PREVIEW_FLAGS = new Set(['preview_is_partial', 'trial_preview', 'trial_taste']);

// ── r-cta-is-not-withholding (2026-08-28) ──────────────────────────────────
// Two of the markers below prove NOTHING was withheld — they only prove a CTA
// was printed. `upgrade CTA present` and `free-tier note` ride on almost every
// free-tier response, INCLUDING ones served whole. Counting them as gating made
// `preview_warning` assert "data was withheld by tier gating" over an envelope
// whose own `withheld_fields` was `[]`. Observed live 2026-08-28 on
// search_facilities: 25 rows returned, nothing trimmed, reasons
// ['upgrade CTA present', 'free-tier note'], withheld_fields [] — and the
// warning still told the agent to distrust the completeness of a complete
// answer. An honesty block that cries partial on a full response is the same
// class of defect as one that stays silent on a trimmed one: both teach the
// reader to ignore it. So: keep detecting these (the `reasons` list is honest
// and useful), but only let PROVEN withholding raise the partial claim.
const _PROOFLESS_REASONS = new Set(['upgrade CTA present', 'free-tier note']);

// DCHUB_PAID_SELL_LINE (owner 2026-10-04, default OFF): the gate's own records total at the
// top of the payload outranks a nested one, and a row-capped total reads "at least". Fiber
// showed "3 of 884 shown": 884 was one route's vertex count, not the route total.
export function _citeFixOn() {
  return /^(1|true|yes|on)$/i.test(String(process.env.DCHUB_PAID_SELL_LINE || ''));
}

export function detectGating(payload) {
  const fix = _citeFixOn();
  let top = null;
  const withheld = new Set();
  const reasons  = new Set();
  let shown = null, total = null, biggestGap = 0;
  let unlockTool = null;
  // 2026-09-25 (live verify, site_selection_canvas on a free key): what KIND
  // of gating this is, so cite_as can say which part is gated instead of
  // "not the full dataset" over a shortlist whose rows are all there.
  let layerLocked = false, structural = false;

  try {
    walk(payload, (k, v, parent, depth) => {
      // trimForTrial: `_<key>_total_in_pro` = the honest total behind the gate,
      // with parent[key] holding the single teaser row that was kept.
      let m = /^_(.+)_total_in_(pro|developer|enterprise)$/.exec(k);
      if (m && Number.isFinite(Number(v))) {
        const base = m[1];
        const kept = Array.isArray(parent?.[base]) ? parent[base].length : null;
        const t = Number(v);
        if (t - (kept ?? 0) > biggestGap) {
          biggestGap = t - (kept ?? 0);
          shown = kept; total = t;
        }
        if (fix && depth === 0 && (!top || t - (kept ?? 0) > top.total - top.shown)) top = { base, shown: kept ?? 0, total: t };
        withheld.add(base);
        reasons.add(`${base}: ${kept ?? '?'} of ${t} shown`);
        return;
      }
      // trimForTrial: `_<key>_in_pro: true` = this scalar field was nulled.
      m = /^_(.+)_in_(pro|developer|enterprise)$/.exec(k);
      if (m && v === true) { withheld.add(m[1]); reasons.add(`${m[1]} withheld`); return; }

      if (k === '_upgrade' || k === '_upgrade_notice' || k === 'upgrade') {
        // `upgrade` (bare) is the paywall/trial-preview branch; `_upgrade` is
        // trimForTrial's. Only count the bare one when it is a real CTA object,
        // so a payload with an unrelated scalar `upgrade` is not miscounted.
        if (k === 'upgrade' && !(v && typeof v === 'object' && !Array.isArray(v))) return;
        reasons.add('upgrade CTA present');
        if (v && typeof v === 'object' && typeof v.next_tool === 'string') unlockTool = v.next_tool;
        return;
      }
      if (BARE_PREVIEW_FLAGS.has(k) && v) { reasons.add(`${k} flag set`); structural = true; return; }
      // `locked` names what the tier withheld — an array/object of locked
      // fields or tools. An empty one means nothing was locked, so require
      // it to be non-empty rather than merely present.
      if (k === 'locked' && v && typeof v === 'object') {
        const n = Array.isArray(v) ? v.length : Object.keys(v).length;
        if (n > 0) { reasons.add(`${n} locked field(s)`); structural = true; }
        return;
      }
      // `locked: true` on a layer (site_selection_canvas `synthesis`): the
      // decision layer is gated; the rows beside it are not by this marker.
      if (k === 'locked' && v === true) { reasons.add('decision layer locked'); layerLocked = true; return; }
      if (k === '_free_preview' && v) { reasons.add('free preview payload'); structural = true; return; }
      if (k === 'truncated' && v === true) { reasons.add('step result truncated'); structural = true; return; }
      if (k === 'status' && (v === 'gated_preview' || v === 'trial_taste')) {
        reasons.add(`step status ${v}`); structural = true; return;
      }
      if ((k === 'note' || k === '_note' || k === 'message')
          && typeof v === 'string' && PREVIEW_NOTE_RE.test(v)) {
        reasons.add('free-tier note'); return;
      }
    });
  } catch (_) { return null; }

  if (!reasons.size) return null;
  const g = {
    reasons: [...reasons].slice(0, 8),
    withheld_fields: [...withheld].slice(0, 12),
  };
  if (fix && top) { shown = top.shown; total = top.total; }
  if (shown !== null && total !== null) { g.shown = shown; g.total = total; }
  if (fix && top && top.base === 'features' && payload && payload._truncated === true) { g.at_least = true; g.noun = 'routes'; }
  // TRUE only when a marker actually evidenced an absence: a named withheld
  // field, a shown-of-total gap, or a structural preview/locked/truncated flag.
  // A bare upgrade CTA or free-tier note does not qualify — see the block above.
  g.withholding_proven = withheld.size > 0
    || (shown !== null && total !== null && total > shown)
    || [...reasons].some((r) => !_PROOFLESS_REASONS.has(r));
  g.unlock_tool = unlockTool || 'unlock_more_data';
  // Which part is gated, when that is all of it: no row-count gap and no
  // structural preview/truncation flag. null = the generic partial.
  const noGap = !(shown !== null && total !== null && total > shown);
  if (noGap && !structural) {
    if (layerLocked && !withheld.size) g.scope = 'decision_layer';
    else if (withheld.size) g.scope = layerLocked ? 'row_fields_and_decision_layer' : 'row_fields';
  }
  return g;
}

// ── the block ──────────────────────────────────────────────────────────────
// `tier` is the CALLER's effective tier; only a tier that actually removes the
// gates lets us claim `unrestricted`, and only when no marker contradicts it.
const UNGATED_TIERS = new Set(['paid', 'enterprise', 'pro', 'developer', 'founding']);

export function buildProvenance(payload, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const retrievedAt = new Date(now).toISOString();
  const { stamps, suppressed } = collectStamps(payload, now);
  const gating = detectGating(payload);

  const prov = {
    source: ATTR_SOURCE,
    url: ATTR_URL,
    license: ATTR_LICENSE,
    cite_as: ATTR_CITE_AS,
    retrieved_at: retrievedAt,
  };

  if (stamps.length) {
    // An answer is no fresher than its stalest input, so the BINDING as_of is
    // the oldest source timestamp — not the newest, which would flatter a
    // composed envelope whose oldest leg is months old.
    let oldest = stamps[0], newest = stamps[0];
    for (const s of stamps) {
      if (s.ms < oldest.ms) oldest = s;
      if (s.ms > newest.ms) newest = s;
    }
    prov.as_of = _show(oldest);
    if (oldest.zoneless) prov.as_of_zone = 'unstated';
    prov.as_of_basis = stamps.length === 1
      ? `the single source timestamp in this response (${oldest.key})`
      : `OLDEST of ${stamps.length} source timestamps in this response — an answer is no fresher than its stalest input`;
    if (oldest.ms !== newest.ms) {
      prov.as_of_range = { oldest: _show(oldest), newest: _show(newest) };
    }
  } else if (suppressed.length) {
    // UNMEASURED, but not empty-handed: the payload DOES carry dates, they are
    // just per-record. Say so, name the field, and point at the surface that
    // does answer "when was this corpus last rebuilt" — never synthesise a
    // collection date out of row dates (neither the oldest nor the newest).
    prov.as_of = null;
    prov.as_of_record_fields = suppressed;
    prov.as_of_basis = 'UNMEASURED at collection level — this response carries only '
      + `PER-RECORD dates (${suppressed.join(', ')}), which date individual rows, not `
      + 'the dataset. Which rows came back depends on your filters, limit and offset, '
      + 'so no value derived from them (oldest OR newest) is this collection\'s vintage. '
      + 'Cite the per-record field on the row you are citing; for when the corpus itself '
      + 'was last rebuilt, read https://dchub.cloud/api/v1/ops/deadman. `retrieved_at` is '
      + 'when DC Hub served this, NOT when the data was collected.';
  } else {
    // UNMEASURED. Explicitly null — never the serve time wearing a data hat.
    prov.as_of = null;
    prov.as_of_basis = 'UNMEASURED — this response carries no source timestamp. '
      + '`retrieved_at` is when DC Hub served it, NOT when the data was collected. '
      + 'Do not cite it as a data date.';
  }

  // basis_class (CM-1): read from backend blocks, else "unknown". Never
  // upgraded from the presence of an as_of: a dated figure can still be an
  // estimate.
  const basis = deriveBasisClass(payload);
  prov.basis_class = basis.basis_class;
  prov.basis_class_basis = basis.basis;
  prov.provenance_revision = PROVENANCE_REVISION;

  // No summed verification_counts (owner decision 2026-09-28): agents quoted
  // the pair as the withdrawn facility count. collectVerificationCounts stays
  // exported for tests; server.mjs also strips any backend copy
  // (lib/verification-counts.mjs).

  if (gating && gating.withholding_proven) {
    prov.completeness = 'partial_preview';
    prov.preview = gating;
    prov.preview_warning = 'PARTIAL RESPONSE — data was withheld by tier gating. '
      + 'Do not present this as a complete dataset; say what was shown out of what total.';
  } else if (gating) {
    // CTA/note markers only, nothing measurably withheld (r-cta-is-not-withholding).
    // The preview block still ships — `reasons` is true and worth reading — but we
    // do NOT assert a withholding that this envelope contains no evidence of.
    prov.preview = gating;
    prov.completeness = UNGATED_TIERS.has(String(opts.tier || '').toLowerCase())
      ? 'unrestricted' : 'unknown';
    prov.completeness_basis = 'this response carries an upgrade CTA / free-tier note '
      + 'but NO evidence of withholding (no named withheld field, no shown-of-total gap) '
      + '— the CTA alone does not establish that anything was removed.';
  } else if (UNGATED_TIERS.has(String(opts.tier || '').toLowerCase())) {
    prov.completeness = 'unrestricted';
  } else {
    prov.completeness = 'unknown';
    prov.completeness_basis = 'no gating marker in this response, and the caller tier '
      + 'does not by itself guarantee full depth — treat coverage as unverified.';
  }

  if (opts.toolName) prov.tool = opts.toolName;
  return prov;
}

// ── citation ───────────────────────────────────────────────────────────────
// SHAPE DECISION: always an OBJECT. See the module header in server.mjs and
// the report — the string arm stays ACCEPTED on input (and its text is
// preserved verbatim as cite_as) but is never what we EMIT.
export function buildCitation(payload, opts = {}, prov = null) {
  const p = prov || buildProvenance(payload, opts);
  const cite = {
    source: ATTR_SOURCE,
    url: ATTR_URL,
    license: ATTR_LICENSE,
    retrieved_at: p.retrieved_at,
  };
  // cite_as is the line an agent actually quotes, so the honesty has to live
  // IN it — a caveat parked in a sibling field is a caveat that gets dropped.
  let s = ATTR_CITE_AS;
  if (p.completeness === 'partial_preview') {
    const g = p.preview || {};
    s += (g.shown !== undefined && g.total !== undefined)
      ? ` — PARTIAL preview, ${g.shown} of ${g.at_least ? 'at least ' : ''}${g.total}${g.noun ? ' ' + g.noun : ''} shown`
      : g.scope === 'decision_layer'
        ? ' — PARTIAL: every row shown; the decision layer is tier-gated'
        : g.scope === 'row_fields_and_decision_layer'
          ? ' — PARTIAL: every row shown; some row fields and the decision layer are tier-gated'
          : g.scope === 'row_fields'
            ? ' — PARTIAL: every row shown; some row fields are tier-gated'
            : ' — PARTIAL preview (tier-gated; not the full dataset)';
  }
  if (p.as_of) s += ` (as of ${String(p.as_of).slice(0, 10)})`;
  cite.cite_as = s;
  cite.completeness = p.completeness;
  if (p.as_of) cite.as_of = p.as_of;
  return cite;
}

export function attributionFor(payload, opts = {}) {
  const provenance = buildProvenance(payload, opts);
  // The citation is what an agent quotes. When the backend says the collection date is
  // UNMEASURED, the derived date (read off a payload field that may be a load date) must not
  // date the answer there either; mergeProvenance applies the same rule to the block.
  const citeFrom = backendSaysUnmeasured(payload && payload.provenance)
    ? { ...provenance, as_of: null } : provenance;
  const citation = buildCitation(payload, opts, citeFrom);
  return { citation, provenance };
}

// ── the stamp ──────────────────────────────────────────────────────────────
// Applies to BOTH channels an agent might read: the JSON in content[0].text
// (what most clients parse) and structuredContent (what schema-aware clients
// treat as THE result). Additive, idempotent, never throws, never empties a
// response — attribution must NEVER break a tool result.
//
// A REAL backend provenance block wins: we only FILL what it is missing
// (as_of / completeness), never overwrite its measured values.
// G-2: a backend block that states as_of null AND its own as_of_basis is saying the collection
// date is UNMEASURED on purpose (a load date is not a data date). Null alone is not that.
function backendSaysUnmeasured(block) {
  return !!block && typeof block === 'object' && !Array.isArray(block)
    && block.as_of === null && typeof block.as_of_basis === 'string' && block.as_of_basis.trim() !== '';
}

export function mergeProvenance(existing, derived) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return derived;
  const out = { ...derived, ...existing };       // backend's measured values win
  // …but a backend block with no as_of must still say so rather than go silent,
  // and a gated response must still carry its warning.
  // G-2: …except when the backend says, in so many words, that the collection date is
  // UNMEASURED (as_of null AND its own as_of_basis). The payload's top-level `as_of` can be a
  // load date (interconnection queue: today's ingest over a report dated two months earlier),
  // and re-deriving from it is how the citation came to quote the load date as a data date.
  // The backend's null and its reason stand; the derived range/zone describe stamps this
  // server saw, not the collection, so they go with the derived date.
  if (backendSaysUnmeasured(existing)) {
    out.as_of = null;
    delete out.as_of_range;
    if (existing.as_of_zone === undefined) delete out.as_of_zone;
  } else if (existing.as_of === undefined || existing.as_of === null) {
    out.as_of = derived.as_of;
    out.as_of_basis = derived.as_of_basis;
  }
  // The backend's as_of is a HEADLINE reading (e.g. the demand hour). When this server also
  // saw older stamps, the derived as_of_basis ("OLDEST of N") and as_of_range describe a
  // different instant than the as_of that won — a contradiction inside one block. Say which
  // is which. The citation keeps the oldest (conservative) date.
  if (existing.as_of !== undefined && existing.as_of !== null && derived.as_of
      && existing.as_of_basis === undefined) {
    const a = parseStamp(String(existing.as_of)), b = parseStamp(String(derived.as_of));
    if (a !== null && b !== null && a !== b) {
      out.as_of_basis = 'as_of is the backend-stated headline reading; this response also carries '
        + `OLDER inputs (oldest ${derived.as_of}, see as_of_range) — the citation uses the oldest, `
        + 'so cite per-layer as_of values for anything older than the headline.';
    }
  }
  if (existing.completeness === undefined) {
    out.completeness = derived.completeness;
    if (derived.preview) out.preview = derived.preview;
    if (derived.preview_warning) out.preview_warning = derived.preview_warning;
  }
  // CM-1: a valid backend class wins as-is. A missing or off-enum one (e.g.
  // "guess") is replaced by the derived class, and the value we declined is
  // named so the replacement is visible rather than silent.
  // G-2: a backend that states only the 1.2 `basis` gets its v1.1 alias as the class. An
  // off-enum `basis` is replaced by 'unknown' and the declined value is named.
  const viaBasis = basisV11Alias(existing.basis);
  if (!isBasisClass(existing.basis_class) && viaBasis) {
    out.basis_class = viaBasis;
    if (existing.basis_class_basis === undefined) {
      out.basis_class_basis = `read from the backend 1.2 basis (${existing.basis})`;
    }
    if (existing.basis_class !== undefined && existing.basis_class !== null) {
      out.basis_class_rejected = String(existing.basis_class).slice(0, 40);
    }
  } else if (!isBasisClass(existing.basis_class)) {
    out.basis_class = derived.basis_class;
    out.basis_class_basis = derived.basis_class_basis;
    if (existing.basis_class !== undefined && existing.basis_class !== null) {
      out.basis_class_rejected = String(existing.basis_class).slice(0, 40);
    }
  } else if (existing.basis_class_basis === undefined) {
    out.basis_class_basis = viaBasis && viaBasis !== existing.basis_class
      ? 'backend basis_class and basis disagree; basis_class kept'
      : 'read from the backend provenance block';
  }
  if (existing.basis !== undefined && existing.basis !== null && !isBasis12(existing.basis)) {
    out.basis = 'unknown';
    out.basis_rejected = String(existing.basis).slice(0, 40);
  }
  if (typeof out.provenance_revision !== 'string' || !out.provenance_revision) {
    out.provenance_revision = PROVENANCE_REVISION;
  }
  // source must be a non-empty string: an empty or non-string backend value
  // falls back to this server's attribution source.
  if (typeof out.source !== 'string' || !out.source.trim()) out.source = derived.source;
  if (existing.fields !== undefined) {
    const f = normalizeFields(existing.fields);
    if (f) out.fields = f; else delete out.fields;
  }
  return out;
}

// ── isError results (CM-1) ─────────────────────────────────────────────────
// An error, wall or auth_required result still says where it came from. Only
// structuredContent is touched; the error text an agent reads in content[]
// stays byte-identical. When the handler set no structuredContent, the one
// we mint MIRRORS the error (the JSON payload, or the text as `error`) so a
// client that prefers structuredContent still sees the failure, not a
// metadata-only object that hides it.
function stampErrorProvenance(result, opts) {
  const sc = (result.structuredContent && typeof result.structuredContent === 'object'
              && !Array.isArray(result.structuredContent)) ? result.structuredContent : null;
  let base = sc;
  if (!base) {
    let text = null;
    for (const it of result.content) {
      if (typeof it?.text !== 'string') continue;
      if (it.text.trim().startsWith('{')) {
        try {
          const o = JSON.parse(it.text);
          if (o && typeof o === 'object' && !Array.isArray(o)) { base = { ...o }; break; }
        } catch (_) { /* fall through to text */ }
      }
      if (text === null && it.text.trim()) text = it.text;
    }
    if (!base) base = { error: text || 'error' };
  }
  // tier is withheld on purpose: an error is not an "unrestricted" answer,
  // whatever the caller's plan.
  const { provenance } = attributionFor(base, { ...opts, tier: null });
  return { ...result, structuredContent: { ...base, provenance: mergeProvenance(base.provenance, provenance) } };
}

// Coerce any inbound citation to the emitted OBJECT shape, preserving real
// upstream attribution text as cite_as (back-compat with the string arm).
function reconcileCitation(existing, derived) {
  if (typeof existing === 'string' && existing.trim()) {
    return { ...derived, cite_as: existing.trim(), _normalized_from: 'string' };
  }
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    // Keep the producer's fields, but never let a bare upstream object drop the
    // completeness signal this response actually warrants.
    const out = { ...derived, ...existing };
    if (existing.completeness === undefined) out.completeness = derived.completeness;
    if (derived.completeness === 'partial_preview'
        && typeof out.cite_as === 'string'
        && !/PARTIAL/i.test(out.cite_as)) {
      out.cite_as = derived.cite_as;             // honesty beats upstream wording
    }
    return out;
  }
  return derived;
}

export function stampEnvelopeAttribution(result, opts = {}) {
  try {
    if (!result || !Array.isArray(result.content)) return result;
    if (result.isError) return stampErrorProvenance(result, opts);

    // Derive from the richest view of the payload available.
    let payload = null;
    const sc = (result.structuredContent && typeof result.structuredContent === 'object'
                && !Array.isArray(result.structuredContent)) ? result.structuredContent : null;
    let firstIdx = -1, firstObj = null;
    for (let i = 0; i < result.content.length; i += 1) {
      const it = result.content[i];
      if (typeof it?.text === 'string' && it.text.trim().startsWith('{')) {
        try {
          const o = JSON.parse(it.text);
          if (o && typeof o === 'object' && !Array.isArray(o)) { firstIdx = i; firstObj = o; }
        } catch (_) { /* not JSON → leave intact */ }
        break;
      }
    }
    payload = firstObj || sc;
    if (!payload) return result;                 // nothing to describe — stay out

    const { citation, provenance } = attributionFor(payload, opts);

    let out = result;

    // (1) content[0] JSON — the surface nearly every client parses.
    if (firstIdx >= 0 && firstObj) {
      const merged = { ...firstObj };
      merged.citation   = reconcileCitation(firstObj.citation, citation);
      merged.provenance = mergeProvenance(firstObj.provenance, provenance);
      const content = result.content.slice();
      content[firstIdx] = { ...content[firstIdx], text: JSON.stringify(merged) };
      out = { ...out, content };
    }

    // (2) structuredContent — THE result for schema-aware clients.
    if (sc) {
      out = { ...out, structuredContent: {
        ...sc,
        citation:   reconcileCitation(sc.citation, citation),
        provenance: mergeProvenance(sc.provenance, provenance),
      } };
    }
    return out;
  } catch (_) {
    return result;                               // never break a response
  }
}
