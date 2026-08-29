// r-queue-two-shapes (2026-08-29): get_interconnection_queue output contract.
//
// WHY THIS FILE EXISTS
// ====================
// The MCP SDK validates the handler's result against the declared outputSchema
// AFTER the handler returns. So a field whose declared type is narrower than
// what the backend really emits fails the WHOLE call with -32602 "Invalid
// structured content" — no data, no preview, no paywall CTA, no relay link —
// while our own telemetry records the HANDLER's outcome and logs status='ok'.
// The tool looks healthy in mcp_call_log and is completely dead to callers.
// Same class as the hyperscaler_deals {value,display} regressions; the standing
// lesson from those is that only an outside probe sees this.
//
// THE DEFECT. get_interconnection_queue answers from TWO different backend
// endpoints depending on one argument:
//
//     iso given    -> /api/v1/interconnection-queue/by-iso     projects = ARRAY
//     iso omitted  -> /api/v1/interconnection-queue/snapshot   projects = OBJECT
//
// Only the array was declared. So the tool's own DEFAULT call — the all-ISO
// snapshot its description advertises — returned:
//
//     MCP error -32602: Output validation error: Invalid structured content for
//     tool get_interconnection_queue: [{ "expected": "array", "code":
//     "invalid_type", "path": ["projects"] }]
//
// for every tier including paid keys. Measured live 2026-08-29: `{}`,
// `{limit:3}` and `{state:"TX"}` all died; only `{iso:…}` worked.
//
// ★ THE TRAP INSIDE THE FIX. The snapshot's `tracked` is a BOOLEAN (`true`),
// not a count. The first draft of the corrected schema declared it _oNum on the
// reasonable-sounding assumption that it counted classified projects — which
// would have reproduced the exact bug being fixed, on a different field. The
// fixtures below are therefore VERBATIM live reads, not hand-written shapes:
//   GET /api/v1/interconnection-queue/snapshot        (2026-08-29)
//   GET /api/v1/interconnection-queue/by-iso?iso=SPP  (2026-08-29)
// Kept as fixtures rather than a live fetch so this file qualifies for the
// deterministic HARD gate — see .github/workflows/test.yml.
import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../server.mjs';

let tool;
beforeAll(() => {
  tool = createServer()._registeredTools['get_interconnection_queue'];
});

const parse = async (payload) => tool.outputSchema.safeParseAsync(payload);
const why = (r) => JSON.stringify(r.error?.issues ?? r.error ?? null);

// A guard that silently stopped finding its target would pass unconditionally.
describe('the guard found what it is guarding', () => {
  it('get_interconnection_queue is registered and declares an outputSchema', () => {
    expect(tool, 'get_interconnection_queue not registered').toBeTruthy();
    expect(tool.outputSchema,
      'no outputSchema declared — every assertion in this file would pass vacuously').toBeTruthy();
  });
});

// ── fixture A: the all-ISO snapshot (iso omitted) — the form that was dead ───
// Verbatim from the live snapshot endpoint; `top` trimmed to one row and
// `by_iso_count` kept whole because the counts are the point of the object.
const SNAPSHOT = {
  as_of: '2026-08-28',
  iso_count: 7,
  source: 'DC Hub — 7 US ISO public interconnection queues',
  generated_at: '2026-08-29T05:20:11.114Z',
  totals: { queued_load_total_gw: 1744.2 },
  by_iso: [{ iso: 'PJM', queued_load_total_gw: 171.0 }],
  data_center_load: { queued_load_data_center_gw: 225.0 },
  dchub_classified: true,
  methodology: 'Public ISO queue files, normalised per project.',
  freshness: { age_hours: 6 },
  provenance: { source: 'DC Hub', url: 'https://dchub.cloud' },
  projects: {
    by_iso_count: { CAISO: 279, ERCOT: 1893, 'ISO-NE': 68, MISO: 1104, NYISO: 175, PJM: 972, SPP: 1021 },
    note: 'Named per-project queue rows (project, MW, status, state/county) from the 7 US ISO public queues. Aggregate GW totals are in by_iso; call /api/v1/interconnection-queue/by-iso?iso=ERCOT for the full per-ISO project list.',
    top: [{
      capacity_mw: 3200.0, county: 'LA PAZ', fuel_type: 'Battery', iso: 'CAISO',
      project_name: 'ATLAS COMPLEX', queue_date: '2017-05-01', queue_id: 'CAISO-1402',
      queue_status: 'active', state: 'AZ',
    }],
    total: 5512,
    tracked: true,          // ★ BOOLEAN — see the trap note above
  },
};

