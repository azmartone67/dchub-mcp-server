// ── the token diet, and the line it must not cross ──────────────────────────
//
// ASKED FOR BY THREE AGENTS in the 2026-08-29 partner round:
//   Gemini  "Every token you send consumes the user's context window and slows
//            time-to-first-token." It then supplied the exact 17-field siting
//            set, and asked for a preset alias because "projection='siting_
//            summary' saves input prompt tokens on tool invocation."
//   Copilot "Support a `fields` param so Copilot can request only the minimal
//            fields it needs."
//   Mistral the same, under caching.
//
// ★★★ THE INVARIANT THESE TESTS EXIST FOR: A PROJECTION NARROWS ROWS, NEVER THE
// ENVELOPE. Everything DC Hub says about the HONESTY of an answer — citation,
// provenance/as_of, what it could not cover, which arguments it ignored, which
// credential it used, and the verbatim human relay line — is not data a caller
// may opt out of. A caller that could project away `constraint_coverage` would
// get a cheaper answer that is also a less honest one, and would never know it
// had made that trade.
//
// That is not hypothetical: `for_your_human` is the only link a human can act
// on, and `citation` is what makes a figure quotable. Dropping either to save
// bytes breaks a doctrine. Gemini's own example payload keeps
// request_interpretation, as_of, completeness and cite_as while projecting
// `results` — so this is its rule, made mechanical.
import { describe, it, expect } from 'vitest';
import { _resolveProjection, _applyProjection } from '../server.mjs';

const ENVELOPE = {
  ok: true,
  citation: { source: 'DC Hub', cite_as: 'DC Hub, dchub.cloud' },
  provenance: { as_of: '2026-08-29T00:00:00Z' },
  // ★ THE ARRAY SHAPE, deliberately. constraint_coverage is an OBJECT keyed by
  // field on the canvas and a LIST of prose caveats on
  // get_power_availability_timeline. Only the ARRAY shape exercises the
  // keep-list at all — a projector's loop leaves non-array values alone
  // anyway. An object-shaped fixture here passed the mutation control and
  // proved nothing (caught 2026-08-29, before merge).
  constraint_coverage: ['generation is not deliverable load — a supply signal is never a promise that a specific load can energize'],
  sources: [{ name: 'EIA-860', as_of: '2026-08-01' }, { name: 'ERCOT', as_of: '2026-08-29' }],
  request_interpretation: { unsupported_arguments: ['required_mw'] },
  identity: { credential_source: 'query', tier: 'free' },
  for_your_human: '→ **For your human:** open https://dchub.cloud/upgrade',
  empty_result: { reason: 'no_market_met_the_verdict_filter' },
  quota: { tier: 'free' },
  matched: 2,
  markets: [
    { market: 'Abilene', slug: 'abilene', state: 'TX', iso: 'ERCOT', verdict: 'BUILD',
      composite_score: 83, excess_power_score: 85.7, constraint_score: 22.8,
      time_to_power_months: 9.6, dcpi_url: 'https://dchub.cloud/dcpi/abilene',
      operator_notes: 'x'.repeat(400), analyst_narrative: 'y'.repeat(400) },
    { market: 'Akron', slug: 'akron-oh', state: 'OH', iso: 'PJM', verdict: 'AVOID',
      composite_score: 29.3, excess_power_score: 40, constraint_score: 17,
      time_to_power_months: 42, dcpi_url: 'https://dchub.cloud/dcpi/akron-oh',
      operator_notes: 'x'.repeat(400), analyst_narrative: 'y'.repeat(400) },
  ],
};

describe('_resolveProjection', () => {
  it('accepts an explicit array', () => {
    expect([..._resolveProjection(['slug', 'verdict'], undefined)]).toEqual(['slug', 'verdict']);
  });
  it('accepts a comma string (what a URL-shaped caller sends)', () => {
    expect([..._resolveProjection('slug, verdict', undefined)]).toEqual(['slug', 'verdict']);
  });
  it('resolves Gemini\'s preset alias', () => {
    const p = _resolveProjection(undefined, 'siting_summary');
    expect(p.has('composite_score')).toBe(true);
    expect(p.has('water_stress_index')).toBe(true);
    expect(p.size).toBe(17);                    // the exact set Gemini specified
  });
  it('a preset and an explicit list UNION rather than one silently winning', () => {
    const p = _resolveProjection(['tenant_count'], 'market_summary');
    expect(p.has('tenant_count')).toBe(true);
    expect(p.has('verdict')).toBe(true);
  });
  it('no projection asked for -> null, and null means untouched', () => {
    expect(_resolveProjection(undefined, undefined)).toBeNull();
    expect(_resolveProjection([], '')).toBeNull();
    expect(_applyProjection(ENVELOPE, null)).toBe(ENVELOPE);
  });
});

