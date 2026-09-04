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

  // ── r-expired-in-session (2026-09-04) — THIS EXPECTATION IS INVERTED ─────
  // It used to read "established session → NOT eligible (junk bearers
  // mid-session stay with _lateKeyResolve)". _lateKeyResolve does govern the
  // session's IDENTITY — a rejected key leaves it anonymous — but it never
  // 401s, so the client is never TOLD. Handling and signalling are different
  // jobs, and only the first was happening mid-session.
  //
  // A 401 is the ONLY signal in the OAuth spec that tells a client to refresh.
  // Exempting sessions meant we served an expired credential silently for the
  // life of the session and never asked the client to refresh WHILE ITS
  // REFRESH TOKEN WAS STILL GOOD. By the time the session ended and the next
  // `initialize` 401'd, the refresh grant could have aged out too — leaving
  // only a human clicking reconnect. That is the report we get back verbatim:
  // "401 Unauthorized — manual reauthentication required".
  //
  // MEASURED 2026-09-04, one live session, gated tools/call:
  //     no credential        -> 200, tier "free"   (6,639 bytes)
  //     expired-shape Bearer -> 200, tier "trial"  (12,363 bytes)
  // A dead credential outscored no credential and was never challenged.
  //
  // The argument was already written for this gate's SIBLING
  // (_claudeChallengeEligible note 2): "the connector initializes, gets a
  // session, and every later tools/call carries it — so a hasSession bail
  // means the challenge never fires for anyone who completed a handshake,
  // i.e. everyone." It was applied there and not here.
  it('established session → STILL eligible: an expired token must be told', () => {
    expect(_invalidBearerEligible({ ...base, hasSession: true })).toBe(true);
    expect(_invalidBearerEligible({ ...base, hasSession: true,
                                    method: 'tools/call' })).toBe(true);
  });

  it('a session does not resurrect a caller the credential gates excluded', () => {
    // Removing the hasSession bail must not widen WHO is challenged — only
    // WHEN. A valid Bearer, an X-API-Key, or no Bearer at all stays exempt
    // whether or not a session exists.
    for (const over of [{ bearerResolved: true }, { hasApiKeyHeader: true },
                        { authHeader: undefined }, { method: 'tools/list' }]) {
      expect(_invalidBearerEligible({ ...base, hasSession: true, ...over })).toBe(false);
    }
  });

  it('the bound still applies inside a session — never a lockout', () => {
    // The anti-lockout rule is the BUDGET, not the session exemption. A client
    // that cannot refresh loses challengeMax calls mid-session and is then
    // served, exactly as it is when sessionless.
    expect(_invalidBearerEligible({ ...base, hasSession: true,
                                    challengesIssued: 3, challengeMax: 3 })).toBe(false);
  });
});

// ── r-invalid-bearer-bound (2026-09-03) ─────────────────────────────────────
// The challenge above had no bound. `initialize` 401s, so no session is ever
// created, so `hasSession` is false on the retry, so it 401s again — forever.
// Live consequence 2026-09-03: an agent holding a stale Bearer asked for the
// largest US markets by capacity, got -32001 on every attempt, and answered
// from a competitor's published table. Anonymous callers were being served the
// whole time on the same endpoint.
//
// r-challenge-bound settled this for the Claude-connector challenge on
// 2026-08-23: "After CHALLENGE_MAX challenges the call is SERVED. A client that
// can do OAuth converts on the first one and never reaches the bound; a client
// that cannot loses CHALLENGE_MAX calls and then works forever." This path
// never got that treatment.
describe('_invalidBearerEligible — the challenge is BOUNDED', () => {
  it('still challenges while the budget is unspent (OAuth brokers convert here)', () => {
    for (const n of [0, 1, 2]) {
      expect(_invalidBearerEligible({ ...base, challengesIssued: n, challengeMax: 3 })).toBe(true);
    }
  });

  it('THE FIX: stops walling once the budget is spent — serves instead', () => {
    expect(_invalidBearerEligible({ ...base, challengesIssued: 3, challengeMax: 3 })).toBe(false);
    expect(_invalidBearerEligible({ ...base, challengesIssued: 99, challengeMax: 3 })).toBe(false);
  });

  it('binds on tools/call too, not just the handshake', () => {
    const tc = { ...base, method: 'tools/call' };
    expect(_invalidBearerEligible({ ...tc, challengesIssued: 2, challengeMax: 3 })).toBe(true);
    expect(_invalidBearerEligible({ ...tc, challengesIssued: 3, challengeMax: 3 })).toBe(false);
  });

  it('challengeMax=0 is the kill switch — never challenge at all', () => {
    expect(_invalidBearerEligible({ ...base, challengesIssued: 0, challengeMax: 0 })).toBe(false);
  });

  it('a MISSING or junk budget falls back to CHALLENGE_MAX, never to 0 or Infinity', () => {
    // omitted entirely → today's callers keep challenging (not silently disarmed)
    expect(_invalidBearerEligible(base)).toBe(true);
    for (const bad of [undefined, null, NaN, -1, 1.5, '3', Infinity]) {
      expect(_invalidBearerEligible({ ...base, challengesIssued: 0, challengeMax: bad })).toBe(true);
    }
    // and a junk COUNTER must not be read as "budget spent"
    for (const bad of [undefined, null, NaN, -5, '9', Infinity]) {
      expect(_invalidBearerEligible({ ...base, challengesIssued: bad, challengeMax: 3 })).toBe(true);
    }
  });

  it('the bound cannot resurrect a caller the earlier gates already excluded', () => {
    const spent = { challengesIssued: 0, challengeMax: 3 };   // budget wide open
    expect(_invalidBearerEligible({ ...base, ...spent, authHeader: undefined })).toBe(false);
    expect(_invalidBearerEligible({ ...base, ...spent, hasApiKeyHeader: true })).toBe(false);
    expect(_invalidBearerEligible({ ...base, ...spent, bearerResolved: true })).toBe(false);
    expect(_invalidBearerEligible({ ...base, ...spent, method: 'tools/list' })).toBe(false);
    // hasSession is deliberately NOT in this list any more — see
    // r-expired-in-session above. It was never a credential gate; it was a
    // timing exemption, and it was the one that killed the connector.
  });
});
