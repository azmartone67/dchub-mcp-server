// Guards for the canonical problem taxonomy (r-taxonomy, 2026-07-31).
//
// OWNER: dchub-backend routes/problem_taxonomy.py, snapshotted daily into
// canonical/problem_taxonomy.json by scripts/refresh-problem-taxonomy.mjs
// (fail-closed). This repo DERIVES three surfaces from the snapshot:
//   1. initialize instructions — _composeScopeSection appended at startup
//   2. discover_tools — not_for {note, out_of_scope} in the envelope
//   3. execute_plan description — the vocabulary clause renders the in_scope
//      list verbatim (a static literal, because sync-tools-manifest.mjs
//      literal-evals descriptions into the registry manifests — THESE TESTS
//      are what keep that transcription honest, the 07-28 anchor-contract
//      lesson: the test reads the RUNTIME source, never its own copy).
// Plus replay.why_live_data (planner v5.9): a per-class "why this answer
// needed live data" reason on plan_query AND execute_plan results.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _composeScopeSection, _INSTRUCTIONS, _CLASS_WHY_LIVE, _PLAN_CLASSES,
  _planQuery, _planReplay, createServer,
} from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'canonical', 'problem_taxonomy.json'), 'utf8'));

let tools;
beforeAll(() => { tools = createServer()._registeredTools; });

describe('committed snapshot (canonical/problem_taxonomy.json)', () => {
  it('carries what a consumer needs to derive', () => {
    expect(Number.isInteger(SNAP.version) && SNAP.version >= 1).toBe(true);
    expect(SNAP.contract_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(SNAP.source).toContain('problem_taxonomy.py'); // one file to edit
    expect(SNAP.in_scope.length).toBeGreaterThanOrEqual(8);
    expect(SNAP.out_of_scope.length).toBeGreaterThanOrEqual(5);
    expect(SNAP.not_for_note.length).toBeGreaterThan(40);
  });

  it('both lists are count-free — digit-free by contract', () => {
    // A number inside a taxonomy entry would rot on its own schedule; the
    // refresh script refuses digits and this pins the committed state too.
    for (const s of [...SNAP.in_scope, ...SNAP.out_of_scope, SNAP.not_for_note]) {
      expect(s, `digit in taxonomy entry: ${s}`).not.toMatch(/\d/);
    }
  });

  it('negative list still covers the classes partners named', () => {
    const joined = SNAP.out_of_scope.join(' ');
    for (const marker of ['PUE', 'UPS', 'networking', 'benchmarks', 'theory', 'cloud', 'LLM']) {
      expect(joined, `negative list lost its ${marker} class`).toContain(marker);
    }
  });
});

describe('_composeScopeSection (initialize instructions)', () => {
  it('carries every in_scope term, every out_of_scope entry, and the note', () => {
    const out = _composeScopeSection(SNAP);
    expect(out).toContain('IN SCOPE');
    expect(out).toContain('NOT IN SCOPE');
    for (const t of SNAP.in_scope) expect(out).toContain(t);
    for (const t of SNAP.out_of_scope) expect(out).toContain(t);
    expect(out).toContain(SNAP.not_for_note);
  });

  // ── must-fail controls: a gate that cannot be shown to withhold is not a gate ──
  it('malformed / absent taxonomy → empty string, never a crash', () => {
    for (const bad of [null, undefined, {}, 42, 'x',
                       { in_scope: ['long enough entry here'], out_of_scope: [] },
                       { ...SNAP, in_scope: SNAP.in_scope.slice(0, 3) },
                       { ...SNAP, out_of_scope: ['short'] },
                       { ...SNAP, not_for_note: 'too short' }]) {
      expect(_composeScopeSection(bad), String(JSON.stringify(bad)).slice(0, 60)).toBe('');
    }
  });

  it('the served instructions actually END with the scope section (wiring)', () => {
    const scope = _composeScopeSection(SNAP);
    expect(scope.length).toBeGreaterThan(200);
    expect(_INSTRUCTIONS.endsWith(scope)).toBe(true);
  });
});

describe('execute_plan description vocabulary (the transcription guard)', () => {
  it('every in_scope term appears verbatim in the registered description', () => {
    const desc = tools.execute_plan.description;
    for (const t of SNAP.in_scope) {
      expect(desc, `execute_plan description lost the in-scope term: "${t}" — ` +
        're-render the vocabulary clause from canonical/problem_taxonomy.json').toContain(t);
    }
  });
});

describe('discover_tools not_for (the negative list in the navigation envelope)', () => {
  it('serves the snapshot lists verbatim', async () => {
    const r = await tools.discover_tools.handler({}, { signal: new AbortController().signal });
    const sc = r.structuredContent;
    expect(sc.not_for).toBeTruthy();
    expect(sc.not_for.out_of_scope).toEqual(SNAP.out_of_scope);
    expect(sc.not_for.note).toBe(SNAP.not_for_note);
  });
});

describe('replay.why_live_code + why_live_data (planner v5.10, additive at replay schema 1)', () => {
  // ChatGPT round-11: an ENUM, not free text — stamped codes must aggregate
  // ("N% of executions needed live queue data"), and that only works if the
  // value space is small, stable, and canon-owned.
  it('the snapshot carries a small, well-formed reason enum', () => {
    const wlr = SNAP.why_live_reasons;
    expect(wlr && typeof wlr).toBe('object');
    const n = Object.keys(wlr).length;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(12);
    for (const [code, phrase] of Object.entries(wlr)) {
      expect(code).toMatch(/^requires_[a-z_]+$/);
      expect(typeof phrase).toBe('string');
      expect(phrase.length).toBeGreaterThan(20);
      expect(phrase, `digit in phrase for ${code}`).not.toMatch(/\d/);
    }
  });

  it('every plan class maps to a code, and every code exists in the canon enum', () => {
    for (const c of _PLAN_CLASSES) {
      const code = _CLASS_WHY_LIVE[c.id];
      expect(code, `class ${c.id} has no why_live code`).toBeTruthy();
      expect(SNAP.why_live_reasons[code],
        `class ${c.id} assigned code "${code}" that the canonical enum does not define — ` +
        'add it to dchub-backend routes/problem_taxonomy.py WHY_LIVE_REASONS first').toBeTruthy();
    }
  });

  it('the map stays an aggregation axis — several classes share codes', () => {
    const used = new Set(Object.values(_CLASS_WHY_LIVE));
    expect(used.size).toBeLessThan(Object.keys(_CLASS_WHY_LIVE).length);
  });

  it('a routed plan carries the code + the canon phrase; unknown carries neither', () => {
    const routed = _planQuery('rank markets for a 200 MW AI campus');
    const r = _planReplay(routed);
    const code = _CLASS_WHY_LIVE[routed.intent_class];
    expect(r.why_live_code).toBe(code);
    expect(r.why_live_data).toBe(SNAP.why_live_reasons[code]);

    const un = _planQuery('xylophone lessons for beginners');
    expect(un.intent_class).toBe('unknown');
    // emit-only-when-real: no phantom live-data claim on an unrouted plan
    const ur = _planReplay(un);
    expect('why_live_code' in ur).toBe(false);
    expect('why_live_data' in ur).toBe(false);
  });
});
