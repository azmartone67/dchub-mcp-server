/**
 * r-cap-enforce (2026-08-31) — the daily full-answer cap now actually bites.
 *
 * THE DEFECT
 * ──────────
 * `_fullCapHydrate` was fired and abandoned on the line immediately before the
 * local count was read:
 *
 *     _fullCapHydrate(key, id, tool, cap);            // async, never awaited
 *     const n = (_trialDayCounts.get(key) || 0) + 1;  // reads local, still 0
 *
 * So a fresh replica always decided from a count of zero, whatever the durable
 * counter said. The peek landed after the answer had already shipped, and the
 * hydrated-marker was set BEFORE it resolved, so hydration happened once per
 * process and never affected the call that triggered it. Effective cap was
 * (replicas x cap).
 *
 * MEASURED 2026-08-31 (mcp_full_answer_counts, 30d, declared cap = 2):
 *   847 of 1,859 (identity, tool, day) buckets were ABOVE the cap
 *   worst bucket n = 21
 *   3,712 full answers served past the declared limit
 *   gated share of real payable-tool calls: 27/1,985 = 1.4%
 *
 * A durable counter whose value arrives after the decision is not a counter,
 * it is a log.
 *
 * Pure-local: a stub peek endpoint on 127.0.0.1. No prod, no network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';

let srv, base, mode = 'over', peeks = 0;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    if (!req.url.startsWith('/api/v1/mcp/full-cap/peek')) { res.writeHead(404); res.end('{}'); return; }
    peeks += 1;
    if (mode === 'hang') return;                       // never responds -> timeout
    if (mode === 'error') { res.writeHead(500); res.end('boom'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    // 'over' = the durable counter already knows this identity used its 2.
    res.end(JSON.stringify(mode === 'over' ? { ok: true, n: 2 } : { ok: false }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  process.env.DCHUB_API_BASE = base;
  process.env.DCHUB_FULL_CAP_PEEK_MS = '800';
});
afterAll(() => srv && srv.close());

async function freshServer() {
  // A fresh module instance = a fresh replica: empty local Maps and env re-read.
  vi.resetModules();
  const m = await import('../server.mjs');
  m._trialDayCounts.clear();
  m._fullCapHydrated.clear();
  return m;
}

beforeEach(() => { peeks = 0; mode = 'over'; });

describe('the durable count is consulted BEFORE the gate decides', () => {
  it('gates the FIRST call on a fresh replica when the day is already spent', async () => {
    // ★ THE REGRESSION. Pre-fix this returned false: local count 0 -> n=1 -> allowed,
    // and the peek saying "you already had 2" landed after the answer shipped.
    const m = await freshServer();
    const over = await m._trialFullCallsExceeded('9.9.9.9', 'get_grid_intelligence', 2, 'id-spent');
    expect(over).toBe(true);
    expect(peeks).toBe(1);
  });

  it('still allows a caller the durable counter has never seen', async () => {
    // The safety property: enforcing the cap must not wall a first-time caller.
    mode = 'fresh';                                    // {ok:false} -> no durable count
    const m = await freshServer();
    expect(await m._trialFullCallsExceeded('1.1.1.1', 'get_fiber_intel', 2, 'id-new')).toBe(false);
    expect(await m._trialFullCallsExceeded('1.1.1.1', 'get_fiber_intel', 2, 'id-new')).toBe(false);
    // third call of the day on the same tool -> over cap
    expect(await m._trialFullCallsExceeded('1.1.1.1', 'get_fiber_intel', 2, 'id-new')).toBe(true);
  });

  it('peeks once per (identity, tool, day) per process, not once per call', async () => {
    const m = await freshServer();
    await m._trialFullCallsExceeded('2.2.2.2', 'get_market_intel', 2, 'id-a');
    await m._trialFullCallsExceeded('2.2.2.2', 'get_market_intel', 2, 'id-a');
    await m._trialFullCallsExceeded('2.2.2.2', 'get_market_intel', 2, 'id-a');
    expect(peeks).toBe(1);
  });

  it('concurrent first-calls await the SAME peek instead of racing past it', async () => {
    // Pre-fix each concurrent call fired its own peek and read a local 0.
    const m = await freshServer();
    const rs = await Promise.all(Array.from({ length: 5 }, () =>
      m._trialFullCallsExceeded('3.3.3.3', 'get_grid_intelligence', 2, 'id-conc')));
    expect(peeks).toBe(1);
    expect(rs.every((r) => r === true)).toBe(true);   // durable already at cap
  });
});

describe('fail-open is preserved — a backend problem must never wall a caller', () => {
  it('a peek that errors falls back to the local count and allows', async () => {
    mode = 'error';
    const m = await freshServer();
    expect(await m._trialFullCallsExceeded('4.4.4.4', 'get_fiber_intel', 2, 'id-err')).toBe(false);
  });

  it('a peek that hangs times out and allows rather than stalling forever', async () => {
    mode = 'hang';
    const m = await freshServer();
    const t0 = Date.now();
    const over = await m._trialFullCallsExceeded('5.5.5.5', 'get_fiber_intel', 2, 'id-hang');
    const ms = Date.now() - t0;
    expect(over).toBe(false);
    expect(ms).toBeLessThan(3000);        // bounded by DCHUB_FULL_CAP_PEEK_MS, not the 5s default
  });
});

describe('the kill switch restores the previous behaviour exactly', () => {
  it('DCHUB_FULL_CAP_PEEK_MS=0 does not wait, so a spent day is not seen', async () => {
    process.env.DCHUB_FULL_CAP_PEEK_MS = '0';
    try {
      const m = await freshServer();
      expect(m.FULL_CAP_PEEK_MS).toBe(0);
      // Same input that gates above; with no wait it allows, as it did pre-fix.
      expect(await m._trialFullCallsExceeded('6.6.6.6', 'get_grid_intelligence', 2, 'id-off')).toBe(false);
    } finally {
      process.env.DCHUB_FULL_CAP_PEEK_MS = '800';
    }
  });
});

describe('source guard — an un-awaited call site gates 100% of traffic', () => {
  it('every _trialFullCallsExceeded call site is awaited', () => {
    // ★ The function is async now, so a bare call evaluates to a Promise, which
    // is TRUTHY. A single missed `await` does not fail open, it fails CLOSED on
    // every payable call. node --check cannot see this; this can.
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const bad = src.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => l.includes('_trialFullCallsExceeded(')
        && !l.includes('export async function')
        && !l.includes('await _trialFullCallsExceeded('));
    expect(bad.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });

  it('the function is declared async', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toContain('export async function _trialFullCallsExceeded(');
  });
});
