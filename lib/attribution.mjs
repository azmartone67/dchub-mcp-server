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
const AS_OF_KEYS = new Set([
  'as_of', 'as_of_date', 'data_as_of', 'generated_at', 'updated_at',
  'last_updated', 'published_at', 'snapshot_date', 'effective_date',
]);

const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;          // tolerate clock skew
const MAX_AGE_MS     = 25 * 365 * 24 * 60 * 60 * 1000; // reject absurd epochs

function parseStamp(v) {
  if (typeof v !== 'string' || v.length < 4) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

// Generic bounded walker shared by every collector below.
function walk(root, visit) {
  let nodes = 0;
  const seen = new Set();
  const rec = (node, depth) => {
    if (node === null || typeof node !== 'object') return;
    if (depth > MAX_DEPTH || nodes > MAX_NODES) return;
    if (seen.has(node)) return;                 // cycle guard
    seen.add(node);
    nodes += 1;
    if (Array.isArray(node)) {
      for (const v of node) rec(v, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      visit(k, v, node, depth);
      rec(v, depth + 1);
    }
  };
  rec(root, 0);
}

// ── as_of ──────────────────────────────────────────────────────────────────
// Collect every plausible DATA timestamp in the payload. Returns [] when the
// payload carries none — the UNMEASURED case, which the caller must not paper
// over.
export function collectTimestamps(payload, now = Date.now()) {
  const out = [];
  try {
    walk(payload, (k, v) => {
      if (!AS_OF_KEYS.has(k)) return;
      const ms = parseStamp(v);
      if (ms === null) return;
      if (ms > now + FUTURE_SKEW_MS) return;    // implausible future — don't claim it
      if (ms < now - MAX_AGE_MS) return;        // implausible past
      out.push({ key: k, iso: new Date(ms).toISOString(), ms });
    });
  } catch (_) { /* fail soft — an empty list is the honest fallback */ }
  return out;
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

// ── gating / preview detection ─────────────────────────────────────────────
// Every marker the server actually emits when it withholds data. Sourced from
// the real trim paths in server.mjs (trimForTrial stamps `_<key>_total_in_pro`
// and `_<key>_in_pro`; the anon/cap/tease branches stamp `_upgrade`,
// `_upgrade_notice`, `_free_preview`; execute_plan step results carry
// `truncated:true`; gated steps carry status `gated_preview`).
const PREVIEW_NOTE_RE = /free[- ]tier|free preview|showing\s+\d+\s+of\s+\d+|sign up to unlock|upgrade for full/i;

export function detectGating(payload) {
  const withheld = new Set();
  const reasons  = new Set();
  let shown = null, total = null, biggestGap = 0;
  let unlockTool = null;

  try {
    walk(payload, (k, v, parent) => {
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
        withheld.add(base);
        reasons.add(`${base}: ${kept ?? '?'} of ${t} shown`);
        return;
      }
      // trimForTrial: `_<key>_in_pro: true` = this scalar field was nulled.
      m = /^_(.+)_in_(pro|developer|enterprise)$/.exec(k);
      if (m && v === true) { withheld.add(m[1]); reasons.add(`${m[1]} withheld`); return; }

      if (k === '_upgrade' || k === '_upgrade_notice') {
        reasons.add('upgrade CTA present');
        if (v && typeof v === 'object' && typeof v.next_tool === 'string') unlockTool = v.next_tool;
        return;
      }
      if (k === '_free_preview' && v) { reasons.add('free preview payload'); return; }
      if (k === 'truncated' && v === true) { reasons.add('step result truncated'); return; }
      if (k === 'status' && (v === 'gated_preview' || v === 'trial_taste')) {
        reasons.add(`step status ${v}`); return;
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
  if (shown !== null && total !== null) { g.shown = shown; g.total = total; }
  g.unlock_tool = unlockTool || 'unlock_more_data';
  return g;
}

// ── the block ──────────────────────────────────────────────────────────────
// `tier` is the CALLER's effective tier; only a tier that actually removes the
// gates lets us claim `unrestricted`, and only when no marker contradicts it.
const UNGATED_TIERS = new Set(['paid', 'enterprise', 'pro', 'developer', 'founding']);

export function buildProvenance(payload, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const retrievedAt = new Date(now).toISOString();
  const stamps = collectTimestamps(payload, now);
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
    prov.as_of = oldest.iso;
    prov.as_of_basis = stamps.length === 1
      ? `the single source timestamp in this response (${oldest.key})`
      : `OLDEST of ${stamps.length} source timestamps in this response — an answer is no fresher than its stalest input`;
    if (oldest.ms !== newest.ms) {
      prov.as_of_range = { oldest: oldest.iso, newest: newest.iso };
    }
  } else {
    // UNMEASURED. Explicitly null — never the serve time wearing a data hat.
    prov.as_of = null;
    prov.as_of_basis = 'UNMEASURED — this response carries no source timestamp. '
      + '`retrieved_at` is when DC Hub served it, NOT when the data was collected. '
      + 'Do not cite it as a data date.';
  }

  const vc = collectVerificationCounts(payload);
  if (vc) prov.verification_counts = vc;   // omitted entirely when unmeasured

  if (gating) {
    prov.completeness = 'partial_preview';
    prov.preview = gating;
    prov.preview_warning = 'PARTIAL RESPONSE — data was withheld by tier gating. '
      + 'Do not present this as a complete dataset; say what was shown out of what total.';
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
      ? ` — PARTIAL preview, ${g.shown} of ${g.total} shown`
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
  const citation = buildCitation(payload, opts, provenance);
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
function mergeProvenance(existing, derived) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return derived;
  const out = { ...derived, ...existing };       // backend's measured values win
  // …but a backend block with no as_of must still say so rather than go silent,
  // and a gated response must still carry its warning.
  if (existing.as_of === undefined || existing.as_of === null) {
    out.as_of = derived.as_of;
    out.as_of_basis = derived.as_of_basis;
  }
  if (existing.completeness === undefined) {
    out.completeness = derived.completeness;
    if (derived.preview) out.preview = derived.preview;
    if (derived.preview_warning) out.preview_warning = derived.preview_warning;
  }
  return out;
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
    if (!result || result.isError || !Array.isArray(result.content)) return result;

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
