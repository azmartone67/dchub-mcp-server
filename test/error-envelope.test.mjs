// Offline unit tests for the error_version:1 envelope builder (Gemini contract).
// Pure, network-free — guards the LOCKED shape + the strict-subset guarantee on
// suggested_params (an invalid key breaks the agent retry loop, so it MUST drop).
import { describe, it, expect } from 'vitest';
import {
  ERROR_VERSION,
  VALID_SEVERITIES,
  errorProvenance,
  filterSuggestedParams,
  buildMitigation,
  buildErrorEnvelope,
  withErrorEnvelope,
} from '../lib/error-envelope.mjs';

const TODAY = new Date().toISOString().slice(0, 10);

describe('error_version:1 — envelope shape', () => {
  it('has error_version 1, a gateway provenance block, and _error_mitigation', () => {
    const env = buildErrorEnvelope({
      error_code: 'tool_execution_failed',
      severity: 'transient_backoff',
      deterministic_hint: 'wait ~500ms and retry',
    });
    expect(env.error_version).toBe(1);
    expect(ERROR_VERSION).toBe(1);
    expect(env.provenance).toEqual({
      source: 'DC Hub Protocol Gateway',
      as_of: TODAY,
      license: 'CC-BY-4.0',
      cite_as: 'DC Hub, dchub.cloud',
    });
    expect(env._error_mitigation.error_code).toBe('tool_execution_failed');
    expect(env._error_mitigation.severity).toBe('transient_backoff');
    expect(env._error_mitigation.deterministic_hint).toBe('wait ~500ms and retry');
  });

  it('as_of is the RUNTIME date (not hardcoded)', () => {
    // Recomputed from new Date() inside the helper — must equal today's UTC date.
    expect(errorProvenance().as_of).toBe(TODAY);
    expect(errorProvenance().as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('exposes exactly the three locked severities', () => {
    expect([...VALID_SEVERITIES].sort()).toEqual(
      ['fatal', 'parameter_adjustment', 'transient_backoff']);
  });
});

describe('severity semantics', () => {
  it('transient_backoff omits suggested_params (nothing to adjust)', () => {
    const env = buildErrorEnvelope({
      error_code: 'tool_execution_failed',
      severity: 'transient_backoff',
      deterministic_hint: 'backend pressure — wait ~500ms and retry same params',
    });
    expect('suggested_params' in env._error_mitigation).toBe(false);
  });

  it('an unknown/invalid severity falls back to transient_backoff', () => {
    expect(buildMitigation({ severity: 'meltdown' }).severity).toBe('transient_backoff');
    expect(buildMitigation({}).severity).toBe('transient_backoff');
  });

  it('keeps a valid fatal severity', () => {
    expect(buildMitigation({ severity: 'fatal' }).severity).toBe('fatal');
  });
});

describe('suggested_params — STRICT SUBSET of the tool schema', () => {
  it('drops keys not in the allowed set, keeps valid ones', () => {
    const mit = buildMitigation({
      error_code: 'invalid_iso',
      severity: 'parameter_adjustment',
      deterministic_hint: 'did you mean ERCOT?',
      suggested_params: { iso: 'ERCOT', region: 'x', bogus: 1 },
      allowed_params: new Set(['iso', 'metric', 'period']),  // get_grid_data schema
    });
    expect(mit.suggested_params).toEqual({ iso: 'ERCOT' });
    expect('region' in mit.suggested_params).toBe(false);
    expect('bogus' in mit.suggested_params).toBe(false);
  });

  it('accepts allowed as an Array as well as a Set', () => {
    const mit = buildMitigation({
      severity: 'parameter_adjustment',
      suggested_params: { iso: 'PJM', nope: 2 },
      allowed_params: ['iso', 'metric'],
    });
    expect(mit.suggested_params).toEqual({ iso: 'PJM' });
  });

  it('OMITS suggested_params entirely when no key survives filtering', () => {
    const mit = buildMitigation({
      severity: 'parameter_adjustment',
      suggested_params: { only_bad_keys: 1, also_bad: 2 },
      allowed_params: ['iso'],
    });
    expect('suggested_params' in mit).toBe(false);
  });

  it('fails CLOSED when there is no allowed set (drops everything)', () => {
    // Cannot validate against a schema → emitting an unvalidatable key is worse
    // than emitting none, so the whole thing is dropped.
    expect(filterSuggestedParams({ iso: 'ERCOT' }, null)).toEqual({});
    expect('suggested_params' in buildMitigation({
      severity: 'parameter_adjustment',
      suggested_params: { iso: 'ERCOT' },
      // allowed_params omitted
    })).toBe(false);
  });

  it('OMITS suggested_params when the candidate is absent', () => {
    const mit = buildMitigation({
      severity: 'parameter_adjustment',
      deterministic_hint: 'use get_grid_scoreboard for non-US grids',
      allowed_params: ['iso'],
      // no suggested_params → e.g. an intl ISO where a tool-switch (not a param) fixes it
    });
    expect('suggested_params' in mit).toBe(false);
  });

  it('filterSuggestedParams keeps only allowed keys', () => {
    expect(filterSuggestedParams({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });
});

describe('withErrorEnvelope — merge onto an existing payload', () => {
  it('preserves legacy payload fields and adds the envelope keys', () => {
    const payload = { error: 'invalid_iso', detail: 'iso=X', valid_isos: ['ERCOT'], _source: 'DC Hub — dchub.cloud' };
    const out = withErrorEnvelope(payload, {
      error_code: 'invalid_iso',
      severity: 'parameter_adjustment',
      deterministic_hint: 'set iso to a valid US ISO',
      suggested_params: { iso: 'ERCOT' },
      allowed_params: ['iso', 'metric', 'period'],
    });
    // legacy fields survive
    expect(out.error).toBe('invalid_iso');
    expect(out.valid_isos).toEqual(['ERCOT']);
    // envelope present
    expect(out.error_version).toBe(1);
    expect(out.provenance.source).toBe('DC Hub Protocol Gateway');
    expect(out._error_mitigation.suggested_params).toEqual({ iso: 'ERCOT' });
  });
});

describe('fail-soft — the error path must never throw', () => {
  it('handles null / garbage inputs without throwing', () => {
    expect(() => buildErrorEnvelope(null)).not.toThrow();
    expect(() => buildErrorEnvelope(undefined)).not.toThrow();
    expect(() => withErrorEnvelope(42, null)).not.toThrow();
    expect(() => filterSuggestedParams(null, null)).not.toThrow();
    expect(() => filterSuggestedParams('not-an-object', ['iso'])).not.toThrow();
  });

  it('bare buildErrorEnvelope(null) still yields a valid envelope', () => {
    const env = buildErrorEnvelope(null);
    expect(env.error_version).toBe(1);
    expect(env._error_mitigation.severity).toBe('transient_backoff');
    expect(env._error_mitigation.error_code).toBe('unknown_error');
  });

  it('withErrorEnvelope on a non-object payload returns the bare envelope', () => {
    const out = withErrorEnvelope('oops', { error_code: 'x', severity: 'fatal', deterministic_hint: 'h' });
    expect(out.error_version).toBe(1);
    expect(out._error_mitigation.severity).toBe('fatal');
  });
});
