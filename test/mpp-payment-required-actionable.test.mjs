// The payment_required message must tell a willing payer HOW to pay.
//
// ★2026-08-23. Traced live: an agent that sends `mpp_pay=true` on a
// machine-payable tool gets back, as content[0].text, exactly this:
//
//     "Payment required: $0.50 to call analyze_site (DC Hub deep-tier)."
//
// 64 characters — a price and no method. The challenge, the credential
// argument and the retry all lived in `data`, while `message` is what becomes
// content[0].text and therefore what the MODEL reads. An agent that had
// already committed to paying was told the price and given nowhere to go.
//
// Why this is safe where the wall prose is not: r-pro-clean (audit
// 2026-06-30) measured that stacking CTAs into the WALL prose cannibalised
// conversion and regressed the handoff 110 -> 0. This response is different —
// nothing but `mpp_pay=true` produces it, so its only possible audience is an
// agent that already chose to pay.
import { describe, it, expect, vi, afterEach } from "vitest";

const CHALLENGE = {
  id: "chal_test", intent: "charge", method: "stripe", realm: "dchub.cloud",
  expires: "2026-08-23T04:39:45.784Z",
  request: { currency: "usd", amount: "50" },
};

async function loadHook(fetchImpl) {
  vi.stubGlobal("fetch", fetchImpl);
  vi.resetModules();
  return await import("../mpp-hook.mjs?t=" + Math.random());
}

afterEach(() => { vi.unstubAllGlobals(); });

const okFetch = () => Promise.resolve({
  json: () => Promise.resolve({ ok: true, challenge: CHALLENGE, price_usd: "0.50" }),
});

describe("mppChallengeError message", () => {
  it("still states the price and the tool", async () => {
    const { mppChallengeError } = await loadHook(okFetch);
    const e = await mppChallengeError("analyze_site");
    expect(e.message).toMatch(/\$0\.50/);
    expect(e.message).toMatch(/analyze_site/);
  });

  it("names the ONE argument the agent must send back", async () => {
    // Without this the agent cannot act: `mpp_credential` is the only channel
    // a MODEL can write (params._meta is client-owned — PR #198).
    const { mppChallengeError } = await loadHook(okFetch);
    const e = await mppChallengeError("analyze_site");
    expect(e.message).toMatch(/mpp_credential/);
    expect(e.message).toMatch(/challenges\[0\]/);
  });

  it("carries the expiry, because the challenge is short-lived", async () => {
    const { mppChallengeError } = await loadHook(okFetch);
    const e = await mppChallengeError("analyze_site");
    expect(e.message).toContain(CHALLENGE.expires);
  });

  it("tells an agent that CANNOT pay what to do instead", async () => {
    // The gate we do not control: Stripe Shared Payment Tokens are new and
    // most agents cannot mint one. Without this clause the message is a
    // longer dead end, and the agent reports "the tool failed".
    const { mppChallengeError } = await loadHook(okFetch);
    const e = await mppChallengeError("analyze_site");
    expect(e.message).toMatch(/cannot/i);
    expect(e.message).toMatch(/human/i);
    expect(e.message).not.toMatch(/tool failed"?\s*$/);
  });

  it("keeps the machine-readable half intact", async () => {
    const { mppChallengeError } = await loadHook(okFetch);
    const e = await mppChallengeError("analyze_site");
    expect(e.data.challenges).toEqual([CHALLENGE]);
    expect(e.data.price_usd).toBe("0.50");
    expect(e.data.tool).toBe("analyze_site");
    expect(e.data.httpStatus).toBe(402);
  });

  it("a missing expiry does not produce a broken sentence", async () => {
    const { mppChallengeError } = await loadHook(() => Promise.resolve({
      json: () => Promise.resolve({
        ok: true, price_usd: "0.50",
        challenge: { id: "c", intent: "charge" },   // no `expires`
      }),
    }));
    const e = await mppChallengeError("analyze_site");
    expect(e.message).toMatch(/mpp_credential/);
    expect(e.message).not.toMatch(/\(expires\s*\)/);
    expect(e.message).not.toMatch(/undefined/);
  });

  it("a sidecar failure still falls back to null, not a half-message", async () => {
    // null is the contract: the caller falls back to the normal depth-tease.
    const { mppChallengeError } = await loadHook(() => Promise.resolve({
      json: () => Promise.resolve({ ok: false }),
    }));
    expect(await mppChallengeError("analyze_site")).toBeNull();
  });
});
