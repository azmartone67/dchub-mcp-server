// R2 (2026-10-18): the second server "DC Hub Power & Grid" - pack membership, manifest limits, no price copy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';

const M = JSON.parse(readFileSync(new URL('../registry/power-grid.server.json', import.meta.url), 'utf8'));
const SPINE = ['discover_tools', 'claim_free_key', 'unlock_more_data', 'summarize_for_citation'];
const LISTED = ['get_market_dcpi_rank', 'get_power_availability_timeline', 'get_interconnection_queue',
  'get_grid_intelligence', 'get_grid_scoreboard', 'get_energy_prices', 'compare_isos', 'get_hosting_capacity',
  'get_retirement_headroom', 'analyze_site', 'find_sites'];

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

async function post(path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
  const raw = await res.text();
  return { status: res.status, json: JSON.parse(raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw) };
}

describe('POST /mcp/power', () => {
  it('lists exactly the 15 tools: 11 power/grid + the spine', async () => {
    const r = await post('/mcp/power', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.status).toBe(200);
    expect(r.json.result.tools.map((t) => t.name).sort()).toEqual([...LISTED, ...SPINE].sort());
    expect(r.json.result.tools.length).toBeLessThanOrEqual(15);
  });
  it('answers initialize (a mounted path, not the GET health blob)', async () => {
    const r = await post('/mcp/power', { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pg-test', version: '1' } } });
    expect(r.json.result.serverInfo).toBeTruthy();
  });
  it('/mcp/grid is unchanged at 17', async () => {
    const r = await post('/mcp/grid', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.json.result.tools.length).toBe(17);
  });
});

describe('registry/power-grid.server.json', () => {
  it('fits the registry schema limits and names this entry only', () => {
    expect(M.name).toBe('cloud.dchub/power-grid');
    expect(M.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(M.title.length).toBeLessThanOrEqual(100);
    expect(M.description.length).toBeLessThanOrEqual(100);
    expect(M.remotes).toEqual([{ type: 'streamable-http', url: 'https://dchub.cloud/mcp/power' }]);
    expect(M._meta['io.modelcontextprotocol.registry/publisher-provided'].toolCount).toBe(15);
  });
  it('is keyword-rich where directories search, and carries no price or plan wording', () => {
    const text = JSON.stringify(M);
    for (const k of ['power', 'grid', 'interconnection', 'electricity']) expect(M.title.toLowerCase() + ' ' + M.description.toLowerCase(), k).toContain(k);
    expect(text).not.toMatch(/\$\s?\d|\/mo\b|per month|\bPro\b|\bplan\b|\bpricing\b/i);
  });
  it('its remote is not one the first entry uses', () => {
    const first = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    expect(first.remotes.map((r) => r.url)).not.toContain(M.remotes[0].url);
  });
});
