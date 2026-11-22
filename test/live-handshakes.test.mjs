// =============================================================================
// Live handshake sweep: every MCP path's initialize instructions, read from production
// -----------------------------------------------------------------------------
// Owner 2026-11-22 ("add the light and slim paths to the live QA sweep"). The daily live suite only handshook bare
// /mcp, and nothing read the instruction text other paths serve. The same day a manual sweep found /mcp/light at
// 2,059 characters and the slim ?tools=core handshake at 2,063, both over the 2,048 MCP clients keep, while every
// unit test was green (the local handler is not what production serves once flags and deploys differ). mcp#1664 and
// mcp#1666 fixed both; this keeps watching them, and every other path, from the outside.
//
// For each path: the initialize answers with instructions, they name no tool count (owner 2026-11-22: no catalog total
// and no served count), they fit 2,048 characters, and a listing-scope path still says it is a listing scope.
//
// Paths: bare /mcp; the implicit light list a coding host gets (Cursor by clientInfo, Copilot CLI by User-Agent);
// /mcp/light; the slim ?tools=core list; /mcp/grok; the directory and core profiles; every pack in MCP_PACKS (read
// from server.mjs source, so a new pack joins the sweep without an edit here).
//
// QA-marked on every request (User-Agent dchub-qa-readonly/..., X-DCHub-QA: 1) so the sweep is not counted as
// traffic. No X-MCP-Client header: it names the client, and the light list is chosen from the client's name.
// Live only (MCP_URL set, test.yml's "Live MCP suite" step); a local run skips visibly. Initialize only, no tool call.
// =============================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_COUNT, packPaths } from './live-handshakes-lib.mjs';   // offline checks: test/live-handshakes-unit.test.mjs

const LIVE = !!process.env.MCP_URL;
const MCP_URL = process.env.MCP_URL || 'https://dchub.cloud/mcp';
const BASE = MCP_URL.replace(/\/mcp\/?$/, '');
const BUDGET = 2048;
const QA_UA = 'dchub-qa-readonly/live-handshakes';

// [label, path, User-Agent, clientInfo.name, kind]; kind says which scope line the path must carry.
const SURFACES = [
  ['/mcp', '/mcp', QA_UA, 'dchub-qa-readonly', 'full'],
  ['/mcp light (Cursor)', '/mcp', QA_UA, 'cursor-vscode', 'implicit-light'],
  ['/mcp light (Copilot CLI)', '/mcp', `${QA_UA}/copilot-cli/1.0.34`, 'dchub-qa-readonly', 'implicit-light'],
  ['/mcp/light', '/mcp/light', QA_UA, 'dchub-qa-readonly', 'light'],
  ['/mcp?tools=core (slim)', '/mcp?tools=core', QA_UA, 'dchub-qa-readonly', 'slim'],
  ['/mcp/grok', '/mcp/grok', QA_UA, 'dchub-qa-readonly', 'pack'],
  ['/mcp/claude', '/mcp/claude', QA_UA, 'dchub-qa-readonly', 'profile'],
  ['/mcp/chatgpt', '/mcp/chatgpt', QA_UA, 'dchub-qa-readonly', 'profile'],
  ['/mcp/core', '/mcp/core', QA_UA, 'dchub-qa-readonly', 'profile'],
];
const PACKS = packPaths(readFileSync(new URL('../server.mjs', import.meta.url), 'utf8'));

async function initialize(path, ua, client) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'user-agent': ua,
      'x-dchub-qa': '1',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1' } } }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  try { return { status: res.status, instructions: JSON.parse(data)?.result?.instructions }; }
  catch (_) { return { status: res.status, instructions: undefined }; }
}

const served = {};

describe.runIf(LIVE)('live handshakes: no tool count, within 2,048, scope line kept (owner 2026-11-22)', () => {
  beforeAll(async () => {
    for (const [label, path, ua, client, kind] of [...SURFACES, ...PACKS.map((p) => [p, p, QA_UA, 'dchub-qa-readonly', 'pack'])]) {
      try { served[label] = { kind, ...(await initialize(path, ua, client)) }; }
      catch (e) { served[label] = { kind, status: 0, error: String(e?.message || e) }; }
    }
  }, 180_000);

  it('reads the real pack list', () => { expect(PACKS.length).toBeGreaterThanOrEqual(5); });

  it('every path answers initialize with instructions', () => {
    const missing = Object.entries(served).filter(([, v]) => typeof v.instructions !== 'string' || v.instructions.length < 200)
      .map(([k, v]) => `${k} (HTTP ${v.status}${v.error ? ', ' + v.error : ''})`);
    expect(missing).toEqual([]);
  });

  it('no handshake names a tool count', () => {
    const hits = Object.entries(served).filter(([, v]) => TOOL_COUNT.test(v.instructions || ''))
      .map(([k, v]) => `${k}: "${v.instructions.match(TOOL_COUNT)[0]}"`);
    expect(hits).toEqual([]);
  });

  it('every handshake fits the 2,048-character client budget', () => {
    const over = Object.entries(served).filter(([, v]) => (v.instructions || '').length > BUDGET)
      .map(([k, v]) => `${k} ${v.instructions.length}`);
    expect(over).toEqual([]);
  });

  it('the light paths serve the light list (Tools: line, then discover_tools) and say they are a listing scope', () => {
    for (const [k, v] of Object.entries(served)) {
      if (v.kind !== 'light' && v.kind !== 'implicit-light') continue;
      expect(v.instructions, k).toMatch(/Tools: execute_plan(?:, [a-z_]+)*\. discover_tools lists the rest\. /);
      expect(v.instructions, k).toMatch(/ENDPOINT SCOPE: (?:\/mcp\/light is )?a listing scope, not a permission scope/);
      expect(v.instructions, k).toContain('the full list is at https://dchub.cloud/mcp?catalog=full');
    }
  });

  it('the slim path says what it lists, when the slim list is on', () => {
    const v = served['/mcp?tools=core (slim)'];
    // DCHUB_SLIM_PROFILE_TEST is the owner's switch; off, ?tools=core is plain /mcp and there is nothing slim to check.
    if (!/\(tools=core\)/.test(v.instructions || '')) { console.warn('[live-handshakes] slim list is off; ?tools=core served plain /mcp'); return; }
    expect(v.instructions).toMatch(/ENDPOINT SCOPE: this \/mcp list \(tools=core\) is a listing scope, not a permission scope/);
  });

  it('grok and every pack say they list a subset, a listing scope', () => {
    for (const [k, v] of Object.entries(served)) {
      if (v.kind !== 'pack') continue;
      expect(v.instructions, k).toMatch(/ENDPOINT SCOPE: \/mcp\/\S+ lists a subset of DC Hub tools, a listing scope, not a permission scope/);
    }
  });
});
