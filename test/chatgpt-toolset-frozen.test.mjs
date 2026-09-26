// ── frz-chatgpt-toolset (owner, 2026-09-26) ──
//
// DC Hub 1.0.0 was submitted to the OpenAI app directory on 2026-09-25
// (~18:06 PT) and is in review. While it is, the /mcp/chatgpt tool set is
// frozen: names, count, titles, descriptions, annotations and input schemas.
// Adding, removing or renaming a tool — or changing any of those — forces a
// new review. Backend and data fixes, and tool OUTPUT changes, are fine.
//
// The snapshot is the live tools/list captured from
// https://dchub.cloud/mcp/chatgpt. If this test fails, the change you made
// reaches the reviewed catalog: revert it, or — only after the review closes
// and on purpose — regenerate test/fixtures/chatgpt-toolset.frozen.json in the
// same PR and say so in the PR body.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FROZEN = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/chatgpt-toolset.frozen.json', import.meta.url)), 'utf8'));
const canon = (tools) => JSON.stringify([...tools].sort((a, b) => (a.name < b.name ? -1 : 1)), (k, v) =>
  (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v);

let httpServer, stub, PORT, prevBase;

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
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
});

async function toolsList() {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp/chatgpt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return JSON.parse(body).result.tools;
}

describe('frz-chatgpt-toolset: the reviewed /mcp/chatgpt catalog does not move', () => {
  it('the snapshot is self-consistent', () => {
    expect(FROZEN.tools).toHaveLength(FROZEN.count);
    expect(new Set(FROZEN.tools.map((t) => t.name)).size).toBe(FROZEN.count);
    for (const t of FROZEN.tools) expect(t.annotations.readOnlyHint, t.name).toBe(true);
  });

  it('same tool names and count', async () => {
    const live = await toolsList();
    expect(live.map((t) => t.name).sort()).toEqual(FROZEN.tools.map((t) => t.name).sort());
    expect(live).toHaveLength(FROZEN.count);
  });

  it('every tool: identical title, description, annotations and input schema', async () => {
    const live = Object.fromEntries((await toolsList()).map((t) => [t.name, t]));
    for (const f of FROZEN.tools) {
      const l = live[f.name];
      expect(l, f.name).toBeDefined();
      for (const k of ['title', 'description', 'annotations', 'inputSchema'])
        expect(canon([{ name: f.name, v: l[k] }]), `${f.name}.${k} changed — frz-chatgpt-toolset`)
          .toBe(canon([{ name: f.name, v: f[k] }]));
    }
  });

  it('the whole catalog is byte-identical to the snapshot (any other field too)', async () => {
    expect(canon(await toolsList())).toBe(canon(FROZEN.tools));
  });
});
