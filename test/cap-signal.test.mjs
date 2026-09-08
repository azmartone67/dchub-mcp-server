/**
 * r-cap-signal (2026-09-07) — the biggest wall writes an upgrade signal.
 *
 * THE DEFECT
 * ──────────
 * The `_tasteExceeded` branch is the deprivation moment. It labelled itself on
 * the call row (status='trial_cap_exceeded') but never wrote
 * mcp_upgrade_signals, while the branches either side of it did
 * (trial_preview, paid_tool_blocked).
 *
 * MEASURED 2026-09-07 (production):
 *   mcp_call_log status='trial_cap_exceeded'
 *       39,344 calls / 10,562 sessions since 2026-08-06
 *        8,442 calls /  2,256 sessions / 246 keys in the last 7d
 *   published beside it: upgrade_signals_7d = 366        (23x understatement)
 *   mcp_upgrade_signals, 30d, ALL types:
 *       trial_preview 2,054 · paid_tool_blocked 890 · checkout_link_issued 1
 *
 * The outreach path reads mcp_upgrade_signals, so ~35,000 deprivations per 30d
 * carried no caller_id to follow up.
 *
 * ★ PLACEMENT IS THE INVARIANT, not merely presence. `status` is assigned
 * BEFORE the JSON parse; on a parse throw the catch falls through and the
 * caller is served the FULL answer. A signal written beside the status
 * assignment would count callers who were never walled. It must sit inside the
 * `if (parsed …)` that returns the trimmed payload — between _dropCreditCache
 * and the return — so one row means one caller actually deprived.
 *
 * Source-reading: the branch sits ~12,300 lines into a 1.4MB monolith behind a
 * gate, a tier resolve and a live-shaped result object. The invariant worth
 * holding is structural, and reading the source holds it without standing up
 * half the server.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');

/**
 * Strip `//` line comments.
 *
 * ★ NOT cosmetic. The first cut of this file asserted the kill switch with
 * `expect(b).toContain('DCHUB_CAP_SIGNAL_DISABLE')` and SURVIVED a mutation
 * that deleted the guard outright — because the comment above the guard names
 * the variable, so the token stayed findable with the code gone. A test whose
 * anchor its own documentation satisfies is measuring the documentation.
 * Everything structural below reads code only.
 */
function codeOnly(src) {
  return src.split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      // Naive but sufficient here: no `//` appears inside a string literal in
      // this branch, and the assertions below would fail loudly if one did.
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');
}

/** The `_tasteExceeded` wall branch, from its status label to its return. */
function walledBranch() {
  const start = SRC.indexOf("status = 'trial_cap_exceeded';");
  expect(start, "the wall branch no longer labels itself").toBeGreaterThan(-1);
  const end = SRC.indexOf('} catch (_) { /* fall through to full data on parse failure */ }', start);
  expect(end, 'the wall branch lost its parse-failure catch').toBeGreaterThan(start);
  return codeOnly(SRC.slice(start, end));
}

describe('r-cap-signal: the cap wall writes an upgrade signal', () => {
  it('fires signalPaywall with its own signal_type', () => {
    const b = walledBranch();
    expect(b).toContain("signal_type: 'trial_cap_exceeded'");
    // Distinct type: reusing trial_preview would fold ~35k rows/30d into an
    // existing series and silently restate it.
    expect(b.match(/signal_type: 'trial_preview'/g)).toBeNull();
  });

  it('fires ONLY on the path that actually serves the wall', () => {
    const b = walledBranch();
    const drop   = b.indexOf('_dropCreditCache(c);');
    const signal = b.indexOf('signalPaywall({');
    const ret    = b.indexOf('return { content: [');
    expect(drop,   '_dropCreditCache anchor missing').toBeGreaterThan(-1);
    expect(signal, 'no signalPaywall in the wall branch').toBeGreaterThan(-1);
    expect(ret,    'the wall branch no longer returns a trimmed payload').toBeGreaterThan(-1);
    // Ordering encodes the invariant: the signal is inside the parsed-and-
    // returning block, never beside the status assignment above it.
    expect(signal).toBeGreaterThan(drop);
    expect(signal).toBeLessThan(ret);
  });

  it('carries the identity fields the outreach path needs', () => {
    const b = walledBranch();
    const sig = b.slice(b.indexOf('signalPaywall({'), b.indexOf('return { content: ['));
    for (const f of ['session_id:', 'api_key:', 'ip_address:', 'mcp_client:',
                     'tool:', 'tier_current:', 'tier_required:']) {
      expect(sig, `signal payload lost ${f}`).toContain(f);
    }
  });

  it('does not assert a daily_usage it cannot measure at the wall', () => {
    const b = walledBranch();
    const sig = b.slice(b.indexOf('signalPaywall({'), b.indexOf('return { content: ['));
    expect(sig).toContain('daily_limit:');
    // _trialFullRemaining reads 0 here by construction, so any daily_usage
    // would be a floor published as a count.
    expect(sig).not.toContain('daily_usage:');
  });

  it('is killable without a deploy', () => {
    const b = walledBranch();
    // Code-only, and the EXECUTABLE read — `process.env.` never appears in the
    // prose above the guard, so this cannot be satisfied by the comment.
    const guard = b.indexOf('process.env.DCHUB_CAP_SIGNAL_DISABLE');
    expect(guard, 'the kill switch is gone from the code (comments do not count)')
      .toBeGreaterThan(-1);
    // Inert when set: the guard must WRAP the call, not run it and discard.
    // ★ Ordering alone is not enough — indexOf returns -1 when absent and
    // -1 < anything, so the presence assertion above has to come first.
    expect(guard).toBeLessThan(b.indexOf('signalPaywall({'));
  });
});
