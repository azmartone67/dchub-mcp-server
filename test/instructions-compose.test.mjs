// Guard for the initialize-instructions compose gate (server.mjs).
//
// WHY THIS EXISTS (2026-07-30): the figures clause in `instructions` was a
// hand-authored literal that rotted three times (21,000+ facilities, 311
// markets, 500,000+ assets — each an over-claim by the time anyone looked).
// It now composes from canonical/mcp_facts.json behind a freshness gate with
// a fail-SOFT contract: fresh + complete facts → figures; anything else →
// prose WITHOUT figures. The must-fail controls are the point: a gate that
// cannot be shown to withhold figures on stale input is not a gate.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _composeInstructions, _FACTS_REQUIRED, _FACTS_MAX_AGE_DAYS } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FACTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'canonical', 'mcp_facts.json'), 'utf8'));

const NOW = Date.parse('2026-07-30T12:00:00Z');
const DAY = 86400e3;
const freshFacts = () => JSON.parse(JSON.stringify({
  ...FACTS, generated_at: new Date(NOW - DAY).toISOString(),
}));

// A composed result either carries the facts figures or none at all. The
// figure-less form is identified by its canonical-stats pointer, which the
// figure-bearing form never includes.
const hasFigures = (s) => !s.includes('api/v1/stats/canonical');

// ★ A BARE NUMBER IS A TOKEN BAN, and a token ban matches inside a BIGGER
// number. `1,400+` retires a DEALS figure (server.mjs: "1,400+ deals, 79
// tools"); it is also the literal tail of the live facilities count
// `21,400+`. The day canon crossed 21,400 this guard began rejecting the
// CORRECT value — it failed the facts regeneration that carried it, and
// `1,500+` sits waiting to do the same at 21,500+. `numberBan` requires the
// match to start at a real number boundary, so a retired figure is still
// caught standing alone and is no longer found inside an unrelated one.
// Same reasoning test/retired-claims.test.mjs states for its own list:
// "which is why this is a phrase ban and not a token ban".
const numberBan = (src) => `(?<![\\d,])${src}`;
const banned = (...srcs) => new RegExp(srcs.join('|'));

// ★ ONE definition each, referenced by both the gate and the boundary tests
// below. Built inline in two places, the boundary tests were asserting against
// a COPY: deleting `1,400\\+` from the real list left every one of them green.
const COMPOSED_BAN = banned(
  numberBan('12,650'), numberBan('311 markets'), numberBan('1,400\\+'),
  numberBan('1,500\\+'), numberBan('500,000\\+'), 'headroom',
  numberBan('369\\s*GW'), numberBan('540\\+\\s*projects'));
const FACTS_BAN = banned(
  numberBan('12,650'), '"311"', numberBan('1,400\\+'), numberBan('1,500\\+'),
  numberBan('500,000\\+'), numberBan('21,000\\+'), numberBan('180\\+'));

