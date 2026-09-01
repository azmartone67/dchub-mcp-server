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

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    if (!req.url.startsWith('/api/v1/mcp/anon-usage')) { res.writeHead(404); res.end('{}'); return; }
    fetches += 1;
    if (mode === 'hang') return;                                  // never responds -> timeout
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
  return m;
}

beforeEach(() => { mode = 'count'; served = 0; fetches = 0; });

describe('the hard wall lands at MULT x the cap and nowhere earlier', () => {
  it('does not wall inside the carrot band, and walls at exactly 10x', async () => {
    // cap 30, mult 10 => carrot 30..299, wall at 300. The band is the whole
    // point: a real agent that hits the cap keeps getting its trimmed preview
    // and its claim_free_key nudge, exactly as before this change.
    for (const [count, walled] of [[0, false], [30, false], [299, false], [300, true], [1345, true]]) {
      served = count;
      const m = await freshServer({ cap: 30, mult: 10 });
      expect(await m._anonHardWalled('9.9.9.9'), `count=${count}`).toBe(walled);
    }
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
  for (const bad of ['error', 'garbage', 'hang']) {
    it(`treats an unreadable count as 0 (${bad})`, async () => {
      served = 999999;      // irrelevant: the response is unusable
      mode = bad;
      const m = await freshServer({ cap: 30, mult: 10 });
      expect(await m._anonHardWalled('9.9.9.9')).toBe(false);
      expect(await m._anonOverCap('9.9.9.9')).toBe(false);
    }, 15000);
  }
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
