// 2026-11-26 (owner): /mcp/claude's analyze_site description said "without one it returns only a notice", stated
// no daily keyless runs, and so carried no exception clause, while /mcp states both (mcp#1781). It now states
// what keyless returns, the daily sentence at the cap the lane runs at, and the shared exception clause from
// lib/tier-canon.mjs; with the lane off or the cap 0 neither sentence is stated.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLAUDE_TOOLS, claudeAnalyzeSiteDescription, CLAUDE_ANALYZE_SITE_LEAD,
  CLAUDE_ANALYZE_SITE_PREVIEW } from '../lib/claude-directory.mjs';
import { ANALYZE_SITE_DAILY_EXCEPTION, analyzeSiteKeylessDailySentence } from '../lib/tier-canon.mjs';

const ON = { DCHUB_KEYLESS_SITE_FULL: '1', DCHUB_KEYLESS_SITE_FULL_CAP: '2' };

describe('/mcp/claude analyze_site description', () => {
  it('lane on: the daily sentence at the cap, then the exception clause, then the preview', () => {
    const d = claudeAnalyzeSiteDescription(ON);
    const daily = analyzeSiteKeylessDailySentence(2);
    expect(daily).toMatch(/first 2 `analyze_site` calls each UTC day/);
    expect(d.startsWith(CLAUDE_ANALYZE_SITE_LEAD)).toBe(true);
    expect(d).toContain(daily + ' ' + ANALYZE_SITE_DAILY_EXCEPTION);
    expect(d.indexOf(ANALYZE_SITE_DAILY_EXCEPTION)).toBeLessThan(d.indexOf(CLAUDE_ANALYZE_SITE_PREVIEW));
    expect(d.endsWith(CLAUDE_ANALYZE_SITE_PREVIEW)).toBe(true);
  });

  it('lane off, or cap 0: no daily sentence and no exception clause', () => {
    for (const env of [{ DCHUB_KEYLESS_SITE_FULL: '0' }, { DCHUB_KEYLESS_SITE_FULL: '1', DCHUB_KEYLESS_SITE_FULL_CAP: '0' }]) {
      const d = claudeAnalyzeSiteDescription(env);
      expect(d, JSON.stringify(env)).not.toContain(ANALYZE_SITE_DAILY_EXCEPTION);
      expect(d, JSON.stringify(env)).not.toMatch(/each UTC day/);
      expect(d).toBe(CLAUDE_ANALYZE_SITE_LEAD + ' Without a DC Hub key it ' + CLAUDE_ANALYZE_SITE_PREVIEW);
    }
  });

  it('the served table carries the built text; the false "only a notice" line is gone from analyze_site only', () => {
    expect(CLAUDE_TOOLS.analyze_site).toBe(claudeAnalyzeSiteDescription());
    expect(CLAUDE_TOOLS.analyze_site).not.toMatch(/only a notice/);
    for (const t of ['compare_sites', 'get_composite_site_score', 'generate_site_analysis']) {
      expect(CLAUDE_TOOLS[t], t).toMatch(/only a notice/);
    }
  });

  it('names no plan or price', () => {
    for (const d of [claudeAnalyzeSiteDescription(ON), claudeAnalyzeSiteDescription({ DCHUB_KEYLESS_SITE_FULL: '0' })]) {
      expect(d).not.toMatch(/\b(Pro|Developer|Starter|Enterprise|Founder)\b|\$\s?\d|\/mo\b|per month/);
    }
  });

  it('one copy of the exception clause: server.mjs imports it from lib/tier-canon.mjs', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).not.toContain("'Those daily runs do not cover every network or client '");
    expect(src).toMatch(/ANALYZE_SITE_DAILY_EXCEPTION, FOUNDING_URL[^}]*\} from '\.\/lib\/tier-canon\.mjs'/);
  });
});
