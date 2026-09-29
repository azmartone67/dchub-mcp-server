// ── site-envelope.mjs — keep the site-scoring flow inside the MCP contract ──
//
// xAI's agent eval (2026-09-28) named this its #1 structural gap: the
// site-scoring tools take MCP-shaped arguments, but the next hop an agent is
// handed leads to the raw REST route GET /api/site-score, and that route does
// not speak the DCHubEnvelope (`_entity` + `ok`, components.schemas.DCHubEnvelope
// in the backend's /openapi.json).
//
// What was measured on the three tools this module covers, live, 2026-09-28:
//   analyze_site               _entity "site",  no `ok`
//   get_composite_site_score   _entity "get_composite_site_score" (the tool
//                              NAME: _ENTITY_MAP had no entry, so the gated
//                              path fell through to the name — not a value of
//                              the envelope's _entity enum), no `ok`
//   get_water_risk             _entity "risk",  no `ok` (the backend's own
//                              flag is `success`)
// And in the offline harness: an upstream error (a 404 unknown_candidate, a
// 503) reaches the agent stamped `_entity: "site"` — _upstreamError drops the
// backend's `_entity: "error"` and _stampEntityCb then stamps the tool's class
// onto the failure. The envelope says a failure is `ok: false` +
// `_entity: "error"`.
//
// This step runs at the END of the tool chain (just inside _flagUpstreamError),
// after every preview/wall/attribution step has built its structuredContent, so
// every return path of these tools leaves with the same envelope. It:
//   1. sets `ok` (false on a failure, true on an answer — a gated preview IS an
//      answer; see isSiteFailure),
//   2. sets `_entity` to the tool's envelope class on an answer and to "error"
//      on a failure,
//   3. rewrites any value that is EXACTLY a site-scoring REST route
//      ("/api/site-score?lat=…", "GET https://dchub.cloud/api/v1/water/stress")
//      into the MCP call that serves it: {tool, args}. Prose that merely
//      mentions a path is left alone, and REST routes with no MCP twin in this
//      family (doc links, the gating matrix, the key-claim URL) are not touched.
// It applies the same to content[0].text when that is a JSON object, so the two
// channels agree.
//
// The REST route itself is not changed here: /api/site-score has live callers.

export const SITE_ENVELOPE_TOOLS = Object.freeze({
  analyze_site: 'site',
  get_composite_site_score: 'site',
  get_water_risk: 'risk',
});

// Site-scoring REST routes → the MCP tool that serves the same read. Matched
// on the whole path, so /api/site-score/compare never resolves as
// /api/site-score.
const REST_TO_TOOL = new Map([
  ['/api/site-score/compare', 'compare_sites'],
  ['/api/site-score', 'analyze_site'],
  ['/api/v1/site-score', 'analyze_site'],
  ['/api/v1/site-planner/composite-score', 'get_composite_site_score'],
  ['/api/v1/site-planner/disaster-risk', 'get_disaster_risk'],
  ['/api/v1/water/drought', 'get_water_risk'],
  ['/api/v1/water/stress', 'get_water_risk'],
  ['/api/v1/water/risk', 'get_water_risk'],
  ['/api/v2/water/drought', 'get_water_risk'],
]);

