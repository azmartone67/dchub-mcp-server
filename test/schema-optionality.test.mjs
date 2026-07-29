// r-shortlist-rerank (2026-07-16): zod-layer optionality guards. The MCP SDK
// validates args against each tool's zod schema BEFORE the handler runs, so a
// param declared z.any() without .optional() rejects every call that omits it
// with -32602 ("expected nonoptional, received undefined") — invisible to
// handler-level tests and to _validateToolArgs. This killed two DOCUMENTED
// modes in a row: analyze_parcel's lat/lon-only hosted-parcel lookup (geometry
// was required; fixed r-coord-aliases 2026-07-16) and rank_sites' shortlist
// re-rank ("reuses their saved objectives if you pass none" — objectives was
// required). These tests parse payloads against the REGISTERED schemas exactly
// as the SDK does, pinning both the must-be-optional params and the
// intentionally-required ones (whose backends 400 legibly when they're absent,
// so loosening them would just move the error somewhere less helpful).
import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../server.mjs';

let tools;
beforeAll(() => {
  tools = createServer()._registeredTools;
});

const parses = async (tool, args) =>
  (await tools[tool].inputSchema.safeParseAsync(args)).success;

describe('rank_sites — shortlist re-rank mode must reach the handler', () => {
  it('shortlist_name WITHOUT objectives passes zod (saved objectives reused server-side)', async () => {
    expect(await parses('rank_sites', { shortlist_name: 'Q3-2026-1GW-targets' })).toBe(true);
  });
  it('candidates + objectives (the classic mode) still passes', async () => {
    expect(await parses('rank_sites', {
      candidates: [{ lat: 33.4, lng: -112.0, water_stress: 40 }],
      objectives: { water_stress: -0.6 },
    })).toBe(true);
  });
  it('candidates WITHOUT objectives passes zod — the backend owns the legible 400', async () => {
    // /api/v1/rank-sites returns "objectives required: {field: weight}..." (400),
    // which callAPI surfaces as {error, detail}. A zod -32602 would hide it.
    expect(await parses('rank_sites', { candidates: [{ lat: 33.4, lng: -112.0 }] })).toBe(true);
  });
});

describe('analyze_parcel — lat/lon-only hosted-parcel lookup (r-coord-aliases pin)', () => {
  it('lat+lon WITHOUT geometry passes zod', async () => {
    expect(await parses('analyze_parcel', { lat: 39.04, lon: -77.48 })).toBe(true);
  });
  it('geometry alone still passes', async () => {
    expect(await parses('analyze_parcel', {
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
    })).toBe(true);
  });
});

describe('intentionally-required z.any() params stay required', () => {
  it('save_to_shortlist: site is required (backend 400s "shortlist_name and site are required")', async () => {
    expect(await parses('save_to_shortlist', { shortlist_name: 'x', objectives: { a: 1 } })).toBe(false);
  });
  // ★2026-07-29 (Persistence Shell #41 lane 2) — objectives MOVED to optional.
  // This file's own rule for keeping a z.any() required is "the backend 400s
  // legibly when it's absent, so loosening it would just move the error
  // somewhere less helpful". That rule is correct, and it holds for `site`
  // (/api/v1/shortlist/save does 400 "shortlist_name and site are required").
  // It does NOT hold for objectives: the backend reads
  // `body.get("objectives") or {}` and accepts absence SILENTLY. So the zod
  // requirement was not backed by a legible 400 — it was the only thing
  // rejecting the call, and it rejected the minimal, obvious payload.
  //
  // The other stated reason — the snapshot + re-rank contract needs objectives —
  // is real, but the requirement never actually protected it: `objectives: {}`
  // passed zod AND the backend and produced saved_score=null, i.e. exactly the
  // degraded row the guard existed to prevent. A guard you can satisfy with an
  // empty object is not guarding.
  //
  // Both are now closed at the layer that can actually enforce them: the backend
  // derives EQUAL WEIGHTS over the site's own numeric metric fields whenever
  // objectives is absent or empty, so saved_objectives is never empty and
  // re-scoring always has criteria. See routes/shortlists.py.
  it('save_to_shortlist: objectives is OPTIONAL (backend derives equal weights)', async () => {
    expect(await parses('save_to_shortlist', { shortlist_name: 'x', site: { lat: 1, lng: 2 } })).toBe(true);
  });
  it('save_to_shortlist: the MINIMAL documented call parses', async () => {
    // The call the tool description now advertises. If this ever regresses, the
    // published example is a lie and the chain goes dead again.
    expect(await parses('save_to_shortlist', {
      shortlist_name: 'my-targets',
      site: { site_ref: 'PJM-A1', lat: 39.95, lng: -76.72, capacity_mw: 100 },
    })).toBe(true);
  });
  it('save_to_shortlist: shortlist_name is required (the backend hard-400s on it)', async () => {
    // Was OPTIONAL at zod while the backend REQUIRED it — the inverse of the
    // objectives bug, and the other half of why no arg set satisfied both.
    expect(await parses('save_to_shortlist', { site: { lat: 1, lng: 2 } })).toBe(false);
  });
  it('save_to_shortlist: full payload passes', async () => {
    expect(await parses('save_to_shortlist',
      { shortlist_name: 'x', site: { lat: 1, lng: 2 }, objectives: { water_stress: -0.6 } })).toBe(true);
  });
  it('set_shortlist_alert: notify is required (backend 400s "notify.webhook or notify.email is required")', async () => {
    expect(await parses('set_shortlist_alert', { shortlist_name: 'x', percentile_below: 70 })).toBe(false);
  });
  it('set_shortlist_alert: full payload passes', async () => {
    expect(await parses('set_shortlist_alert',
      { shortlist_name: 'x', percentile_below: 70, notify: { email: 'a@b.com' } })).toBe(true);
  });
});
