// Grok 2026-10-06 item 2: the OAuth route returns identity.tier so a signed-in
// user can verify the account from ChatGPT. The frozen /mcp/chatgpt never does.
import { describe, it, expect } from 'vitest';
import { transformDirectoryMessage } from '../lib/chatgpt-directory.mjs';

const raw = (identity) => ({ jsonrpc: '2.0', id: 1, result: {
  content: [{ type: 'text', text: 'ok' }],
  structuredContent: { rows: [1], identity: { ...identity, credential_source: 'header', key_prefix: 'dch_live_abc', quota: { left: 3 } } },
} });

describe('oauth identity.tier', () => {
  it('adds only the tier on the OAuth route', () => {
    const m = transformDirectoryMessage(raw({ tier: 'pro' }), 'tools/call', 'site_selection_canvas', { identity: true });
    expect(m.result.structuredContent.identity).toEqual({ tier: 'pro', credential_source: 'oauth' });
    expect(JSON.stringify(m)).not.toMatch(/dch_live|quota/);
  });
  it('never adds identity on the frozen directory route', () => {
    const m = transformDirectoryMessage(raw({ tier: 'pro' }), 'tools/call', 'site_selection_canvas');
    expect(m.result.structuredContent.identity).toBeUndefined();
  });
  it('omits identity when the tier is unknown or malformed', () => {
    const m = transformDirectoryMessage(raw({ tier: 'x y; drop' }), 'tools/call', 'site_selection_canvas', { identity: true });
    expect(m.result.structuredContent.identity).toBeUndefined();
  });
});
