// /mcp/claude: a partial search or fetch closes with the plans line, like every
// other gated tool (Grok audit 2026-09-26 03:56 PT: keyless search "Ashburn"
// returned partial_preview, 3 of 5, with no closing line). /mcp/chatgpt keeps
// OpenAI's connector contract: exactly one item, no line (frozen behaviour).
import { describe, it, expect } from 'vitest';
import { scrubClaudeToolResult, CLAUDE_PLANS_NOTICE } from '../lib/claude-directory.mjs';
import { scrubToolResult as scrubChatgpt } from '../lib/chatgpt-directory.mjs';

const rows = [1, 2, 3].map((i) => ({ id: String(8480 + i), title: 'Facility ' + i, url: 'https://dchub.cloud/facility/' + (8480 + i) }));
const partial = { results: rows, citation: { cite_as: 'DC Hub, dchub.cloud', completeness: 'partial_preview' } };
const full = { results: rows, citation: { cite_as: 'DC Hub, dchub.cloud', completeness: 'unknown' } };
const res = (sc) => ({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc });

describe('/mcp/claude search and fetch', () => {
  for (const tool of ['search', 'fetch']) {
    it(`${tool}: a partial result ends with exactly one neutral plans line`, () => {
      const r = scrubClaudeToolResult(res(partial), tool);
      expect(r.content).toHaveLength(2);
      expect(JSON.parse(r.content[0].text).results).toHaveLength(3);
      expect(r.content[1].text).toBe(CLAUDE_PLANS_NOTICE);
      expect(r.content.filter((c) => c.text === CLAUDE_PLANS_NOTICE)).toHaveLength(1);
      expect(r.structuredContent.notice).toBe(CLAUDE_PLANS_NOTICE);
      expect(CLAUDE_PLANS_NOTICE).not.toMatch(/\$\s?\d|checkout|unlock|credits|\/go\//i);
    });
    it(`${tool}: a full result carries no line`, () => {
      const r = scrubClaudeToolResult(res(full), tool);
      expect(r.content).toHaveLength(1);
      expect(JSON.stringify(r)).not.toContain(CLAUDE_PLANS_NOTICE);
    });
  }
});

describe('CONTROL: /mcp/chatgpt keeps the one-item connector contract', () => {
  for (const tool of ['search', 'fetch']) {
    it(`${tool}: one item, no plans line, even when partial`, () => {
      const r = scrubChatgpt(res(partial), tool);
      expect(r.content).toHaveLength(1);
      expect(JSON.stringify(r)).not.toContain('dchub.cloud/plans');
    });
  }
});
