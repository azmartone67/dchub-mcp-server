// ── error-envelope: the error_version:1 contract (Gemini partnership) ────────
// Shared builder for DC Hub's machine-readable error envelope. Mirrors the
// backend (REST) contract EXACTLY so an agent hitting EITHER surface parses one
// identical shape. Extracted to lib/ so it can be unit-tested offline and reused
// by every error call site in server.mjs (the r-failsoft handler-error path and
// the _validateToolArgs invalid-args path today; more later).
//
// FAIL-SOFT is the whole point: this code runs ONLY when something already went
// wrong. It must never throw — an exception here would replace a structured,
// self-correcting error with an unstructured crash, defeating the contract.
//
// THE LOCKED CONTRACT (error_version:1):
//   {
//     error_version: 1,
//     provenance: { source, as_of, license, cite_as },
//     _error_mitigation: {
//       error_code:        "<machine_readable_snake_case>",
//       severity:          "parameter_adjustment" | "transient_backoff" | "fatal",
//       deterministic_hint:"<one sentence: why it failed + what unlocks it>",
//       suggested_params?: { ... }   // OMITTED entirely when none; when present,
//                                    // every key MUST be a STRICT SUBSET of that
//                                    // tool's own declared parameter names.
//     }
//   }
//
// severity semantics (agent retry loop):
//   parameter_adjustment → agent re-runs IMMEDIATELY with merged suggested_params
//   transient_backoff    → agent waits ~500ms and retries the SAME params
//   fatal                → agent fails closed (physics violation / hard gate)
//
// HARD RULE: an invalid suggested_params key breaks the agent retry loop, so the
// validator DROPS (and logs) any key not in the tool's declared set — it never
// emits an unvalidatable key. When the filtered set is empty the key is OMITTED.

export const ERROR_VERSION = 1;
export const VALID_SEVERITIES = Object.freeze([
  'parameter_adjustment', 'transient_backoff', 'fatal',
]);
const _SEV_SET = new Set(VALID_SEVERITIES);

// Runtime date — computed FRESH per call, NEVER hardcoded. Production runs UTC,
// so ISO-date is the server's runtime date. Matches how the rest of the gateway
// stamps time (new Date().toISOString()).
function _today() {
  try { return new Date().toISOString().slice(0, 10); }
  catch { return ''; }
}

// Gateway provenance block for the error envelope. The `source` label is the
// PROTOCOL GATEWAY (distinct from a dataset's data-provenance block) — an error
// is emitted by the gateway, not sourced from a table. as_of is the runtime date.
export function errorProvenance() {
  return {
    source: 'DC Hub Protocol Gateway',
    as_of: _today(),
    license: 'CC-BY-4.0',
    cite_as: 'DC Hub, dchub.cloud',
  };
}

// Coerce an allowed-set argument (Set | Array | null/undefined) to a Set, or
// null when we genuinely have no schema to validate against.
function _toAllowSet(allowed) {
  if (allowed instanceof Set) return allowed;
  if (Array.isArray(allowed)) return new Set(allowed);
  return null;
}

// Filter a candidate suggested_params object against a tool's declared param
// names — the STRICT-SUBSET guarantee. Returns a NEW object containing only keys
// present in `allowed`. Any other key is DROPPED and logged (never emitted).
// When `allowed` is null/empty we cannot validate, so we fail CLOSED (drop
// everything) — emitting an unvalidatable key is worse than emitting none.
export function filterSuggestedParams(candidate, allowed) {
  const out = {};
  try {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return out;
    const allow = _toAllowSet(allowed);
    for (const [k, v] of Object.entries(candidate)) {
      if (allow && allow.has(k)) {
        out[k] = v;
      } else {
        try {
          console.warn(`[error-envelope] dropped suggested_param "${k}" — not in tool's declared schema`);
        } catch (_e) { /* logging must never break the error path */ }
      }
    }
  } catch (_e) { /* fail-soft: return whatever validated so far */ }
  return out;
}

// Build the _error_mitigation block. suggested_params is validated against
// allowed_params and OMITTED entirely when no valid keys remain.
export function buildMitigation(opts = {}) {
  const { error_code, severity, deterministic_hint, suggested_params, allowed_params } = opts || {};
  const mit = {
    error_code: (typeof error_code === 'string' && error_code) ? error_code : 'unknown_error',
    severity: _SEV_SET.has(severity) ? severity : 'transient_backoff',
    deterministic_hint: (typeof deterministic_hint === 'string' && deterministic_hint)
      ? deterministic_hint
      : 'An error occurred. Wait ~500ms and retry once.',
  };
  try {
    if (suggested_params && typeof suggested_params === 'object' && !Array.isArray(suggested_params)) {
      const filtered = filterSuggestedParams(suggested_params, allowed_params);
      if (Object.keys(filtered).length > 0) mit.suggested_params = filtered;  // OMIT when empty
    }
  } catch (_e) { /* leave suggested_params off entirely */ }
  return mit;
}

// Build the FULL error_version:1 envelope (the structuredContent shape).
export function buildErrorEnvelope(opts = {}) {
  try {
    return {
      error_version: ERROR_VERSION,
      provenance: errorProvenance(),
      _error_mitigation: buildMitigation(opts),
    };
  } catch (_e) {
    // Last-ditch minimal-but-valid envelope — never let the error path throw.
    return {
      error_version: ERROR_VERSION,
      provenance: {
        source: 'DC Hub Protocol Gateway', as_of: '',
        license: 'CC-BY-4.0', cite_as: 'DC Hub, dchub.cloud',
      },
      _error_mitigation: {
        error_code: 'unknown_error', severity: 'transient_backoff',
        deterministic_hint: 'An error occurred. Wait ~500ms and retry once.',
      },
    };
  }
}

// Merge the envelope onto an EXISTING payload object (so legacy fields such as
// `error` / `tool` / `detail` that downstream telemetry & clients already key
// off are preserved). Envelope keys win on collision. Returns the merged object.
export function withErrorEnvelope(payload, opts = {}) {
  const env = buildErrorEnvelope(opts);
  try {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return { ...payload, ...env };
    }
  } catch (_e) { /* fall through to the bare envelope */ }
  return env;
}
