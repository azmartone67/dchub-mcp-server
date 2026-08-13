// toplevel-attribution.test.mjs — r-cite-toplevel (2026-08-12)
//
// THE MEASUREMENT THIS GUARDS
// Live keyless probe of production, 2026-08-12:
//   POST https://dchub.cloud/mcp  tools/call execute_plan
//     intent="rank markets for a 200 MW AI campus"
// The envelope's top-level keys came back as:
//   _entity ok intent intent_class planner_version executed
//   _executed_total_in_pro minted totals replay answer_guide next_recipe
//   _source _upgrade
// No `citation`. No `provenance`. `cite_as` occurred ZERO times in the entire
// response body. An agent composing an answer reads the top of the object; if
// attribution is not there it is not relayed, and it never reaches the human.
//
// Two other probed surfaces each carried a citation OR a provenance block,
// never both — and one served `citation` as a bare STRING while the rest served
// an OBJECT, which is why partner agents were told to handle either.
//
// WHAT IS ASSERTED HERE
//   1. execute_plan + two GATED tool surfaces carry BOTH a top-level citation
//      (with cite_as) and a provenance block (with as_of) on BOTH channels.
//   2. The emitted citation is always the OBJECT shape; an inbound STRING is
//      accepted and its text preserved as cite_as (back-compat, no break).
//   3. ANTI-INFLATION: as_of is never invented. No timestamp in the payload
//      → as_of === null and as_of_basis says UNMEASURED. Verification counts
//      are omitted, never zero-filled.
//   4. A gated / 1-of-N preview SAYS SO in the cite_as an agent quotes.
//
// The fixtures below are the REAL shapes, transcribed from the live probe and
// from the server's own trim paths (trimForTrial stamps `_<key>_total_in_pro`;
// the anon branch stamps `_upgrade`; execute_plan steps carry truncated:true).
import { describe, it, expect } from 'vitest';
import {
  stampEnvelopeAttribution, buildProvenance, buildCitation,
  collectTimestamps, collectVerificationCounts, detectGating,
} from '../lib/attribution.mjs';

// ── fixtures ───────────────────────────────────────────────────────────────

// The live execute_plan envelope, keyless (free tier), abbreviated but
// structurally faithful: gated via `_executed_total_in_pro` + `_upgrade`, and
// its step results are `truncated`.
const EXECUTE_PLAN_LIVE = {
  _entity: 'plan_execution',
  ok: true,
  intent: 'rank markets for a 200 MW AI campus',
  intent_class: 'market_ranking',
  planner_version: '5.11',
  executed: [
    { step: 1, tool: 'ai_capacity_index', args: { horizon: 90, limit: 10 },
      status: 'executed', ms: 507,
      result: { truncated: true, preview: '{"_entity":"index"}' } },
  ],
  _executed_total_in_pro: 4,
  minted: {},
  totals: { steps: 4, executed: 1 },
  replay: [{ step: 1, why: 'market ranking needs the capacity index' }],
  answer_guide: 'Compose from executed[].result',
  next_recipe: 'compare the top two markets',
  _source: 'DC Hub — dchub.cloud',
  _upgrade: { tier: 'anonymous', next_tool: 'claim_free_key' },
};

// A gated single tool, anon-trimmed: one teaser row kept out of 41.
const SEARCH_FACILITIES_GATED = {
  _entity: 'facility',
  data: [{ id: 1, name: 'Ashburn DC1', country: 'US' }],
  _data_total_in_pro: 41,
  count: null,
  _count_in_pro: true,
  note: 'Free tier preview — a single teaser row is shown.',
  _upgrade: { tier: 'anonymous', next_tool: 'claim_free_key' },
};

// A second gated surface with a REAL backend provenance block — the case where
// we must DEFER to measured values and only fill what is missing.
const GRID_GATED_WITH_BACKEND_PROV = {
  _entity: 'iso_grid',
  iso: 'ERCOT',
  as_of: '2026-08-11T14:00:00.000Z',
  provenance: {
    source: 'DC Hub', method: 'EIA-930 + ERCOT telemetry',
    as_of: '2026-08-11T14:00:00.000Z',
    verification_counts: { verified: 4903, tracked: 21900 },
  },
  headroom: null,
  _headroom_in_pro: true,
  _upgrade: { tier: 'free', next_tool: 'unlock_more_data' },
};

const asResult = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  structuredContent: { ...payload },
});

const parse0 = (r) => JSON.parse(r.content[0].text);

