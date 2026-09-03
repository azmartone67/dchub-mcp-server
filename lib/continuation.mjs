// continuation.mjs — the structured continuation object, and the ONE human
// line's content.  (r-continuation, 2026-09-03)
//
// ═══ WHY THIS EXISTS, and what the evidence actually says ═══
//
// The gated response has always carried a human link. It has never worked:
//
//   · 2026-07-03  agent-relay claim funnel:  0/36 paid in 30d, 3 humans ever opened
//   · 2026-08-15  human line hoisted to position 0 (theory: trailing lines die
//                 to summarization)
//   · 2026-08-26  that theory tested at n=5,704 over 11 days:
//                 5,704 paywall signals -> 1 real handoff open -> 0 converted.
//                 Placement reverted to trailing; DATA leads.
//
// So PLACEMENT has now been measured in both positions and is not the variable.
// What has never been varied is the line's CONTENT. Read it as it shipped:
//
//     "open <url> — see what your agent found and how to unlock it."
//
// There is nothing in that sentence a model cannot paraphrase without loss,
// because it carries no information — no number, no field name, nothing about
// THIS query. An agent compressing its final answer drops it for exactly the
// reason it should: it is the least informative sentence in the envelope. The
// verbatim-relay instruction asks the agent to preserve a line that has nothing
// in it to preserve.
//
// This module makes the line carry the specifics the gate already knows: how
// many rows are behind the wall FOR THIS QUERY, and which fields they are.
// "5 of 47 grid_capacity rows" survives summarization because dropping it loses
// something. That is the whole hypothesis, and it is falsifiable — see
// `specificity` in the signal payload, which records per response whether the
// line went out with specifics or without.
//
// ═══ THE RULE: NEVER INVENT A NUMBER ═══
//
// Every quantity here comes from a locked count the gate actually computed
// (the `*_total_in_developer` family). When those are absent this module
// returns `null` and the caller keeps the generic copy verbatim. A degraded
// line is a smaller loss than a confident wrong one — a human who opens on
// "47 rows" and finds 3 does not come back, and neither does their agent.
//
// ★ NOT EMITTED: `estimated_tool_calls_saved`.
//   The original proposal for this work wanted the gate to advertise how many
//   web searches DC Hub replaces. Nothing here can source that. The planner's
//   `estimated_calls` is the cost of a DC HUB plan (how many of our calls a
//   plan spends), not a count of avoided external retrievals — using it would
//   mean publishing one measurement under another's name, which is the failure
//   this repo keeps writing guards about. It is omitted rather than
//   approximated. If a real basis is ever measured, add it here with its basis
//   string and nowhere else.

/** Longest field name we will put in a human-facing sentence. */
const FIELD_LABEL_MAX = 40;
/** Field names to name explicitly in the prose before falling back to a count. */
const FIELDS_IN_PROSE = 2;

const _isPosInt = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n === Math.floor(n);

/** A field name safe to print: snake/kebab identifiers only, length-capped. */
function cleanField(f) {
  if (typeof f !== 'string') return null;
  const s = f.trim();
  if (!s || s.length > FIELD_LABEL_MAX) return null;
  return /^[A-Za-z0-9_.-]+$/.test(s) ? s : null;
}

