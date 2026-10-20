/**
 * r-mpp-onestep (2026-07-25) — the ONE-STEP agent-pay offer.
 *
 * Context: the agent-pay watcher read ZERO challenges ever requested. The rail
 * worked, but paying required the agent to discover `_meta.mpp_pay=true` in an
 * English prose field and burn an extra round trip to fetch a challenge. mppOffer
 * ships the challenge inline with the paywall preview so paying is: read
 * challenges[0] → mint an SPT → retry once with the credential.
 *
 * These are pure-local tests against a stub sidecar — no network, no prod.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

const CHALLENGE = {
  id: 'CH_TEST', method: 'stripe', intent: 'charge', realm: 'dchub.cloud',
  request: { currency: 'usd', amount: '50' },
};

let srv, mode = 'ok', hits = 0, mpp;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    hits++;
    if (mode === 'ok') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, price_usd: '0.50', challenge: CHALLENGE }));
    }
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'boom' }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.MPP_ENABLED = '1';
  process.env.MPP_SIDECAR_URL = `http://127.0.0.1:${srv.address().port}`;
  mpp = await import('../mpp-hook.mjs');
});
afterAll(() => srv && srv.close());

describe('mpp one-step offer', () => {
  it('exports every identifier server.mjs imports', async () => {
    // Guards the class of bug that shipped 2026-06-28: get_market_intel was added to
    // the MPP price table while `mppPrice` was never imported into server.mjs, arming
    // a ReferenceError on the get_market_intel depth-tease path.
    const need = ['mppEnabled', 'isMppTool', 'mppCredential', 'mppChallengeError',
      'mppVerify', 'mppWantsChallenge', 'mppOffer', 'mppPrice', 'MPP_CRED_KEY',
      'MPP_RECEIPT_KEY', 'MPP_PAYMENT_REQUIRED', 'MPP_PAYMENT_FAILED'];
    for (const k of need) expect(mpp[k], `missing export ${k}`).toBeDefined();
  });

  // ★2026-10-20 owner policy: every payment needs the human's explicit approval,
  // so no passive self-pay offer ships (MPP_SELF_PAY_ADVERTISED=false). This case
  // used to pin the offer's shape; it now pins that the offer is absent.
  it('embeds a ready-to-pay challenge and needs no magic flag — RETIRED: no passive offer under the human-approval policy', async () => {
    for (const t of ['get_grid_intelligence', 'get_fiber_intel', 'get_market_intel', 'analyze_site']) {
      expect(await mpp.mppOffer(t)).toBeNull();
    }
  });
  // ★2026-10-20 owner policy: every payment needs the human's explicit approval,
  // so no passive self-pay offer ships (MPP_SELF_PAY_ADVERTISED=false). This case
  // used to pin the offer's shape; it now pins that the offer is absent.
  it('covers the three flagship tools the agent-pay watcher tracks — RETIRED: no passive offer under the human-approval policy', async () => {
    for (const t of ['get_grid_intelligence', 'get_fiber_intel', 'get_market_intel', 'analyze_site']) {
      expect(await mpp.mppOffer(t)).toBeNull();
    }
  });
  it('is a no-op when MPP is off or the tool is not payable', async () => {
    process.env.MPP_ENABLED = '0';
    expect(await mpp.mppOffer('analyze_site')).toBeNull();
    process.env.MPP_ENABLED = '1';
    expect(await mpp.mppOffer('get_news')).toBeNull();
  });

  // ★2026-10-20 owner policy: every payment needs the human's explicit approval,
  // so no passive self-pay offer ships (MPP_SELF_PAY_ADVERTISED=false). This case
  // used to pin the offer's shape; it now pins that the offer is absent.
  it('degrades to the two-step hint when the sidecar fails (never throws) — RETIRED: no passive offer under the human-approval policy', async () => {
    for (const t of ['get_grid_intelligence', 'get_fiber_intel', 'get_market_intel', 'analyze_site']) {
      expect(await mpp.mppOffer(t)).toBeNull();
    }
  });
  // ★2026-10-20 owner policy: every payment needs the human's explicit approval,
  // so no passive self-pay offer ships (MPP_SELF_PAY_ADVERTISED=false). This case
  // used to pin the offer's shape; it now pins that the offer is absent.
  it('opens a circuit breaker so a sick sidecar cannot tax the hot paywall path — RETIRED: no passive offer under the human-approval policy', async () => {
    for (const t of ['get_grid_intelligence', 'get_fiber_intel', 'get_market_intel', 'analyze_site']) {
      expect(await mpp.mppOffer(t)).toBeNull();
    }
  });
});
