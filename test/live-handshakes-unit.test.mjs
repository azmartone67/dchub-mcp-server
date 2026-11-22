// Offline checks for the live handshake sweep (test/live-handshakes.test.mjs): its pack list is the real one and its
// count detector reads the wordings the owner had removed (2026-11-22). Hard-gate qualified: no network, no writes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_COUNT, packPaths } from './live-handshakes-lib.mjs';

describe('live handshake sweep helpers', () => {
  it('packPaths reads the MCP_PACKS entries from the real server.mjs', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const paths = packPaths(src);
    expect(paths.length).toBeGreaterThanOrEqual(5);
    for (const p of paths) expect(p).toMatch(/^\/mcp\/[a-z][\w-]*$/);
    // Every pack in the map body is found: one `pack:` key per entry, so the counts agree.
    const body = src.slice(src.indexOf('const MCP_PACKS = new Map(['), src.indexOf('\n]);', src.indexOf('const MCP_PACKS = new Map([')));
    expect(paths.length).toBe((body.match(/^\s+\['\/mcp\/[^']+',/gm) || []).length);
  });

  it('packPaths returns [] when the map is missing (the live test then fails on its pack-count check)', () => {
    expect(packPaths('const OTHER = 1;')).toEqual([]);
    expect(packPaths(null)).toEqual([]);
  });

  it('CONTROL: TOOL_COUNT reads the removed wordings and passes the new ones', () => {
    for (const s of ["this client's /mcp list shows 10 DC Hub tools", '/mcp/grok lists 11 DC Hub tools',
      'This list shows 3 tools;', 'DC Hub: 98 tools.', '2,000+ tools']) expect(s, s).toMatch(TOOL_COUNT);
    for (const s of ['lists a subset of DC Hub tools', 'discover_tools lists the rest.', 'tools/call accepts any DC Hub tool by name'])
      expect(s, s).not.toMatch(TOOL_COUNT);
  });
});
