/**
 * AGENT-PAY FUNNEL SPLIT — one counter per DISTINCT event (r-mpp-abandonment).
 *
 * THE DEFECT THIS GUARDS. `mpp_challenge` records "a signed quote was ISSUED".
 * It was read everywhere as "the agent attempted to pay". With no counter
 * between issuance and return, 13 quotes and 1 verify failure over 120d could
 * not be told apart from 13 attempts that mostly broke — and the two readings
 * point at opposite fixes. The fix is a counter, not a comment, so this file
 * asserts the counters cannot re-merge.
 *
 * TWO KINDS OF ASSERTION, and they fail for different reasons:
 *
 *   1. CANON — the exported funnel map: every event has its own status, every
 *      status has a BASIS line, and the wire names are pinned so a rename
 *      cannot silently zero a published reader.
 *
 *   2. WIRING — the counters live in `server.mjs`, not here, so a canon-only
 *      test would pass while the PAID counter fired on the verify-FAILURE
 *      branch. These assertions run brace-depth containment over the real
 *      committed source and pin each assignment to its own branch.
 *
 * Every containment assertion carries a vacuity check that ERRORS rather than
 * passing when its anchor is not found — an unfound anchor is the one way a
 * structural guard goes quietly green.
 *
 * Pure-local: no network, no sidecar, no Stripe, no money.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
let mpp, SRC, LINES;

/** 1-indexed line number of the single line matching `re`. Errors if not exactly one. */
function soleLine(re, label) {
  const hits = LINES.map((t, i) => ({ n: i + 1, t }))
    .filter((r) => re.test(r.t) && !/^\s*(\/\/|\*)/.test(r.t));
  if (hits.length !== 1) {
    throw new Error(`ANCHOR ${label}: expected exactly 1 match for ${re}, found ${hits.length}`
      + ` — the guard cannot check what it cannot find.`);
  }
  return hits[0].n;
}

/**
 * End line (1-indexed) of the block opened on `openLine`, by brace depth.
 * Errors if the block never closes — never silently returns the file end.
 */
