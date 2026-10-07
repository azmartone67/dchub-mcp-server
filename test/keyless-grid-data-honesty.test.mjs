// keyless-grid-data-honesty.test.mjs — Grok audit 2026-10-06, item 9.
// A keyless get_grid_data said "You got the headline demand for PJM (92178 MW @ …)" while demand_mw was
// null, and pointed its retry at get_grid_intelligence and its signup at "email-only". The message must
// match the payload, and every next step names get_grid_data and claim_free_key.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const TEASER = {
  region: 'PJM', rto_code: 'PJM', demand_mw: 92178, demand_period: '2026-10-06T23',
  demand_24h: '<gated: identified-tier or higher>', gated: true, tier_required: 'identified',
  message: 'You got the headline demand for PJM (92178 MW @ 2026-10-06T23). Full 24h series + generation mix + headroom requires a free dev key (email-only signup, no credit card). For fund-grade access — daily DCPI exports, interconnect queues, M&A tracker — see /enterprise (from $12,000/yr).',
  agent_action: { type: 'claim_free_key', method: 'POST', url: 'https://dchub.cloud/api/v1/keys/claim',
    then: 'Retry GET /api/v1/grid/intelligence/PJM with header \'X-API-Key: <api_key>\'' },
  email_capture: { type: 'capture_email_for_free_key', method: 'GET', url: 'https://dchub.cloud/notify?tool=get_grid_intelligence',
    prompt: 'Ask your human: want a free dev key (10 calls/day, no credit card) plus a reset-time notice?' },
};

let S, stub, srv, PORT;
const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(p.startsWith('/api/v1/grid/intelligence/') ? TEASER : {}));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
});
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function post(h, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...h }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json };
}
async function keylessGridData(iso = 'PJM') {
  const init = await post({}, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grid-honesty-test', version: '1' } } });
  const h = { 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const r = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_grid_data', arguments: { iso } } });
  return JSON.parse(r.json).result;
}

describe('keyless get_grid_data, end to end', () => {
  it('the message matches the payload: no MW figure beside a null demand_mw', async () => {
    const r = await keylessGridData();
    const sc = r.structuredContent;
    expect(sc.demand_mw ?? null).toBeNull();           // demand is a Pro figure (test/gating.test.mjs)
    expect(sc.message).not.toMatch(/92178|\d[\d,]*\s*MW/);
    expect(sc.message).toMatch(/withheld on a keyless call/);
    expect(JSON.stringify(r)).not.toContain('92178');
  });
  it('every next step names get_grid_data and claim_free_key, not get_grid_intelligence, and no email requirement', async () => {
    const sc = (await keylessGridData()).structuredContent;
    expect(sc.message).toContain('claim_free_key');
    expect(sc.message).toContain('get_grid_data with iso=PJM');
    expect(sc.message).not.toMatch(/email[- ]only|dev key/i);
    if (sc.agent_action) { expect(sc.agent_action.then || '').toContain('get_grid_data'); expect(sc.agent_action.then || '').not.toContain('grid/intelligence'); }
    if (sc.email_capture) {
      expect(sc.email_capture.url).toContain('tool=get_grid_data');
      expect(JSON.stringify(sc.email_capture)).not.toMatch(/get_grid_intelligence|10 calls\/day/);
    }
  });
});

describe('_keylessGridDataHonesty', () => {
  it('leaves other tools and ungated payloads alone', async () => {
    const f = (await import('../server.mjs'))._keylessGridDataHonesty;
    const keyed = { region: 'PJM', demand_mw: 5, message: 'ok' };
    expect(f({ ...keyed }, 'get_grid_data')).toEqual(keyed);
    const t = { ...TEASER };
    expect(f(t, 'get_grid_intelligence').message).toBe(TEASER.message);
  });
  it('when demand_mw IS shown, the number stays and only the key wording is fixed', async () => {
    const f = (await import('../server.mjs'))._keylessGridDataHonesty;
    const out = f({ ...TEASER, agent_action: undefined, email_capture: undefined }, 'get_grid_data');
    expect(out.message).toContain('92178 MW');
    expect(out.message).not.toMatch(/email[- ]only|dev key/i);
  });
});