// ── 1. the contract: BOTH blocks, TOP level, on BOTH channels ─────────────
describe('top-level citation + provenance on execute_plan and gated tools', () => {
  const surfaces = [
    ['execute_plan (live keyless envelope)', EXECUTE_PLAN_LIVE],
    ['search_facilities (gated 1-of-41)',    SEARCH_FACILITIES_GATED],
    ['get_grid_intelligence (gated)',        GRID_GATED_WITH_BACKEND_PROV],
  ];

  it('sweeps a non-empty surface list (guards against a vacuous pass)', () => {
    // A sweep over an empty list is a silent green. Assert we really have the
    // front door plus at least two gated tools, exactly as the task requires.
    expect(surfaces.length).toBeGreaterThanOrEqual(3);
  });

  it.each(surfaces)('%s — content[0] carries citation.cite_as AND provenance.as_of key', (_n, payload) => {
    const out = stampEnvelopeAttribution(asResult(payload), { toolName: 't', tier: 'free' });
    const top = parse0(out);

    expect(top).toHaveProperty('citation');
    expect(top).toHaveProperty('provenance');
    // citation must be the OBJECT shape and must carry a quotable cite_as
    expect(typeof top.citation).toBe('object');
    expect(Array.isArray(top.citation)).toBe(false);
    expect(typeof top.citation.cite_as).toBe('string');
    expect(top.citation.cite_as.length).toBeGreaterThan(0);
    // provenance must DECLARE as_of — present as a key even when null, so the
    // absence of a date is itself readable rather than silent.
    expect('as_of' in top.provenance).toBe(true);
    expect(typeof top.provenance.as_of_basis).toBe('string');
  });

  it.each(surfaces)('%s — structuredContent carries both blocks too', (_n, payload) => {
    const out = stampEnvelopeAttribution(asResult(payload), { toolName: 't', tier: 'free' });
    const sc = out.structuredContent;
    expect(typeof sc.citation).toBe('object');
    expect(typeof sc.citation.cite_as).toBe('string');
    expect('as_of' in sc.provenance).toBe(true);
  });

  it.each(surfaces)('%s — the original payload survives untouched', (_n, payload) => {
    const out = stampEnvelopeAttribution(asResult(payload), { toolName: 't', tier: 'free' });
    const top = parse0(out);
    for (const k of Object.keys(payload)) {
      if (k === 'citation' || k === 'provenance') continue;
      expect(top).toHaveProperty(k);
    }
  });
});

// ── 2. shape: object emitted, string accepted ─────────────────────────────
describe('citation shape is normalised to OBJECT (string accepted, never emitted)', () => {
  it('an inbound STRING citation is preserved as cite_as, not discarded', () => {
    const withString = { ...SEARCH_FACILITIES_GATED,
      citation: 'DC Hub Site Selection Canvas — dchub.cloud/site-selection (CC BY 4.0)' };
    // No gating markers stripped, so this stays a partial; the upstream text is
    // still the thing we must not throw away.
    const out = stampEnvelopeAttribution(asResult(withString), { toolName: 't', tier: 'free' });
    const top = parse0(out);
    expect(typeof top.citation).toBe('object');
    expect(top.citation._normalized_from).toBe('string');
    expect(top.citation.cite_as).toContain('Site Selection Canvas');
  });

  it('never EMITS a bare string on any channel', () => {
    for (const p of [EXECUTE_PLAN_LIVE, SEARCH_FACILITIES_GATED, GRID_GATED_WITH_BACKEND_PROV]) {
      const out = stampEnvelopeAttribution(asResult(p), { toolName: 't', tier: 'free' });
      expect(typeof parse0(out).citation).toBe('object');
      expect(typeof out.structuredContent.citation).toBe('object');
    }
  });
});

// ── 3. ANTI-INFLATION ─────────────────────────────────────────────────────
describe('does not inflate: as_of and verification counts describe THIS response', () => {
  it('no timestamp in the payload → as_of is null and basis says UNMEASURED', () => {
    // EXECUTE_PLAN_LIVE deliberately carries no as_of/generated_at anywhere.
    expect(collectTimestamps(EXECUTE_PLAN_LIVE)).toHaveLength(0);
    const p = buildProvenance(EXECUTE_PLAN_LIVE, { tier: 'free' });
    expect(p.as_of).toBeNull();
    expect(p.as_of_basis).toMatch(/UNMEASURED/);
    // and it must NOT quietly pass off the serve time as a data date
    expect(p.as_of).not.toBe(p.retrieved_at);
  });

  it('omits verification_counts entirely rather than zero-filling', () => {
    expect(collectVerificationCounts(EXECUTE_PLAN_LIVE)).toBeNull();
    const p = buildProvenance(EXECUTE_PLAN_LIVE, { tier: 'free' });
    expect('verification_counts' in p).toBe(false);   // a flattering zero is a bug
  });

  it('uses the REAL backend counts when the payload actually carries them', () => {
    const p = buildProvenance(GRID_GATED_WITH_BACKEND_PROV, { tier: 'free' });
    expect(p.verification_counts.verified).toBe(4903);
    expect(p.verification_counts.tracked).toBe(21900);
  });

  it('binds as_of to the OLDEST source timestamp, not the newest', () => {
    const mixed = { as_of: '2026-08-11T00:00:00.000Z',
                    nested: { generated_at: '2026-03-01T00:00:00.000Z' } };
    const p = buildProvenance(mixed, { tier: 'paid' });
    expect(p.as_of).toBe('2026-03-01T00:00:00.000Z');   // stalest input binds
    expect(p.as_of_range.newest).toBe('2026-08-11T00:00:00.000Z');
  });

  it('rejects an implausible future timestamp instead of citing it', () => {
    const future = new Date(Date.now() + 90 * 86400000).toISOString();
    expect(collectTimestamps({ as_of: future })).toHaveLength(0);
  });

  it('a real backend provenance block wins over the derived one', () => {
    const out = stampEnvelopeAttribution(
      asResult(GRID_GATED_WITH_BACKEND_PROV), { toolName: 't', tier: 'free' });
    expect(parse0(out).provenance.method).toBe('EIA-930 + ERCOT telemetry');
    expect(parse0(out).provenance.as_of).toBe('2026-08-11T14:00:00.000Z');
  });
});