// ── fixture B: the per-ISO drill-down (iso given) — the form that worked ─────
const BY_ISO = {
  as_of: '2026-08-28',
  iso: 'SPP',
  project_count: 1021,
  queued_load_total_gw: 245.6,
  queued_load_data_center_gw: null,
  queued_load_dc_share_pct: null,
  top_subregions: null,
  new_applications_q_gw: null,
  new_applications_period: null,
  historical_completion_pct: null,
  source_name: 'SPP Generator Interconnection Queue',
  source_url: 'https://spp.org/',
  v: 'verified',
  provenance: { source: 'DC Hub', url: 'https://dchub.cloud' },
  projects: [{
    capacity_mw: 1400.0, county: 'Creek', fuel_type: 'Gas', iso: 'SPP',
    project_name: null,              // the live feed really does emit nulls here
    queue_date: '2025-03-01', queue_id: 'SPP-GEN-2024-340',
    queue_status: 'DISIS STAGE', state: 'OK',
  }],
};

describe('both shapes the backend actually emits are accepted', () => {
  it('the all-ISO snapshot parses — projects as a SUMMARY OBJECT', async () => {
    const r = await parse(SNAPSHOT);
    expect(r.success, `snapshot rejected: ${why(r)}`).toBe(true);
  });

  it('the per-ISO drill-down parses — projects as an ARRAY', async () => {
    const r = await parse(BY_ISO);
    expect(r.success, `by-iso rejected: ${why(r)}`).toBe(true);
  });

  // The precise failure that was live. Named on its own so a regression says
  // what broke rather than just "a fixture stopped parsing".
  it('projects-as-object is not rejected for "expected array"', async () => {
    const r = await parse({ projects: SNAPSHOT.projects });
    expect(r.success, `still rejecting the object form: ${why(r)}`).toBe(true);
  });

  it('tracked:true (boolean) is accepted — it is a flag, not a count', async () => {
    const r = await parse({ projects: { total: 5512, tracked: true } });
    expect(r.success, `boolean tracked rejected: ${why(r)}`).toBe(true);
  });

  it('a null project_name inside the array form is accepted', async () => {
    const r = await parse({ projects: [{ queue_id: 'SPP-1', project_name: null, capacity_mw: 1400.0 }] });
    expect(r.success, `null project_name rejected: ${why(r)}`).toBe(true);
  });

  it('projects: null is accepted (the field is nullable)', async () => {
    const r = await parse({ projects: null });
    expect(r.success, `null projects rejected: ${why(r)}`).toBe(true);
  });

  it('projects absent entirely is accepted (the field is optional)', async () => {
    const r = await parse({ as_of: '2026-08-28' });
    expect(r.success, `absent projects rejected: ${why(r)}`).toBe(true);
  });
});

// The union must stay a union. Widening it to z.any() would make every
// assertion above pass while silently dropping the per-project field
// documentation that agents read to decide what to ask for — so pin that the
// declared shape is still discriminating, and still carries the row fields.
describe('the fix stays a union, not a blanket any', () => {
  it('a project row that is neither an array nor an object is still rejected', async () => {
    const r = await parse({ projects: 'five thousand five hundred and twelve' });
    expect(r.success, 'projects accepted a bare string — the schema was widened to any').toBe(false);
  });

  it('the served schema still documents the per-project row fields', () => {
    const json = JSON.stringify(tool.outputSchema);
    for (const f of ['queue_id', 'project_name', 'capacity_mw', 'queue_status', 'fuel_type']) {
      expect(json, `per-project field "${f}" no longer documented`).toContain(f);
    }
  });

  it('the served schema documents the summary-object fields too', () => {
    const json = JSON.stringify(tool.outputSchema);
    for (const f of ['by_iso_count', 'tracked', 'total']) {
      expect(json, `summary field "${f}" not documented`).toContain(f);
    }
  });
});

// mcp #215: the bundled Claude client rejects any schema carrying an
// unsupported $schema dialect, and did so for all 82 tools at once. Adding a
// union must not reintroduce a dialect stamp on this tool's output schema.
describe('no schema dialect is stamped', () => {
  it('the output schema declares no $schema', () => {
    expect(JSON.stringify(tool.outputSchema)).not.toContain('$schema');
  });
});

// The description is the only place an agent learns that one field name
// carries two types. If the schema fix ships without it, the tool stops
// erroring and starts silently confusing callers instead.
describe('the shape switch is documented where an agent will read it', () => {
  it('the tool description says the shape depends on the call', () => {
    const d = tool.description || '';
    expect(d).toMatch(/CHANGES SHAPE|SHAPE DEPENDS/i);
    expect(d).toContain('by_iso_count');
  });
});
