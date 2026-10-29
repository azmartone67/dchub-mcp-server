// Owner 2026-10-28 (social-link channels): claim_free_key reaches the backend from the MCP server, with no
// browser cookie. The connector URL's ?via=<channel> must travel as X-DCHub-Via so the backend counts that
// channel's key / unlock (dchub-backend routes/via_funnel.py). Only the closed set is forwarded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, stub, srv, PORT, claimHeaders = [];
const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      req.on('data', () => {});
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (p === '/api/v1/keys/claim') claimHeaders.push(req.headers);
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

async function claimWith(query, headers = {}) {
  const url = `http://127.0.0.1:${PORT}/mcp${query}`;
  const h0 = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers };
  const init = await fetch(url, { method: 'POST', headers: h0, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'via-forward-test', version: '1' } } }) });
  const sid = init.headers.get('mcp-session-id'); await init.text();
  const h = { ...h0, 'mcp-session-id': sid };
  await (await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).text();
  claimHeaders = [];
  await (await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'claim_free_key', arguments: { client_name: 'via-forward-check' } } }) })).text();
  return claimHeaders[0];
}

describe('claim_free_key forwards the connector URL channel', () => {
  it.each(['x', 'linkedin', 'substack', 'reddit', 'media', 'mcp-wall'])('?via=%s -> X-DCHub-Via', async (ch) => {
    const h = await claimWith(`?via=${ch}`);
    expect(h, 'claim never reached the stub').toBeTruthy();
    expect(h['x-dchub-via']).toBe(ch);
  });
  it('the header form works too', async () => {
    expect((await claimWith('', { 'x-dchub-via': 'reddit' }))['x-dchub-via']).toBe('reddit');
  });
  it('a gateway / unknown / absent via is not forwarded', async () => {
    expect((await claimWith('?via=pipeworx'))['x-dchub-via']).toBeUndefined();
    expect((await claimWith('?via=twitter'))['x-dchub-via']).toBeUndefined();
    expect((await claimWith(''))['x-dchub-via']).toBeUndefined();
  });
});
