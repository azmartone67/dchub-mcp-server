// mint-forwards-caller-ip.test.mjs — r-mint-gateway-id (2026-09-24)
//
// Measured 2026-09-24 (auto_trial_keys, 24h): 546 gateway mints landed on 17
// ip hashes — the gateway's own egress — under the UA "node", so the backend's
// per-caller mint ceiling saw one pooled caller. mintAutoTrial now forwards the
// caller's IP in X-DCHub-Client-IP (the backend honours it only with our
// internal key: dchub-backend routes/mint_guard.gateway_caller_ip).
//
// Guards: the header carries ctx.client_ip; it is absent when there is none;
// the existing identity headers are unchanged.
//
// Qualifies for the hard gate: deterministic, no network (fetch is stubbed).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mintAutoTrial, _ctxALS } from '../server.mjs';

function capture() {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    calls.push({ url: String(url), headers: { ...(init && init.headers) } });
    return { ok: true, json: async () => ({ ok: true, api_key: 'dch_trial_test' }) };
  });
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('mintAutoTrial forwards its caller', () => {
  it('sends the caller IP in X-DCHub-Client-IP with the existing identity headers', async () => {
    const calls = capture();
    const out = await _ctxALS.run(
      { client_ip: '198.51.100.7', user_agent: 'node', platform: 'claude', session_id: 's-1' },
      () => mintAutoTrial('get_fiber_intel'));
    expect(out && out.api_key).toBe('dch_trial_test');
    expect(calls).toHaveLength(1);
    const h = calls[0].headers;
    expect(calls[0].url).toMatch(/\/api\/v1\/keys\/auto-mint\?tool=get_fiber_intel$/);
    expect(h['X-DCHub-Client-IP']).toBe('198.51.100.7');
    expect(h['User-Agent']).toBe('node');
    expect(h['X-MCP-Platform']).toBe('claude');
    expect(h['X-MCP-Session']).toBe('s-1');
    expect('X-Internal-Key' in h).toBe(true);
  });

  it('omits the header when the request carried no caller IP', async () => {
    const calls = capture();
    await _ctxALS.run({ user_agent: 'Claude-User/1.0' }, () => mintAutoTrial('rank_markets'));
    expect(calls).toHaveLength(1);
    expect('X-DCHub-Client-IP' in calls[0].headers).toBe(false);
  });
});
