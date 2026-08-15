// Unit tests for r-challenge-after-value (2026-08-15) — the Claude-connector
// 401 challenge now fires on tools/call and NEVER on initialize.
//
// The defect this locks: `initialize` is the first message of the MCP handshake,
// so 401'ing it meant the claude.ai web connector never reached the tools/list
// exemption the 07-03 fix added — the exemption was unreachable from the day it
// shipped. Measured live before the change: 4,356 connector-init challenges in
// 30d against 3 new durable identities, and ZERO `claude_connector/tools/call`
// rows in the entire ledger, because nothing ever got past the handshake.
//
// _claudeChallengeEligible is the pure decision function the POST /mcp handler
// runs; env gates (_workosEnabled / DCHUB_OAUTH_CHALLENGE_DISABLE) stay at the
// call site and are NOT modelled here.
import { describe, it, expect } from 'vitest';
import { _claudeChallengeEligible } from '../server.mjs';

const base = {
  isClaudeConnector: true,
  method: 'tools/call',
  hasApiKeyHeader: false,
  workosAuthed: false,
  authHeader: undefined,
  hasSession: false,
};

describe('_claudeChallengeEligible — ask after value, not before it', () => {
  it('THE FIX: keyless claude connector on tools/call → challenged', () => {
    expect(_claudeChallengeEligible(base)).toBe(true);
  });

  it('THE REGRESSION GUARD: initialize is NEVER challenged', () => {
    expect(_claudeChallengeEligible({ ...base, method: 'initialize' })).toBe(false);
  });

  it('discovery stays open — tools/list and ping are never challenged', () => {
    expect(_claudeChallengeEligible({ ...base, method: 'tools/list' })).toBe(false);
    expect(_claudeChallengeEligible({ ...base, method: 'ping' })).toBe(false);
  });

  it('a connector that is not Claude is never challenged (broad agents stay 200)', () => {
    expect(_claudeChallengeEligible({ ...base, isClaudeConnector: false })).toBe(false);
  });

  it('X-API-Key callers are untouched', () => {
    expect(_claudeChallengeEligible({ ...base, hasApiKeyHeader: true })).toBe(false);
  });

  it('an already-authenticated WorkOS caller is not re-challenged', () => {
    expect(_claudeChallengeEligible({ ...base, workosAuthed: true })).toBe(false);
  });

  // r-api-connector-bearer (2026-07-19): the Messages-API connector ships the
  // same Claude-User UA but authenticates via Bearer. Challenging it 401'd calls
  // carrying a perfectly valid dchub_live key into an OAuth flow they cannot
  // perform — every Messages-API eval failed for weeks, silently green.
  it('ANY Bearer credential defers to the invalid-bearer gate, never this one', () => {
    expect(_claudeChallengeEligible({ ...base, authHeader: 'Bearer dch_live_whatever' })).toBe(false);
    expect(_claudeChallengeEligible({ ...base, authHeader: 'Bearer junk' })).toBe(false);
  });

  it('an established session is never yanked mid-flight', () => {
    expect(_claudeChallengeEligible({ ...base, hasSession: true })).toBe(false);
  });

  // Guard against the lazy refactor that reinstates the old behaviour by
  // widening the method test back to a two-way OR.
  it('no method other than tools/call is eligible', () => {
    for (const m of ['initialize', 'tools/list', 'ping', 'resources/list',
                     'prompts/list', 'notifications/initialized', undefined, '']) {
      expect(_claudeChallengeEligible({ ...base, method: m })).toBe(false);
    }
  });
});
