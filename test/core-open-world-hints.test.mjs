// /mcp/core: a core tool that delegates to an open-world canonical tool is
// itself open-world, and the rest are not.
//
// Owner 2026-10-09: openWorldHint is true on the canonical reads whose backend
// route calls a public third-party source, and on execute_plan, which chains
// them. Core tools reach those tools through delegate calls, so the hint has to
// follow them. The open-world names come from the SERVED /mcp tools/list, not a
// hand-kept copy, so adding a tool to OPEN_WORLD_TOOLS re-checks core too.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CORE_OPEN_WORLD, CORE_DELEGATES } from '../lib/core-profile.mjs';

const SRC = readFileSync(fileURLToPath(new URL('../lib/core-profile.mjs', import.meta.url)), 'utf8');
let httpServer, stub, PORT, prevBase;
const LISTS = {};

async function toolsList(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return JSON.parse(body).result.tools;
}

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
  LISTS['/mcp'] = await toolsList('/mcp');
  LISTS['/mcp/core'] = await toolsList('/mcp/core');
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
});

// Each core tool's definition runs from its `  name: '<tool>',` line to the
// next one (or end of file); helpers above the first tool belong to none.
function coreToolBlocks() {
  const re = /^ {2}name: '([a-z_]+)',$/gm;
  const marks = [...SRC.matchAll(re)].map((m) => ({ name: m[1], at: m.index }));
  return marks.map((m, i) => ({ name: m.name, body: SRC.slice(m.at, i + 1 < marks.length ? marks[i + 1].at : SRC.length) }));
}

// Section-spec tables (e.g. INCLUDE_SITE) sit just above the tool that uses
// them, so a name can appear in the block BEFORE its user. Attribute a quoted
// delegate name to the tool whose body references the table holding it.
function delegatesByCoreTool(openWorld) {
  const blocks = coreToolBlocks();
  const tables = [...SRC.matchAll(/^const ([A-Z_]+) = \{/gm)].map((m) => m[1]);
  const out = new Map(blocks.map((b) => [b.name, new Set()]));
  for (const b of blocks) {
    for (const n of openWorld) if (b.body.includes(`'${n}'`)) out.get(b.name).add(n);
  }
  for (const t of tables) {
    const start = SRC.indexOf(`const ${t} = {`);
    const body = SRC.slice(start, SRC.indexOf('\n};', start));
    const hits = openWorld.filter((n) => body.includes(`'${n}'`));
    if (!hits.length) continue;
    const users = blocks.filter((b) => new RegExp(`\\b${t}\\[`).test(b.body));
    for (const b of blocks) for (const n of hits) if (b.body.includes(body)) out.get(b.name).delete(n);
    for (const u of users) for (const n of hits) out.get(u.name).add(n);
  }
  return out;
}

describe('/mcp/core openWorldHint follows the delegates', () => {
  it('the core surface and its open-world inputs are non-empty (a check over nothing proves nothing)', () => {
    expect(LISTS['/mcp/core'].length).toBeGreaterThan(5);
    const ow = LISTS['/mcp'].filter((t) => t.annotations?.openWorldHint === true).map((t) => t.name);
    expect(ow.filter((n) => CORE_DELEGATES.includes(n)).length).toBeGreaterThan(3);
    expect(coreToolBlocks().map((b) => b.name).sort()).toEqual(LISTS['/mcp/core'].map((t) => t.name).sort());
  });

  it('CORE_OPEN_WORLD is exactly the core tools that delegate to an open-world tool', () => {
    const ow = LISTS['/mcp'].filter((t) => t.annotations?.openWorldHint === true)
      .map((t) => t.name).filter((n) => CORE_DELEGATES.includes(n));
    const by = delegatesByCoreTool(ow);
    const derived = [...by].filter(([, s]) => s.size).map(([n]) => n).sort();
    expect(derived).toEqual([...CORE_OPEN_WORLD].sort());
  });

  it('the served /mcp/core hints match, with all four hints boolean', () => {
    const bad = [];
    for (const t of LISTS['/mcp/core']) {
      const a = t.annotations || {};
      for (const h of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        if (typeof a[h] !== 'boolean') bad.push(`${t.name}.${h}=${JSON.stringify(a[h])}`);
      }
      if (a.openWorldHint !== CORE_OPEN_WORLD.has(t.name)) bad.push(`${t.name}: openWorldHint=${a.openWorldHint}`);
    }
    expect(bad).toEqual([]);
  });
});
