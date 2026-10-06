// r-upstream-contract (2026-08-03): a non-2xx from the backend collapsed to
// `{ error: "API 404", detail: <raw slice> }`, discarding the code/hint/
// suggestions the backend had already produced. Measured 2026-08-02: 2 of 5
// error paths reached the agent with nothing actionable at all.
//
// These tests pin the two properties that matter and are easy to lose:
//   1. the backend's OWN words survive — we never replace a real hint with a
//      generic one (that is how a useful error becomes a useless one), and
//   2. every error still carries a severity from the BACKEND's vocabulary,
//      so an agent's state machine can branch on it.
import { describe, it, expect } from 'vitest';
import { _upstreamError } from '../server.mjs';

const j = (o) => JSON.stringify(o);

describe('_upstreamError', () => {
  it('keeps the backend\'s own hint rather than substituting a generic one', () => {
    // The real shape returned by a bad market slug, observed 2026-08-02.
    const out = _upstreamError(404, j({
      code: 'NOT_FOUND',
      detail: 'Use a valid market slug. Call rank_markets to list them.',
    }));
    expect(out._error_mitigation.deterministic_hint)
      .toBe('Use a valid market slug. Call rank_markets to list them.');
    // and the backend's own code wins over the status-derived one
    expect(out._error_mitigation.error_code).toBe('NOT_FOUND');
  });

  it('preserves hint + suggestions instead of flattening them away', () => {
    const out = _upstreamError(404, j({
      error: 'not found', hint: 'AI agent? See the integration map.',
      suggestions: ['/api/v1/ecosystem'], path: '/api/x', success: false,
    }));
    expect(out.hint).toBe('AI agent? See the integration map.');
    expect(out.suggestions).toEqual(['/api/v1/ecosystem']);
    expect(out.path).toBe('/api/x');
    expect(out._error_mitigation.deterministic_hint).toBe('AI agent? See the integration map.');
  });

  it('derives an honest code + severity when the backend named none', () => {
    const nf = _upstreamError(404, j({ error: 'nope', id: 'bad-slug' }));
    expect(nf._error_mitigation.error_code).toBe('upstream_not_found');
    expect(nf._error_mitigation.severity).toBe('parameter_adjustment');
    expect(nf.id).toBe('bad-slug');

    const bad = _upstreamError(422, j({ error: 'bad param' }));
    expect(bad._error_mitigation.error_code).toBe('invalid_parameter');
    expect(bad._error_mitigation.severity).toBe('parameter_adjustment');

    const down = _upstreamError(503, j({ error: 'upstream down' }));
    expect(down._error_mitigation.error_code).toBe('upstream_unavailable');
    expect(down._error_mitigation.severity).toBe('transient_backoff');
  });

  it('uses ONLY the backend severity vocabulary', () => {
    const allowed = new Set(['parameter_adjustment', 'transient_backoff', 'fatal']);
    for (const s of [400, 404, 409, 422, 500, 502, 503]) {
      const o = _upstreamError(s, j({ error: 'x' }));
      if (o._error_mitigation) {
        expect(allowed.has(o._error_mitigation.severity), `status ${s}`).toBe(true);
      }
    }
  });

  it('never becomes LESS informative than the old shape', () => {
    // Non-JSON upstream body: detail must still carry the raw slice, and the
    // response must still be recognizable as `API <status>`.
    const raw = '<html>gateway timeout</html>';
    const out = _upstreamError(504, raw);
    expect(out.error).toBe('API 504');
    expect(out.detail).toContain('gateway timeout');
  });

  it('does not invent a hint it cannot support', () => {
    // A status we have no honest generic guidance for must carry no
    // mitigation block at all rather than a plausible-sounding fabrication.
    const out = _upstreamError(418, j({ error: 'teapot' }));
    expect(out._error_mitigation).toBeUndefined();
    expect(out.error).toBe('API 418');
  });

  it('truncates a runaway body the same way the old code did', () => {
    const big = 'x'.repeat(5000);
    const out = _upstreamError(500, big);
    expect(out.detail.length).toBeLessThanOrEqual(500);
  });

  it('is wired into both callAPI helpers, not just one', () => {
    // callAPI and callAPIWrite each had their own copy of the collapsing
    // line; a fix applied to one only would leave every WRITE tool
    // (save_site / set_market_alert) still returning a bare status.
    const src = readSrc();
    expect((src.match(/_upstreamError\(resp\.status, text\)/g) || []).length).toBe(2);
    expect(src).not.toMatch(/error: `API \$\{resp\.status\}`, detail: text\.slice/);
  });
});

