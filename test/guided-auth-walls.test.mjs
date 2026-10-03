// A5 tier-gating (owner 2026-10-03): a backend 401/402/403 never reaches the
// caller as a bare passthrough. Measured live 2026-10-03, keyless:
//   list_standing_intents -> {"error":"API 401","detail":"api_key_required"}
//   export_dataset        -> {"error":"API 402","detail":"upgrade_required"}
// Driven end to end through a real session against a stub backend that answers
// those statuses. isError stays exactly as it was (true), and no link is added.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const K_FREE = 'dch_live_guided_unbound001';
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};
let S, PORT, httpServer, stub;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/validate') {
        let b = ''; for await (const ch of req) b += ch;
        const k = (JSON.parse(b || '{}').api_key) || '';
        res.end(JSON.stringify(k === K_FREE ? { valid: true, tier: 'free', developer_id: 'dev_g', email: null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (url.pathname.startsWith('/api/v1/agentic/intents')) {
        res.statusCode = 401; res.end(JSON.stringify({ error: 'api_key_required' })); return;
      }
      if (url.pathname.startsWith('/api/v1/lp/export')) {
        res.statusCode = 402; res.end(JSON.stringify({ error: 'upgrade_required' })); return;
      }
      if (url.pathname.startsWith('/api/v1/lp/saved')) {
        res.statusCode = 401; res.end(JSON.stringify({ error: 'auth_required' })); return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json };
}

async function call(name, args = {}, key = null) {
  const headers = key ? { 'x-api-key': key } : {};
  const init = await post(headers, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'guided-test', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { json } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
  const r = JSON.parse(json).result || {};
  const text = ((r.content || [])[0] || {}).text || '';
  let lead = null; try { lead = JSON.parse(text); } catch (_) { lead = null; }
  return { r, text, lead, sc: r.structuredContent || {} };
}

const BARE = /^\{"error":"API 40[123]","detail":"[a-z_]+"\}$/;

describe('guided 401/402 through a real session', () => {
  it('keyless list_standing_intents (401): next_tool claim_free_key, isError unchanged', async () => {
    const { r, text, lead, sc } = await call('list_standing_intents');
    expect(r.isError).toBe(true);
    expect(text).not.toMatch(BARE);
    for (const b of [lead, sc]) {
      expect(b.error).toBe('API 401');               // legacy key stays
      expect(b.next_tool).toBe('claim_free_key');
      expect(b.tier_required).toBe('free_key');
      expect(b.required_plan).toBe('free');
      expect(b.message).toMatch(/claim_free_key/);
    }
  });

  it('keyless export_dataset (402): a sentence and unlock_more_data, Pro', async () => {
    const { r, text, lead, sc } = await call('export_dataset');
    expect(r.isError).toBe(true);
    expect(text).not.toMatch(BARE);
    for (const b of [lead, sc]) {
      expect(b.error).toBe('API 402');
      expect(b.detail).toBe('upgrade_required');
      expect(b.next_tool).toBe('unlock_more_data');
      expect(b.tier_required).toBe('pro');
      expect(b.required_plan).toBe('pro');
      expect(b.message).toMatch(/needs the Pro plan/);
    }
  });

  it('adds no link, no price, no em dash', async () => {
    for (const name of ['list_standing_intents', 'export_dataset', 'list_saved_sites']) {
      const { lead } = await call(name);
      const g = { message: lead.message, next_tool: lead.next_tool, tier_required: lead.tier_required,
                  required_plan: lead.required_plan };
      expect(JSON.stringify(g), name).not.toMatch(/https?:\/\/|\$\s?\d|—/);
    }
  });
});

describe('_authWallGuidance / _guideAuthWall (unit)', () => {
  it('a keyed 401 on an email-class tool points at bind_email', () => {
    const g = S._authWallGuidance('get_facility', 401, 'identity_required', true);
    expect(g.next_tool).toBe('bind_email');
    expect(g.required_plan).toBe('identified');
  });
  it('leaves a body that already carries a gated envelope alone', () => {
    const res = { content: [{ type: 'text', text: JSON.stringify({ error: 'API 403', detail: 'x', next_tool: 'bind_email' }) }] };
    expect(S._guideAuthWall(res, 'export_dataset')).toBe(res);
  });
  it('leaves non-auth errors and successes alone', () => {
    const e404 = { content: [{ type: 'text', text: '{"error":"API 404","detail":"nope"}' }] };
    const ok = { content: [{ type: 'text', text: '{"results":[]}' }] };
    expect(S._guideAuthWall(e404, 'export_dataset')).toBe(e404);
    expect(S._guideAuthWall(ok, 'export_dataset')).toBe(ok);
  });
  it('a keyless free-key wall reaches claim_free_key, never unlock_more_data', () => {
    expect(S._authWallGuidance('save_site', 401, 'auth_required', false).next_tool).toBe('claim_free_key');
  });
});
