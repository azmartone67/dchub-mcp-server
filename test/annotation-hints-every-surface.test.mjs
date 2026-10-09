// Every tool on every MCP surface states all four annotation hints as literal
// booleans, and a write is never labelled read-only.
//
// 2026-10-09: OpenAI rejected DC Hub 1.0.0 with "tool annotations do not match
// behavior". The submitted /mcp/chatgpt list had all four hints on all 67 tools,
// so presence was not the problem; a value was. research_task was annotated
// readOnlyHint:true + idempotentHint:true while it POSTs a job row and may
// answer {task_id}. These checks read the served tools/list of each surface,
// not a hand-kept table, so a new tool cannot skip them.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
const SURFACES = ['/mcp', '/mcp/chatgpt', '/mcp/grok'];
// Name prefixes that create, change or send something.
const WRITE_PREFIX = /^(save_|set_|register_|subscribe_|bind_|claim_|request_|report_|accept_|delete_|recover_)/;
// Writes whose names do not say so.
const WRITE_BY_NAME = ['research_task'];

let httpServer, stub, PORT, prevBase;
const LISTS = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  for (const path of SURFACES) {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const raw = await res.text();
    const body = raw.includes('data: ')
      ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
    LISTS[path] = JSON.parse(body).result.tools;
  }
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
});

describe.each(SURFACES)('annotation hints on %s', (path) => {
  it('the surface lists tools (a check over an empty list proves nothing)', () => {
    expect(LISTS[path].length).toBeGreaterThan(5);
  });

  it('every tool states all four hints as true or false', () => {
    const bad = [];
    for (const t of LISTS[path]) {
      for (const h of HINTS) {
        if (typeof t.annotations?.[h] !== 'boolean') bad.push(`${t.name}.${h}=${JSON.stringify(t.annotations?.[h])}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no write is labelled read-only, and every delete_ is destructive', () => {
    const bad = [];
    for (const t of LISTS[path]) {
      const a = t.annotations || {};
      const isWrite = WRITE_PREFIX.test(t.name) || WRITE_BY_NAME.includes(t.name);
      if (isWrite && a.readOnlyHint !== false) bad.push(`${t.name}: readOnlyHint=${a.readOnlyHint}`);
      if (isWrite && a.idempotentHint !== false && !t.name.startsWith('delete_')) bad.push(`${t.name}: idempotentHint=${a.idempotentHint}`);
      if (t.name.startsWith('delete_') && a.destructiveHint !== true) bad.push(`${t.name}: destructiveHint=${a.destructiveHint}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('directory profiles serve read-only tools only', () => {
  it('/mcp/chatgpt has no write, so "every tool is a read-only lookup" stays true', () => {
    const writes = LISTS['/mcp/chatgpt'].filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(writes).toEqual([]);
    expect(LISTS['/mcp/chatgpt'].map((t) => t.name)).not.toContain('research_task');
  });

  it('/mcp still serves research_task, annotated as a write', () => {
    const a = LISTS['/mcp'].find((t) => t.name === 'research_task')?.annotations;
    expect(a).toBeTruthy();
    expect(a.readOnlyHint).toBe(false);
    expect(a.idempotentHint).toBe(false);
  });
});