function readSrc() {
  // eslint-disable-next-line no-undef
  return require('node:fs').readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
}


// ── guidance fields survive a 4xx (Grok 2026-10-06: the WECC explanation was dropped) ──────────
describe('_upstreamError guidance passthrough', () => {
  // The body get_retirement_headroom's backend sends for region_iso=WECC (be#6423).
  const WECC = {
    ok: false, _entity: 'error', error: "unknown region_iso 'WECC'", ignored: ['WECC'],
    known: ['CAISO', 'ERCOT', 'ISONE', 'MISO', 'NYISO', 'PJM', 'SPP'],
    also_accepted: 'any EIA balancing-authority code present in the retirement data',
    balancing_authorities_in_data: ['MISO', 'PJM', 'TVA', 'SWPP', 'NYIS', 'CISO'],
    note: 'WECC is an interconnection, not a balancing authority: pass the balancing-authority codes inside it, e.g. AZPS, SRP, WALC, PACE, BPAT.',
  };
  it('control: the old allowlist alone would have dropped every one of these', () => {
    const out = _upstreamError(400, j(WECC));
    expect(out.error).toBe('API 400');
    expect(out.detail).toBe("unknown region_iso 'WECC'");
  });
  it('a 400 keeps note, known, ignored, also_accepted and balancing_authorities_in_data', () => {
    const out = _upstreamError(400, j(WECC));
    expect(out.note).toMatch(/interconnection, not a balancing authority/);
    expect(out.known).toEqual(WECC.known);
    expect(out.ignored).toEqual(['WECC']);
    expect(out.also_accepted).toMatch(/balancing-authority code/);
    expect(out.balancing_authorities_in_data).toEqual(WECC.balancing_authorities_in_data);
  });
  it('everything else the backend put in the body stays out (allowlist, not passthrough)', () => {
    const out = _upstreamError(400, j({ ...WECC, trace: 'Traceback ...', internal_dsn: 'postgres://x', ok: false, _entity: 'error' }));
    expect(JSON.stringify(out)).not.toMatch(/Traceback|postgres:\/\/|internal_dsn/);
    expect(out._entity).toBeUndefined();
  });
  it('a 5xx body is not guidance and passes none of it', () => {
    const out = _upstreamError(503, j(WECC));
    for (const k of ['note', 'known', 'ignored', 'also_accepted', 'balancing_authorities_in_data']) expect(out[k], k).toBeUndefined();
  });
  it('is bounded: long strings are cut, arrays capped, non-scalar entries and objects dropped', () => {
    const out = _upstreamError(400, j({
      error: 'x', note: 'n'.repeat(5000),
      balancing_authorities_in_data: Array.from({ length: 500 }, (_, i) => 'CODE' + i),
      known: [{ a: 1 }, ['nested'], 'OK', 7], ignored: { not: 'a list' }, also_accepted: 12345,
    }));
    expect(out.note.length).toBe(600);
    expect(out.balancing_authorities_in_data.length).toBe(100);
    expect(out.known).toEqual(['OK', 7]);
    expect(out.ignored).toBeUndefined();
    expect(out.also_accepted).toBeUndefined();
  });
  it('the existing fields and the mitigation block are untouched by it', () => {
    const out = _upstreamError(400, j({ ...WECC, hint: 'try AZPS', code: 'BAD_REGION' }));
    expect(out.hint).toBe('try AZPS');
    expect(out.code).toBe('BAD_REGION');
    expect(out._error_mitigation.error_code).toBe('BAD_REGION');
    expect(out._error_mitigation.deterministic_hint).toBe('try AZPS');
  });
});

