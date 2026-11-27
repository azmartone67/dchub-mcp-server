// QA 2026-11-26 (P3): keyless /mcp/claude analyze_site answered structuredContent {ok: true,
// error: 'plan_required', site_teaser, ...}: an answered preview that also said it failed, under a code that
// names a plan. /mcp marks the same wall status 'gated_preview' with no `error`. lib/claude-directory.mjs
// claudeWallStatus now does the same on this profile; a real rejection keeps its error, and the shared
// scrub (so /mcp/chatgpt) is unchanged.
import { describe, it, expect } from 'vitest';
import { scrubClaudeToolResult, claudeWallStatus, CLAUDE_PLANS_NOTICE,
  claudeIsGated } from '../lib/claude-directory.mjs';
import { scrubToolResult as scrubChatgptToolResult } from '../lib/chatgpt-directory.mjs';

const SHORT = 'https://dchub.cloud/u/hz254h';
// The raw wall as the backend/edge sends it (error 'pro_required'; the shared scrub maps it).
const wallRaw = (tool = 'analyze_site', extra = {}) => ({
  content: [{ type: 'text', text: 'Site teaser: verdict BUILD.' }],
  structuredContent: { ok: true, error: 'pro_required', tool, _gated: true, _wall: true,
    site_teaser: { verdict: 'BUILD', power_infrastructure: 'BUILD', unlock_url: SHORT },
    human_url: SHORT, show_to_user: true, ...extra },
});
const texts = (r) => (r.content || []).map((c) => c.text);

describe('/mcp/claude: an answered preview carries no error', () => {
  for (const tool of ['analyze_site', 'compare_sites', 'get_market_intel']) {
    it(`${tool}: no error key, status gated_preview, still gated, notice still last`, () => {
      const r = scrubClaudeToolResult(wallRaw(tool), tool);
      const sc = r.structuredContent;
      expect(sc.ok).toBe(true);
      expect('error' in sc, JSON.stringify(sc)).toBe(false);
      expect(sc.status).toBe('gated_preview');
      expect(sc._wall).toBe(true);
      expect(claudeIsGated(r)).toBe(true);
      expect(texts(r).at(-1)).toBe(CLAUDE_PLANS_NOTICE);
      expect(JSON.stringify(r)).not.toMatch(/plan_required|pro_required/);
    });
  }

  it('analyze_site keeps its unlock link and v15 copy', () => {
    const sc = scrubClaudeToolResult(wallRaw(), 'analyze_site').structuredContent;
    expect(sc.human_url).toBe(SHORT);
    expect(sc.copy_version).toBe('v15');
  });

  it('a rejection with no answered data (no ok: true) keeps its error', () => {
    const raw = { content: [{ type: 'text', text: 'not served' }],
      structuredContent: { error: 'pro_required', tool: 'analyze_site' } };
    expect(scrubClaudeToolResult(raw, 'analyze_site').structuredContent.error).toBe('plan_required');
  });

  it('an existing status is kept', () => {
    const out = { structuredContent: { ok: true, error: 'plan_required', status: 'upgrade_required' } };
    expect(claudeWallStatus(out, {}).structuredContent).toEqual({ ok: true, status: 'upgrade_required' });
  });

  it('DCHUB_CLAUDE_WALL_STATUS=0 restores the earlier output', () => {
    const out = { structuredContent: { ok: true, error: 'plan_required' } };
    expect(claudeWallStatus(out, { DCHUB_CLAUDE_WALL_STATUS: '0' })).toBe(out);
    expect(claudeWallStatus(out, {}).structuredContent.error).toBeUndefined();
  });

  it('/mcp/chatgpt is not wired to it: its scrub adds no status', () => {
    const sc = scrubChatgptToolResult(wallRaw(), 'analyze_site').structuredContent;
    expect(sc.status).toBeUndefined();
  });
});
