// claim-client-name-matches-rest-canon.test.mjs — Grok audit 2026-10-06, item 8 (MCP half).
// claim_free_key must send the client_name in the SAME canonical form the REST claim endpoint stores
// (dchub-backend routes/claim_identity.normalize_client_name): control characters out, whitespace runs
// collapsed, trimmed, 80 characters. Otherwise a name claimed here and re-claimed over REST is two
// (client_name, ip) pairs and mints two keys. The backend canonicalises on its side too; this keeps the
// name the tool REPORTS (and persists in snippets) equal to the name that is stored.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const KEY = 'dch_live_' + 'c0ffee11'.repeat(4);
let S, stub, srv, PORT, claimBodies = [];
const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      let buf = '';
      req.on('data', (d) => { buf += d; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (p === '/api/v1/keys/claim') { try { claimBodies.push(JSON.parse(buf)); } catch (_) {} res.end(JSON.stringify({ success: true, api_key: KEY, tier: 'free' })); return; }
        res.end('{}');
      });
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
async function claimAs(clientName) {
  const init = await post({}, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claim-canon-test', version: '1' } } });
  const h = { 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  claimBodies = [];
  await post(h, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'claim_free_key', arguments: { client_name: clientName } } });
  return claimBodies[0];
}

describe('claim_free_key sends the canonical client_name to the claim endpoint', () => {
  it('trims, collapses whitespace and strips control characters', async () => {
    expect((await claimAs('  grokbot   firstcall\taudit\n ')).client_name).toBe('grokbot firstcall audit');
  });
  it('caps at 80 characters like the backend', async () => {
    const sent = (await claimAs('agent-' + 'x'.repeat(150))).client_name;
    expect(sent).toHaveLength(80);
    expect(sent.startsWith('agent-xxx')).toBe(true);
  });
  it('an empty name falls back to mcp-agent, a plain name is untouched', async () => {
    expect((await claimAs('   ')).client_name).toBe('mcp-agent');
    expect((await claimAs('grokbot-firstcall-audit-2026-10-06')).client_name).toBe('grokbot-firstcall-audit-2026-10-06');
  });
});
