// persist-config-vscode.test.mjs — (2026-08-26)
//
// `/install/vscode` was 404, and the frontend generator says WHY, deliberately:
//
//   "NOT ADDED: /install/vscode. persist_config carries no VS Code entry, so
//    there is no canonical snippet to copy and inventing one would be exactly
//    the fabrication the rest of this comment argues against."
//
// That refusal was right, and this is the upstream half it was waiting on:
// persist_config.clients is THE canonical source for every install snippet, so
// VS Code lands here first and the install page follows from it.
//
// ★ THE LOAD-BEARING DIFFERENCE is the top-level key. VS Code reads `servers`;
// every other JSON client here reads `mcpServers`. A block copied from Cursor
// parses fine as JSON and registers NOTHING — the same silent-failure class as
// Windsurf's `serverUrl` and Cline's `type: "streamableHttp"`, both of which
// already have a caveat because they cost someone a debugging session.
//
// ★★ WHY THIS DRIVES A REAL tools/call. persist_config is built by a local
// const inside the claim_free_key handler — it is not exported, so a unit test
// would have to re-implement it and would then be testing the copy. A stub
// backend stands in for /api/v1/keys/claim so no real key is minted.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub, STUB_PORT;
let stubHits = 0;
const FAKE_KEY = 'dchub_test_key_not_real_0000';

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      stubHits += 1;
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
  else process.env.DCHUB_API_BASE = prev;   // sibling live-network tests share this env
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

describe('persist_config carries a canonical VS Code snippet', () => {
  it('★ uses `servers`, NOT `mcpServers` — the key that makes it load at all', async () => {
    const before = stubHits;
    const sc = await claim();
    expect(stubHits, 'stub never called — DCHUB_API_BASE did not take, this guard ran nothing')
      .toBeGreaterThan(before);

    const vs = sc.persist_config?.clients?.vscode;
    expect(vs, 'no vscode entry in persist_config.clients').toBeTruthy();
    const cfg = JSON.parse(vs.snippet);
    expect(Object.keys(cfg)).toEqual(['servers']);
    expect(cfg.mcpServers).toBeUndefined();
    expect(cfg.servers.dchub.type).toBe('http');
    expect(cfg.servers.dchub.url).toContain('/mcp');
    expect(cfg.servers.dchub.headers['X-API-Key']).toBe(FAKE_KEY);
  });

  it('names the file VS Code actually reads', async () => {
    const vs = (await claim()).persist_config.clients.vscode;
    expect(vs.file).toContain('.vscode/mcp.json');
  });

  it('every OTHER JSON client still uses mcpServers — this is a difference, not a rename', async () => {
    const clients = (await claim()).persist_config.clients;
    for (const [name, c] of Object.entries(clients)) {
      if (name === 'vscode') continue;
      let cfg;
      try { cfg = JSON.parse(c.snippet); } catch { continue; }   // CLI one-liners
      expect(Object.keys(cfg), `${name} lost its mcpServers root`).toEqual(['mcpServers']);
    }
  });

  // ★ REMOVED, deliberately: a response-scoped twin of the instructions guard
  // below. Two rewrites and it still could not be shown to FAIL — mutating the
  // client list out of either markdown branch (the minted-key branch and the
  // held-key branch) left it green, because neither branch renders under this
  // fixture. A guard whose mutant survives is not evidence, and keeping it
  // would have manufactured exactly the confidence this file exists to refuse.
  // The instructions guard below is the one that is mutation-verified RED.

  it('★ ...and named in the SERVER INSTRUCTIONS too, which is where an agent reads first', async () => {
    // Caught by mutation V4: the response-scoped check above passes while
    // _INSTR_TAIL — the `instructions` string handed over at initialize, before
    // any tool is called — silently drops the client. That is the copy an agent
    // reads to decide whether a snippet for its host even exists.
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {},
                  clientInfo: { name: 'guard', version: '1' } } }),
    });
    const raw = await res.text();
    const json = raw.includes('data: ')
      ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
      : raw;
    const instructions = (JSON.parse(json).result || {}).instructions || '';
    expect(instructions.length, 'instructions came back empty — guard would be vacuous')
      .toBeGreaterThan(1000);

    const clients = Object.keys((await claim()).persist_config.clients);
    // ★ This map must cover EVERY key in persist_config.clients. It is not a
    // convenience — a client added without a LABEL entry makes LABEL[c]
    // undefined and this guard silently asserts includes('undefined'), which
    // is how a new client would sail past the very check that exists to catch
    // it. gemini_cli/antigravity added 2026-08-31 with their snippets.
    const LABEL = { claude_desktop: 'Claude Desktop', claude_code: 'Claude Code',
                    cursor: 'Cursor', vscode: 'VS Code', cline: 'Cline', windsurf: 'Windsurf',
                    gemini_cli: 'Gemini CLI', antigravity: 'Antigravity' };
    for (const c of clients) {
      expect(LABEL[c], `client '${c}' has no LABEL entry — this guard would assert includes('undefined')`)
        .toBeTruthy();
    }
    for (const c of clients) {
      expect(instructions.includes(LABEL[c]),
        `client '${c}' has a persist_config snippet but is not named in the server instructions`)
        .toBe(true);
    }
  });

  it('every client snippet carries the minted key', async () => {
    const clients = (await claim()).persist_config.clients;
    for (const [name, c] of Object.entries(clients)) {
      expect(c.snippet.includes(FAKE_KEY), `${name} snippet does not carry the key`).toBe(true);
    }
  });
});
