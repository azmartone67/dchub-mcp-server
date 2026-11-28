// site-context-cite.mjs — Grok fix-all 2026-11-27 item 8 (owner-approved): get_site_context is cited with the
// execute_plan owner line "Source: DC Hub (dchub.cloud), as of <YYYY-MM-DD>" (lib/plan-cite-line.mjs), and its
// completeness is set from the depth the handler served (_siteContextFor's view), never left "unknown":
//   view "full" -> completeness "full": every block's values at this point.
// A preview keeps the completeness the attribution step gave it: stamping "partial_preview" there makes the tier
// wall (lib/source-line.mjs isTierPreview) add an upgrade link, which the keyless site-context preview must not carry
// (test/get-site-context-tool.test.mjs).
// Pure; never throws (returns the payload unchanged on any failure).
import { PLAN_CITE_PREFIX, planCiteDay } from './plan-cite-line.mjs';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export const SITE_CONTEXT_DEPTH = Object.freeze({
  full: { completeness: 'full',
    basis: 'full neighborhood body at this point: every block carries its values, source and as_of, or states its gap.' },
});

export function siteContextCiteLine(sc, now = Date.now(), opts = {}) {
  return PLAN_CITE_PREFIX + planCiteDay(isObj(sc) ? sc : {}, now, opts);
}

export function stampSiteContextCite(out, sc, now = Date.now(), opts = {}) {
  try {
    if (!isObj(out)) return out;
    const cite = siteContextCiteLine(sc, now, opts);
    const depth = isObj(sc) && sc.view === 'full' ? SITE_CONTEXT_DEPTH.full : null;
    const res = { ...out, cite_as: cite };
    const set = (blk) => {
      const b = { ...blk, cite_as: cite };
      if (depth && (b.completeness == null || b.completeness === 'unknown')) {
        b.completeness = depth.completeness;
        b.completeness_basis = depth.basis;
      }
      return b;
    };
    if (isObj(res.citation)) res.citation = set(res.citation);
    if (isObj(res.provenance)) res.provenance = set(res.provenance);
    if (depth && !isObj(res.citation) && !isObj(res.provenance)) {
      res.completeness = depth.completeness;
    }
    return res;
  } catch (_e) { return out; }
}
