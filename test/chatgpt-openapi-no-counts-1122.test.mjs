// Owner 2026-11-22 ("fix the chatgpt openapi counts too"): the ChatGPT Actions
// schema and the GPT instructions name no market count and no tool count, same as
// mcp.json (be#9179), the tool descriptions (mcp#1634), the listing copy (mcp#1638)
// and the Claude Desktop extension (mcp#1642). The backend's served copy
// (static/integrations/chatgpt/) dropped its counts in be#9162.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET_COUNT = /\b\d[\d,]*\+?\s+(?:(?:DC\s+Hub|DCPI|metro|scored)\s+)?markets?\b/i;
const TOOL_COUNT = /\b\d+\+?(?:[ -](?:live|MCP|read-only))*[ \n-]tools?\b/i;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Every string in the schema, so a count moved into an operation summary is seen too. */
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe('ChatGPT Actions schema and GPT instructions name no count', () => {
  it('the patterns catch the removed phrasings (not vacuous)', () => {
    expect(MARKET_COUNT.test('170+ countries, 300+ DCPI markets, real-time')).toBe(true);
    expect(MARKET_COUNT.test('- 300+ markets scored by the Data Center Power Index')).toBe(true);
    expect(TOOL_COUNT.test('98 tools over a global map')).toBe(true);
    expect(MARKET_COUNT.test('markets scored daily by the Data Center Power Index (DCPI)')).toBe(false);
  });

  it('openapi.json: no string states a market or tool count', () => {
    const all = strings(JSON.parse(read('integrations/chatgpt/openapi.json')));
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((s) => MARKET_COUNT.test(s))).toEqual([]);
    expect(all.filter((s) => TOOL_COUNT.test(s))).toEqual([]);
    expect(JSON.parse(read('integrations/chatgpt/openapi.json')).info.description)
      .toContain('markets scored daily by the Data Center Power Index (DCPI)');
  });

  it('instructions.txt: no market or tool count', () => {
    const t = read('integrations/chatgpt/instructions.txt');
    expect(t.length).toBeGreaterThan(1000);
    expect(t.match(new RegExp(MARKET_COUNT.source, 'gi'))).toBeNull();
    expect(t.match(new RegExp(TOOL_COUNT.source, 'gi'))).toBeNull();
    expect(t).toContain('- Markets scored daily by the Data Center Power Index (DCPI)');
  });
});
