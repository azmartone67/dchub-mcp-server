// Gemini Shift A/B (2026-07-30) — leaf-tool description precision, held honest.
//
// The 07-28 catchment audit found users' own vocabulary (megawatt, fuel mix,
// power density, nuclear, cooling, PUE, SMR, carbon, liquid cooling, …) almost
// absent from the 81 leaf descriptions; execute_plan was fixed first, leaves
// deferred. This tranche adds vocabulary ONLY where a live tool call verified
// the data actually carries it (probed 2026-07-30):
//   · get_power_pipeline   → technology labels incl. literal 'nuclear'
//                            ("Fermi Nuclear", "Project Matador Nuclear"),
//                            and its own handler aggregates by_technology_mw
//   · get_renewable_energy → by_fuel breakdown = a fuel-mix read
//   · ai_capacity_index    → response literally carries "rack power density
//                            or cooling type"
//
// The second half of this file matters more than the first: the SAME probes
// showed no PUE, no SMR labels (data says 'nuclear'), no carbon fields, no
// 'liquid' anywhere — so those words must NOT appear in these descriptions.
// Vocabulary an agent can route on but the tool cannot answer is the
// force-match overclaiming we declined on 07-28, and a router that learns we
// overclaim deprioritises the whole catalog. Both directions are pinned so
// neither "finishing the list" nor a helpful future edit can drift this.
//
// Descriptions are read from the SOURCE (the string literal passed to
// trackedTool) — the same string the runtime serves for these tools; the
// per-platform override layer sits above and is platform-scoped by design.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

// Extract the single-quoted description literal that follows
// trackedTool(srv, '<name>',  — tolerant of escaped quotes inside.
function sourceDescription(name) {
  const at = SRC.indexOf(`trackedTool(srv, '${name}'`);
  expect(at, `${name}: registration not found`).toBeGreaterThan(-1);
  const openRel = SRC.indexOf("'", at + `trackedTool(srv, '${name}'`.length + 1);
  expect(openRel, `${name}: description literal not found`).toBeGreaterThan(-1);
  let i = openRel + 1, out = '';
  while (i < SRC.length) {
    const ch = SRC[i];
    if (ch === '\\') { out += SRC[i + 1]; i += 2; continue; }
    if (ch === "'") break;
    out += ch; i += 1;
  }
  return out;
}

const VERIFIED = {
  get_power_pipeline: ['nuclear', 'megawatt'],
  get_renewable_energy: ['fuel mix'],
  ai_capacity_index: ['power density', 'cooling', 'megawatt'],
};

// Terms the live probes could NOT verify in these tools' data. 'carbon' and
// 'PUE' returned nothing anywhere; 'SMR' is unsupported because the data
// labels the technology 'nuclear'; 'liquid cooling' because the field is
// 'cooling type' with no liquid variant observed.
const REFUSED = ['smr', 'small modular', 'pue', 'liquid cooling', 'carbon'];

describe('leaf catchment — verified vocabulary present', () => {
  for (const [tool, terms] of Object.entries(VERIFIED)) {
    for (const term of terms) {
      it(`${tool} carries '${term}'`, () => {
        expect(sourceDescription(tool).toLowerCase()).toContain(term);
      });
    }
  }
});

describe('leaf catchment — unverified vocabulary REFUSED (the honesty pin)', () => {
  for (const tool of Object.keys(VERIFIED)) {
    for (const term of REFUSED) {
      it(`${tool} does NOT claim '${term}'`, () => {
        expect(sourceDescription(tool).toLowerCase()).not.toContain(term);
      });
    }
  }
});

describe('leaf catchment — precision stays precision', () => {
  it('no force-match language in the tranche', () => {
    for (const tool of Object.keys(VERIFIED)) {
      const d = sourceDescription(tool).toLowerCase();
      for (const banned of ['must be called', 'always call', 'start here',
                            'the front door', 'call this first']) {
        expect(d, `${tool}: '${banned}' is front-door/force-match language`)
          .not.toContain(banned);
      }
    }
  });

  it('edited descriptions stay leaf-sized — none rivals the front door', () => {
    // execute_plan (the intended largest routing surface among orchestrators)
    // was 1,768 live bytes on 2026-07-30; the largest leaf was 2,209. Keep the
    // tranche comfortably below the current leaf maximum so this wave can
    // never mint a new rank-1 description.
    for (const tool of Object.keys(VERIFIED)) {
      expect(Buffer.byteLength(sourceDescription(tool), 'utf8'),
             `${tool}: description ballooned`).toBeLessThan(2100);
    }
  });

  it('semantic_search query alias grounds itself (Shift B remnant)', () => {
    // The single under-described parameter of 309 in the 07-30 audit.
    const at = SRC.indexOf("query: S.describe('Alias for q — the same natural-language query");
    expect(at, 'query alias grounding lost').toBeGreaterThan(-1);
  });
});
