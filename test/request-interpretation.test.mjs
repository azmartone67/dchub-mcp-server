// request-interpretation.test.mjs — (2026-08-25)  STAGE 0a
//
// An argument this server does not declare is dropped in silence. Measured
// live 2026-08-25, both real:
//
//   get_power_availability_timeline{latitude,longitude} -> API 400. That tool
//     declares {mw, state, years} and NO coordinates. The 400 says a parameter
//     was rejected; it never says WHICH.
//   /api/v1/facilities?search=… -> the ENTIRE 17,170-row fleet, because
//     `search` was not an accepted alias. No error at all.
//
// A dropped argument that errors is visible. One that is ignored is not.
//
// ★ The load-bearing half of this file is the REFUSAL. There is no
// `recognized_arguments`, and there must not be: capacity_mw and state are BOTH
// declared on analyze_site and identical at dispatch, yet state moves the
// composite score (AZ 83.6 vs TX 71) and capacity_mw does not (79 at 1 MW,
// 5000 MW and absent). Reporting both as "recognized" would report a silently
// dropped constraint as understood — a false reassurance, strictly worse than
// silence.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _requestInterpretation, _stampRequestInterpretation } from '../server.mjs';

const declared = (...k) => new Set(k);

describe('it names arguments that definitively never reached the handler', () => {
  it('reports sent MINUS declared', () => {
    const ri = _requestInterpretation(
      { latitude: 33.4, longitude: -112, state: 'AZ' }, declared('mw', 'state', 'years'));
    expect(ri.unsupported_arguments).toEqual(['latitude', 'longitude']);
  });

  it('is SILENT when every argument is declared', () => {
    expect(_requestInterpretation({ state: 'AZ' }, declared('mw', 'state'))).toBe(null);
  });

  it('is silent on an empty call', () => {
    expect(_requestInterpretation({}, declared('state'))).toBe(null);
  });

  it('says nothing for a tool whose declared set is unknown', () => {
    // Guessing "everything you sent is unsupported" would be worse than silence.
    expect(_requestInterpretation({ a: 1 }, null)).toBe(null);
    expect(_requestInterpretation({ a: 1 }, undefined)).toBe(null);
  });

  it('sorts, so the block is stable across calls', () => {
    const ri = _requestInterpretation({ zz: 1, aa: 2 }, declared('x'));
    expect(ri.unsupported_arguments).toEqual(['aa', 'zz']);
  });
});

describe('★ it refuses to claim an argument was APPLIED', () => {
  it('has no recognized_arguments key', () => {
    const ri = _requestInterpretation({ q: 1 }, declared('x'));
    expect(Object.keys(ri)).not.toContain('recognized_arguments');
    expect(Object.keys(ri)).not.toContain('applied_arguments');
  });

  it('states in-band that declared does NOT mean applied', () => {
    const ri = _requestInterpretation({ q: 1 }, declared('x'));
    expect(ri.caveat).toMatch(/cannot tell you/i);
    expect(ri.caveat).toMatch(/applied/i);
  });

  it('points at the one place that CAN say it', () => {
    const ri = _requestInterpretation({ q: 1 }, declared('x'));
    expect(ri.caveat).toMatch(/constraint_coverage/);
    expect(ri.caveat).toMatch(/argument_disposition/);
  });

  it('calls the basis true by construction, not an inference', () => {
    const ri = _requestInterpretation({ q: 1 }, declared('x'));
    expect(ri.basis).toMatch(/by construction/i);
  });
});

describe('stamping is additive, silent and fail-soft', () => {
  const wrap = (sc) => ({ content: [{ type: 'text', text: '{}' }], structuredContent: sc });

  it('stamps when an argument really was undeclared', () => {
    const r = _stampRequestInterpretation(
      wrap({ ok: true }), { latitude: 1 }, declared('mw', 'state'));
    expect(r.structuredContent.request_interpretation.unsupported_arguments)
      .toEqual(['latitude']);
  });

  it('adds nothing when there is nothing to report', () => {
    const r = _stampRequestInterpretation(wrap({ ok: true }), { state: 'AZ' }, declared('state'));
    expect(r.structuredContent.request_interpretation).toBeUndefined();
  });

  it('never overwrites a block the handler already set', () => {
    // ★ This test MUST use a declared set that would otherwise produce a block —
    // with an unresolvable one, nothing is computed and the guard is never
    // reached. Mutation-tested: the earlier version passed with the guard
    // deleted, because it passed a tool name that resolved to null.
    const own = { unsupported_arguments: ['handler_said_so'] };
    const r = _stampRequestInterpretation(
      wrap({ ok: true, request_interpretation: own }), { bogus: 1 }, declared('x'));
    expect(r.structuredContent.request_interpretation).toBe(own);
  });

  it('leaves the rest of structuredContent intact', () => {
    const r = _stampRequestInterpretation(
      wrap({ ok: true, data: [1, 2] }), { bogus: 1 }, declared('x'));
    expect(r.structuredContent.ok).toBe(true);
    expect(r.structuredContent.data).toEqual([1, 2]);
  });

  it('survives null, non-object and a throwing getter', () => {
    expect(_stampRequestInterpretation(null, {}, declared('x'))).toBe(null);
    const evil = { content: [] };
    Object.defineProperty(evil, 'structuredContent', { get() { throw new Error('boom'); } });
    expect(() => _stampRequestInterpretation(evil, {}, declared('x'))).not.toThrow();
  });
});

describe('★ it is actually WIRED into dispatch', () => {
  // A pure unit test proves the function is correct and says NOTHING about
  // whether anything calls it. This escaped once already on _flagUpstreamError.
  const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

  it('is called from the tool-dispatch chain exactly once', () => {
    expect((SRC.match(/_stampRequestInterpretation\(_stampAttribution\(/g) || []).length).toBe(1);
  });

  it('is handed the raw args AND the tool\'s declared param set', () => {
    expect(SRC).toMatch(/\), args, _toolParamKeys\(name\)\), name\)\);/);
  });

  it('sits INSIDE the error flag, so an errored call still reports dropped args', () => {
    expect(SRC).toMatch(/_flagUpstreamError\(_stampRequestInterpretation\(/);
  });
});
