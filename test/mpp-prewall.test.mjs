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

  it('fires on the last free answer, with the challenge already inline', async () => {
    const o = await mpp.mppPrewallOffer('analyze_site', 0);
    expect(o).toBeTruthy();
    expect(o.challenges?.[0]?.id).toBe('CH_PREWALL');
    expect(o.pay_now?.retry_tool).toBe('analyze_site');
    expect(o.free_full_answers_remaining).toBe(0);
    expect(o.note).toMatch(/LAST free/i);
  });

  it('is marked PASSIVE so it can never be logged as pay-intent', async () => {
    // The metric contract: `mpp_challenge` means "an agent ASKED to pay".
    // A passively-shipped challenge is not intent; counting it would turn the
    // pay-intent metric into "every call near the cap" and destroy its meaning.
    const o = await mpp.mppPrewallOffer('analyze_site', 0);
    expect(o.offer_type).toBe('pre_wall');
    expect(o.passive).toBe(true);
  });

  it('never appears for a non-payable tool', async () => {
    expect(await mpp.mppPrewallOffer('get_news', 0)).toBeNull();
  });

  it('honours the kill switch', async () => {
    process.env.MPP_PREWALL_DISABLE = '1';
    expect(await mpp.mppPrewallOffer('analyze_site', 0)).toBeNull();
    delete process.env.MPP_PREWALL_DISABLE;
  });

  it('honours a tuned threshold', async () => {
    process.env.MPP_PREWALL_AT = '2';
    expect(await mpp.mppPrewallOffer('analyze_site', 2)).toBeTruthy();
    expect(await mpp.mppPrewallOffer('analyze_site', 3)).toBeNull();
    delete process.env.MPP_PREWALL_AT;
  });

  it('ignores a non-numeric remaining rather than firing blind', async () => {
    expect(await mpp.mppPrewallOffer('analyze_site', undefined)).toBeNull();
    expect(await mpp.mppPrewallOffer('analyze_site', NaN)).toBeNull();
  });

  it('still offers (two-step shape) when the sidecar is down', async () => {
    // The answer already succeeded — a sick sidecar must degrade the offer,
    // never withhold it or delay the response.
    mode = 'down';
    const o = await mpp.mppPrewallOffer('compare_sites', 0);
    mode = 'ok';
    expect(o).toBeTruthy();
    expect(o.offer_type).toBe('pre_wall');
    expect(o.machine_payable).toBe(true);
  });
});
