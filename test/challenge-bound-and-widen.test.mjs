// A challenge that can never stop is a LOCKOUT, and the allowlist that widens it.
//
// ★2026-08-23 — FOUND BY RUNNING IT IN PRODUCTION, not by reading it.
// With DCHUB_CHALLENGE_AFTER_N=0 armed, the challenge branch `return`s BEFORE
// _bumpAnonCall, so a challenged call never increments the counter:
//     call 1 -> 401 (no bump) -> call 2 -> priorAnonCalls STILL 0 -> 401 …
// forever. claude.ai completes the handshake so it converts; `Claude-User` —
// the Messages-API connector — has no human at a browser to finish a sign-in,
// and 43 of its calls across 10 IPs landed in the last 7d. Those callers were
// bricked for as long as the flag was on. It was rolled back within the hour.
//
// So the bound is a PREREQUISITE for widening, not a nicety: widening the
// allowlist without it multiplies the lockout across every client added.
import { describe, it, expect } from "vitest";
import {
  _claudeChallengeEligible, _challengeMax, _challengeClientAllowed,
  CHALLENGE_MAX,
} from "../server.mjs";

const anon = (over = {}) => ({
  isClaudeConnector: true,
  method: "tools/call",
  hasApiKeyHeader: false,
  workosAuthed: false,
  authHeader: "",
  priorAnonCalls: 1,     // past the free-answer allowance
  challengesIssued: 0,
  ...over,
});

describe("the bound — a client that cannot sign in is never locked out", () => {
  it("THE REGRESSION: challenges stop after the cap and the call is served", () => {
    // Simulates the production lockout: priorAnonCalls never advances because
    // a challenged call does not bump it. Only the bound can end this.
    let issued = 0;
    const served = [];
    for (let call = 1; call <= 10; call++) {
      const challenged = _claudeChallengeEligible(
        anon({ priorAnonCalls: 0, challengeAfterN: 0, challengesIssued: issued, challengeMax: 3 }),
      );
      if (challenged) issued++; else served.push(call);
    }
    expect(issued).toBe(3);
    expect(served).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  it("under the cap it still challenges", () => {
    expect(_claudeChallengeEligible(anon({ challengesIssued: 2, challengeMax: 3 }))).toBe(true);
  });

  it("at and past the cap it serves", () => {
    expect(_claudeChallengeEligible(anon({ challengesIssued: 3, challengeMax: 3 }))).toBe(false);
    expect(_claudeChallengeEligible(anon({ challengesIssued: 99, challengeMax: 3 }))).toBe(false);
  });

  it("cap 0 is a kill switch — never challenge", () => {
    expect(_claudeChallengeEligible(anon({ challengesIssued: 0, challengeMax: 0 }))).toBe(false);
  });

  it("the compiled default cap is a real, finite number", () => {
    // A default of 0 would silently disarm the wall; a huge one restores the
    // lockout. Pinned as a VALUE.
    expect(CHALLENGE_MAX).toBe(3);
  });

  it("every unusable cap resolves to 3, never to a lockout", () => {
    for (const bad of [undefined, null, "", "   ", "abc", "-1", "1.5", "NaN", true, {}, []]) {
      expect(_challengeMax(bad)).toBe(3);
    }
    expect(_challengeMax("0")).toBe(0);   // explicit kill switch still honored
    expect(_challengeMax("5")).toBe(5);
  });
});

describe("the allowlist — widening is opt-in, one client at a time", () => {
  it("defaults to Claude only, which is exactly today's behavior", () => {
    expect(_challengeClientAllowed("claude-ai", undefined)).toBe(true);
    expect(_challengeClientAllowed("claude", undefined)).toBe(true);
    expect(_challengeClientAllowed("claude-user", undefined)).toBe(true);
    expect(_challengeClientAllowed("cursor", undefined)).toBe(false);
    expect(_challengeClientAllowed("mcp", undefined)).toBe(false);
  });

  it("named clients are admitted when listed", () => {
    expect(_challengeClientAllowed("cursor", "claude,cursor")).toBe(true);
    expect(_challengeClientAllowed("CURSOR", "claude,cursor")).toBe(true);  // case-insensitive
    expect(_challengeClientAllowed("windsurf", "claude,cursor")).toBe(false);
  });

  it("'*' admits everything — the deliberate all-in setting", () => {
    expect(_challengeClientAllowed("anything", "*")).toBe(true);
  });

  it("an empty or nameless client is never admitted by accident", () => {
    // The 158-agent generic bucket sends clientInfo.name='mcp'; a blank name
    // must not fall through into a challenge.
    expect(_challengeClientAllowed("", "claude,cursor")).toBe(false);
    expect(_challengeClientAllowed(null, "*")).toBe(false);
    expect(_challengeClientAllowed("cursor", "")).toBe(false);
  });
});

describe("widening never weakens the existing exemptions", () => {
  for (const issued of [0, 2]) {
    it(`issued=${issued}: credentialed and non-tools/call callers stay exempt`, () => {
      const at = (over) => _claudeChallengeEligible(
        anon({ challengesIssued: issued, challengeMax: 3, ...over }));
      expect(at({ method: "initialize" })).toBe(false);
      expect(at({ hasApiKeyHeader: true })).toBe(false);
      expect(at({ workosAuthed: true })).toBe(false);
      expect(at({ authHeader: "Bearer abc" })).toBe(false);
      expect(at({ isClaudeConnector: false })).toBe(false);
    });
  }
});