export function cleanFields(fields) {
  if (!Array.isArray(fields)) return [];
  const out = [];
  for (const f of fields) {
    const c = cleanField(f);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * The structured continuation object (machine-readable half).
 *
 * Replaces "you were refused" with "here is what continuing returns", so an
 * agent has something to reason about and something worth repeating. Every
 * field is optional-by-absence: a caller that knows less emits less, and a
 * consumer must treat a missing key as unknown, never as zero.
 *
 * `next_action.url` points at /continue (the human-readable renderer shipped in
 * dchub-frontend) carrying the same figures as query params. The PROSE line
 * deliberately keeps whatever URL the caller was already using — /relay/<token>
 * today. Swapping the prose link to a page with no conversion history, in the
 * same change that alters the line's content, would confound the one experiment
 * this module exists to run.
 */
export function buildContinuation({
  tool, tier, shown, total, field, fields, humanUrl, continueUrl, sessionId,
} = {}) {
  const t = cleanField(tool);
  if (!t) return null;

  const fs = cleanFields(fields);
  const gated = { tool: t };
  if (_isPosInt(total)) gated.records_available = total;
  if (_isPosInt(shown)) gated.records_shown = shown;
  const fld = cleanField(field);
  if (fld) gated.records_field = fld;
  if (fs.length) gated.fields_unlocked = fs;

  const out = {
    status: 'upgrade_required',
    // The half already delivered is the point: a human who can see value
    // received reads the rest as an offer, not a toll.
    answer_available: true,
    tier: typeof tier === 'string' && tier ? tier : 'free',
    gated,
    // Named so a consumer can tell a quantified continuation from a bare one
    // without re-deriving it — and so the funnel can count them separately.
    specificity: (gated.records_available || gated.fields_unlocked) ? 'quantified' : 'generic',
  };

  const actions = [];
  if (humanUrl) actions.push({ type: 'human_authorization', url: humanUrl });
  if (continueUrl) actions.push({ type: 'human_review', url: continueUrl });
  actions.push({ type: 'agent_autonomous', how: 'mpp_pay / mpp_credential, or claim_free_key for the free tier' });
  out.continuations = actions;
  if (sessionId) out.session_id = sessionId;
  return out;
}

/**
 * The /continue link. Params match the contract published on that page and
 * fenced by dchub-frontend's Guard 19 — extend both together or neither.
 */
export function buildContinueUrl({ base = 'https://dchub.cloud/continue', tool, shown, total, field, fields, agent } = {}) {
  const t = cleanField(tool);
  if (!t) return null;
  const p = new URLSearchParams({ tool: t });
  if (_isPosInt(total)) p.set('records', String(total));
  const fs = cleanFields(fields);
  if (fs.length) p.set('fields', fs.join(','));
  if (typeof agent === 'string' && /^[A-Za-z0-9 ._-]{1,40}$/.test(agent)) p.set('agent', agent);
  // `need` is the one prose param we can fill honestly from what the gate knows.
  const need = describeLocked({ shown, total, field, fields, markdown: false });
  if (need) p.set('need', need);
  return base + '?' + p.toString();
}

/**
 * A noun phrase for what is LOCKED — "the other 42 rows (plus `fiber_routes`)".
 * Returns null when the gate knew nothing specific, which is the signal to keep
 * the generic copy rather than dress up an absence.
 *
 * `markdown:false` strips the backticks: the /continue page renders params with
 * textContent (deliberately — it treats every param as hostile), so a backtick
 * sent there is drawn as a backtick, not as code.
 *
 * `omitField:true` drops the field name from the row phrase, for callers that
 * already named it in the same sentence.
 */
export function describeLocked({ shown, total, field, fields, markdown = true, omitField = false } = {}) {
  const tick = markdown ? '`' : '';
  const q = (f) => tick + f + tick;
  const fld = cleanField(field);
  const fs = cleanFields(fields).filter((f) => f !== fld);
  const hasTotal = _isPosInt(total);
  const label = (fld && !omitField) ? q(fld) + ' ' : '';
  const rows = (n) => `${n} ${label}row${n === 1 ? '' : 's'}`;

  let core = null;
  if (hasTotal && _isPosInt(shown) && shown < total) core = `the other ${rows(total - shown)}`;
  else if (hasTotal)                                 core = rows(total);
  else if (fld)                                      core = `the full ${q(fld)} breakdown`;

  const named = fs.slice(0, FIELDS_IN_PROSE).map(q).join(', ');
  const rest = fs.length - FIELDS_IN_PROSE;
  const extra = fs.length
    ? `${named}${rest > 0 ? ` and ${rest} more field${rest === 1 ? '' : 's'}` : ''}`
    : '';

  if (!core) return extra || null;          // fields only: name them, invent no rows
  return extra ? `${core} (plus ${extra})` : core;
}

/**
 * The content half of the ONE human line — a clause naming what THIS query left
 * on the table.
 *
 * Phrased so the paid layer is the subject ("DC Hub's paid layer has …"): the
 * object is a count we do not control, and every subject-first phrasing has a
 * number-agreement trap in it that a 1-row answer walks straight into.
 *
 * Returns null when nothing specific is known, so the caller keeps its existing
 * generic sentence and this can never make a response worse than the one it
 * replaces.
 */
export function continuationHumanText({ shown, total, field, fields } = {}) {
  const fld = cleanField(field);
  const partial = _isPosInt(total) && _isPosInt(shown) && shown < total;
  // When we lead with "got N of M `field` rows", the locked phrase must not say
  // the field name a second time.
  const locked = describeLocked({ shown, total, field, fields, omitField: partial });
  if (!locked) return null;
  if (partial) {
    return `your agent got ${shown} of ${total}${fld ? ' `' + fld + '`' : ''} rows here`
         + ` — DC Hub's paid layer has ${locked}`;
  }
  return `DC Hub's paid layer has ${locked} for this query`;
}

/**
 * Recover what the gate locked, FROM THE PAYLOAD THE GATE ALREADY BUILT.
 *
 * `_teaseDepth` writes `_<field>_total_in_developer = v.length` next to the
 * sliced array, so both halves of "5 of 47" are sitting in the response — the
 * count in the marker, the shown length on the array itself. Reading them here
 * means ONE integration point instead of threading specifics through five gate
 * branches, and it cannot drift from what was actually served: if the tease
 * changes what it trims, this reads the change for free.
 *
 * Only the `_*_total_in_*` family is trusted. Masked metric keys (set to null
 * by the same pass) are deliberately NOT reported as locked fields — a null has
 * more than one cause, and a field named as withheld that was merely absent is
 * the confident-wrong claim this module refuses to make.
 */
const _LOCKED_RE = /^_(.+)_total_in_(?:developer|pro)$/;
/**
 * The OTHER honest marker trimForTrial writes: `_<field>_in_pro: true`, stamped
 * on a field it masked outright (grid headroom, time-to-power) rather than one
 * it sliced.
 *
 * ★ Reading it is not the "ambiguous null" this module refuses. A metric masked
 * to null has more than one cause and is deliberately ignored; this is a
 * purpose-built boolean whose only meaning is "this field was withheld from
 * you". Different evidence, different rule.
 *
 * It matters because of WHICH tools it covers. get_grid_intelligence is the
 * most-gated tool on the platform and returns scalars, not long arrays — so it
 * carries these markers and almost never carries a `_total_in_` one. Without
 * this, the highest-volume gated tool would fall to the generic line on nearly
 * every call, and the quantified/generic experiment would under-sample the
 * exact traffic it was built to measure.
 */
const _MASKED_RE = /^_(.+)_in_pro$/;

export function extractLockedFromPayload(payload, depth = 2) {
  if (!payload || typeof payload !== 'object' || depth < 0) return null;
  let best = null;
  const others = [];

  const scan = (obj, d) => {
    if (!obj || typeof obj !== 'object' || d < 0) return;
    for (const [k, v] of Object.entries(obj)) {
      const m = _LOCKED_RE.exec(k);
      if (m && _isPosInt(v)) {
        const base = m[1];
        const arr = obj[base];
        const found = { field: base, total: v,
                        shown: Array.isArray(arr) ? arr.length : undefined };
        if (!best || found.total > best.total) {
          if (best) others.push(best.field);
          best = found;
        } else {
          others.push(base);
        }
      } else if (v === true && _MASKED_RE.test(k) && !_LOCKED_RE.test(k)) {
        // `_x_total_in_pro` also matches _MASKED_RE (capturing "x_total"), so the
        // count form is excluded explicitly rather than by regex order.
        const mm = _MASKED_RE.exec(k);
        if (mm && !/_total$/.test(mm[1])) others.push(mm[1]);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        scan(v, d - 1);
      }
    }
  };
  scan(payload, depth);

  const fields = cleanFields(others);
  // No sliced array anywhere, but fields were withheld: that is still something
  // specific and true, and on the most-gated tools it is the ONLY thing there is.
  if (!best) return fields.length ? { fields } : null;
  return { field: best.field, total: best.total, shown: best.shown, fields };
}
