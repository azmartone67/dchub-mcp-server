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

// ★2026-09-01 — THE ADJECTIVE SLOT. Two tool counts rotted in plain sight because
// a single word sat between the digits and "tools":
//
//   scripts/smithery_description.txt   "82 live MCP tools"   canon 83
//   docs/contextual-triggers.md        "70 live tools"       canon 83, stale since 2026-07-08
//
// Both the detector and the healer keyed on `(?: MCP| read-only)?` — ONE optional
// adjective — so "live MCP" matched neither. `node scripts/sync-tools-manifest.mjs`
// exited 0 and reported nothing, which is indistinguishable from clean. The second
// file compounded it by being in no scan list at all.
//
// These run the ACTUAL patterns out of the script rather than grepping for text,
// so narrowing one fails here. The adjective set stays CLOSED on purpose — an
// open `\w*` would let the healer rewrite numbers inside unrelated prose.
function rxAfter(anchor) {
  const i = SRC.indexOf(anchor);
  if (i < 0) throw new Error(`anchor not found, test is vacuous: ${anchor}`);
  const m = SRC.slice(i).match(/\/((?:[^/\\\n]|\\.)+)\/([gimsuy]*)/);
  if (!m) throw new Error(`no regex after anchor: ${anchor}`);
  return new RegExp(m[1], m[2].replace('g', ''));
}

describe('tool-count patterns cover the adjective slot', () => {
  const PATTERNS = [
    ['per-file heal',   'txt = applyRx(txt, /\\b(\\d+)'],
    ['coverage detect', 'live.matchAll(/(\\d+)'],
    ['coverage heal',   ".replace(/\\b(\\d+)((?: live"],
  ];
  const MUST_MATCH = ['83 tools', '83 MCP tools', '83 live MCP tools',
                      '70 live tools', '83 read-only tools'];

  for (const [label, anchor] of PATTERNS) {
    it(`${label}: matches every adjective phrasing we ship`, () => {
      const rx = rxAfter(anchor);
      for (const s of MUST_MATCH) {
        expect(rx.test(s), `"${s}" is invisible to the ${label} pattern`).toBe(true);
      }
    });

    it(`${label}: the adjective set stays closed`, () => {
      // Over-widening (e.g. \w*) would let the healer rewrite counts inside
      // unrelated prose. An unknown adjective must NOT be absorbed.
      const rx = rxAfter(anchor);
      expect(rx.test('83 amazing tools'),
        `${label} absorbs an arbitrary word — the set is no longer closed`).toBe(false);
    });
  }

  it('both files that carried the rot are in the sweep that actually heals', () => {
    // MEASURED, because "in a scan list" is not the same as "scanned": dropping
    // docs/contextual-triggers.md from COVERAGE alone still detects the stale
    // count, but dropping it from the per-file sweep makes the detector go
    // silent. Only this list is load-bearing, so this is the one to pin — a
    // looser `SRC.includes(name)` passes while the file is effectively unscanned.
    const at = SRC.indexOf("for (const f of ['smithery.yaml'");
    expect(at, 'per-file sweep not found — this test would be vacuous').toBeGreaterThan(-1);
    const sweep = SRC.slice(at, SRC.indexOf('])', at));
    for (const f of ['scripts/smithery_description.txt', 'docs/contextual-triggers.md']) {
      expect(sweep.includes(`'${f}'`), `${f} is absent from the sweep that heals tool counts`).toBe(true);
    }
  });
});
