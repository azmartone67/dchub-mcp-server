// tool-guide-pointers.test.mjs - P1-6 (Grok brief 2026-10-18): the slimmed tools/list description of
// plan_query and get_grid_scoreboard ends in a one-line pointer to dchub://tool-guides/<tool>, which
// serves the full registered text. Nothing a directory profile serves is touched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TOOL_GUIDE_TOOLS, toolGuideUri, toolGuidePointer, SLIM_DESC_MAX } from '../lib/list-slim.mjs';

let S, srv, PORT;
beforeAll(async () => {
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  await new Promise((r) => { srv = S.app.listen(0, '127.0.0.1', r); });
  PORT = srv.address().port;
});
afterAll(async () => { await new Promise((r) => srv.close(r)); });

async function wireTools(path = '/mcp') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return JSON.parse(json).result.tools;
}
const readGuide = async (name) => {
  const r = S.createServer(null, '')._registeredResources[toolGuideUri(name)];
  expect(r, `resource for ${name}`).toBeTruthy();
  return (await r.readCallback(new URL(toolGuideUri(name)), {})).contents[0].text;
};

describe('tool guide pointers', () => {
  it('covers exactly plan_query and get_grid_scoreboard', () => {
    expect([...TOOL_GUIDE_TOOLS].sort()).toEqual(['get_grid_scoreboard', 'plan_query']);
  });
  it('the wire description ends with the pointer and stays inside the cap', async () => {
    const tools = new Map((await wireTools()).map((t) => [t.name, t]));
    for (const n of TOOL_GUIDE_TOOLS) {
      const d = tools.get(n).description;
      expect(d.endsWith(toolGuidePointer(n)), n).toBe(true);
      expect(d.length, n).toBeLessThanOrEqual(SLIM_DESC_MAX + 1);
    }
  });
  it('no other tool carries a pointer', async () => {
    for (const t of await wireTools()) {
      if (!TOOL_GUIDE_TOOLS.has(t.name)) expect(t.description, t.name).not.toContain('dchub://tool-guides/');
    }
  });
  it('the resource serves the full, longer text, and its opening matches the wire copy', async () => {
    const tools = new Map((await wireTools()).map((t) => [t.name, t]));
    for (const n of TOOL_GUIDE_TOOLS) {
      const full = await readGuide(n);
      const wire = tools.get(n).description.slice(0, 120);
      expect(full.length, n).toBeGreaterThan(tools.get(n).description.length + 200);
      expect(full, n).toContain(wire.slice(0, 80));
    }
  });
  it('the frozen /mcp/chatgpt catalog carries no pointer', async () => {
    for (const t of await wireTools('/mcp/chatgpt')) expect(t.description, t.name).not.toContain('dchub://tool-guides/');
  });
});

describe('annotations trim (P1-6)', () => {
  it('the wire drops the repeated upgrade_relay sentence but keeps the access tags and links', async () => {
    const canon = new Map((await S._buildToolsListResult(null)).tools.map((t) => [t.name, t]));
    const wire = await wireTools();
    expect([...canon.values()].filter((t) => t.annotations.upgrade_relay).length).toBeGreaterThan(20);
    for (const t of wire) {
      const c = canon.get(t.name).annotations;
      expect(t.annotations, t.name).not.toHaveProperty('upgrade_relay');
      expect(t.annotations.pricing_url, t.name).toBe(c.pricing_url);
      expect(t.annotations.connect_url, t.name).toBe(c.connect_url);
      expect(t.annotations.access, t.name).toBe(c.access);
    }
  });
  it('the frozen /mcp/chatgpt catalog is not trimmed', async () => {
    for (const t of await wireTools('/mcp/chatgpt')) expect(JSON.stringify(t.annotations || {}), t.name).not.toMatch(/upgrade_relay/);
  });
});
