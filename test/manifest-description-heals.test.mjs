// r-desc-selfheal (2026-08-03): mcp-server.json's TOP-LEVEL description was
// scanned check-only, on the reasoning that it is "hand-authored JSON". The
// scan fails CI, so every canon roll left one stale sentence blocking the next
// unrelated PR until a human edited it by hand. That happened on two
// consecutive days (15,700+ -> 15,900+, then 15,900+ -> 16,100+), each time
// costing a green build on work that had nothing to do with it.
//
// "Hand-authored" was never the obstacle: the same block already machine-writes
// version, tools[] and tools_count into that file. The description's PROSE
// stays operator-owned; its five phrase quantities are canon-owned and heal
// through the same helper the other eight surfaces use.
//
// These tests pin the property that matters — the field is REACHABLE by --fix
// — because the failure mode is silent: a check-only field looks identical to
// a healed one until the day canon moves.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../scripts/sync-tools-manifest.mjs', import.meta.url), 'utf8');

describe('mcp-server.json top-level description', () => {
  it('is healed, not merely scanned', () => {
    // The heal must run through the shared helper — a bespoke regex here would
    // be a twin of the quantity rules and would drift from them.
    expect(SRC).toMatch(/applyQuantities\(\s*'mcp-server\.json \(top-level description\)'/);
  });

  it('assigns the healed text back onto the object that gets written', () => {
    // Computing a healed string and discarding it is this repo's most-repeated
    // bug (the agent-surfaces heal did exactly that, three times).
    expect(SRC).toMatch(/m\.description\s*=\s*healedDesc/);
  });

  it('heals in the SAME block that writes the file', () => {
    // Two pend() calls for one path means last-write-wins and a silently
    // dropped heal. The description assignment must precede the single pend.
    const block = SRC.slice(SRC.indexOf("const m = readJSON('mcp-server.json')"));
    const assign = block.indexOf('m.description = healedDesc');
    const write = block.indexOf("pend('mcp-server.json'");
    expect(assign).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(assign).toBeLessThan(write);
  });

  it('no longer scans the same sentence a second time', () => {
    // A doubled problem line reads as two stale surfaces and inflates every
    // drift report.
    const hits = (SRC.match(/mcp-server\.json \(top-level description\)/g) || []).length;
    expect(hits).toBe(1);
  });

  it('only mutates the description when --fix is set', () => {
    // CHECK mode must stay read-only: CI runs it on the committed tree.
    const i = SRC.indexOf('m.description = healedDesc');
    const guard = SRC.slice(Math.max(0, i - 120), i);
    expect(guard).toMatch(/if \(FIX\)/);
  });

  it('the prose is still operator-owned — only quantities heal', () => {
    // QUANTITIES, not a wholesale template overwrite.
    const i = SRC.indexOf("applyQuantities('mcp-server.json (top-level description)");
    expect(SRC.slice(i, i + 200)).toContain('QUANTITIES');
  });
});
