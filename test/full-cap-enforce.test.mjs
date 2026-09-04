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
// bucket name ('*' = the all-tools caller bucket) -> durable n. Lets a test
// spend one budget without touching the other.
let counts = {};
const m_ALL = '*';   // the all-tools caller bucket sentinel

// A hang test must fire its deadline only once the backend actually HOLDS the
// request. Aborting earlier proves nothing (the read never reached the stub)
// and lets the request land during a LATER test, inflating its count.
let hangSeen = 0, hangNotify = () => {};
const untilHung = (n) => new Promise((resolve) => {
  const check = () => { if (hangSeen >= n) resolve(); };
  hangNotify = check;
  check();
});

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    if (!req.url.startsWith('/api/v1/mcp/full-cap/peek')) { res.writeHead(404); res.end('{}'); return; }
    peeks += 1;
    if (mode === 'hang') { hangSeen += 1; hangNotify(); return; }   // never responds -> timeout
    if (mode === 'error') { res.writeHead(500); res.end('boom'); return; }
    const tool = new URL(req.url, base).searchParams.get('tool');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (mode === 'counts') {
      const n = counts[tool];
      res.end(JSON.stringify(n ? { ok: true, n } : { ok: false }));
      return;
    }
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
  // ★ DETERMINISM (2026-09-04): every test below except the fail-open pair is
  // about WHAT the gate decides, not how long it waits. The stub answers on
  // 127.0.0.1 in microseconds, so the real 800ms deadline here is not a
  // property under test — it is a race against the OS scheduler, and under the
  // full 158-file suite the worker loses it: the peek is aborted for a stub
  // that already answered, the count never hydrates, and a gating assertion
  // reads the fail-open verdict. Measured on main 2026-09-04: 3 of 3 full-suite
  // runs failed one or more of these, a different one each run, all green in
  // isolation. A deadline no scheduling stall can reach removes the race
  // without touching a single assertion. The test that OWNS the deadline
  // property installs its own controllable one — see the fail-open block.
  m._readDeadline.signal = () => AbortSignal.timeout(120_000);
  return m;
}

beforeEach(() => { peeks = 0; mode = 'over'; counts = {}; hangSeen = 0;
  process.env.DCHUB_TRIAL_CALLER_CAP_MULT = '2'; });

describe('the durable count is consulted BEFORE the gate decides', () => {
  it('gates the FIRST call on a fresh replica when the day is already spent', async () => {
    // ★ THE REGRESSION. Pre-fix this returned false: local count 0 -> n=1 -> allowed,
    // and the peek saying "you already had 2" landed after the answer shipped.
    const m = await freshServer();
    const over = await m._trialFullCallsExceeded('9.9.9.9', 'get_grid_intelligence', 2, 'id-spent');
    expect(over).toBe(true);
    // Two peeks: the per-tool bucket and the per-caller bucket, fired together.
    expect(peeks).toBe(2);
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
    expect(peeks).toBe(2);   // one per bucket, not one per call
  });

  it('concurrent first-calls await the SAME peek instead of racing past it', async () => {
    // Pre-fix each concurrent call fired its own peek and read a local 0.
    const m = await freshServer();
    const rs = await Promise.all(Array.from({ length: 5 }, () =>
      m._trialFullCallsExceeded('3.3.3.3', 'get_grid_intelligence', 2, 'id-conc')));
    expect(peeks).toBe(2);                            // one per bucket, shared
    expect(rs.every((r) => r === true)).toBe(true);   // durable already at cap
  });
});

