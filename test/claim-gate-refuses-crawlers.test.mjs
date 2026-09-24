// A self-declared crawler is not a high-intent prospect.
//
// Read on Neon 2026-09-24: 19 mcp_high_intent_sessions rows (15 sessions, 17 tools),
// claims minted 09-17..09-21, 0 opens, all from
//   platform 'brickblue'
//   UA       'BrickBlueBot/0.1 (+https://brick.blue/bot; agentic-web registry)'
// isBotOrInternalCtx() gates trackPaidHit + shouldMintClaim, and its list had no
// crawler token, so the sweep landed in the handoff funnel's relay_minted.
//
// The human-bearing controls matter as much as the refusals: ChatGPT-User's UA
// contains '/bot', so a rule keyed on the word would silently drop real prospects.
import { describe, it, expect } from 'vitest';
import { isBotOrInternalCtx } from '../server.mjs';

const CRAWLERS = [
  { platform: 'brickblue', client_ua: 'BrickBlueBot/0.1 (+https://brick.blue/bot; agentic-web registry)' },
  { platform: 'brickblue', client_ua: 'BrickBlueBot/0.1 (+https://brick.blue/bot; agentic-web indexer)' },
  { client_ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)' },
  { client_ua: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' },
  { user_agent: 'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)' },
];

const HUMANS = [
  { platform: 'chatgpt', client_ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot' },
  { platform: 'claude', client_ua: 'Claude-User (claude-code/2.1.0; +https://support.anthropic.com/)' },
  { platform: 'perplexity', client_ua: 'Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)' },
  { platform: 'claude', client_ua: 'node' },
  { platform: 'cursor', client_ua: 'Cursor/1.4.2' },
  { platform: 'copilot', client_ua: 'GitHubCopilotChat/0.30.0' },
  {},
];

describe('claim gate: crawlers', () => {
  for (const c of CRAWLERS) {
    it(`refuses ${c.client_ua || c.user_agent}`, () => {
      expect(isBotOrInternalCtx(c)).toBe(true);
    });
  }
});

describe('claim gate: human-bearing agents still pass', () => {
  for (const c of HUMANS) {
    it(`allows ${c.client_ua || '(empty ctx)'}`, () => {
      expect(isBotOrInternalCtx(c)).toBe(false);
    });
  }
});
