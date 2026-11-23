// upstream-empty-retryable-1123.test.mjs — QA v2.12.63 (2026-11-23, P3 item g).
//
// 2 of ~20 calls (analyze_site, find_sites, IA) came back EMPTY after ~15 s and answered on a retry.
// callAPI turned an empty 2xx body into {raw: ''} and a deadline abort into {error: '<abort message>'};
// neither is a failure envelope (_isFailureEnvelope reads "API <status>" or _error_mitigation), so the
// tool served an empty answer as if the backend had found nothing.
//
// Now both are a failure envelope with retryable: true and retry_after_s, the tool result is isError,
// and one structured [upstream-retryable] log line names the tool, the path, the reason and elapsed_ms.
// No timeout changes. The real server.mjs on loopback against a stub backend (no network).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

let H, fence;
const routes = (p) => {
  if (p === '/api/v1/sites/find') return { status: 200, raw: '' };
  if (p === '/api/site-score') return { status: 200, raw: '   \n' };
  if (p === '/api/v1/rank-sites') return { status: 200, raw: '' };
  return undefined;
};
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: routes });
}, 240_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

const captureLog = async (fn) => {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(' ')); };
  try { return { out: await fn(), lines }; } finally { console.log = orig; }
};
const logged = (lines) => lines.filter((l) => l.startsWith('[upstream-retryable] '))
  .map((l) => JSON.parse(l.slice('[upstream-retryable] '.length)));

describe('an empty backend body is a retryable failure, not an empty answer', () => {
  it('find_sites (text-only tool): isError, retryable, retry_after_s, and one structured log line', async () => {
    const { out: r, lines } = await captureLog(() => H.call('/mcp', 'find_sites', { state: 'IA' }));
    const res = r.msg && r.msg.result;
    expect(res, r.raw.slice(0, 300)).toBeTruthy();
    expect(res.isError).toBe(true);
    const body = JSON.stringify(res);
    expect(body).toMatch(/\\?"retryable\\?":\s*true/);
    expect(body).toMatch(/retry_after_s/);
    expect(body).toMatch(/upstream_empty_response/);
    const L = logged(lines).filter((x) => x.path === '/api/v1/sites/find');
    expect(L.length, lines.join('\n').slice(0, 500)).toBeGreaterThanOrEqual(1);
    expect(L[0]).toMatchObject({ tool: 'find_sites', reason: 'empty_body' });
    expect(Number.isFinite(L[0].elapsed_ms)).toBe(true);
  }, 60_000);

  it('analyze_site (structuredContent tool, full-access key): a whitespace-only body is the same failure', async () => {
    const { out: r, lines } = await captureLog(() => H.call('/mcp', 'analyze_site', { lat: 41.6, lon: -93.6 }, { 'x-api-key': PRO_KEY }));
    const res = r.msg && r.msg.result;
    expect(res, r.raw.slice(0, 300)).toBeTruthy();
    expect(res.isError, r.raw.slice(0, 600)).toBe(true);
    expect(JSON.stringify(res)).toMatch(/\\?"retryable\\?":\s*true/);
    expect(logged(lines).some((x) => x.tool === 'analyze_site' && x.path === '/api/site-score' && x.reason === 'empty_body')).toBe(true);
  }, 60_000);
});

describe('a write is never told to retry itself', () => {
  it('rank_sites (POST): an empty body is not turned into a retryable failure and logs no retry line', async () => {
    const { lines } = await captureLog(() => H.call('/mcp', 'rank_sites',
      { candidates: [{ id: 'a', lat: 41.6, lon: -93.6 }], objectives: { power: 1 } }, { 'x-api-key': PRO_KEY }));
    expect(logged(lines).filter((x) => x.path === '/api/v1/rank-sites')).toEqual([]);
  }, 60_000);
});

describe('the envelope itself (pure)', () => {
  it('a deadline abort is a timeout; any other transport error is not', () => {
    const t = new Error('The operation was aborted due to timeout'); t.name = 'TimeoutError';
    const a = new Error('This operation was aborted'); a.name = 'AbortError';
    expect(H.S._isTimeoutError(t)).toBe(true);
    expect(H.S._isTimeoutError(a)).toBe(true);
    expect(H.S._isTimeoutError(new TypeError('fetch failed'))).toBe(false);
    expect(H.S._isTimeoutError(null)).toBeFalsy();
  });
  it('reads as a failure (so the tool result is isError) and carries retry fields', async () => {
    const { out: e, lines } = await captureLog(() => H.S._upstreamRetryable('timeout', '/api/v1/site-score?lat=1', 15012, { _askTool: 'analyze_site' }));
    expect(e).toMatchObject({ error: 'upstream_timeout', retryable: true, retry_after_s: 5 });
    expect(e._error_mitigation).toMatchObject({ error_code: 'upstream_timeout', severity: 'transient_backoff', retryable: true });
    expect(H.S._isFailureEnvelope({ structuredContent: e })).toBe(true);
    expect(logged(lines)).toEqual([{ tool: 'analyze_site', path: '/api/v1/site-score', reason: 'timeout', elapsed_ms: 15012 }]);
  });
});
