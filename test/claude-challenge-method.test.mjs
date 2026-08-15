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
  priorAnonCalls: 1,   // the first anonymous answer in a session is always free
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

  // ★The defect the first pass shipped: hasSession was an exemption, and the
  // connector holds a session on every call after initialize — so the challenge
  // fired for nobody. A live probe (initialize 200 -> tools/call 200) caught it.
  it('THE ASK-AFTER-VALUE GUARD: the first anonymous call in a session is free', () => {
    expect(_claudeChallengeEligible({ ...base, priorAnonCalls: 0 })).toBe(false);
    expect(_claudeChallengeEligible({ ...base, priorAnonCalls: undefined })).toBe(false);
  });

  it('the second call onward IS challenged', () => {
    expect(_claudeChallengeEligible({ ...base, priorAnonCalls: 1 })).toBe(true);
    expect(_claudeChallengeEligible({ ...base, priorAnonCalls: 7 })).toBe(true);
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

// ── identity resolution ────────────────────────────────────────────────────
// These exist because a mutation that made identity resolution inert again —
// the precise defect the first pass of this change shipped to production —
// passed every test above. The pure predicate never sees clientInfo or the UA,
// so it could not.
import { _resolveClaudeConnector } from '../server.mjs';

describe('_resolveClaudeConnector — who counts as the Claude connector', () => {
  it('THE SHIPPED DEFECT: a tools/call has NO clientInfo and a generic UA — the web connector is identifiable ONLY by what initialize remembered', () => {
    expect(_resolveClaudeConnector({ ua: 'node', ciName: '', recalledClientName: 'claude-ai' })).toBe(true);
    expect(_resolveClaudeConnector({ ua: 'node', ciName: '', recalledClientName: '' })).toBe(false);
  });

  it('initialize still resolves from clientInfo directly', () => {
    expect(_resolveClaudeConnector({ ua: 'node', ciName: 'claude-ai' })).toBe(true);
    expect(_resolveClaudeConnector({ ua: 'node', ciName: 'Claude-AI' })).toBe(true);
  });

  it('the Messages-API connector is still caught by its UA', () => {
    expect(_resolveClaudeConnector({ ua: 'Claude-User/1.0', ciName: '' })).toBe(true);
  });

  it('every other client resolves false', () => {
    for (const c of ['cursor', 'cline', 'chatgpt', 'smithery', 'mcp', '', undefined]) {
      expect(_resolveClaudeConnector({ ua: 'node', ciName: c, recalledClientName: c })).toBe(false);
    }
  });
});

// ── THE WIRING, not just the predicate ─────────────────────────────────────
// Both earlier passes of this change were "green and mutation-verified" and both
// shipped a challenge that fired for nobody, because every test supplied
// recalledClientName BY HAND. The value's real producer — _rememberPlatform at
// initialize, read back on a later tools/call — was never once exercised. The
// second defect was reading `.clientName` off _recallPlatform(), which returns a
// STRING; `.clientName` on a string is undefined, forever, silently.
//
// So: drive the round trip. This is the test that would have caught it.
import { _rememberPlatform, _recallClientName, _recallPlatform } from '../server.mjs';

describe('identity round-trip: what initialize remembers, tools/call must recall', () => {
  it('THE SHIPPED DEFECT: _recallPlatform returns a STRING — .clientName on it is undefined', () => {
    _rememberPlatform('sid-web', 'mcp', 'claude-ai');
    const recalled = _recallPlatform('sid-web');
    expect(typeof recalled === 'string' || recalled === null).toBe(true);
    expect(recalled?.clientName).toBeUndefined();          // the exact bug, pinned
    expect(_recallClientName('sid-web')).toBe('claude-ai'); // the accessor that works
  });

  // ★Drives the SAME path production drives: a sessionId in, the recall lookup
  // happening inside the resolver. No hand-fed recalledClientName — that is what
  // let two broken call sites go green.
  it('a claude.ai web session is resolvable on a later tools/call', () => {
    _rememberPlatform('sid-web-2', 'mcp', 'claude-ai');
    expect(_resolveClaudeConnector({
      ua: 'node', ciName: '', sessionId: 'sid-web-2',      // the real tools/call wire shape
    })).toBe(true);
  });

  it('an unknown session resolves to nothing and is never challenged', () => {
    expect(_recallClientName('sid-never-seen')).toBe(null);
    expect(_resolveClaudeConnector({
      ua: 'node', ciName: '', sessionId: 'sid-never-seen',
    })).toBe(false);
  });

  it('another platform’s session does not resolve as Claude', () => {
    _rememberPlatform('sid-cursor', 'cursor', 'cursor');
    expect(_resolveClaudeConnector({
      ua: 'node', ciName: '', sessionId: 'sid-cursor',
    })).toBe(false);
  });
});