describe('_applyProjection — rows narrow', () => {
  const out = _applyProjection(ENVELOPE, _resolveProjection(undefined, 'market_summary'));
  it('drops the long prose fields that dominate the payload', () => {
    for (const row of out.markets) {
      expect(row.operator_notes).toBeUndefined();
      expect(row.analyst_narrative).toBeUndefined();
    }
  });
  it('keeps every requested field', () => {
    expect(out.markets[0].verdict).toBe('BUILD');
    expect(out.markets[0].composite_score).toBe(83);
    expect(out.markets[0].dcpi_url).toContain('dchub.cloud');
  });
  it('actually saves tokens — the point of the exercise', () => {
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(ENVELOPE).length / 2);
  });
});

// ★★★ The line. Each of these, dropped, would break something named.
describe('_applyProjection — the envelope is NOT projectable', () => {
  const KEEP = ['citation', 'provenance', 'constraint_coverage', 'request_interpretation',
                'identity', 'for_your_human', 'empty_result', 'quota', 'ok', 'matched', 'sources'];
  it('survives a projection that names none of it', () => {
    const out = _applyProjection(ENVELOPE, _resolveProjection(['slug'], undefined));
    for (const k of KEEP) expect(out[k], `projection dropped ${k}`).toBeDefined();
  });
  it('survives the narrowest projection possible', () => {
    const out = _applyProjection(ENVELOPE, _resolveProjection(['nothing_matches_this'], undefined));
    for (const k of KEEP) expect(out[k], `projection dropped ${k}`).toBeDefined();
  });
  it('an ARRAY-shaped envelope value keeps its CONTENTS, not just its key', () => {
    const out = _applyProjection(ENVELOPE, _resolveProjection(['slug'], undefined));
    expect(out.constraint_coverage).toEqual(ENVELOPE.constraint_coverage);
    expect(out.sources).toEqual(ENVELOPE.sources);
  });

  // ★★★ THE CASE THE KEEP-LIST ACTUALLY EXISTS FOR, and the only one that can
  // detect its removal. Two earlier versions of this block passed the mutation
  // control and proved NOTHING: a projection that shares no field with an
  // envelope row is already safe, because a row matching nothing is returned
  // whole. The keep-list only bites when the projection PARTIALLY matches an
  // envelope row — then, without it, the row is silently narrowed.
  //
  // `siting_summary` contains BOTH `name` and `as_of`, and a provenance source
  // row is {name, as_of}. Any preset overlapping a provenance row would quietly
  // strip the other half of it, so an agent would cite a source with no date —
  // the exact failure `as_of` discipline exists to prevent.
  it('a projection that PARTIALLY matches a provenance row must not narrow it', () => {
    const keep = _resolveProjection(['name'], undefined);   // matches sources[].name only
    const out = _applyProjection(ENVELOPE, keep);
    expect(out.sources[0]).toEqual(ENVELOPE.sources[0]);    // as_of survives
    expect(out.sources[0].as_of).toBe('2026-08-01');
  });

  it('the same overlap through the real siting_summary preset', () => {
    const out = _applyProjection(ENVELOPE, _resolveProjection(undefined, 'siting_summary'));
    expect(out.sources[0].as_of).toBe('2026-08-01');
    expect(out.sources[0].name).toBe('EIA-860');
  });
  it('the human relay line is preserved verbatim, not merely present', () => {
    const out = _applyProjection(ENVELOPE, _resolveProjection(['slug'], undefined));
    expect(out.for_your_human).toBe(ENVELOPE.for_your_human);
  });
  it('underscore-prefixed internals (_total_in_pro counters) are preserved', () => {
    const withCounter = { ...ENVELOPE, _markets_total_in_pro: 300 };
    expect(_applyProjection(withCounter, _resolveProjection(['slug'], undefined))._markets_total_in_pro)
      .toBe(300);
  });
});

describe('_applyProjection — never lies about a row', () => {
  it('a row sharing NO field with the projection comes back WHOLE, not empty', () => {
    // {} would read as "this record is empty", a different and false claim.
    // Under-projecting is recoverable; lying about a record is not.
    const out = _applyProjection({ rows: [{ a: 1, b: 2 }] }, _resolveProjection(['zzz'], undefined));
    expect(out.rows[0]).toEqual({ a: 1, b: 2 });
  });
  it('non-object rows pass through untouched', () => {
    const out = _applyProjection({ rows: ['abilene', 42, null] }, _resolveProjection(['slug'], undefined));
    expect(out.rows).toEqual(['abilene', 42, null]);
  });
  it('a bare top-level array is projected too', () => {
    const out = _applyProjection([{ slug: 'a', junk: 1 }], _resolveProjection(['slug'], undefined));
    expect(out).toEqual([{ slug: 'a' }]);
  });
});
