// Every tool on every MCP surface carries at most ONE "Use this when ..." lead.
//
// 2026-10-22: live tools/list on /mcp and /mcp/oauth served compare_isos, get_grid_scoreboard and
// get_water_risk with two leads ("Use this when the user asks to compare two to four US power grids
// (ISOs) side by side Use this when the user asks to compare two to four power grids side by side —").
// withRoutingLine() (lib/agent-outreach.mjs) prepended its ROUTING_LINES entry whenever the description
// did not start with that exact string, so rewording a description in server.mjs without the line
// doubled the lead. These checks read the served tools/list of each surface, plus the tuner-override
// path, not a hand-kept table, so a new tool or a reworded one cannot skip them.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { ROUTING_LINES } from '../lib/agent-outreach.mjs';

const LEAD = /Use this when /g;
const SURFACES = ['/mcp', '/mcp/oauth', '/mcp/core', '/mcp/claude', '/mcp/grok', '/mcp/chatgpt'];
const leads = (d) => (String(d || '').match(LEAD) || []).length;

let httpServer, stub, PORT, prevBase, S;
const LISTS = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
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
}, 60000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
});

describe.each(SURFACES)('one "Use this when" lead per tool on %s', (path) => {
  it('the surface lists tools (a check over an empty list proves nothing)', () => {
    expect(LISTS[path].length).toBeGreaterThan(5);
  });

  it('no tool description carries the lead twice', () => {
    const bad = LISTS[path].filter((t) => leads(t.description) > 1)
      .map((t) => `${t.name} (${leads(t.description)}): ${t.description.slice(0, 160)}`);
    expect(bad).toEqual([]);
  });
});

describe('the leads the guard counts are really there', () => {
  // A lead pattern that matched nothing would make the "> 1" check above pass on anything.
  it('every /mcp tool opens with its lead', () => {
    const missing = LISTS['/mcp'].filter((t) => !t.description.startsWith('Use this when ')).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  // The line withRoutingLine() restores in front of a lead-less tuner override is the opening of the
  // tool's own /mcp description, so a restored lead says what the tool says (compare_isos once read
  // "US power grids (ISOs)" here after the tool took every grid).
  it('each routing line is the opening of its /mcp description', () => {
    const byName = Object.fromEntries(LISTS['/mcp'].map((t) => [t.name, t.description]));
    const drift = Object.entries(ROUTING_LINES)
      .filter(([name, line]) => byName[name] !== undefined && !byName[name].startsWith(line))
      .map(([name]) => name);
    expect(Object.keys(ROUTING_LINES).filter((n) => byName[n] !== undefined).length).toBeGreaterThan(10);
    expect(drift).toEqual([]);
  });
});

describe('per-platform tuner overrides keep one lead', () => {
  // The backend tuner can replace a description. One with no lead gets one back; one with its own
  // lead must not gain a second.
  it('lead-less and own-lead overrides both come out with exactly one lead', async () => {
    const names = Object.keys(ROUTING_LINES);
    const ov = {};
    names.forEach((n, i) => {
      ov[n] = i % 2 ? `Overridden text for ${n}.` : `Use this when the user wants ${n} (tuned). Overridden text.`;
    });
    const r = await S._buildToolsListResult(ov);
    const tools = r.tools.filter((t) => names.includes(t.name));
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.every((t) => t.description.includes('Overridden text')), 'overrides were not applied').toBe(true);
    const bad = tools.filter((t) => leads(t.description) !== 1).map((t) => `${t.name}: ${t.description.slice(0, 160)}`);
    expect(bad).toEqual([]);
  }, 60000);
});
