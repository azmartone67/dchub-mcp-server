/**
 * r-prewall (2026-07-27) — the PRE-WALL agent-pay offer.
 *
 * Context: shell #34 measured why nobody ever paid. Only 3 of 2,529 real
 * payable-tool calls in 30 days were ever gated (0.1%) — the auto-trial grants
 * full data on essentially every call, so the pay offer sat behind a wall almost
 * no agent reached. The rail was never the problem; reachability was.
 *
 * mppPrewallOffer attaches the ready-to-pay offer to a call that SUCCEEDS, on the
 * agent's last free answer, while intent is live. Nothing is withheld.
 *
 * Pure-local tests against a stub sidecar — no network, no prod.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

const CHALLENGE = {
  id: 'CH_PREWALL', method: 'stripe', intent: 'charge', realm: 'dchub.cloud',
  request: { currency: 'usd', amount: '50' },
};

let srv, mode = 'ok', mpp;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    if (mode === 'down') { res.destroy(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, challenge: CHALLENGE }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.MPP_ENABLED = '1';
  process.env.MPP_SIDECAR_URL = `http://127.0.0.1:${srv.address().port}`;
  delete process.env.MPP_PREWALL_DISABLE;
  delete process.env.MPP_PREWALL_AT;
  mpp = await import('../mpp-hook.mjs');
});

afterAll(() => new Promise((r) => srv.close(r)));

describe('pre-wall pay offer', () => {
  it('stays silent while the agent has free answers left', async () => {
    expect(await mpp.mppPrewallOffer('analyze_site', 5)).toBeNull();
    expect(await mpp.mppPrewallOffer('analyze_site', 2)).toBeNull();
  });

  // ★2026-10-20 owner policy: every payment needs the human's explicit approval,
  // so no passive self-pay offer ships (MPP_SELF_PAY_ADVERTISED=false). This case
  // used to pin the offer's shape; it now pins that the offer is absent.
  it('fires on the last free answer, with the challenge already inline — RETIRED: no passive offer under the human-approval policy', async () => {
    expect(await mpp.mppPrewallOffer('compare_sites', 0)).toBeNull();
    expect(await mpp.mppPrewallOffer('analyze_site', 1)).toBeNull();
  });
  // ★2026-10-20 owner policy: every payment needs the human's explicit approval,
  // so no passive self-pay offer ships (MPP_SELF_PAY_ADVERTISED=false). This case
  // used to pin the offer's shape; it now pins that the offer is absent.
  it('is marked PASSIVE so it can never be logged as pay-intent — RETIRED: no passive offer under the human-approval policy', async () => {
    expect(await mpp.mppPrewallOffer('compare_sites', 0)).toBeNull();
    expect(await mpp.mppPrewallOffer('analyze_site', 1)).toBeNull();
  });
  it('never appears for a non-payable tool', async () => {
    expect(await mpp.mppPrewallOffer('get_news', 0)).toBeNull();
  });

  it('honours the kill switch', async () => {
    process.env.MPP_PREWALL_DISABLE = '1';
    expect(await mpp.mppPrewallOffer('analyze_site', 0)).toBeNull();
    delete process.env.MPP_PREWALL_DISABLE;
  });

  // ★2026-10-20 owner policy: every payment needs the human's explicit approval,
  // so no passive self-pay offer ships (MPP_SELF_PAY_ADVERTISED=false). This case
  // used to pin the offer's shape; it now pins that the offer is absent.
  it('honours a tuned threshold — RETIRED: no passive offer under the human-approval policy', async () => {
    expect(await mpp.mppPrewallOffer('compare_sites', 0)).toBeNull();
    expect(await mpp.mppPrewallOffer('analyze_site', 1)).toBeNull();
  });
  it('ignores a non-numeric remaining rather than firing blind', async () => {
    expect(await mpp.mppPrewallOffer('analyze_site', undefined)).toBeNull();
    expect(await mpp.mppPrewallOffer('analyze_site', NaN)).toBeNull();
  });

  // ★2026-10-20 owner policy: every payment needs the human's explicit approval,
  // so no passive self-pay offer ships (MPP_SELF_PAY_ADVERTISED=false). This case
  // used to pin the offer's shape; it now pins that the offer is absent.
  it('still offers (two-step shape) when the sidecar is down — RETIRED: no passive offer under the human-approval policy', async () => {
    expect(await mpp.mppPrewallOffer('compare_sites', 0)).toBeNull();
    expect(await mpp.mppPrewallOffer('analyze_site', 1)).toBeNull();
  });
});
