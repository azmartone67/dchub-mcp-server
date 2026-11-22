// Owner 2026-11-21 ("fix the dxt manifest too"): the Claude Desktop extension
// description names neither a tool count nor a market count, same as mcp.json
// (be#9179), the tool descriptions (mcp#1634) and the listing copy (mcp#1638).
// Checks the manifest AND the copy inside the committed dchub.dxt bundle, since
// the bundle is what a user actually installs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packBundle } from '../scripts/dxt-bundle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET_COUNT = /\b\d[\d,]*\+?\s+(?:(?:DC\s+Hub|DCPI|metro|scored)\s+)?markets?\b/i;
const TOOL_COUNT = /\b\d+\+?(?:[ -](?:live|MCP|read-only))*[ \n-]tools?\b/i;
const manifest = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'dxt/manifest.json'), 'utf8'));

describe('dxt manifest names no tool or market count', () => {
  it('the patterns catch the removed phrasing (not vacuous)', () => {
    const was = 'for AI agents — 98 tools over a global data-center facility map, 300+ markets scored by the DCPI';
    expect(MARKET_COUNT.test(was)).toBe(true);
    expect(TOOL_COUNT.test(was)).toBe(true);
    expect(MARKET_COUNT.test('markets scored daily by the DCPI')).toBe(false);
  });

  it('description and long_description carry neither count', () => {
    const m = manifest();
    for (const k of ['description', 'long_description']) {
      expect(m[k].length, k).toBeGreaterThan(80);
      expect(m[k].match(MARKET_COUNT), k).toBeNull();
      expect(m[k].match(TOOL_COUNT), k).toBeNull();
    }
    expect(m.description).toContain('markets scored daily by the Data Center Power Index');
  });

  it('the committed dchub.dxt bundle carries the same manifest (repacked)', () => {
    const built = packBundle((src) => fs.readFileSync(path.join(ROOT, src)));
    expect(Buffer.compare(built, fs.readFileSync(path.join(ROOT, 'dchub.dxt')))).toBe(0);
  });
});