describe('fail-open is preserved — a backend problem must never wall a caller', () => {
  it('a peek that errors falls back to the local count and allows', async () => {
    mode = 'error';
    const m = await freshServer();
    expect(await m._trialFullCallsExceeded('4.4.4.4', 'get_fiber_intel', 2, 'id-err')).toBe(false);
  });

  it('a peek that hangs is bounded by the configured deadline and allows', async () => {
    // ★ THE DEADLINE IS THE PROPERTY, so this test owns the clock rather than
    // measuring one. It used to assert `Date.now()` elapsed < 3000ms against a
    // real 800ms AbortSignal — which proves the bound only when the machine is
    // idle, passes just as happily at a 2.9s bound, and flips to a failure when
    // a loaded suite deschedules the worker past 3s. Vitest fake timers are no
    // help: AbortSignal.timeout runs on Node's internal timer list, which they
    // do not patch (a 1000ms signal survives advancing them 5000ms).
    //
    // So the deadline is INJECTED. Two things are now asserted that the
    // stopwatch could not: the gate asks for exactly DCHUB_FULL_CAP_PEEK_MS
    // (not the 5s fallback, and not "some number under 3000"), and when that
    // deadline fires against a backend that never responds the gate resolves
    // FALSE — bounded and fail-open — with no wall clock anywhere in the test.
    process.env.DCHUB_FULL_CAP_PEEK_MS = '777';   // distinct from 800 and from the 5000 default
    try {
      mode = 'hang';
      const m = await freshServer();
      expect(m.FULL_CAP_PEEK_MS).toBe(777);

      const ctl = new AbortController();
      let armed;
      const asked = new Promise((r) => { armed = r; });
      m._readDeadline.signal = (ms) => { armed(ms); return ctl.signal; };

      const gate = m._trialFullCallsExceeded('5.5.5.5', 'get_fiber_intel', 2, 'id-hang');

      // The peek is in flight, and it asked for the CONFIGURED bound. This is
      // strictly more than the old stopwatch could see: hard-code the deadline
      // to any value under 3s — 2000, say, ignoring DCHUB_FULL_CAP_PEEK_MS
      // entirely — and `ms < 3000` still passed. This does not.
      expect(await asked).toBe(777);

      // Both buckets' peeks are in the backend's hands and will never be
      // answered. Waiting for that is what makes the abort below a TIMEOUT of
      // a real in-flight read rather than a cancellation of one still being
      // dialled — and it keeps a late-arriving peek out of a later test's count.
      await untilHung(2);
      expect(peeks).toBe(2);

      // Nothing has resolved yet: the gate really is waiting on the peek, so
      // the FALSE below is the deadline firing and not a peek that never ran.
      let settled = false;
      gate.then(() => { settled = true; });
      await new Promise((r) => setImmediate(r));
      expect(settled).toBe(false);

      ctl.abort(new DOMException('The operation was aborted', 'TimeoutError'));
      expect(await gate).toBe(false);     // bounded, and fail-open when it fires
    } finally {
      process.env.DCHUB_FULL_CAP_PEEK_MS = '800';
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// r-caller-cap (2026-08-31) — the budget is PER CALLER, not per tool.
//
// The per-(identity,tool,day) counter resets for every distinct tool, so a
// caller who rotates tools never spent a budget at all. Measured 30d to
// 2026-08-31: callers touch 1.99 distinct capped tools/day on average (max 6),
// so a per-tool cap of 2 was really ~4 full answers/day for a typical caller
// and up to 12 for the widest.
//
// A second bucket now tracks the caller across ALL capped tools and the gate
// refuses when EITHER is spent.
// ─────────────────────────────────────────────────────────────────────────────
describe('the per-caller budget closes tool rotation', () => {
  const TOOLS = ['get_grid_intelligence', 'get_fiber_intel', 'get_market_intel',
                 'analyze_site', 'compare_sites'];

  it('★ five different tools, one call each: the 5th is gated', async () => {
    // Pre-change every one of these was allowed — a fresh per-tool bucket each
    // time. With per-tool 2 and caller 2x2=4, the caller budget binds on call 5.
    mode = 'fresh';
    const m = await freshServer();
    const seen = [];
    for (const t of TOOLS) {
      seen.push(await m._trialFullCallsExceeded('7.7.7.7', t, 2, 'id-rotate'));
    }
    expect(seen).toEqual([false, false, false, false, true]);
  });

  it('does NOT loosen the single-tool case — the per-tool cap still binds first', async () => {
    // The safety property. Caller cap 4 > per-tool cap 2, so a caller hammering
    // ONE tool must still stop at 2, not get 4.
    mode = 'fresh';
    const m = await freshServer();
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      seen.push(await m._trialFullCallsExceeded('8.8.8.8', 'get_fiber_intel', 2, 'id-single'));
    }
    expect(seen).toEqual([false, false, true, true]);
  });

  it('the caller budget follows the DURABLE identity, not the IP', async () => {
    // A caller behind rotating cloud NAT presents a fresh IP per call. The
    // budget belongs to the identity, so rotating IPs must not reset it —
    // that was one of the named secondary leaks.
    mode = 'fresh';
    const m = await freshServer();
    const seen = [];
    for (let i = 0; i < 5; i += 1) {
      seen.push(await m._trialFullCallsExceeded(`10.0.0.${i}`, TOOLS[i], 2, 'one-identity'));
    }
    expect(seen).toEqual([false, false, false, false, true]);
  });

  it('reads the caller bucket from the durable counter, so a fresh replica inherits it', async () => {
    // The all-tools bucket rides the same rail under the '*' sentinel.
    mode = 'counts';
    counts[m_ALL] = 4;                       // caller budget already spent today
    const m = await freshServer();
    // Untouched tool, so the per-tool bucket is empty — only the caller bucket gates.
    expect(await m._trialFullCallsExceeded('9.1.1.1', 'analyze_site', 2, 'id-spent-all')).toBe(true);
  });

  it('scales with the per-tool cap, so bound-email and paid tiers lift together', async () => {
    // callerCap = perToolCap * CALLER_CAP_MULT. A bound caller at 10/tool gets
    // 20 across tools, not 4 — the ladder still means something.
    mode = 'fresh';
    const m = await freshServer();
    expect(m.CALLER_CAP_MULT).toBe(2);
    const seen = [];
    for (let i = 0; i < 5; i += 1) {
      seen.push(await m._trialFullCallsExceeded('11.1.1.1', TOOLS[i], 10, 'id-bound'));
    }
    expect(seen.every((v) => v === false)).toBe(true);   // 5 << 20
  });

  it('remaining() reports the SMALLER budget, so the CTA cannot overstate', async () => {
    mode = 'counts';
    counts[m_ALL] = 4;            // caller budget gone
    const m = await freshServer();
    // One call on a fresh tool: the per-tool bucket says 1 left, but the
    // caller's all-tools budget is already spent, so the honest answer is 0.
    await m._trialFullCallsExceeded('12.1.1.1', 'compare_sites', 2, 'id-min');
    expect(m._trialFullRemaining('12.1.1.1', 'compare_sites', 2, 'id-min')).toBe(0);
    // And with the caller cap off, the same state reports the per-tool number —
    // proving the 0 above came from the caller budget, not from an empty read.
    process.env.DCHUB_TRIAL_CALLER_CAP_MULT = '0';
    try {
      const m2 = await freshServer();
      await m2._trialFullCallsExceeded('12.1.1.1', 'compare_sites', 2, 'id-min');
      expect(m2._trialFullRemaining('12.1.1.1', 'compare_sites', 2, 'id-min')).toBe(1);
    } finally { process.env.DCHUB_TRIAL_CALLER_CAP_MULT = '2'; }
  });

  it('CALLER_CAP_MULT=0 disables the caller bucket entirely', async () => {
    process.env.DCHUB_TRIAL_CALLER_CAP_MULT = '0';
    try {
      mode = 'fresh';
      const m = await freshServer();
      expect(m.CALLER_CAP_MULT).toBe(0);
      const seen = [];
      for (const t of TOOLS) {
        seen.push(await m._trialFullCallsExceeded('13.1.1.1', t, 2, 'id-off'));
      }
      expect(seen.every((v) => v === false)).toBe(true);   // rotation unbounded again
      expect(peeks).toBe(TOOLS.length);                    // no '*' peeks fired
    } finally {
      process.env.DCHUB_TRIAL_CALLER_CAP_MULT = '2';
    }
  });
});
