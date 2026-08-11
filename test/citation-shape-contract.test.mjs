// citation-shape-contract.test.mjs — r-cite-shape (2026-08-10)
//
// THE OUTAGE THIS GUARDS
// A keyless live call to dchub.cloud/mcp:
//     site_selection_canvas capacity_mw=200 region=TX max_months=24
// returned, to EVERY strict MCP client:
//     MCP error -32602: Output validation error
//     path ["citation"] — expected object, received string
// Not a gate, not a preview — a protocol error. The tool was unreachable.
//
// Upstream cause (verified against the live REST origin the tool wraps):
//     GET /api/v1/site-selection/canvas?capacity_mw=200&region=TX&max_months=24
//     → "citation": "DC Hub Site Selection Canvas — dchub.cloud/site-selection (CC BY 4.0)"
// a STRING, where the declared envelope says object. The three stamp sites in
// server.mjs all guarded on PRESENCE (`'citation' in obj`, `!sc.citation`), so
// a wrong-typed citation was never corrected — it was preserved and shipped.
//
// This file is the contract in both directions:
//   1. _normalizeCitation coerces every non-object shape to the object form
//      (preserving real attribution text) and is idempotent on valid input.
//   2. EVERY declared outputSchema — the shared envelope plus all typed
//      per-tool schemas — accepts BOTH citation shapes, so no upstream can
//      ever again turn an attribution-format drift into a client-side outage.
import { describe, it, expect } from 'vitest';
import { _normalizeCitation, _OUTPUT_ENVELOPE, _TOOL_OUTPUT_SCHEMAS } from '../server.mjs';

// The exact byte-for-byte string the live canvas endpoint returned.
const LIVE_CANVAS_CITATION =
  'DC Hub Site Selection Canvas — dchub.cloud/site-selection (CC BY 4.0)';

describe('_normalizeCitation', () => {
  it('coerces the live canvas STRING into the documented object shape', () => {
    const out = _normalizeCitation(LIVE_CANVAS_CITATION);
    expect(typeof out).toBe('object');
    expect(Array.isArray(out)).toBe(false);
    expect(out.source).toBe('DC Hub');
    expect(out.license).toBe('CC-BY-4.0');
    // The upstream wording is real attribution — preserved, never discarded.
    expect(out.cite_as).toBe(LIVE_CANVAS_CITATION);
    expect(out._normalized_from).toBe('string');
  });

  it('is idempotent on an already-valid object (does not re-stamp retrieved_at)', () => {
    const valid = { source: 'DC Hub', url: 'https://dchub.cloud', license: 'CC-BY-4.0',
                    cite_as: 'DC Hub, dchub.cloud', retrieved_at: '2026-01-01T00:00:00.000Z' };
    const out = _normalizeCitation(valid);
    expect(out).toBe(valid);                       // same reference — untouched
    expect(out.retrieved_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('produces the canonical object for missing / null / undefined', () => {
    for (const v of [undefined, null]) {
      const out = _normalizeCitation(v);
      expect(out.cite_as).toBe('DC Hub, dchub.cloud');
      expect(out._normalized_from).toBeUndefined();  // nothing was replaced
    }
  });

  it('coerces every other wrong type instead of passing it through', () => {
    // Arrays are the shape that broke site_evaluation_handoff in 2026-07; a
    // number/boolean citation is nonsense but must still not reach the SDK.
    for (const v of [['DC Hub'], 42, true, '   ']) {
      const out = _normalizeCitation(v);
      expect(typeof out).toBe('object');
      expect(Array.isArray(out)).toBe(false);
      expect(out.source).toBe('DC Hub');
    }
  });

  it('never throws, whatever it is handed', () => {
    const hostile = [Symbol('x'), () => {}, new Map(), NaN, Infinity, -0];
    for (const v of hostile) {
      expect(() => _normalizeCitation(v)).not.toThrow();
      expect(typeof _normalizeCitation(v)).toBe('object');
    }
  });
});

// ── The sweep: every declared outputSchema, both citation shapes ───────────
// This is the part that generalizes. The canvas was one tool; the same drift
// in any of the others would have produced the same outage, and nothing was
// watching. Now every schema the server advertises is asserted directly.
describe('outputSchema contract: citation accepts both shapes, on every tool', () => {
  const schemas = Object.entries({ __envelope__: _OUTPUT_ENVELOPE, ..._TOOL_OUTPUT_SCHEMAS });

  it('advertises a non-empty set of schemas to sweep', () => {
    // A sweep over an empty list is a vacuous pass — assert we actually have
    // the typed flagship schemas plus the shared envelope.
    expect(schemas.length).toBeGreaterThan(5);
  });

  it.each(schemas)('%s accepts an OBJECT citation', (_name, schema) => {
    const r = schema.safeParse({
      _entity: 'response',
      citation: { source: 'DC Hub', url: 'https://dchub.cloud', license: 'CC-BY-4.0',
                  cite_as: 'DC Hub, dchub.cloud', retrieved_at: new Date().toISOString() },
    });
    expect(r.success).toBe(true);
  });

  it.each(schemas)('%s accepts the live STRING citation (no -32602)', (_name, schema) => {
    const r = schema.safeParse({ _entity: 'response', citation: LIVE_CANVAS_CITATION });
    if (!r.success) {
      throw new Error(`${_name} would reject a real payload: `
        + JSON.stringify(r.error.issues));
    }
    expect(r.success).toBe(true);
  });

  it.each(schemas)('%s accepts a payload with NO citation at all', (_name, schema) => {
    expect(schema.safeParse({ _entity: 'response' }).success).toBe(true);
  });
});

// ── End-to-end: the exact failing payload, through the real stamp path ─────
describe('regression: the site_selection_canvas payload validates after stamping', () => {
  it('string citation → normalized → passes the envelope validator', () => {
    // Mirrors what the origin actually returns, keys and all.
    const upstream = {
      ok: true,
      citation: LIVE_CANVAS_CITATION,
      inputs: { capacity_mw: 200, region: 'TX', max_months: 24 },
      shortlist: [{ market: 'Midland–Odessa', state: 'TX', iso: 'ERCOT', verdict: 'BUILD' }],
      tier: 'free',
    };
    // Pre-fix this failed; the raw upstream shape is what reached the SDK.
    expect(_OUTPUT_ENVELOPE.safeParse(upstream).success).toBe(true);

    const stamped = { ...upstream, citation: _normalizeCitation(upstream.citation) };
    const r = _OUTPUT_ENVELOPE.safeParse(stamped);
    expect(r.success).toBe(true);
    expect(typeof stamped.citation).toBe('object');
    expect(stamped.citation.cite_as).toBe(LIVE_CANVAS_CITATION);
    // The payload itself must survive normalization untouched.
    expect(stamped.shortlist[0].state).toBe('TX');
    expect(stamped.shortlist[0].iso).toBe('ERCOT');
  });
});