// ── 4. a preview must SAY it is a preview ─────────────────────────────────
describe('gated / preview responses declare their own partiality', () => {
  it('detects the 1-of-41 anon trim and names the gap', () => {
    const g = detectGating(SEARCH_FACILITIES_GATED);
    expect(g).not.toBeNull();
    expect(g.shown).toBe(1);
    expect(g.total).toBe(41);
  });

  it('a 1-of-N preview says PARTIAL in the cite_as an agent quotes', () => {
    const p = buildProvenance(SEARCH_FACILITIES_GATED, { tier: 'free' });
    const c = buildCitation(SEARCH_FACILITIES_GATED, { tier: 'free' }, p);
    expect(p.completeness).toBe('partial_preview');
    expect(c.cite_as).toMatch(/PARTIAL/);
    expect(c.cite_as).toContain('1 of 41');
    expect(p.preview_warning).toMatch(/Do not present this as a complete dataset/i);
  });

  it('the execute_plan front door is flagged partial on the free tier', () => {
    const p = buildProvenance(EXECUTE_PLAN_LIVE, { tier: 'free' });
    expect(p.completeness).toBe('partial_preview');
    const c = buildCitation(EXECUTE_PLAN_LIVE, { tier: 'free' }, p);
    expect(c.cite_as).toMatch(/PARTIAL/);
  });

  it('completeness is three-valued and never claims more than it knows', () => {
    // ungated payload + free tier → we do NOT know the backend served it whole
    const clean = { _entity: 'response', rows: [{ a: 1 }] };
    expect(buildProvenance(clean, { tier: 'free' }).completeness).toBe('unknown');
    // ungated payload + a tier that actually removes the gates → unrestricted
    expect(buildProvenance(clean, { tier: 'enterprise' }).completeness).toBe('unrestricted');
    // gating marker present → partial, regardless of how good the tier is
    expect(buildProvenance(SEARCH_FACILITIES_GATED, { tier: 'enterprise' }).completeness)
      .toBe('partial_preview');
  });
});

// ── 5. it must never break a response ─────────────────────────────────────
describe('fail-soft: attribution never damages a tool result', () => {
  it('passes an error result through untouched', () => {
    const err = { isError: true, content: [{ type: 'text', text: 'boom' }] };
    expect(stampEnvelopeAttribution(err, {})).toBe(err);
  });

  it('leaves non-JSON content intact', () => {
    const r = { content: [{ type: 'text', text: 'plain prose, not JSON' }] };
    expect(stampEnvelopeAttribution(r, {}).content[0].text).toBe('plain prose, not JSON');
  });

  it('survives hostile input without throwing', () => {
    for (const v of [null, undefined, 42, 'str', [], {}, { content: 'nope' }]) {
      expect(() => stampEnvelopeAttribution(v, {})).not.toThrow();
    }
  });

  it('is idempotent — stamping twice does not double or drift', () => {
    const once = stampEnvelopeAttribution(asResult(SEARCH_FACILITIES_GATED), { tier: 'free' });
    const twice = stampEnvelopeAttribution(once, { tier: 'free' });
    expect(parse0(twice).citation.cite_as).toBe(parse0(once).citation.cite_as);
    expect(parse0(twice).provenance.completeness).toBe(parse0(once).provenance.completeness);
  });

  it('handles a cyclic payload without hanging', () => {
    const cyc = { a: 1 }; cyc.self = cyc;
    expect(() => buildProvenance(cyc, {})).not.toThrow();
  });
});
