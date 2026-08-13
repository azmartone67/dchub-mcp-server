/**
 * r-mpp-receipt-replay (2026-08-12) — A CALLER WHO PAID MUST GET THEIR ANSWER.
 *
 * THE DEFECT (measured, open until this change):
 *   duplicate retry → Stripe correctly dedupes on (challenge.id, spt) → mppx
 *   raises "Payment has already been processed." → the gateway took the
 *   !_mppV.ok branch, stamped `mpp_verify_failed` and returned `payment_failed`
 *   WITH NO DATA. The caller was charged EXACTLY ONCE and answered ZERO times.
 *
 * THE FIX has two halves; this file covers the GATEWAY half.
 *   · sidecar (~/dchub-mpp-rail/mpp-rail.mjs) resolves a Stripe-confirmed replay
 *     to the ORIGINAL paid receipt → {ok:true, replayed:true}. Proven by
 *     `node --test mpp-rail.test.mjs` there (mock Stripe, no key, no money).
 *   · gateway (here) must then SERVE THE DATA, must not re-book the money, and
 *     when the paid result genuinely cannot be resolved must return an
 *     actionable error naming the receipt — not a generic payment_failed.
 *
 * Pure-local: a stub sidecar on 127.0.0.1. No network, no prod, no Stripe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const SERVER = new URL('../server.mjs', import.meta.url);
const SRC = readFileSync(SERVER, 'utf8');

let srv, reply = null, lastBody = null, mpp;

beforeAll(async () => {
  srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    lastBody = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.MPP_ENABLED = '1';
  process.env.MPP_SIDECAR_URL = `http://127.0.0.1:${srv.address().port}`;
  mpp = await import('../mpp-hook.mjs');
});
afterAll(() => srv && srv.close());

const RECEIPT = { method: 'stripe', status: 'success', reference: 'pi_3Test', timestamp: '2026-08-12T00:00:00Z' };

describe('mppCallDigest — scopes a payment to ONE call', () => {
  it('is stable and independent of key order', () => {
    const a = mpp.mppCallDigest('analyze_site', { lat: 1, lon: 2, radius_km: 5 });
    const b = mpp.mppCallDigest('analyze_site', { radius_km: 5, lon: 2, lat: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the ARGS change — a paid call cannot be replayed as a different one', () => {
    expect(mpp.mppCallDigest('analyze_site', { site: 'A' }))
      .not.toBe(mpp.mppCallDigest('analyze_site', { site: 'B' }));
  });

  it('changes when the TOOL changes', () => {
    expect(mpp.mppCallDigest('analyze_site', { site: 'A' }))
      .not.toBe(mpp.mppCallDigest('compare_sites', { site: 'A' }));
  });

  it('distinguishes nested shapes that flatten to the same text', () => {
    expect(mpp.mppCallDigest('t', { a: { b: 1 } })).not.toBe(mpp.mppCallDigest('t', { 'a.b': 1 }));
    expect(mpp.mppCallDigest('t', { a: [1, 2] })).not.toBe(mpp.mppCallDigest('t', { a: [2, 1] }));
  });

  it('handles undefined / empty args without throwing', () => {
    expect(() => mpp.mppCallDigest('analyze_site', undefined)).not.toThrow();
    expect(mpp.mppCallDigest('analyze_site', {})).not.toBe(mpp.mppCallDigest('analyze_site', undefined));
  });
});

describe('mppVerify — the three outcomes the gateway must tell apart', () => {
  it('sends the call digest so the sidecar can scope the replay', async () => {
    reply = { status: 200, body: { ok: true, receipt: RECEIPT } };
    await mpp.mppVerify('analyze_site', 'cred', 'DIGEST_A');
    expect(lastBody.call_digest).toBe('DIGEST_A');
    expect(lastBody.tool).toBe('analyze_site');
    expect(lastBody.credential).toBe('cred');
  });

  it('a fresh settle is ok and NOT flagged as a replay', async () => {
    reply = { status: 200, body: { ok: true, receipt: RECEIPT } };
    const r = await mpp.mppVerify('analyze_site', 'cred', 'D');
    expect(r.ok).toBe(true);
    expect(r.replayed).toBe(false);
    expect(r.receipt).toEqual(RECEIPT);
  });

  it('THE FIX: a resolved replay is ok:true with the ORIGINAL receipt', async () => {
    reply = { status: 200, body: { ok: true, replayed: true, receipt: RECEIPT, payment_reference: 'pi_3Test', settled_at: '2026-08-12T00:00:00Z' } };
    const r = await mpp.mppVerify('analyze_site', 'cred', 'D');
    expect(r.ok, 'a paid replay must NOT be an error').toBe(true);
    expect(r.replayed).toBe(true);
    expect(r.receipt).toEqual(RECEIPT);
    expect(r.payment_reference).toBe('pi_3Test');
  });

  it('an unresolvable replay is a failure but is FLAGGED as already-paid', async () => {
    reply = { status: 402, body: { ok: false, replayed: true, reason: 'receipt_unavailable', payment_reference: 'pi_3Test', error: 'settled, not recoverable' } };
    const r = await mpp.mppVerify('analyze_site', 'cred', 'D');
    expect(r.ok).toBe(false);
    expect(r.replayed).toBe(true);
    expect(r.reason).toBe('receipt_unavailable');
    expect(r.payment_reference).toBe('pi_3Test');
  });

  it('a genuine verification failure is NOT flagged as paid', async () => {
    reply = { status: 402, body: { ok: false, reason: 'verification_failed', error: 'Missing Payment scheme.' } };
    const r = await mpp.mppVerify('analyze_site', 'cred', 'D');
    expect(r.ok).toBe(false);
    expect(r.replayed, 'an unpaid caller must never be treated as paid').toBe(false);
  });

  it('ROLLOUT: an un-upgraded sidecar (no replayed flag) is still recognised from the mppx text', async () => {
    // The gateway and the sidecar deploy separately. Until the sidecar ships,
    // this keeps a duplicate retry out of the generic payment_failed bucket.
    reply = { status: 402, body: { ok: false, code: -32043, error: 'Payment has already been processed.' } };
    const r = await mpp.mppVerify('analyze_site', 'cred', 'D');
    expect(r.ok).toBe(false);
    expect(r.replayed).toBe(true);
  });

  it('fails CLOSED when the sidecar is unreachable — never assumes payment', async () => {
    const saved = process.env.MPP_SIDECAR_URL;
    process.env.MPP_SIDECAR_URL = 'http://127.0.0.1:1';   // nothing listening
    try {
      const r = await mpp.mppVerify('analyze_site', 'cred', 'D');
      expect(r.ok).toBe(false);
      expect(r.replayed).toBe(false);
      expect(r.reason).toBe('sidecar_unreachable');
    } finally { process.env.MPP_SIDECAR_URL = saved; }
  });
});

describe('server.mjs settle branch — structure the runtime cannot be unit-booted for', () => {
  // server.mjs boots a listener on import, so these are source-shape guards.
  // Every one asserts it FOUND its region first, so none can pass vacuously.

  const block = (() => {
    const i = SRC.indexOf('const _mppV = await mppVerify(');
    expect(i, 'no mppVerify settle site in server.mjs — these guards are vacuous').toBeGreaterThan(-1);
    // 6000 (was 4000): the rebase onto #177 added the CREDENTIAL_RETURNED stamp
    // and the if/else paid arm, pushing `payment_replay` to ~3.9k. A window that
    // ends just past the last anchor is one comment away from going vacuous.
    return SRC.slice(i, i + 6000);
  })();

  it('passes a call digest into the settle so the replay is scoped', () => {
    expect(block).toMatch(/mppVerify\(\s*name,\s*_mppCred,\s*mppCallDigest\(\s*name,\s*args\s*\)\s*\)/);
  });

  it('imports mppCallDigest (a missing import is a ReferenceError on the settle path)', () => {
    // This exact class shipped once: get_market_intel was priced while mppPrice
    // was never imported, arming a ReferenceError on a live path.
    const imp = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/mpp-hook\.mjs'/);
    expect(imp, 'no mpp-hook import found').not.toBeNull();
    expect(imp[1]).toContain('mppCallDigest');
  });

  it('handles the already-paid failure BEFORE the generic payment_failed return', () => {
    const replayAt = block.indexOf('_mppV.replayed');
    // Post-#177 the terminal statuses come from the funnel canon, not literals.
    const genericAt = block.indexOf('status = MPP_FUNNEL_STATUS.VERIFY_FAILED');
    expect(replayAt).toBeGreaterThan(-1);
    expect(genericAt).toBeGreaterThan(-1);
    expect(replayAt, 'the paid-replay branch must precede the generic failure').toBeLessThan(genericAt);
  });

  it('the already-paid error names the receipt and a recovery route (constraint e)', () => {
    const i = block.indexOf('payment_already_processed');
    expect(i, 'no payment_already_processed branch').toBeGreaterThan(-1);
    const arm = block.slice(Math.max(0, i - 1500), i + 1500);
    expect(arm.length, 'empty slice — this guard would pass vacuously').toBeGreaterThan(500);
    expect(arm).toMatch(/payment_reference/);
    expect(arm).toMatch(/support@dchub\.cloud/);
    expect(arm).toMatch(/charged_again:\s*false/);
    expect(arm, 'must not masquerade as a generic payment_failed').toMatch(/payment_failed:\s*false/);
  });

  it('a replay is NOT re-booked as revenue', () => {
    // mpp_paid is what routes/funnel_health.py counts as settled real money
    // (_PAID_ST). Stamping it on a replay would invent revenue that never moved.
    //
    // Post-#177 this is an if/else over canon symbols rather than a ternary over
    // literals — the funnel split bans bare 'mpp_*' status literals and requires
    // a BASIS line per counter. The INVARIANT is unchanged and asserted three
    // ways, so collapsing the two arms back into one cannot pass:
    //   (a) the replay arm is branch-selected on _mppV.replayed,
    //   (b) it stamps a status that is NOT the PAID counter, and
    //   (c) the two wire values are actually different.
    expect(block, 'the paid arm must branch on the replay flag')
      .toMatch(/if\s*\(\s*_mppV\.replayed\s*\)\s*\{\s*\n\s*status\s*=\s*MPP_FUNNEL_STATUS\.REPLAY_SERVED\s*;/);
    expect(block, 'the fresh-settle arm must still stamp PAID')
      .toMatch(/\}\s*else\s*\{\s*\n\s*status\s*=\s*MPP_FUNNEL_STATUS\.PAID\s*;/);
    expect(mpp.MPP_FUNNEL_STATUS.REPLAY_SERVED,
      'a replay status equal to mpp_paid would re-book the money')
      .not.toBe(mpp.MPP_FUNNEL_STATUS.PAID);
    expect(mpp.MPP_FUNNEL_BASIS[mpp.MPP_FUNNEL_STATUS.REPLAY_SERVED],
      'the replay counter needs its own BASIS line').toBeTruthy();
  });

  it('a resolved replay still returns the FULL result plus the receipt', () => {
    const okAt = block.indexOf('MPP_FUNNEL_STATUS.REPLAY_SERVED');
    const handlerAt = block.indexOf('await handler(');
    const receiptAt = block.indexOf('MPP_RECEIPT_KEY');
    expect(okAt).toBeGreaterThan(-1);
    expect(handlerAt, 'the paid path must run the tool').toBeGreaterThan(okAt);
    expect(receiptAt, 'the paid path must attach the receipt').toBeGreaterThan(okAt);
    expect(block).toMatch(/payment_replay:\s*true/);
  });

  it('the settle result is still the ONLY thing that unlocks data', () => {
    // Nothing in the new branch may return tool data without _mppV.ok. The
    // already-paid failure arm must return isError, not a handler result.
    const i = block.indexOf('payment_already_processed');
    const arm = block.slice(block.lastIndexOf('if (!_mppV.ok)', i), i);
    expect(arm).not.toMatch(/await handler\(/);
  });
});
