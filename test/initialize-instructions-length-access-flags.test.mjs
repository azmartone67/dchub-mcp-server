// initialize-instructions-length.test.mjs, again, with the Agent Handoff flags ON (DCHUB_EXP_UPGRADE_BLOCK and
// DCHUB_ACCESS_STATUS_TOOL). The access line (server.mjs ACCESS_INSTR_LINE) pushed /mcp/grok 1,987 -> 2,194 and the
// pack paths past 2,048 before it was cut to the purchase rule alone. Every served path must stay inside its budget
// with the flags on; a path the line cannot fit (/mcp/grok and /mcp/grok/oauth keep 48 characters of headroom, so
// 2,000) is served without it, and every access block carries the same sentence as agent_note.
// Reads the served initialize result over real HTTP (stub backend on loopback). No disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const FLAGS = { DCHUB_EXP_UPGRADE_BLOCK: '1', DCHUB_ACCESS_STATUS_TOOL: '1' };
const BUDGET = 2048;
const GROK_BUDGET = 2000;
let S, CW, httpServer, stub, PORT, prevBase;
const prevFlags = {};
const served = {};

async function init(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'instructions-length-test', version: '1' } } }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  try { return JSON.parse(body).result?.instructions; } catch (_) { return undefined; }
}

const CORE = ['/mcp', '/mcp/grok', '/mcp/chatgpt', '/mcp/claude', '/mcp/core'];
const GROK = ['/mcp/grok', '/mcp/grok/oauth'];
let PACKS = [];

beforeAll(async () => {
  for (const [k, v] of Object.entries(FLAGS)) { prevFlags[k] = process.env[k]; process.env[k] = v; }
  await new Promise((resolve) => {
    stub = createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{}'); }); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  CW = await import('../lib/commercial-wall.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  PACKS = [...S.MCP_PACKS.keys()];
  for (const p of [...CORE, '/mcp/grok/oauth', ...PACKS]) served[p] = await init(p);
}, 60_000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  for (const k of Object.keys(FLAGS)) { if (prevFlags[k] === undefined) delete process.env[k]; else process.env[k] = prevFlags[k]; }
});

describe('with the access flags ON, every handshake still fits its budget', () => {
  it('reads every path', () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(5);
    for (const p of [...CORE, ...PACKS]) expect(typeof served[p], p).toBe('string');
  });

  it.each([...CORE, '/mcp/grok/oauth'])('%s is at most 2,048 characters with the flags on', (p) => {
    if (p === '/mcp/grok/oauth' && served[p] === undefined) return;   // the OAuth URL may challenge instead
    expect(served[p].length, p + ' measured ' + served[p].length).toBeLessThanOrEqual(BUDGET);
  });

  it.each(GROK)('%s keeps its 48 characters of headroom (at most 2,000) with the flags on', (p) => {
    if (p === '/mcp/grok/oauth' && served[p] === undefined) return;
    expect(served[p].length, p + ' measured ' + served[p].length).toBeLessThanOrEqual(GROK_BUDGET);
  });

  it('every pack path is at most 2,048 characters with the flags on', () => {
    const over = PACKS.filter((p) => served[p].length > BUDGET).map((p) => p + ' ' + served[p].length);
    expect(over, over.join(', ')).toEqual([]);
  });

  it('the line is the purchase rule alone, no price or plan name, and it is the access block\'s agent_note', () => {
    expect(S.ACCESS_INSTR_LINE).toBe(CW.ACCESS_AGENT_NOTE);
    expect(S.ACCESS_INSTR_LINE.length).toBeLessThanOrEqual(64);
    expect(S.ACCESS_INSTR_LINE).toMatch(/get_access_status/);
    expect(S.ACCESS_INSTR_LINE).not.toMatch(CW.AGENT_TEXT_BANNED);
    expect(CW.buildAccess({ unlocks_with: 'pro' }).access.agent_note).toBe(CW.ACCESS_AGENT_NOTE);
  });

  it('/mcp and the pack paths carry the line; the Grok paths (no room) are served without it', () => {
    expect(served['/mcp']).toContain(S.ACCESS_INSTR_LINE);
    for (const p of PACKS) if (!GROK.includes(p)) expect(served[p], p).toContain(S.ACCESS_INSTR_LINE);
    for (const p of GROK) if (served[p] !== undefined) expect(served[p], p).not.toContain(S.ACCESS_INSTR_LINE);
    expect(served['/mcp/chatgpt']).not.toContain(S.ACCESS_INSTR_LINE);
  });

  it('a path whose budget the line would pass is served the plain text, byte for byte', () => {
    const on = { ...FLAGS };
    const lean = S._INSTRUCTIONS_LEAN;
    expect(S._accessFitForTest(lean, { instrBudget: 1 }, on)).toBe(lean);
    expect(S._accessFitForTest(lean, undefined, {})).toBe(lean);
    const full = S._accessFitForTest(lean, undefined, on);
    expect(full).toContain(S.ACCESS_INSTR_LINE);
    expect(full.length).toBe(lean.length + S.ACCESS_INSTR_LINE.length + 1);
    expect(S._accessFitForTest(lean, { instrBudget: full.length }, on)).toBe(full);
    expect(S._accessFitForTest(lean, { instrBudget: full.length - 1 }, on)).toBe(lean);
    expect(CW.ACCESS_INSTR_BUDGET_COMPACT).toBe(GROK_BUDGET);
  });
});
