// The initialize `instructions` string is the FIRST thing every connecting
// agent reads. On 2026-08-05 it advertised "15,300+ facilities" while live
// canon said "16,300+" — a thousand facilities stale, on the surface we had
// been telling AI partners to trust OVER our own web pages.
//
// Cause: two canonical snapshot files. canon_phrases.json is refreshed daily
// and heals every tool description; mcp_facts.json is regenerated on its own
// cadence and fed the instructions alone. Nobody was watching the second one.
//
// These guards assert the instructions agree with the canon-owned snapshot,
// so the two can never silently disagree again.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const canon = JSON.parse(readFileSync(
  new URL('../canonical/canon_phrases.json', import.meta.url), 'utf8'));
const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

describe('initialize instructions bind to canon-owned phrases', () => {
  it('composes from canon_phrases.json, not from mcp_facts.json alone', () => {
    // The overlay must exist AND be applied at the composition call site —
    // defining it without wiring it is the shape of this exact bug.
    expect(src).toContain('function _overlayCanonPhrases(');
    expect(src).toMatch(/_composeInstructions\(\s*_overlayCanonPhrases\(facts\)/);
  });

  it('overlays every canon-owned quantity', () => {
    // If canon starts carrying a quantity the overlay does not copy, the
    // instructions silently keep serving the export's stale value.
    for (const k of ['facilities', 'countries', 'markets', 'deals']) {
      expect(canon[k], `canon snapshot missing ${k}`).toBeTruthy();
      const overlay = src.slice(src.indexOf('function _overlayCanonPhrases('));
      expect(overlay.slice(0, 1200)).toContain(`'${k}'`);
    }
  });

  it('leaves the stale-export gate intact', () => {
    // The overlay must not invent a generated_at. A stale mcp_facts export has
    // to keep degrading to figure-less prose rather than being dressed up with
    // fresh canon numbers and published as current.
    const overlay = src.slice(src.indexOf('function _overlayCanonPhrases('),
                              src.indexOf('export const _INSTRUCTIONS'));
    expect(overlay).not.toContain('generated_at');
  });

  it('falls back to the export rather than emitting undefined', () => {
    // A missing snapshot, or a key absent from it, must leave the previous
    // value in place — never blank the number out of the prose.
    const overlay = src.slice(src.indexOf('function _overlayCanonPhrases('),
                              src.indexOf('export const _INSTRUCTIONS'));
    expect(overlay).toMatch(/catch\s*\{\s*return facts;/);
    expect(overlay).toMatch(/if \(canon\[k\]\)/);
  });
});