describe('instructions compose gate', () => {
  it('fresh + complete facts → figures, verbatim from the facts file', () => {
    const out = _composeInstructions(freshFacts(), NOW);
    expect(hasFigures(out)).toBe(true);
    for (const k of ['facilities', 'markets', 'deals', 'countries', 'infrastructure_assets_total']) {
      expect(out).toContain(String(FACTS.numbers[k]));
    }
    expect(out).toContain('generating UNITS across all statuses');
    // retired over-claims can never re-enter through this path
    // ★2026-09-02: the retired pipeline figure too. test/retired-claims bans
    // it from every committed FILE; this is the one fence on the composed
    // runtime string, which no file scan can see.
    expect(out).not.toMatch(COMPOSED_BAN);
  });

  // ── must-fail controls ──

  // ── the ban list's own boundary, both directions ──
  // Widening a ban is how a guard quietly stops guarding. These pin that the
  // retired figures are still caught standing alone, and that the boundary is
  // doing real work rather than disarming them.
  it('a retired figure standing alone is still caught', () => {
    expect(FACTS_BAN.test('{"deals":"1,400+"}')).toBe(true);
    expect(FACTS_BAN.test('{"facilities":"21,000+"}')).toBe(true);
    expect(FACTS_BAN.test('{"assets":"500,000+"}')).toBe(true);
    expect(FACTS_BAN.test('{"facilities":"12,650"}')).toBe(true);
    // ★ Probes chosen from the entries test/retired-claims.test.mjs does NOT
    // also scan every file for. Spelling one of those out here would re-publish
    // the retired claim and trip that guard on this very file — reword, never
    // allow-list. `311 markets` exercises the same composed-ban path.
    expect(COMPOSED_BAN.test('across 311 markets')).toBe(true);
    expect(COMPOSED_BAN.test('spare headroom in the queue')).toBe(true);
  });

  it('a retired figure is NOT found inside a larger, live number', () => {
    // `1,400+` retires a DEALS count and is the tail of the live facilities
    // count. Unanchored it rejected canon the day it crossed 21,400 — and
    // `1,500+` would do it again at 21,500+, so both directions are pinned.
    expect(FACTS_BAN.test('{"facilities":"21,400+"}')).toBe(false);
    expect(FACTS_BAN.test('{"facilities":"21,500+"}')).toBe(false);
    expect(FACTS_BAN.test('{"units":"2,180+"}')).toBe(false);
    expect(FACTS_BAN.test('{"rows":"912,650"}')).toBe(false);
  });

  it('the live canonical facilities figure passes the committed-facts ban', () => {
    // The value this guard actually rejected, taken from the tree rather than
    // retyped: test/canon-heal-gates-on-the-marker.test.mjs pins it as live.
    const live = JSON.stringify({ facilities: '21,400+', markets: '300+',
                                  deals: '2,100+', countries: '170+' });
    expect(live).not.toMatch(FACTS_BAN);
  });

  it('absent facts → prose without figures (no crash)', () => {
    for (const bad of [null, undefined, {}, { numbers: null }, 'not-an-object', 42]) {
      const out = _composeInstructions(bad, NOW);
      expect(hasFigures(out), `facts=${JSON.stringify(bad)}`).toBe(false);
      expect(out).toContain('DC Hub is the live infrastructure data layer');
    }
  });

  it('each missing required key → prose without figures', () => {
    for (const k of _FACTS_REQUIRED) {
      const f = freshFacts();
      delete f.numbers[k];
      expect(hasFigures(_composeInstructions(f, NOW)), `missing ${k}`).toBe(false);
    }
  });

  it('stale generated_at → prose without figures, never stale figures', () => {
    const f = freshFacts();
    f.generated_at = new Date(NOW - (_FACTS_MAX_AGE_DAYS + 1) * DAY).toISOString();
    expect(hasFigures(_composeInstructions(f, NOW))).toBe(false);
  });

  it('missing / unparseable / far-future generated_at → prose without figures', () => {
    for (const ts of [undefined, '', 'not-a-date', new Date(NOW + 30 * DAY).toISOString()]) {
      const f = freshFacts();
      f.generated_at = ts;
      expect(hasFigures(_composeInstructions(f, NOW)), `generated_at=${ts}`).toBe(false);
    }
  });

  it('boundary: exactly at max age still passes; a day past does not', () => {
    const f = freshFacts();
    f.generated_at = new Date(NOW - _FACTS_MAX_AGE_DAYS * DAY).toISOString();
    expect(hasFigures(_composeInstructions(f, NOW))).toBe(true);
  });

  // ── the committed facts file itself ──
  it('committed mcp_facts.json carries every required key + generated_at', () => {
    expect(FACTS.generated_at, 'generated_at missing — exporter not run?').toBeTruthy();
    expect(Number.isFinite(Date.parse(FACTS.generated_at))).toBe(true);
    for (const k of _FACTS_REQUIRED) {
      expect(FACTS.numbers[k], `numbers.${k} missing`).not.toBeUndefined();
    }
  });

  it('committed facts carry no retired over-claims', () => {
    const n = JSON.stringify(FACTS.numbers);
    expect(n).not.toMatch(FACTS_BAN);
  });
});
