// windsurf-path-and-claim-copy.test.mjs — (2026-11-11, funnel-9 leftovers)
//
// 1. persist_config.clients.windsurf named ~/.codeium/windsurf/mcp_config.json. Windsurf's
//    Cascade now opens ~/.config/devin/mcp_config.json from its "Open MCP config file" action
//    (docs.devin.ai/windsurf/plugins/cascade/mcp); the ~/.codeium file is only the editor's
//    discovery source, so a key pasted there is not what Cascade loads.
// 2. The claude-variant high-intent line promised "a free 7-day/50-call trial key". The claim
//    link now issues the caller's free, durable key (be#8702), not a 7-day trial.
//
// 3. (2026-11-20) Windsurf's docs (docs.windsurf.com/windsurf/cascade/mcp) name
//    ~/.config/devin/mcp_config.json as the user config; ~/.codeium/windsurf/mcp_config.json is the
//    older path. persist_config and the docs now name both, current first, from one module
//    (lib/windsurf-config-where.mjs); the docs carry WINDSURF_WHERE_MD verbatim.
//
// Drives a real claim_free_key tools/call against a stub backend, as persist-config-vscode does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  WINDSURF_CONFIG_PATH, WINDSURF_CONFIG_PATH_OLDER, WINDSURF_WHERE, WINDSURF_WHERE_MD, WINDSURF_PERSIST_FILE,
} from '../lib/windsurf-config-where.mjs';

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

// Current path first, older path second, the older one marked as such.
function whereProblems(text) {
  const p = [];
  const i = text.indexOf(WINDSURF_CONFIG_PATH), j = text.indexOf(WINDSURF_CONFIG_PATH_OLDER);
  if (i < 0) p.push('does not name ' + WINDSURF_CONFIG_PATH);
  if (j < 0) p.push('does not name ' + WINDSURF_CONFIG_PATH_OLDER);
  if (i >= 0 && j >= 0 && j < i) p.push('older path comes first');
  if (!/current Windsurf/.test(text) || !/on older versions/.test(text)) p.push('does not say which path is current');
  return p;
}

describe('the shared Windsurf sentence', () => {
  it('is the wanted copy, current path first', () => {
    expect(WINDSURF_WHERE).toBe('Add to ~/.config/devin/mcp_config.json (current Windsurf), or ~/.codeium/windsurf/mcp_config.json on older versions.');
    expect(WINDSURF_WHERE_MD.replace(/`/g, '')).toBe(WINDSURF_WHERE);
    expect(whereProblems(WINDSURF_WHERE)).toEqual([]);
    expect(whereProblems(WINDSURF_PERSIST_FILE)).toEqual([]);
  });
  it('must-fail: old-first, one-path and unlabelled copies are caught', () => {
    expect(whereProblems('Add to ~/.codeium/windsurf/mcp_config.json, or ~/.config/devin/mcp_config.json (current Windsurf) on older versions')).not.toEqual([]);
    expect(whereProblems('~/.config/devin/mcp_config.json')).not.toEqual([]);
    expect(whereProblems('~/.config/devin/mcp_config.json or ~/.codeium/windsurf/mcp_config.json')).not.toEqual([]);
  });
  for (const rel of ['docs/quick-start.md', 'integrations/mcp-clients/README.md']) {
    it(`${rel} carries the shared sentence verbatim`, () => {
      const md = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
      expect(md).toContain(WINDSURF_WHERE_MD);
      // the older path appears only inside the shared sentence
      expect(md.split(WINDSURF_WHERE_MD).join('')).not.toContain(WINDSURF_CONFIG_PATH_OLDER);
    });
  }
});

describe('persist_config: Windsurf names the current and the older config file', () => {
  it('points at ~/.config/devin/mcp_config.json first, ~/.codeium/windsurf as the older path', async () => {
    const before = stubHits;
    const sc = await claim();
    expect(stubHits, 'stub never called — DCHUB_API_BASE did not take, this guard ran nothing')
      .toBeGreaterThan(before);
    const ws = sc.persist_config?.clients?.windsurf;
    expect(ws, 'no windsurf entry in persist_config.clients').toBeTruthy();
    expect(ws.file).toBe(WINDSURF_PERSIST_FILE);
    expect(whereProblems(ws.file)).toEqual([]);
    const cfg = JSON.parse(ws.snippet);
    expect(cfg.mcpServers.dchub.serverUrl).toContain('/mcp');
    expect(cfg.mcpServers.dchub.headers['X-API-Key']).toBe(FAKE_KEY);
  });
});

describe('high-intent claim line: no trial promise on a free-key link', () => {
  it('the claude variant offers a free key, not a 7-day/50-call trial', () => {
    const line = S.VARIANT_COPY.claude('get_market_intel', { count: 3, claim_url: 'https://dchub.cloud/claim/T' }, 'https://dchub.cloud/upgrade');
    expect(line).toContain('https://dchub.cloud/claim/T');
    expect(line).toContain('a free DC Hub key');
    expect(line).not.toMatch(/7-day|50-call|trial key/);
  });
});
