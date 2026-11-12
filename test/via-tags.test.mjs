// via-tags.test.mjs: directory and partner via tags for the key-mint channel (2026-11-12). Pure unit test.
import { describe, it, expect } from 'vitest';
import { DIRECTORY_VIA_TAGS, DIRECTORY_VIA_ALIASES, OTHER_VIA, directoryViaTag, keyMintVia } from '../lib/via-tags.mjs';

describe('directoryViaTag', () => {
  it('names every directory and partner the owner listed', () => {
    for (const t of ['glama', 'smithery', 'pulsemcp', 'mcpso', 'mcpmarket', 'context7', 'docker', 'arcade', 'muse',
      'registry', 'pipeworx', 'anythingmcp', 'airbyte', 'filament']) {
      expect(DIRECTORY_VIA_TAGS, t).toContain(t);
      expect(directoryViaTag(t)).toBe(t);
    }
  });
  it('resolves aliases and is case-insensitive', () => {
    expect(directoryViaTag('mcp.so')).toBe('mcpso');
    expect(directoryViaTag('MCP-Market')).toBe('mcpmarket');
    expect(directoryViaTag('official-registry')).toBe('registry');
    for (const [a, t] of Object.entries(DIRECTORY_VIA_ALIASES)) expect(DIRECTORY_VIA_TAGS, a).toContain(t);
  });
  it('is null for anything unregistered or not a string', () => {
    for (const v of ['twitter', '', '  ', null, undefined, 42, {}]) expect(directoryViaTag(v)).toBeNull();
  });
});

describe('keyMintVia: bounded, sanitized, falls back to other', () => {
  it('registered tag -> itself; any other name -> other; nothing -> null', () => {
    expect(keyMintVia('glama')).toBe('glama');
    expect(keyMintVia('some-new-site')).toBe(OTHER_VIA);
    expect(keyMintVia('')).toBeNull();
    expect(keyMintVia(null)).toBeNull();
    expect(keyMintVia(undefined)).toBeNull();
  });
  it('the output set is closed: registered tags plus other, never free text', () => {
    const allowed = new Set([...DIRECTORY_VIA_TAGS, OTHER_VIA]);
    for (const v of ['a', 'x'.repeat(40), 'weird.name_1', 'glama.ai', 'mcp.so', 'unknown-partner']) {
      expect(allowed.has(keyMintVia(v)), v).toBe(true);
    }
  });
});
