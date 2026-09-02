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
    expect(out).not.toMatch(/12,650|311 markets|1,400\+|1,500\+|500,000\+|headroom|369\s*GW|540\+\s*projects/);
  });

  // ── must-fail controls ──
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
    expect(n).not.toMatch(/12,650|"311"|1,400\+|1,500\+|500,000\+|21,000\+|180\+/);
  });
});
