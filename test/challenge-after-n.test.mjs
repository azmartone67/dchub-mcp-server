// The anonymous free-answer allowance before the OAuth ask.
//
// ★2026-08-23. `_claudeChallengeEligible` hardcoded `priorAnonCalls >= 1`.
// The mechanism works — a live probe against prod (clientInfo.name='claude-ai',
// no credentials) gets 200 on tools/call #1 and a clean 401 +
// WWW-Authenticate on #2 — but the cohort it exists for makes ONE call per
// session: 3,703 connector inits in 30d produced THREE tools/call challenges
// (1,853 challenge events per new durable identity), while the durable cohort
// it would create returns at 66.7% against 4.7% for key-only.
//
// The allowance is now DCHUB_CHALLENGE_AFTER_N. Default 1 = byte-identical to
// the old behavior; 0 challenges the first anonymous call. Reach-sensitive, so
// it ships dormant — these tests pin that dormancy as hard as they pin the
// feature, because a reach experiment that silently arms itself is the
// dangerous failure here.
import { describe, it, expect } from "vitest";
import { _claudeChallengeEligible, CHALLENGE_AFTER_N, _challengeAllowance } from "../server.mjs";

const anon = (over = {}) => ({
  isClaudeConnector: true,
  method: "tools/call",
  hasApiKeyHeader: false,
  workosAuthed: false,
  authHeader: "",
  priorAnonCalls: 0,
  ...over,
});

describe("default is dormant — today's behavior, unchanged", () => {
  it("the compiled default allowance is 1", () => {
    // Pinned as a VALUE, not just a branch: if the env parser ever defaults to
    // 0, every anonymous first call starts 401ing in production.
    expect(CHALLENGE_AFTER_N).toBe(1);
  });

  it("first anonymous call is served", () => {
    expect(_claudeChallengeEligible(anon({ priorAnonCalls: 0 }))).toBe(false);
  });

  it("second anonymous call is challenged", () => {
    expect(_claudeChallengeEligible(anon({ priorAnonCalls: 1 }))).toBe(true);
  });
});

describe("the allowance is honored when set", () => {
  it("0 challenges the FIRST call — the lever this exists for", () => {
    expect(_claudeChallengeEligible(anon({ priorAnonCalls: 0, challengeAfterN: 0 }))).toBe(true);
  });

  it("2 serves two answers, then challenges", () => {
    expect(_claudeChallengeEligible(anon({ priorAnonCalls: 0, challengeAfterN: 2 }))).toBe(false);
    expect(_claudeChallengeEligible(anon({ priorAnonCalls: 1, challengeAfterN: 2 }))).toBe(false);
    expect(_claudeChallengeEligible(anon({ priorAnonCalls: 2, challengeAfterN: 2 }))).toBe(true);
  });

  it("a garbage allowance falls back to 1, never to 0", () => {
    // Fail SAFE: an unparseable env must not start challenging first calls.
    for (const bad of ["", "abc", null, undefined, -3, NaN]) {
      expect(_claudeChallengeEligible(anon({ priorAnonCalls: 0, challengeAfterN: bad })))
        .toBe(false);
    }
  });
});

describe("every pre-existing exemption still holds at every allowance", () => {
  // The allowance must not become a way to challenge a credentialed caller.
  for (const n of [0, 1, 2]) {
    it(`allowance ${n}: a credentialed or non-Claude caller is never challenged`, () => {
      const at = (over) => _claudeChallengeEligible(anon({ priorAnonCalls: 99, challengeAfterN: n, ...over }));
      expect(at({ isClaudeConnector: false })).toBe(false);
      expect(at({ method: "initialize" })).toBe(false);   // ★never on initialize
      expect(at({ method: "tools/list" })).toBe(false);
      expect(at({ hasApiKeyHeader: true })).toBe(false);
      expect(at({ workosAuthed: true })).toBe(false);
      expect(at({ authHeader: "Bearer abc123" })).toBe(false);
    });
  }

  it("initialize is exempt even at allowance 0 — that WAS the pre-08-15 failure", () => {
    expect(_claudeChallengeEligible(anon({
      method: "initialize", priorAnonCalls: 0, challengeAfterN: 0,
    }))).toBe(false);
  });
});


// The env parser itself. Split out because the empty-string case is the one
// that actually bit: `Number('')` is 0, so a naive coercion turned
// `DCHUB_CHALLENGE_AFTER_N=` into "challenge every first call" — arming a
// reach experiment nobody chose, from a value a human produces by accident.
describe("_challengeAllowance — every unusable value resolves to 1, never 0", () => {
  it("parses real integers", () => {
    expect(_challengeAllowance("0")).toBe(0);
    expect(_challengeAllowance("1")).toBe(1);
    expect(_challengeAllowance("3")).toBe(3);
    expect(_challengeAllowance(2)).toBe(2);
  });

  it("falls back to 1 on anything else", () => {
    for (const bad of [undefined, null, "", "   ", "abc", "-1", "1.5", "NaN",
                       "0x0", "1e0", " 0 x", "٠", true, {}, []]) {
      expect(_challengeAllowance(bad)).toBe(1);
    }
  });

  it("whitespace around a real value is tolerated", () => {
    expect(_challengeAllowance(" 0 ")).toBe(0);
    expect(_challengeAllowance("\t2\n")).toBe(2);
  });
});
