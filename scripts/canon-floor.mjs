#!/usr/bin/env node
// ============================================================================
// THE CANON FLOOR RULE — one implementation for every canon-number check here.
//
// Owner decision 2026-09-26, the same rule dchub-desktop-extension#5 applies in
// scripts/check-canon-numbers.py. A published count with a "+" ("24,800+
// facilities") is a FLOOR: it claims "at least this many". Compared with the
// live canon value C:
//
//   published P  > C            FAIL  an overclaim is the real defect
//   C*(1-0.05) <= P < C         PASS  still true, but emit ::warning:: to refresh
//   P == C                      PASS
//   P  < C*(1-0.05)             FAIL  too stale
//
// Tool counts are EXACT, "+" or not. A count published WITHOUT a "+" is not a
// floor, so it is exact too.
//
// Before this, sync-tools-manifest.mjs and check-served-manifest.mjs required
// byte/value equality for every "+" number, and ecosystem-sync.mjs had its own
// copy of the tolerance (0.95, a multiplier) for hosted listings only.
//
//   node scripts/canon-floor.mjs --self-test     hermetic, exit 0/1
// ============================================================================

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// How far below canon a published "+" floor may sit before it is too stale.
export const FLOOR_TOLERANCE = 0.05;

/**
 * Judge one published count against canon.
 * @param {number} published  the number as published (a "24,600+" is 24600)
 * @param {number} canon      the canon value (a "24,800+" is 24800)
 * @param {{floor?: boolean, exact?: boolean}} opts
 *   floor — the published number carries a "+" (and so does canon)
 *   exact — this unit is always exact (tools), whatever `floor` says
 * @returns {{state: 'ok'|'warn'|'overclaim'|'stale'|'mismatch', pass: boolean, warn: boolean}}
 */
export function judgeCount(published, canon, { floor = false, exact = false } = {}) {
  const P = Number(published);
  const C = Number(canon);
  if (!Number.isFinite(P) || !Number.isFinite(C)) return { state: 'mismatch', pass: false, warn: false };
  if (exact || !floor) {
    return P === C ? { state: 'ok', pass: true, warn: false } : { state: 'mismatch', pass: false, warn: false };
  }
  if (P > C) return { state: 'overclaim', pass: false, warn: false };
  if (P < C * (1 - FLOOR_TOLERANCE)) return { state: 'stale', pass: false, warn: false };
  if (P < C) return { state: 'warn', pass: true, warn: true };
  return { state: 'ok', pass: true, warn: false };
}

/** A one-line reason for a verdict, for logs and problem lists. */
export function describeVerdict(verdict, canonText) {
  switch (verdict.state) {
    case 'overclaim': return `OVERCLAIM, canon is ${canonText}`;
    case 'stale': return `too stale, more than ${FLOOR_TOLERANCE * 100}% below canon ${canonText}`;
    case 'warn': return `below canon ${canonText} but within ${FLOOR_TOLERANCE * 100}%; refresh it`;
    case 'mismatch': return `canon is ${canonText} (exact match required)`;
    default: return 'matches canon';
  }
}

/** A GitHub Actions annotation line. Printed outside Actions too: it is plain text. */
export const ghWarning = (msg) => `::warning::${String(msg).replace(/\r?\n/g, ' ')}`;

// ---- self-test --------------------------------------------------------------
export function selfTest() {
  const C = 24800;
  const cases = [
    ['CONTROL: a floor equal to canon passes, no warning', judgeCount(C, C, { floor: true }), 'ok'],
    ['a floor 3% below canon passes, with a warning', judgeCount(Math.round(C * 0.97), C, { floor: true }), 'warn'],
    ['a floor exactly at the 5% edge passes, with a warning', judgeCount(C * 0.95, C, { floor: true }), 'warn'],
    ['a floor 6% below canon fails as stale', judgeCount(Math.round(C * 0.94), C, { floor: true }), 'stale'],
    ['a floor ONE above canon fails (overclaim has no tolerance)', judgeCount(C + 1, C, { floor: true }), 'overclaim'],
    ['tools stay EXACT: one below canon fails', judgeCount(91, 92, { exact: true }), 'mismatch'],
    ['tools stay EXACT: one above canon fails', judgeCount(93, 92, { exact: true }), 'mismatch'],
    ['tools stay EXACT even when published with "+"', judgeCount(91, 92, { floor: true, exact: true }), 'mismatch'],
    ['a count published WITHOUT "+" stays exact', judgeCount(Math.round(C * 0.97), C, { floor: false }), 'mismatch'],
    ['CONTROL: an exact count equal to canon passes', judgeCount(92, 92, { exact: true }), 'ok'],
    ['an unparseable count fails, never passes', judgeCount(NaN, C, { floor: true }), 'mismatch'],
  ];
  let bad = 0;
  for (const [label, v, want] of cases) {
    const ok = v.state === want && v.pass === (want === 'ok' || want === 'warn') && v.warn === (want === 'warn');
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` (got ${v.state}, want ${want})`}`);
  }
  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed');
  return bad === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
  console.log('usage: node scripts/canon-floor.mjs --self-test');
}
