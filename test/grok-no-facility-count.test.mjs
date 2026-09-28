// /mcp/grok states no facility COUNT — not in a tool description, not in the
// initialize instructions.
//
// Owner decision 2026-09-27: no facility number anywhere until a corroborated
// count exists ("corroborated count pending"). /mcp and /mcp/chatgpt were
// cleaned by mcp#610/#611/#612, but the Grok profile (mcp#608) hand-writes its
// own search_facilities description and filled the number in from
// canonical/canon_phrases.json, which KEEPS a numeric `facilities` on purpose.
// Measured live 2026-09-28 09:20Z on /mcp/grok:
//   search_facilities: "Search 24,900+ data-center facilities in 170+ countries …"
// test/facility-count-withdrawn.test.mjs scans committed files, so a number
// composed at runtime from canon never reached it. This test reads what the
// path actually SERVES.
//
// Real handler over HTTP, local stub backend, no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { findFacilityFloors } from '../scripts/canon-floor.mjs';

// The owner's pattern: a thousands-grouped number near "facilit". The gap may
// not cross a sentence or list boundary (. ; , newline), so "per-facility
// tenants, and 1,600+ tracked M&A deals" is not read as a facility count.
const NEAR_BEFORE = /(\d{1,3},\d{3}\+?)[^.;,\n]{0,40}facilit/gi;
const NEAR_AFTER = /facilit(?:y|ies)[^.;,\n\d]{0,24}(\d{1,3},\d{3}\+?)/gi;
export function facilityCounts(text) {
  const t = String(text || '');
  return [
    ...[...t.matchAll(NEAR_BEFORE)].map((m) => m[0]),
    ...[...t.matchAll(NEAR_AFTER)].map((m) => m[0]),
    ...findFacilityFloors(t),
  ];
}

let S, G, PORT, httpServer, stub, prevBase;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/api/v1/mcp/session-key')) { res.statusCode = 404; res.end('{}'); return; }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  G = await import('../lib/grok-profile.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
});

async function post(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, json: JSON.parse(data) };
}
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok-count-test', version: '1.0' } } };

describe('/mcp/grok states no facility count (corroborated count pending)', () => {
  it('CONTROL: the detector catches the live 2026-09-28 wording and its variants', () => {
    for (const bad of [
      'Search 24,900+ data-center facilities in 170+ countries by text query',
      'Search 24,600+ global data center facilities',
      'facility search (24,600+)',
      '**Facilities:** 24,600+ across 170+ countries',
      'covers 24,900 facilities',
    ]) expect(facilityCounts(bad), bad).not.toEqual([]);
    // …and does not fire on the counts that sit beside the facility map.
    for (const ok of [
      'a global data-center facility map (170+ countries; corroborated count pending), 300+ markets',
      'per-facility tenants, and 1,600+ tracked M&A deals',
      "Search DC Hub's global data-center facility map (170+ countries; corroborated count pending)",
    ]) expect(facilityCounts(ok), ok).toEqual([]);
  });

  it('no /mcp/grok tool description states a facility count', async () => {
    const tools = (await post('/mcp/grok', LIST)).json.result.tools;
    expect(tools.length).toBe(11);
    for (const t of tools) expect(facilityCounts(t.description), `${t.name}: ${t.description}`).toEqual([]);
    const sf = tools.find((t) => t.name === 'search_facilities');
    expect(sf.description).toContain('corroborated count pending');
  });

  it('the hand-written descriptions carry none either (independent of canon_phrases.json)', () => {
    for (const [n, d] of Object.entries(G.GROK_DESCRIPTIONS)) expect(facilityCounts(d), n).toEqual([]);
    // The builder no longer takes a facility number at all: passing one is ignored.
    const forced = G.grokDescriptions({ facilities: '99,999+', countries: '170+' });
    for (const [n, d] of Object.entries(forced)) expect(facilityCounts(d), n).toEqual([]);
  });

  it('the /mcp/grok initialize instructions state no facility count', async () => {
    const init = await post('/mcp/grok', INIT);
    const instr = init.json.result.instructions;
    expect(instr).toContain('/mcp/grok, which lists 11 DC Hub tools');   // it IS the Grok handshake
    expect(facilityCounts(instr)).toEqual([]);
  });
});
