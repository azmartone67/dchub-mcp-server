// platform-header.test.mjs — r-platform-header: explicit platform attribution
// header (X-MCP-Platform / X-Client-Source), honored ONLY for known platforms.
import { describe, it, expect } from 'vitest';
import { detectPlatformFromInit } from '../server.mjs';

const init = (name) => ({ params: { clientInfo: { name } } });

describe('explicit platform header attribution', () => {
  it('a KNOWN header value wins over a generic clientInfo (the Gemini case)', () => {
    // enterprise Gem sends clientInfo.name='mcp' but sets the header
    expect(detectPlatformFromInit(init('mcp'), 'node', 'gemini-enterprise')).toBe('gemini');
    expect(detectPlatformFromInit(init('mcp'), 'node', 'gemini')).toBe('gemini');
  });

  it('the HF Space bridge header (X-MCP-Platform: huggingface) attributes', () => {
    // huggingface is a known platform (live in the reach allowlist), and the HF
    // Space bridge already sends this header — so it now attributes instead of
    // falling into the generic 'mcp' bucket.
    expect(detectPlatformFromInit(init('mcp'), 'node', 'huggingface')).toBe('huggingface');
  });

  it('an UNKNOWN header value cannot mint a platform or brand-attribute crawl', () => {
    expect(detectPlatformFromInit(init('mcp'), 'node', 'randomcorp')).toBe('mcp');
    expect(detectPlatformFromInit(init('mcp'), 'node', 'totally-made-up')).toBe('mcp');
    // empty / whitespace hint is a no-op
    expect(detectPlatformFromInit(init('gemini'), 'node', '')).toBe('gemini');
    expect(detectPlatformFromInit(init('gemini'), 'node', '   ')).toBe('gemini');
  });

  it('no header → unchanged clientInfo/UA behavior (regression guard)', () => {
    expect(detectPlatformFromInit(init('claude-ai'), 'node')).toBe('claude');
    expect(detectPlatformFromInit(init('cursor-vscode'), 'node')).toBe('cursor');
    expect(detectPlatformFromInit(init('mistral-le-chat'), 'node')).toBe('mistral');
    // junk clientInfo still collapses to dchub-internal
    expect(detectPlatformFromInit(init('clawith'), '')).toBe('dchub-internal');
    // unknown-but-clean clientInfo still passes through as its own tag
    expect(detectPlatformFromInit(init('some-new-agent'), '')).toBe('some-new-agent');
    // no clientInfo, no header → UA fallback
    expect(detectPlatformFromInit({}, 'perplexitybot/1.0')).toBe('perplexity');
    expect(detectPlatformFromInit({}, 'node')).toBe('mcp');
  });

  it('a known header overrides a different known clientInfo (caller self-identifies)', () => {
    // deliberate: the header is the caller asserting its own identity; only ever
    // to a known platform, and the caller controls both, so this is attribution
    // not spoofing of someone else.
    expect(detectPlatformFromInit(init('claude-ai'), 'node', 'gemini')).toBe('gemini');
  });
});
