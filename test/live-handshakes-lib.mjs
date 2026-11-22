// Helpers for test/live-handshakes.test.mjs (live) and test/live-handshakes-unit.test.mjs (offline, hard gate).

// "98 tools", "10 DC Hub tools", "2,000+ tools": a stated tool count (owner 2026-11-22: none in any handshake).
export const TOOL_COUNT = /\b\d[\d,]*\+?\s+(?:DC Hub\s+)?tools\b/i;

// Pack paths as server.mjs declares them: `['/mcp/<name>', { pack: ...` inside `const MCP_PACKS = new Map([`.
export function packPaths(src) {
  const s = String(src || '');
  const start = s.indexOf('const MCP_PACKS = new Map([');
  const end = start < 0 ? -1 : s.indexOf('\n]);', start);
  if (start < 0 || end < 0) return [];
  return [...s.slice(start, end).matchAll(/^\s+\['(\/mcp\/[a-z][\w-]*)',\s*\{\s*pack:/gm)].map((m) => m[1]);
}
