// answer-question-alias-1121.test.mjs — owner 2026-11-21 (agent-incentive round; HOLD until after the
// Nov 23 launch): `answer_question` reaches execute_plan on /mcp only, call-time, never listed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as S from '../server.mjs';

const call = (path, name = 'answer_question') => ({ path, body: { method: 'tools/call', params: { name, arguments: { question: 'q' } } } });

describe('answer_question alias', () => {
  it('applies on /mcp only', () => {
    expect(S._answerQuestionAlias(call('/mcp'))).toBe(true);
    expect(S._answerQuestionAlias(call('/mcp/'))).toBe(true);
    for (const p of ['/mcp/chatgpt', '/mcp/claude', '/mcp/grok', '/mcp/core', '/mcp/registry', '/mcp/oauth']) {
      expect(S._answerQuestionAlias(call(p))).toBe(false);
    }
    expect(S._answerQuestionAlias(call('/mcp', 'execute_plan'))).toBe(false);
    expect(S._answerQuestionAlias({ path: '/mcp', body: { method: 'tools/list' } })).toBe(false);
  });
  it('is not a listed tool and not in the all-path alias map', () => {
    const m = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'));
    expect(m.tools.map((t) => t.name)).not.toContain('answer_question');
    expect(Object.prototype.hasOwnProperty.call(S.TOOL_ALIASES, 'answer_question')).toBe(false);
  });
});
