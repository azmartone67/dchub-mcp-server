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