function blockEnd(openLine, label) {
  let depth = 0;
  for (let i = openLine - 1; i < LINES.length; i += 1) {
    // strip line comments and quoted/templated text so their braces don't count
    const code = LINES[i]
      .replace(/\/\/.*$/, '')
      .replace(/`(?:\\.|[^`\\])*`/g, '``')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, '""');
    for (const ch of code) {
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    if (depth < 0) break;
  }
  throw new Error(`ANCHOR ${label}: block opened at line ${openLine} never closes`
    + ` — containment cannot be evaluated.`);
}

beforeAll(async () => {
  // Rail ARMED on purpose: an invariant that only holds while the feature is
  // dark is vacuous. (Sidecar address is never dialled by these tests.)
  process.env.MPP_ENABLED = '1';
  process.env.MPP_SIDECAR_URL = 'http://127.0.0.1:1';
  mpp = await import('../mpp-hook.mjs');
  SRC = readFileSync(SERVER, 'utf8');
  LINES = SRC.split('\n');
});

// ── 1. CANON ───────────────────────────────────────────────────────────

describe('funnel canon: one counter per distinct event', () => {
  it('every event maps to its OWN status — no two share a counter', () => {
    const entries = Object.entries(mpp.MPP_FUNNEL_STATUS);
    expect(entries.length, 'funnel canon is empty — nothing to check')
      .toBeGreaterThanOrEqual(5);
    const seen = new Map();
    for (const [event, status] of entries) {
      expect(seen.has(status),
        `${event} and ${seen.get(status)} both increment "${status}" — that is the `
        + 'defect this split exists to end').toBe(false);
      seen.set(status, event);
    }
  });

  it('pins the wire names — a rename here silently zeroes a published reader', () => {
    // mpp_challenge in particular is already published on
    // /api/v1/admin/agent-pay-events and quoted externally.
    expect(mpp.MPP_FUNNEL_STATUS).toMatchObject({
      OFFER_PREWALL: 'mpp_offer_prewall',
      QUOTE_ISSUED: 'mpp_challenge',
      CREDENTIAL_RETURNED: 'mpp_credential_returned',
      VERIFY_FAILED: 'mpp_verify_failed',
      PAID: 'mpp_paid',
    });
  });

  it('every counter carries a one-line BASIS, and no basis is orphaned', () => {
    const statuses = Object.values(mpp.MPP_FUNNEL_STATUS).sort();
    const bases = Object.keys(mpp.MPP_FUNNEL_BASIS).sort();
    expect(bases, 'a counter without a basis is exactly the original defect')
      .toEqual(statuses);
    for (const s of statuses) {
      expect(mpp.MPP_FUNNEL_BASIS[s].length,
        `BASIS for ${s} is too short to state which event increments it`)
        .toBeGreaterThan(40);
    }
  });

  it('the quote-issued basis says ISSUED and does NOT claim an attempt to pay', () => {
    // The whole incident in one assertion: the name implied an event the
    // counter does not record.
    const b = mpp.MPP_FUNNEL_BASIS.mpp_challenge;
    expect(b).toMatch(/ISSUANCE|ISSUED/);
    expect(b).toMatch(/NOT an attempt to pay/i);
  });

  it('declares what it structurally cannot count, so a zero is never a measurement', () => {
    expect(Array.isArray(mpp.MPP_FUNNEL_UNMEASURED)).toBe(true);
    expect(mpp.MPP_FUNNEL_UNMEASURED.length).toBeGreaterThan(0);
    // The load-bearing blind spot: an ungated call never enters the MPP block.
    expect(mpp.MPP_FUNNEL_UNMEASURED.join(' ')).toMatch(/gate\.allowed/);
  });
});

// ── 2. WIRING (the real run path) ──────────────────────────────────────

describe('funnel wiring: each counter fires on its own event in server.mjs', () => {
  it('every MPP_FUNNEL_STATUS reference names a real event (kills a typo → undefined status)', () => {
    const refs = [...SRC.matchAll(/MPP_FUNNEL_STATUS\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(refs.length, 'no funnel-status references in server.mjs — guard is vacuous')
      .toBeGreaterThan(0);
    const known = new Set(Object.keys(mpp.MPP_FUNNEL_STATUS));
    for (const r of refs) {
      expect(known.has(r), `server.mjs stamps MPP_FUNNEL_STATUS.${r}, which is not a `
        + 'declared event — it would write an undefined status').toBe(true);
    }
  });

  it('no agent-pay status is stamped as a bare string literal any more', () => {
    // A literal bypasses the canon (and its basis) entirely.
    const strays = LINES
      .map((t, i) => ({ n: i + 1, t }))
      .filter((r) => /status\s*=\s*'mpp_/.test(r.t));
    expect(strays.map((s) => `${s.n}: ${s.t.trim()}`)).toEqual([]);
  });

  const anchors = () => {
    const settleOpen = soleLine(/if\s*\(\s*_mppCred\s*\)\s*\{/, 'if (_mppCred)');
    const settleEnd = blockEnd(settleOpen, 'if (_mppCred)');
    const failOpen = soleLine(/if\s*\(\s*!_mppV\.ok\s*\)\s*\{/, 'if (!_mppV.ok)');
    const failEnd = blockEnd(failOpen, 'if (!_mppV.ok)');
    return {
      settleOpen, settleEnd, failOpen, failEnd,
      verifyCall: soleLine(/await\s+mppVerify\s*\(/, 'await mppVerify('),
      returned: soleLine(/status\s*=\s*MPP_FUNNEL_STATUS\.CREDENTIAL_RETURNED/, 'CREDENTIAL_RETURNED'),
      failed: soleLine(/status\s*=\s*MPP_FUNNEL_STATUS\.VERIFY_FAILED/, 'VERIFY_FAILED'),
      paid: soleLine(/status\s*=\s*MPP_FUNNEL_STATUS\.PAID/, 'PAID'),
      quote: soleLine(/status\s*=\s*MPP_FUNNEL_STATUS\.QUOTE_ISSUED/, 'QUOTE_ISSUED'),
    };
  };

  it('CREDENTIAL_RETURNED fires on the RETURN, before the settle decides anything', () => {
    const a = anchors();
    // inside the credential branch...
    expect(a.returned).toBeGreaterThan(a.settleOpen);
    expect(a.returned).toBeLessThan(a.settleEnd);
    // ...and strictly BEFORE verify. If it moved after, it would stop counting
    // returns that never reach a terminal state — i.e. become a synonym for its
    // own outcome, which is the defect being fixed.
    expect(a.returned,
      'CREDENTIAL_RETURNED must be stamped before mppVerify() runs')
      .toBeLessThan(a.verifyCall);
  });

  it('VERIFY_FAILED fires ONLY inside the verification-failure branch', () => {
    const a = anchors();
    expect(a.failed).toBeGreaterThan(a.failOpen);
    expect(a.failed).toBeLessThan(a.failEnd);
  });

  it('PAID fires OUTSIDE the failure branch — it cannot count a failure', () => {
    const a = anchors();
    const insideFailure = a.paid > a.failOpen && a.paid < a.failEnd;
    expect(insideFailure,
      `PAID is stamped at line ${a.paid}, inside the !_mppV.ok block `
      + `(${a.failOpen}-${a.failEnd}) — it would count a failed settle as revenue`)
      .toBe(false);
    // still on the settle path, just past the failure return
    expect(a.paid).toBeGreaterThan(a.failEnd);
    expect(a.paid).toBeLessThan(a.settleEnd);
  });

  it('QUOTE_ISSUED fires OUTSIDE the credential branch — issuance is not a return', () => {
    const a = anchors();
    const insideSettle = a.quote > a.settleOpen && a.quote < a.settleEnd;
    expect(insideSettle,
      `QUOTE_ISSUED is stamped at line ${a.quote}, inside the if (_mppCred) block `
      + `(${a.settleOpen}-${a.settleEnd}) — issuing a quote would be counted as the `
      + 'caller coming back, which is the exact conflation being removed')
      .toBe(false);
  });

  it('OFFER_PREWALL never fires on the settle path — a passive offer is not pay-intent', () => {
    const a = anchors();
    const sites = LINES
      .map((t, i) => ({ n: i + 1, t }))
      .filter((r) => /status\s*=\s*MPP_FUNNEL_STATUS\.OFFER_PREWALL/.test(r.t))
      .map((r) => r.n);
    expect(sites.length, 'no OFFER_PREWALL site found — guard is vacuous')
      .toBeGreaterThan(0);
    for (const n of sites) {
      expect(n > a.settleOpen && n < a.settleEnd,
        `OFFER_PREWALL at line ${n} sits on the settle path`).toBe(false);
    }
  });
});
