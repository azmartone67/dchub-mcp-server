// persist-config-gemini.test.mjs — (2026-08-31)
//
// WHY THIS EXISTS. persist_config.clients carried six clients and no Gemini, so
// an agent running on Gemini CLI called claim_free_key, got back six snippets
// for clients it was not running on, and had nothing correct to show its human.
// The key then died with the response — which is the single largest loss in
// this funnel and the reason persist_config exists at all.
//
// ★ THE TWO GOOGLE CLIENTS DISAGREE WITH EACH OTHER ON THE FIELD NAME, and
// that is the whole risk this file guards:
//
//     gemini_cli   httpUrl     `url` is the SSE form. A Streamable-HTTP server
//                              placed under `url` is dialled with the wrong
//                              transport and never connects.
//     antigravity  serverUrl   `url` AND `httpUrl` are both rejected. The block
//                              is valid JSON and registers nothing at all.
//
// Both failures are SILENT — same class as VS Code's `servers` root and
// Windsurf's `serverUrl`, each of which already cost someone a debugging
// session. Copying either Gemini block onto the other client is the mistake a
// human or a model makes precisely because the two look interchangeable.
//
// ★★ WHY THIS DRIVES A REAL tools/call rather than unit-testing a copy:
// persist_config is a local const inside the claim_free_key handler and is not
// exported, so a unit test would re-implement it and then test its own
// re-implementation. A stub backend stands in for /api/v1/keys/claim so no real
// key is minted. Same harness as persist-config-vscode.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub, STUB_PORT;
const FAKE_KEY = 'dchub_test_key_not_real_0000';

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true, api_key: FAKE_KEY, daily_limit: 10 }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  STUB_PORT = stub.address().port;
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${STUB_PORT}`;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prev;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
});

async function claim() {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'claim_free_key', arguments: { client_name: 'guard' } } }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  const r = JSON.parse(json).result || {};
  if (r.structuredContent) return r.structuredContent;
  try { return JSON.parse((r.content || []).map((c) => c.text || '').join('')); } catch { return {}; }
}

describe('persist_config carries canonical Gemini CLI + Antigravity snippets', () => {
  it('★ Gemini CLI uses `httpUrl` — NOT `url` (SSE) and NOT `command` (stdio)', async () => {
    const g = (await claim()).persist_config?.clients?.gemini_cli;
    expect(g, 'no gemini_cli entry in persist_config.clients').toBeTruthy();
    const dchub = JSON.parse(g.snippet).mcpServers.dchub;
    expect(dchub.httpUrl, 'gemini_cli must declare httpUrl').toContain('/mcp');
    expect(dchub.url, 'gemini_cli must NOT use url — that is the SSE form').toBeUndefined();
    expect(dchub.command, 'gemini_cli must NOT use command — that is stdio').toBeUndefined();
    expect(dchub.serverUrl, 'serverUrl is Antigravity/Windsurf, not Gemini CLI').toBeUndefined();
  });

  it('★ Antigravity uses `serverUrl` — NOT `url` and NOT `httpUrl`', async () => {
    const a = (await claim()).persist_config?.clients?.antigravity;
    expect(a, 'no antigravity entry in persist_config.clients').toBeTruthy();
    const dchub = JSON.parse(a.snippet).mcpServers.dchub;
    expect(dchub.serverUrl, 'antigravity must declare serverUrl').toContain('/mcp');
    expect(dchub.url, 'antigravity rejects url — the block would register nothing').toBeUndefined();
    expect(dchub.httpUrl, 'antigravity rejects httpUrl — copied from Gemini CLI, this is the bug').toBeUndefined();
  });

  it('the two are NOT interchangeable — their field names must differ', async () => {
    const c = (await claim()).persist_config.clients;
    const cli = Object.keys(JSON.parse(c.gemini_cli.snippet).mcpServers.dchub);
    const ag = Object.keys(JSON.parse(c.antigravity.snippet).mcpServers.dchub);
    expect(cli).not.toEqual(ag);
  });

  it('both carry the minted key in a header, which is why they are here at all', async () => {
    const c = (await claim()).persist_config.clients;
    for (const name of ['gemini_cli', 'antigravity']) {
      const dchub = JSON.parse(c[name].snippet).mcpServers.dchub;
      expect(dchub.headers['X-API-Key'], `${name} snippet does not carry the key`).toBe(FAKE_KEY);
    }
  });

  it('both name the file the client actually reads', async () => {
    const c = (await claim()).persist_config.clients;
    expect(c.gemini_cli.file).toContain('.gemini/settings.json');
    expect(c.antigravity.file).toContain('antigravity/mcp_config.json');
  });

  // ★ THE DELIBERATE EXCLUSIONS. A key-persistence snippet is only meaningful
  // for a client that can hold a header. The consumer Gemini app has no custom
  // MCP field at all (a Gem shapes answers and cannot call DC Hub live), and
  // the Gemini Enterprise data store REQUIRES OAuth 2.0 and REJECTS X-API-Key —
  // so a key-bearing snippet for either would be an instruction that cannot
  // work. This pins that as a decision rather than an omission someone
  // "fixes" later.
  it('does NOT invent a snippet for consumer Gemini or Gemini Enterprise', async () => {
    const keys = Object.keys((await claim()).persist_config.clients);
    for (const bogus of ['gemini', 'gemini_gem', 'gemini_enterprise', 'gemini_web', 'vertex']) {
      expect(keys, `${bogus} cannot hold an X-API-Key — it must not have a snippet`).not.toContain(bogus);
    }
  });
});
