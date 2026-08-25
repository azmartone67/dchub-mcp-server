// upstream-error-iserror.test.mjs — (2026-08-25)
//
// LOCAL argument validation has always stamped isError:true (_isoError,
// _coordsError both do, literally). An UPSTREAM rejection of the same argument
// did not. Measured live 2026-08-25:
//
//   rank_sites {candidates:[…]} -> structuredContent.error "API 400",
//                                  _error_mitigation present, NO isError key
//
// Same failure class, two transport signals. A client branching on
// result.isError — which is what the protocol says it is for — could not see
// the upstream one.
//
// ★ The interesting half of this file is what must NOT change. The preview and
// paywall transport decisions at server.mjs:518-545 are MEASURED on both sides:
// isError:true lifted trial conversion off 0% on Claude/Cursor/Cline, while
// Grok and Mistral Le Chat read isError as a HARD failure and bail on a served
// preview. A served preview is not an error and must never be flagged as one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _flagUpstreamError } from '../server.mjs';

const wrap = (sc, extra = {}) => ({
  content: [{ type: 'text', text: JSON.stringify(sc) }],
  structuredContent: sc,
  ...extra,
});

describe('genuine upstream failures get flagged', () => {
  it('flags a payload carrying _error_mitigation', () => {
    const r = _flagUpstreamError(wrap({
      error: 'API 400',
      detail: 'objectives required: {field: weight}',
      _error_mitigation: { error_code: 'invalid_parameter' },
    }), 'rank_sites');
    expect(r.isError).toBe(true);
  });

  it('flags a bare "API <status>" error string', () => {
    expect(_flagUpstreamError(wrap({ error: 'API 503' }), 'x').isError).toBe(true);
  });

  it('flags on _error_mitigation ALONE, with a non-"API NNN" error string', () => {
    // Isolates the two markers. Mutation-tested: without this, deleting the
    // _error_mitigation branch entirely still passed, because every other
    // fixture also carried an "API NNN" string for the second branch to match.
    const r = _flagUpstreamError(wrap({
      error: 'upstream refused the geometry',
      _error_mitigation: { error_code: 'invalid_parameter' },
    }), 'analyze_parcel');
    expect(r.isError).toBe(true);
  });

  it('leaves the rest of the result untouched', () => {
    const sc = { error: 'API 400', detail: 'd' };
    const r = _flagUpstreamError(wrap(sc, { _keep: 1 }), 'x');
    expect(r.structuredContent).toEqual(sc);
    expect(r._keep).toBe(1);
    expect(Array.isArray(r.content)).toBe(true);
  });
});

describe('★ every explicit transport decision survives untouched', () => {
  it('does NOT override a preview that set isError:false', () => {
    // DCHUB_PREVIEW_ISERROR=0 — the agent-friendly setting production runs.
    // Flagging this would make Grok and Mistral bail on a SERVED result.
    const r = _flagUpstreamError(wrap({ error: 'API 400' }, { isError: false }), 'x');
    expect(r.isError).toBe(false);
  });

  it('does NOT override a wall that set isError:true', () => {
    const r = _flagUpstreamError(wrap({ ok: true }, { isError: true }), 'x');
    expect(r.isError).toBe(true);
  });

  it('does NOT flag a served preview (no error markers, no isError key)', () => {
    const r = _flagUpstreamError(wrap({
      results: [{ id: 1 }], _results_total_in_pro: 40, _upgrade: { url: 'x' },
    }), 'rank_sites');
    expect(r.isError).toBeUndefined();
  });

  it('does NOT flag a success payload', () => {
    expect(_flagUpstreamError(wrap({ ok: true, data: [] }), 'x').isError).toBeUndefined();
  });
});

describe('the marker is specific, not "any truthy error"', () => {
  it('ignores a nested/unrelated error field', () => {
    // A successful payload may legitimately carry an `error` describing
    // something OTHER than this call — matching bare truthiness would flag it.
    const r = _flagUpstreamError(wrap({
      ok: true, feeds: [{ feed: 'eia', error: 'last run failed' }],
    }), 'x');
    expect(r.isError).toBeUndefined();
  });

  it('ignores a non-"API NNN" error string with no mitigation block', () => {
    expect(_flagUpstreamError(wrap({ error: 'partial coverage' }), 'x').isError).toBeUndefined();
  });

  it('ignores array and non-object structuredContent', () => {
    expect(_flagUpstreamError(wrap([{ error: 'API 400' }]), 'x').isError).toBeUndefined();
    expect(_flagUpstreamError({ content: [], structuredContent: 'API 400' }, 'x').isError).toBeUndefined();
  });
});

describe('fail-soft', () => {
  it('returns falsy input unchanged rather than throwing', () => {
    expect(_flagUpstreamError(null, 'x')).toBe(null);
    expect(_flagUpstreamError(undefined, 'x')).toBe(undefined);
  });

  it('survives a structuredContent whose getter throws', () => {
    const evil = { content: [] };
    Object.defineProperty(evil, 'structuredContent', {
      get() { throw new Error('boom'); },
    });
    expect(() => _flagUpstreamError(evil, 'x')).not.toThrow();
  });
});


describe('★ it is actually WIRED into dispatch', () => {
  // Mutation-tested: deleting the call from the dispatch chain left every
  // behavioural test above green. A pure unit test proves the function is
  // correct and says NOTHING about whether anything calls it.
  it('wraps the tool-dispatch return chain', () => {
    // ★ Pins that it is called from the dispatch arrow, NOT the literal
    // composition beneath it. The first version matched
    // `_flagUpstreamError(_stampAttribution(` and broke the moment Stage 0a
    // nested _stampRequestInterpretation between them — a correct change. A
    // guard should fail on lost behaviour, not on a new sibling wrapper.
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const call = src.match(/=> _flagUpstreamError\(/g) || [];
    expect(call.length).toBe(1);
  });

  it('is the OUTERMOST wrapper, so nothing after it can drop the flag', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    // The dispatch arrow must hand its result straight to _flagUpstreamError.
    expect(src).toMatch(/async \(args, extra\) => _flagUpstreamError\(/);
  });
});
