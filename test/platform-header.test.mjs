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

describe('r-gemini-ident (2026-08-01): the X-Client-Info alias', () => {
  it("Gemini's full committed signature resolves to gemini — including the dchub-mcp suffix", () => {
    // Gemini committed to 'X-Client-Info: Gemini-Agent/2.5' ahead of the 08-04
    // per-platform gate. The full string contains 'dchub-mcp'; it must resolve
    // via the KNOWN vocabulary ('gemini' matches first) and never junk-screen.
    expect(detectPlatformFromInit(init('mcp'), 'node',
      'Gemini-Agent/2.5 (MCP-Client; dchub-mcp)')).toBe('gemini');
  });

  it('the transport extracts x-client-info as a third header alias (wiring pin)', () => {
    // The hint above is pre-extracted; this pins that the HTTP layer actually
    // reads the header. Source-level check, same style as the class pins.
    const { readFileSync } = require('fs');
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const at = src.indexOf("req.headers['x-client-info']");
    expect(at).toBeGreaterThan(-1);
    const near = src.slice(Math.max(0, at - 400), at);
    expect(near).toContain("x-mcp-platform");
  });
});
