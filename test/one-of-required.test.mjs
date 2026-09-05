import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ONE_OF_REQUIRED } from '../server.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// r-oneof (2026-09-05). A tool whose identifier is satisfiable by ANY ONE of
// several arguments is a JSON-Schema `anyOf`, which inputSchema here does not
// express. Zod therefore cannot reject a call naming NONE of them, the call
// falls through to the tier gate, and the gate answers about MONEY instead of
// about the missing argument.
//
// MEASURED LIVE against production, get_facility with `{}` — no identifier:
//
//     isError: false
//     "🔒 Free-tier preview of `get_facility`. Full results: your human unlocks
//      in one click — $10 one-time = 1,000 API calls …"
//
// The agent asked for a facility without naming one and was told the answer
// costs money. Nothing in the response says an argument is missing, so its
// rational next step is to tell its human to pay. Same family as ARG_ALIASES —
// a call that does not fail LOUDLY — with a worse ending.
//
// ★ WHAT WAS ALSO MEASURED, and why this table is short. Every one of these
// was probed with `{}` against production the same day, BEFORE writing the
// table, precisely so it would not be applied where it does not belong:
//
//   get_market_dcpi_rank  -32602 Input validation error   Zod `required` works
//   score_facility        -32602                          "
//   get_gas_economics     -32602                          "
//   analyze_site          {"error":"missing_coordinates"} own check, correct
//   get_market_intel      returns the market LIST         no identifier needed
//   get_grid_data         returns default grid data       no identifier needed
//
// Adding either of the last two would BREAK a working list mode. That is what
// `test_a_tool_with_a_working_list_mode_is_not_listed` is here to stop.

const toolspec = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'toolspec.json'), 'utf8'));
const TOOLS = Array.isArray(toolspec) ? toolspec : toolspec.tools;
const PROPS = Object.fromEntries(TOOLS.map(
  t => [t.name, new Set(Object.keys((t.inputSchema && t.inputSchema.properties) || {}))]));

// Measured to answer meaningfully with NO arguments. Listing one here would
// convert a working call into an error.
const HAS_A_WORKING_NO_ARG_MODE = ['get_market_intel', 'get_grid_data'];

// Measured to reject `{}` correctly already, via Zod or their own check.
const ALREADY_REJECTS = ['get_market_dcpi_rank', 'score_facility',
                         'get_gas_economics', 'analyze_site'];

describe('ONE_OF_REQUIRED', () => {
  it('covers get_facility, the tool measured answering a paywall', () => {
    expect(ONE_OF_REQUIRED.get_facility).toBeTruthy();
    expect(ONE_OF_REQUIRED.get_facility).toContain('slug');
  });

  it('every accepted name is a REAL declared property of that tool', () => {
    // Non-vacuous: resolved against toolspec.json, which this table does not
    // own. A renamed property upstream reds here instead of shipping a hint
    // that tells an agent to send an argument the tool does not have.
    const bad = {};
    for (const [tool, names] of Object.entries(ONE_OF_REQUIRED)) {
      expect(PROPS[tool], `${tool} is not a known tool`).toBeTruthy();
      const missing = names.filter(n => !PROPS[tool].has(n));
      if (missing.length) bad[tool] = missing;
    }
    expect(bad).toEqual({});
  });

  it('names more than one alternative — a single required arg belongs in the schema', () => {
    for (const [tool, names] of Object.entries(ONE_OF_REQUIRED)) {
      expect(names.length, `${tool}: one name is a plain \`required\`, not a one-of`)
        .toBeGreaterThan(1);
    }
  });

  it('a tool with a working list mode is not listed', () => {
    for (const t of HAS_A_WORKING_NO_ARG_MODE) {
      expect(ONE_OF_REQUIRED[t],
        `${t} answers meaningfully with {} (measured); requiring an identifier `
        + 'would turn a working call into an error').toBeUndefined();
    }
  });

  it('a tool that already rejects {} is not listed', () => {
    for (const t of ALREADY_REJECTS) {
      expect(ONE_OF_REQUIRED[t],
        `${t} already rejects {} correctly; a second gate is dead code`)
        .toBeUndefined();
    }
  });
});

describe('the precheck predicate', () => {
  // The decision as it appears in server.mjs, pulled out and exercised rather
  // than re-implemented — re-implementing it would test this file, not the code.
  const src = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  const m = src.match(/const _oneOf = ONE_OF_REQUIRED\[name\];\s*\n\s*if \(_oneOf && !(_oneOf\.some\(\(k\) => \{[\s\S]*?\}\))\)/);
  it('the predicate is where the test thinks it is', () => {
    expect(m, 'could not locate the one-of predicate in server.mjs').toBeTruthy();
  });

  const missing = (args) => {
    const _oneOf = ONE_OF_REQUIRED.get_facility;
    // eslint-disable-next-line no-eval
    return !eval(m[1].replace(/\bargs\b/g, 'args'));
  };

  it('fires when no identifier is present', () => {
    // eslint-disable-next-line no-unused-vars
    const args = {};
    expect(missing(args)).toBe(true);
  });

  it('does NOT fire when any one identifier is present', () => {
    for (const k of ONE_OF_REQUIRED.get_facility) {
      const args = { [k]: 'equinix-dc-ash1' };
      const _oneOf = ONE_OF_REQUIRED.get_facility;
      // eslint-disable-next-line no-eval
      expect(eval(m[1]), `${k} should satisfy the requirement`).toBe(true);
    }
  });

  it('treats empty string and null as absent, not as an identifier', () => {
    for (const v of ['', null, undefined]) {
      const args = { slug: v };
      const _oneOf = ONE_OF_REQUIRED.get_facility;
      // eslint-disable-next-line no-eval
      expect(eval(m[1]), `slug=${JSON.stringify(v)} must not count`).toBe(false);
    }
  });

  it('ignores unrelated arguments', () => {
    const args = { include_power: true, include_nearby: true };
    const _oneOf = ONE_OF_REQUIRED.get_facility;
    // eslint-disable-next-line no-eval
    expect(eval(m[1])).toBe(false);
  });
});
