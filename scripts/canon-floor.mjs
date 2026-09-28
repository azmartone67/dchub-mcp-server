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

// ---- the facility COUNT is withdrawn (owner decision 2026-09-27) ------------
// No headline facility number ("24,600+ facilities", "24.8K+ data centers") on
// any public surface until a corroborated "r3" count lands. The wording matches
// the r2 comparison brief. /api/v1/canon/phrases keeps a numeric `facilities`
// (plus, from the backend's parallel PR, facilities_count_status:
// "corroboration_pending"); the generators here emit the pending wording
// REGARDLESS of that field, so a numeric canon can never re-publish a number.
export const FACILITY_COUNT_DECISION = '2026-09-27';
export const FACILITY_COUNT_WITHDRAWN_REASON = 'count withdrawn — owner decision 2026-09-27';
export const FACILITY_MAP_PROSE = 'a global data-center facility map (corroborated count pending)';
export const FACILITY_MAP_TILE = 'Global facility map';
export const FACILITY_MAP_CELL = 'Global map; corroborated count pending';
// The backend's status value, honoured when present, never required.
export const FACILITY_COUNT_PENDING_STATUS = 'corroboration_pending';

// frz-claude-relay-wording (test/index-name-canon.test.mjs,
// test/claude-directory-catalog.test.mjs): /mcp instructions + tools/list stay
// byte-identical until 2026-10-02, so these files keep their facility number
// until the do-not-merge-before-2026-10-02 PR. The exemption EXPIRES: from
// 2026-10-02 every check here treats them like any other surface and goes red.
// integrations/packs/site.json is generated from mcp-server.json (why_dchub),
// so it moves with it. (packs/gas.json and packs/siting.json are frozen too but
// carry no facility number, so they need no exemption here.)
export const FACILITY_COUNT_FROZEN_UNTIL = '2026-10-02';
// ★2026-10-02 MCP-text batch (mcp#612): server.mjs, toolspec.json,
// mcp-server.json and packs/site.json now carry the map wording, so the list is
// empty (the dead-entry test requires it). Kept as a mechanism for the next freeze.
export const FACILITY_COUNT_FROZEN_FILES = [];
export function facilityCountFrozen(file, today = new Date().toISOString().slice(0, 10)) {
  return FACILITY_COUNT_FROZEN_FILES.includes(file) && today < FACILITY_COUNT_FROZEN_UNTIL;
}

// A headline facility floor, number first ("24,600+ facilities", "24.6K+ global
// data center facilities", "24,600+ discovered facilities") or number after the
// noun ("facility search (24,600+)", "**Facilities:** 24,600+"). A power unit
// between number and noun ("a 100 MW data center") is a build size, never a
// fleet count, and "+" is required so a bare integer (a score, an ID) is not read
// as a claim.
const FAC_NUM = String.raw`\d{1,3}(?:,\d{3})+\+|\d{1,3}(?:\.\d)?\s?[kK]\+`;
const FAC_NOUN = String.raw`facilit(?:y|ies)|data[\s-]+cent(?:er|re)s?`;
const FAC_BEFORE = new RegExp(String.raw`(?<![\d,.])(${FAC_NUM})((?:\s+[A-Za-z-]+){0,3}?\s+(?:${FAC_NOUN}))`, 'gi');
const FAC_AFTER = new RegExp(String.raw`(?:(?:${FAC_NOUN})(?:\s+[A-Za-z&/-]+){0,3}\s*\(|\*\*Facilities:\*\*\s+)(${FAC_NUM})`, 'gi');
const FAC_UNIT = /\b(?:[kKmMgGtT]?W|[kKmMgGtT]?Wh|[kKmM]?VA)\b/;

/** Every headline facility floor a text states, as written. */
export function findFacilityFloors(text) {
  const out = [];
  for (const rx of [FAC_BEFORE, FAC_AFTER]) {
    for (const m of String(text || '').matchAll(rx)) {
      if (FAC_UNIT.test(m[0])) continue;
      out.push(m[0].replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

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
  const facCases = [
    ['withdrawn: a number-first facility floor is found', findFacilityFloors('92 tools over 24,600+ data-center facilities').length, 1],
    ['withdrawn: a number-after-noun floor is found', findFacilityFloors('facility search (24,600+)').length, 1],
    ['withdrawn: the K form is found', findFacilityFloors('24.6K+ data centers').length, 1],
    ['CONTROL: the pending wording carries no floor', findFacilityFloors(FACILITY_MAP_PROSE).length, 0],
    ['CONTROL: a capacity is not a fleet count', findFacilityFloors('a 1,000+ MW data center').length, 0],
    ['CONTROL: an asset count is not a facility count', findFacilityFloors('330,000+ mapped assets').length, 0],
  ];
  for (const [label, got, want] of facCases) {
    const ok = got === want;
    if (!ok) cases.bad = (cases.bad || 0) + 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` (got ${got}, want ${want})`}`);
  }
  let bad = cases.bad || 0;
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
