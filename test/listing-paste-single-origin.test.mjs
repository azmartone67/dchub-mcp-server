// =============================================================================
// The Smithery paste doc must POINT at the description, never carry a copy.
// -----------------------------------------------------------------------------
// MEASURED 2026-09-05. docs/SMITHERY-LISTING-PASTE.md §2 held a full second copy
// of the listing description under "paste into Description". It had drifted:
//
//     doc said 18,800+ facilities   canon (and the source file) 20,500+
//     doc said 1,900+ deals         canon 2,100+
//     doc said 82 tools             canon 83
//
// Because scripts/sync-tools-manifest.mjs heals quantities in
// scripts/smithery_description.txt and has NEVER known this doc existed. So the
// one file whose entire job is "paste this into Smithery" would have REGRESSED
// the live listing by three canon numbers — on the channel with the most
// external volume — and every quantity guard in the repo would still be green.
//
// Same shape as the stale twins this repo keeps finding (the architecture static
// twin, the discovery static twin, the two growth boards): a second source of
// truth that CI cannot see. The fix is deletion, not refreshing — a copy of a
// healed file can only differ from it by being wrong.
//
// THE CONTRACT
//   R1. No fenced block in the paste doc may be PROSE (multi-sentence) unless it
//       is byte-identical to scripts/smithery_description.txt. Length alone is
//       too weak: a 700-char partial copy is the same defect.
//   R2. No fenced block may be huge and non-identical, prose or not.
//   R3. The doc must actually name the source file, so a reader is sent somewhere.
//   R4. The direct keyless connect URL lives in the SOURCE file, past Smithery's
//       1,000-char search truncation — deliberate, so it costs no ranking window.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = readFileSync(new URL('../docs/SMITHERY-LISTING-PASTE.md', import.meta.url), 'utf8');
const SRC = readFileSync(new URL('../scripts/smithery_description.txt', import.meta.url), 'utf8');

// Smithery's SEARCH api truncates `description` to this many chars — measured
// across 50 servers on 2026-09-01, and pinned in registry_monitor.py as
// SMITHERY_SEARCH_CHARS. Only what survives the cut can rank.
const SEARCH_CHARS = 1000;

/** Every fenced block in the doc, with its language tag. */
function blocks() {
  return [...DOC.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)]
    .map((m) => ({ lang: m[1], body: m[2] }));
}

/** Prose = at least two sentence boundaries. A keyword list has none. */
const sentences = (s) => (s.match(/[a-z0-9)][.!?]\s+[A-Z]/g) || []).length;
const same = (a, b) => a.trim() === b.trim();

describe('SMITHERY-LISTING-PASTE.md — one origin for the description', () => {
  it('MUST-FAIL CONTROL: the harness parses real blocks and reads a real source file', () => {
    const b = blocks();
    expect(b.length, 'no fenced blocks parsed — every check below would be vacuous').toBeGreaterThan(3);
    expect(b.some((x) => x.lang === 'bash'), 'no bash block found').toBe(true);
    expect(SRC.length, 'the description source is missing or trivial').toBeGreaterThan(1500);
    // The keywords block is the largest LEGITIMATE paste field; if it ever
    // disappears, R1 could pass because there is nothing left to check.
    expect(b.some((x) => x.body.length > 400), 'no substantial block left to police').toBe(true);
  });

  it('R1 no fenced block is prose unless it IS scripts/smithery_description.txt', () => {
    for (const b of blocks()) {
      if (sentences(b.body) >= 2 && !same(b.body, SRC)) {
        expect.fail(
          `docs/SMITHERY-LISTING-PASTE.md carries a ${b.body.length}-char prose block that is ` +
          `not scripts/smithery_description.txt:\n\n  ${b.body.slice(0, 120)}…\n\n` +
          `That file is quantity-healed by sync-tools-manifest.mjs and this doc is not, so the ` +
          `copy WILL go stale and pasting it regresses the live listing. Point at the file ` +
          `(\`cat scripts/smithery_description.txt\`) instead of duplicating it.`,
        );
      }
    }
  });

  it('R2 no fenced block is huge and non-identical, prose or not', () => {
    for (const b of blocks()) {
      if (b.body.length >= SEARCH_CHARS && !same(b.body, SRC)) {
        expect.fail(`a ${b.body.length}-char block is not the description source: ${b.body.slice(0, 100)}…`);
      }
    }
  });

  it('R3 the doc names the source file, so the reader is sent somewhere real', () => {
    expect(DOC).toMatch(/scripts\/smithery_description\.txt/);
    expect(DOC).toMatch(/cat scripts\/smithery_description\.txt/);
  });

  it('R4 the direct keyless connect URL is in the SOURCE, past the search cut', () => {
    const at = SRC.indexOf('https://dchub.cloud/mcp');
    expect(at, 'the direct keyless connect URL is not in the listing copy at all').toBeGreaterThan(-1);
    // Deliberate: the first 1,000 chars are the only text that can RANK, so the
    // connect URL — which is for an agent already reading the detail page — must
    // not be spent there. Moving it earlier is a ranking decision, not a typo.
    expect(
      at,
      `the connect URL sits at char ${at}, inside Smithery's ${SEARCH_CHARS}-char search ` +
      `window. Only text inside that window can rank; a URL there spends ranking real ` +
      `estate on something no search query will ever match.`,
    ).toBeGreaterThan(SEARCH_CHARS);
    // and it must be the keyless promise, not a bare link
    expect(SRC).toMatch(/keyless/i);
  });
});
