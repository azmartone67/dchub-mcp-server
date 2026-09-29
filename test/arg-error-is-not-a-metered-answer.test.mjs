// An argument-validation envelope is not a product answer (2026-09-20).
//
// Measured live on a fresh anon session against production. `get_grid_intelligence {}`
// is a SCHEMA-VALID call — the tool's inputSchema declares no `required` array, so
// "(required)" lives only in prose a JSON-Schema validator ignores:
//
//   call 1  {"error":"region required"}  -> "you have 1 more full answer today"
//   call 2  {"error":"region required"}  -> "trial answer 2 of 2 · remaining_today: 0"
//   call 3  {"error":"region required"}  -> walled, and valid_regions trimmed
//                                           7 -> 3 behind _valid_regions_total_in_pro
//
// Two malformed calls that returned ZERO data burned the whole daily trial, and the
// wall then paywalled the list of valid values the caller needed to fix its call.
// get_grid_intelligence was the top real-caller leak on /api/v1/admin/funnel/leakage
// that day: 208 signals / 108 sessions, ~1.9 per session — "two tries, then gone".
//
// These tests pin the predicate AND its wiring. A predicate that is exported but
// not consulted would leave every symptom in place.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isArgValidationError, _resultIsArgError, trimForTrial, TRIAL_PREVIEW_ROWS }
  from '../server.mjs';

// The real envelope, copied from the live probe.
const REGION_REQUIRED = {
  error: 'region required',
  hint: 'Pass region_id (aliases iso/region accepted) = one of the 7 live US ISOs, or a US EIA balancing-authority code (40+ live, e.g. SOCO, AZPS, DUK, TVA). To ask by market name instead, pass market="Ashburn".',
  valid_regions: ['PJM', 'ERCOT', 'CAISO', 'MISO', 'SPP', 'NYISO', 'ISO-NE'],
  example: 'get_grid_intelligence region_id="PJM"',
  example_by_market: 'get_grid_intelligence market="Ashburn"',
};

describe('isArgValidationError', () => {
  it('recognises the live get_grid_intelligence envelope', () => {
    expect(isArgValidationError(REGION_REQUIRED)).toBe(true);
  });

  it('recognises the shorter sibling envelopes', () => {
    expect(isArgValidationError({
      error: 'region required (US state code or name)',
      example: 'get_gas_intelligence region="TX"',
    })).toBe(true);
  });

  // ── the load-bearing half: it must NOT swallow a real answer ──────────────
  it('is FALSE when any data key rides along', () => {
    expect(isArgValidationError({ ...REGION_REQUIRED, projects: [{ id: 1 }] })).toBe(false);
    expect(isArgValidationError({ error: 'partial', fuel_mix: { gas: 0.4 } })).toBe(false);
    expect(isArgValidationError({ error: 'x', rows: [] })).toBe(false);
  });

  it('is FALSE without a non-empty string error', () => {
    expect(isArgValidationError({ hint: 'h', example: 'e' })).toBe(false);
    expect(isArgValidationError({ error: '', hint: 'h' })).toBe(false);
    expect(isArgValidationError({ error: 404, hint: 'h' })).toBe(false);
  });

  it('is FALSE for non-objects', () => {
    for (const v of [null, undefined, 'error', 7, [REGION_REQUIRED]]) {
      expect(isArgValidationError(v)).toBe(false);
    }
  });
});

describe('_resultIsArgError', () => {
  it('reads through a tool result envelope', () => {
    expect(_resultIsArgError({
      content: [{ type: 'text', text: JSON.stringify(REGION_REQUIRED) }],
    })).toBe(true);
  });

  it('fails CLOSED — anything unparseable meters as before', () => {
    expect(_resultIsArgError({ content: [{ type: 'text', text: 'not json' }] })).toBe(false);
    expect(_resultIsArgError({ content: [] })).toBe(false);
    expect(_resultIsArgError(null)).toBe(false);
    expect(_resultIsArgError({ content: [{ type: 'text', text: '{"rows":[1,2]}' }] })).toBe(false);
  });
});

describe('trimForTrial leaves an error envelope alone', () => {
  it('keeps all 7 valid_regions and stamps no _total_in_pro', () => {
    const out = trimForTrial(structuredClone(REGION_REQUIRED), 'get_grid_intelligence');
    expect(out.valid_regions).toHaveLength(7);
    expect(out.valid_regions).toEqual(REGION_REQUIRED.valid_regions);
    expect(out._valid_regions_total_in_pro).toBeUndefined();
    expect(out.hint).toBe(REGION_REQUIRED.hint);
  });

  // Control: the guard must be SCOPED. A real answer still trims.
  it('still trims a same-shaped array on a real answer', () => {
    const real = { regions: ['PJM', 'ERCOT', 'CAISO', 'MISO', 'SPP', 'NYISO', 'ISO-NE'] };
    const out = trimForTrial(real, 'get_grid_intelligence');
    expect(out.regions).toHaveLength(TRIAL_PREVIEW_ROWS);
    expect(out._regions_total_in_pro).toBe(7);
  });
});

// ── wiring: a predicate nothing consults changes nothing ──────────────────
describe('the guard is wired into both consume sites', () => {
  const src = readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('trimForTrial early-returns on an arg error', () => {
    const body = code.slice(code.indexOf('function trimForTrial('));
    expect(body.slice(0, 400)).toContain('if (isArgValidationError(parsed)) return parsed;');
  });

  // ★ #469 left this site unguarded and called it structural. It is not: the
  // handler HAS run here (`const _trialResult = await _dataP`, ~100 lines
  // above). The ReferenceError that caused that conclusion named the WRONG
  // variable — `result` belongs to a different, later branch.
  it('the anon pre-flight cap skips an arg error', () => {
    const i = code.indexOf('const _capApplies =');
    expect(i).toBeGreaterThan(-1);
    const stmt = code.slice(i, code.indexOf(';', i));
    expect(stmt).toContain('!_resultIsArgError(');
  });

  it('...and reads _trialResult, never the later branch\'s `result`', () => {
    // Guarding on `result` here throws "Cannot access 'result' before
    // initialization" at runtime — a TDZ error the type system cannot see and
    // that only test/automint-trial-rungs.test.mjs catches. Pin the variable.
    const i = code.indexOf('const _capApplies =');
    const stmt = code.slice(i, code.indexOf(';', i));
    expect(stmt).toContain('_resultIsArgError(_trialResult)');
    expect(stmt).not.toMatch(/_resultIsArgError\(\s*result\s*\)/);
  });

  it('the metered trial-taste block is skipped entirely on an arg error', () => {
    expect(code).toContain('if (gate.trial_taste && !_resultIsArgError(result)) {');
    expect(code).not.toContain('if (gate.trial_taste) {');
  });
});
