// Unit tests for r-invalid-bearer-401 (2026-07-16) — the present-but-invalid
// Bearer challenge. Live-verified defect: POST /mcp initialize with an
// unknown `Authorization: Bearer` returned a silent anonymous 200 session, so
// enterprise OAuth brokers (Gemini Custom-MCP, Copilot Studio) that trigger
// their sign-in off 401 + WWW-Authenticate never started the flow.
// _invalidBearerEligible is the pure decision function the POST /mcp handler
// runs BEFORE paying the async validateKey() hop; imported directly from
// server.mjs (skips app.listen under VITEST).
import { describe, it, expect } from 'vitest';
import { _invalidBearerEligible } from '../server.mjs';

const base = {
  authHeader: 'Bearer some_unknown_token',
  hasApiKeyHeader: false,
  bearerResolved: false,
  method: 'initialize',
  hasSession: false,
};

describe('_invalidBearerEligible — present-but-invalid Bearer challenge', () => {
  it('THE REPRO: unknown Bearer on initialize, no session, no X-API-Key → eligible', () => {
    expect(_invalidBearerEligible(base)).toBe(true);
  });

  it('unknown Bearer on tools/call (new session) → eligible', () => {
    expect(_invalidBearerEligible({ ...base, method: 'tools/call' })).toBe(true);
  });

  it('CRITICAL: no Authorization header → NOT eligible (anonymous 200 free tier unchanged)', () => {
    expect(_invalidBearerEligible({ ...base, authHeader: undefined })).toBe(false);
    expect(_invalidBearerEligible({ ...base, authHeader: '' })).toBe(false);
    expect(_invalidBearerEligible({ ...base, authHeader: null })).toBe(false);
  });

  it('non-Bearer scheme or empty Bearer → NOT eligible', () => {
    expect(_invalidBearerEligible({ ...base, authHeader: 'Basic dXNlcjpwdw==' })).toBe(false);
    expect(_invalidBearerEligible({ ...base, authHeader: 'Bearer' })).toBe(false);
    expect(_invalidBearerEligible({ ...base, authHeader: 'Bearer   ' })).toBe(false);
  });

  it('Bearer scheme matches case-insensitively (bearer/BEARER)', () => {
    expect(_invalidBearerEligible({ ...base, authHeader: 'bearer tok_x' })).toBe(true);
    expect(_invalidBearerEligible({ ...base, authHeader: 'BEARER tok_x' })).toBe(true);
  });

  it('X-API-Key present alongside a junk Bearer → NOT eligible (keyed callers untouched)', () => {
    expect(_invalidBearerEligible({ ...base, hasApiKeyHeader: true })).toBe(false);
  });

  it('Bearer already resolved (DC-Hub AS token / AuthKit JWT) → NOT eligible', () => {
    expect(_invalidBearerEligible({ ...base, bearerResolved: true })).toBe(false);
  });

  it('discovery methods stay open — tools/list, ping, notifications', () => {
    expect(_invalidBearerEligible({ ...base, method: 'tools/list' })).toBe(false);
    expect(_invalidBearerEligible({ ...base, method: 'ping' })).toBe(false);
    expect(_invalidBearerEligible({ ...base, method: 'notifications/initialized' })).toBe(false);
    expect(_invalidBearerEligible({ ...base, method: undefined })).toBe(false);
  });

  it('established session → NOT eligible (junk bearers mid-session stay with _lateKeyResolve)', () => {
    expect(_invalidBearerEligible({ ...base, hasSession: true })).toBe(false);
  });
});