// A whole value that is one REST call and nothing else: optional method,
// optional dchub.cloud origin, an /api/ path, optional query string.
const REST_VALUE_RE = /^\s*(?:(?:GET|POST)\s+)?(?:https?:\/\/(?:www\.)?dchub\.cloud)?(\/api\/[A-Za-z0-9_\-/.]+)(\?[^\s#]*)?\s*$/;

// Query-string args → the tool's declared argument names. The REST routes read
// `lng` (composite, water) or `lon` (site-score); every one of these tools
// declares `lon`, and `capacity` is the legacy name of `capacity_mw`.
const _ARG_RENAME = { lng: 'lon', longitude: 'lon', latitude: 'lat', capacity: 'capacity_mw' };
const _NUMERIC = new Set(['lat', 'lon', 'capacity_mw']);
function _argsFromQuery(query) {
  const args = {};
  if (!query) return args;
  let sp;
  try { sp = new URLSearchParams(query.slice(1)); } catch { return args; }
  for (const [k0, v0] of sp) {
    if (v0 === '' || /^[{<]/.test(v0)) continue;          // template placeholder, not a value
    const k = _ARG_RENAME[k0] || k0;
    if (k0 === 'capacity' && args.capacity_mw !== undefined) continue;  // capacity_mw wins over legacy capacity
    const n = Number(v0);
    args[k] = (_NUMERIC.has(k) && Number.isFinite(n)) ? n : v0;
  }
  return args;
}

// {tool, args} for a value that is exactly a site-scoring REST call; null for
// anything else.
export function restHintToToolCall(value) {
  if (typeof value !== 'string') return null;
  const m = REST_VALUE_RE.exec(value);
  if (!m) return null;
  const tool = REST_TO_TOOL.get(m[1].replace(/\/+$/, ''));
  if (!tool) return null;
  return { tool, args: _argsFromQuery(m[2] || '') };
}

// Deep rewrite. Returns [newValue, count]. Never mutates the input.
export function rewriteRestHints(node, depth = 0) {
  if (depth > 12) return [node, 0];
  if (typeof node === 'string') {
    const call = restHintToToolCall(node);
    return call ? [call, 1] : [node, 0];
  }
  if (Array.isArray(node)) {
    let n = 0;
    const out = node.map((v) => { const [nv, c] = rewriteRestHints(v, depth + 1); n += c; return nv; });
    return n ? [out, n] : [node, 0];
  }
  if (node && typeof node === 'object') {
    let n = 0;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const [nv, c] = rewriteRestHints(v, depth + 1);
      out[k] = nv; n += c;
    }
    return n ? [out, n] : [node, 0];
  }
  return [node, 0];
}

// A failure is a response that carries no answer:
//   · the upstream error shape _upstreamError builds (`_error_mitigation`, or
//     error "API <status>") — the same predicate _flagUpstreamError uses;
//   · the backend's own flags (`success: false`, `_entity: "error"`);
//   · a handler refusal (isError with a string `error`, e.g. "lat and lon are
//     required numbers") that is NOT a paywall. A wall / tease / gated preview
//     sets isError as a transport choice on a response that did answer, so it
//     stays ok:true — the envelope's "gated-preview" case, distinct from error.
export function isSiteFailure(result, sc) {
  if (!sc || typeof sc !== 'object') return !!(result && result.isError);
  if (sc._error_mitigation) return true;
  if (typeof sc.error === 'string' && /^API \d{3}$/.test(sc.error)) return true;
  if (sc.success === false || sc._entity === 'error') return true;
  // A paywall is recognised by what it carries for the human (an upgrade block
  // or a for_your_human line) — the unkeyed wall answers error "paid_only"
  // with isError set and no _gated flag, and it is still an answer.
  const gated = !!(sc._gated || sc._wall || sc.tease || sc.trial_preview
    || sc.preview_is_partial || sc.paywall_contract || sc.required_plan
    || sc.for_your_human || sc.upgrade || sc._upgrade);
  if (result && result.isError === true && !gated
      && (typeof sc.error === 'string' || !Object.keys(sc).length)) return true;
  return false;
}

function _stampObject(obj, entity, failed) {
  const [rewritten] = rewriteRestHints(obj);
  // _entity and ok lead, so an agent that reads the first keys branches right.
  const { _entity: _e, ok: _o, ...rest } = rewritten;
  return failed
    ? { _entity: 'error', ok: false, ...rest }
    : { _entity: entity, ok: true, ...rest };
}

// The chain step. Fail-soft: a stamp is never worth failing a response over.
export function stampSiteEnvelope(result, toolName) {
  try {
    const entity = SITE_ENVELOPE_TOOLS[toolName];
    if (!entity || !result || typeof result !== 'object') return result;
    const sc0 = result.structuredContent;
    const scIsObj = !!(sc0 && typeof sc0 === 'object' && !Array.isArray(sc0));
    let c0obj = null;
    const c0 = Array.isArray(result.content) ? result.content[0] : null;
    if (c0 && c0.type === 'text' && typeof c0.text === 'string') {
      try {
        const p = JSON.parse(c0.text);
        if (p && typeof p === 'object' && !Array.isArray(p)) c0obj = p;
      } catch { /* prose content stays as it is */ }
    }
    const basis = scIsObj ? sc0 : (c0obj || {});
    const failed = isSiteFailure(result, basis);
    const out = { ...result, structuredContent: _stampObject(basis, entity, failed) };
    if (c0obj) {
      out.content = [{ ...c0, text: JSON.stringify(_stampObject(c0obj, entity, failed)) }, ...result.content.slice(1)];
    }
    return out;
  } catch {
    return result;
  }
}
