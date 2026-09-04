/**
 * r-anon-hard-wall (2026-09-01) — the anonymous soft cap gains an escalation.
 *
 * THE MEASURED CAUSE
 * ──────────────────
 * `chain-hire` (UA `chain-hire/1.0 (MCP client; doubao 2026)`) made 1,345
 * anonymous calls in ONE day against DCHUB_ANON_DAILY_CAP=30 — 45x the cap —
 * to a single tool (`search`), at a flat 100-132 calls/hour for 14 hours,
 * holding no api_key at any point. From mcp_call_log:
 *
 *   api_key | tier | status         | tool   | calls
 *   (NULL)  | free | anon_daily_cap | search |  1410
 *   (NULL)  | free | ok             | search |    63
 *
 * 1,410 calls were logged OVER the cap and served anyway. That is the soft
 * cap working as designed — its own comment says "a CARROT, not a wall ...
 * No 429, isError stays false" — and a carrot is exactly the wrong instrument
 * for a loop that cannot read an envelope. It was 69.6% of the rolling-7d
 * headline. Across 30d, anon_daily_cap fired 7,073 times over 3,517 sessions.
 *
 * WHAT THIS ADDS, AND WHAT IT MUST NOT BREAK
 * ──────────────────────────────────────────
 * A second threshold at MULT x cap (owner's call: 10x => 300/IP/day at the
 * production cap of 30). Below it, nothing changes. The two properties that
 * make this safe are INHERITED from the soft cap and are the real subject of
 * this file — the happy path is the least interesting assertion here:
 *
 *   1. INERT when DCHUB_ANON_DAILY_CAP <= 0  (no fetch, no wall, no latency)
 *   2. FAIL-OPEN on any unreadable count     (a backend hiccup never walls)
 *
 * Pure-local: a stub anon-usage endpoint on 127.0.0.1. No prod, no network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';

let srv, base, mode = 'count', served = 0, fetches = 0;

// A hang test must fire its deadline only once the backend actually HOLDS the
// request. Aborting earlier proves nothing (the read never reached the stub)
// and lets the request land during the NEXT test, inflating its fetch count —
// which is exactly what a first cut of this file did.
let hangSeen = 0, hangNotify = () => {};
const untilHung = (n) => new Promise((resolve) => {
  const check = () => { if (hangSeen >= n) resolve(); };
  hangNotify = check;
  check();
});

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    if (!req.url.startsWith('/api/v1/mcp/anon-usage')) { res.writeHead(404); res.end('{}'); return; }
    fetches += 1;
    if (mode === 'hang') { hangSeen += 1; hangNotify(); return; }  // never responds -> timeout
    if (mode === 'error') { res.writeHead(500); res.end('boom'); return; }
    if (mode === 'garbage') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('not json'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: served }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => srv && srv.close());

// A fresh module instance = a fresh replica: env re-read, local cache empty.
async function freshServer({ cap, mult } = {}) {
  vi.resetModules();
  process.env.DCHUB_API_BASE = base;
  if (cap  !== undefined) process.env.DCHUB_ANON_DAILY_CAP = String(cap);
  if (mult !== undefined) process.env.DCHUB_ANON_HARD_WALL_MULT = String(mult);
  const m = await import('../server.mjs');
  m._anonUsageCounts.clear();
  // ★ DETERMINISM (2026-09-04): the anon count read is bounded by a real 2500ms
  // AbortSignal. The stub answers on 127.0.0.1 in microseconds, so under the
  // full 158-file suite that deadline is not a property under test — it is a
  // race against the OS scheduler, and losing it aborts a read the stub already
  // answered, which fails open to count 0 and flips a walling assertion to
  // false. Measured on main 2026-09-04, that is exactly how "still reports
  // over-CAP across that whole band" failed 2 of 3 full-suite runs while
  // passing 10/10 in isolation. A deadline no scheduling stall can reach
  // removes the race and changes no assertion. The one test that OWNS the
  // deadline property installs its own controllable one — see FAIL-OPEN below.
  m._readDeadline.signal = () => AbortSignal.timeout(120_000);
  return m;
}

beforeEach(() => { mode = 'count'; served = 0; fetches = 0; hangSeen = 0; });

describe('the hard wall lands at MULT x the cap and nowhere earlier', () => {
  it('does not wall inside the carrot band, and walls at exactly 10x', async () => {
    // cap 30, mult 10 => carrot 30..299, wall at 300. The band is the whole
    // point: a real agent that hits the cap keeps getting its trimmed preview
    // and its claim_free_key nudge, exactly as before this change.
    //
    // ★ ONE import, not five (2026-09-04). cap and mult are identical at every
    // point on the band — only the stub-side count moves — so the four extra
    // vi.resetModules() re-evaluations of 19k lines of server.mjs bought
    // nothing and cost the test its determinism: at ~1s per reload under the
    // full suite this ran past the 5s default testTimeout in 3 of 3 measured
    // runs, while passing in isolation. Clearing the 60s per-IP cache gives
    // each point the same cold read a fresh module did, and the `fetches`
    // assertion proves every point really was read from the backend rather
    // than served from that cache.
    const m = await freshServer({ cap: 30, mult: 10 });
    const seen = [];
    for (const count of [0, 30, 299, 300, 1345]) {
      served = count;
      m._anonUsageCounts.clear();
      seen.push([count, await m._anonHardWalled('9.9.9.9')]);
    }
    expect(seen).toEqual([[0, false], [30, false], [299, false], [300, true], [1345, true]]);
    expect(fetches, 'every point must be a fresh backend read, not the 60s cache').toBe(5);
  });

  it('still reports over-CAP across that whole band — the carrot is untouched', async () => {
    served = 299;
    const m = await freshServer({ cap: 30, mult: 10 });
    expect(await m._anonOverCap('9.9.9.9')).toBe(true);    // soft cap still fires
    expect(await m._anonHardWalled('9.9.9.9')).toBe(false); // hard wall does not
  });

  it("chain-hire's own 1,345-call day would have been walled", async () => {
    served = 1345;
    const m = await freshServer({ cap: 30, mult: 10 });
    expect(await m._anonHardWalled('175.147.105.129')).toBe(true);
  });
});

describe('INERT — a disabled cap or a zero multiple costs nothing', () => {
  it('makes NO fetch and never walls when the cap is off', async () => {
    served = 999999;
    const m = await freshServer({ cap: 0, mult: 10 });
    expect(await m._anonHardWalled('9.9.9.9')).toBe(false);
    expect(await m._anonOverCap('9.9.9.9')).toBe(false);
    expect(fetches, 'a disabled cap must not touch the backend at all').toBe(0);
  });

  it('MULT=0 disables the wall but leaves the soft cap intact', async () => {
    served = 999999;
    const m = await freshServer({ cap: 30, mult: 0 });
    expect(await m._anonHardWalled('9.9.9.9')).toBe(false);
    expect(await m._anonOverCap('9.9.9.9')).toBe(true);
  });

  it('never walls without a usable IP', async () => {
    served = 999999;
    const m = await freshServer({ cap: 30, mult: 10 });
    expect(await m._anonHardWalled('')).toBe(false);
    expect(await m._anonHardWalled(null)).toBe(false);
  });
});

describe('FAIL-OPEN — a backend hiccup must never wall the funnel', () => {
  for (const bad of ['error', 'garbage']) {
    it(`treats an unreadable count as 0 (${bad})`, async () => {
      served = 999999;      // irrelevant: the response is unusable
      mode = bad;
      const m = await freshServer({ cap: 30, mult: 10 });
      expect(await m._anonHardWalled('9.9.9.9')).toBe(false);
      expect(await m._anonOverCap('9.9.9.9')).toBe(false);
    });
  }

  it('treats a backend that never answers as 0, bounded by the read deadline', async () => {
    // ★ THE DEADLINE IS THE PROPERTY HERE, so this test owns the clock instead
    // of sleeping against one. Waiting out a real 2500ms AbortSignal made the
    // whole file 2.5s slower AND asserted nothing about the bound itself — the
    // test passed identically whether the read was bounded at 2.5s or 25s.
    // Vitest fake timers cannot substitute: AbortSignal.timeout runs on Node's
    // internal timer list, which they do not patch (a 1000ms signal survives
    // advancing them 5000ms). So the deadline is INJECTED and fired by hand.
    served = 999999;      // irrelevant: the backend never answers at all
    mode = 'hang';
    const m = await freshServer({ cap: 30, mult: 10 });

    const ctl = new AbortController();
    let armed;
    const asked = new Promise((r) => { armed = r; });
    m._readDeadline.signal = (ms) => { armed(ms); return ctl.signal; };

    const walled = m._anonHardWalled('9.9.9.9');
    expect(await asked).toBe(2500);      // the read IS bounded, at the declared 2500ms
    await untilHung(1);                  // the backend HOLDS the request and will not answer
    expect(fetches, 'the read really reached the backend').toBe(1);

    // Still pending, so the false below is the deadline firing — not a read
    // that was skipped or short-circuited before it ever reached the backend.
    let settled = false;
    walled.then(() => { settled = true; });
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);

    ctl.abort(new DOMException('The operation was aborted', 'TimeoutError'));
    expect(await walled).toBe(false);                       // fail-open, never walls
    expect(await m._anonOverCap('9.9.9.9')).toBe(false);    // and the soft cap agrees
    expect(fetches, 'the failed read is cached as 0, not retried').toBe(1);   // still 1
  });
});

describe('one shared count feeds both thresholds', () => {
  it('checking both costs a single backend read, not two', async () => {
    served = 500;
    const m = await freshServer({ cap: 30, mult: 10 });
    await m._anonOverCap('9.9.9.9');
    await m._anonHardWalled('9.9.9.9');
    // The 60s per-IP cache is shared, so adding the hard wall adds no latency
    // to a request that was already consulting the soft cap.
    expect(fetches).toBe(1);
  });
});
