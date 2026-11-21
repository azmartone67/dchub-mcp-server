// agent-incentive-1121-catalog.test.mjs — owner 2026-11-21 ("lets do them all and yes to all items").
// Tool descriptions carry no per-day allowance or plan wording; /mcp suggests the ten-tool profile to
// hosts that load every tool; /mcp/core names plan_and_answer as the execute_plan planner.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as S from '../server.mjs';
import { CORE_INSTRUCTIONS } from '../lib/core-profile.mjs';

const manifest = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'));
const desc = (n) => manifest.tools.find((t) => t.name === n).description;

describe('no per-day or plan lines in these tool descriptions', () => {
  for (const n of ['search_intelligence', 'get_grid_intelligence', 'rank_markets', 'research_task', 'get_hosting_capacity']) {
    it(n, () => {
      const d = desc(n);
      expect(d).not.toMatch(/per day|a day\b|\/day\b|paid DC Hub plan|Unlimited needs/i);
    });
  }
});

describe('ten-tool profile suggestion', () => {
  it('is appended on /mcp only', () => {
    expect(S._INSTR_TAIL_CORE_HINT).toContain('https://dchub.cloud/mcp/core');
    expect(S._INSTR_TAIL_CORE_HINT).not.toMatch(/free|\$|per day|credits?/i);
    expect(S._isDefaultMcpPath({ path: '/mcp' })).toBe(true);
    expect(S._isDefaultMcpPath({ path: '/mcp/' })).toBe(true);
    for (const p of ['/mcp/chatgpt', '/mcp/claude', '/mcp/grok', '/mcp/core', '/mcp/registry', '/mcp/oauth']) {
      expect(S._isDefaultMcpPath({ path: p })).toBe(false);
    }
    expect(S._isDefaultMcpPath({})).toBe(false);
  });
  it('/mcp/core names plan_and_answer as the execute_plan planner', () => {
    expect(CORE_INSTRUCTIONS).toContain('plan_and_answer (the execute_plan planner of the full DC Hub server)');
  });
});
