// grok-claude-check-nits-1016.test.mjs — Grok post-reset Claude check, 2026-10-16.
// Nits 0, 1, 3 and 4 (nit 2 is pinned in market-intel-fallback-provisional.test.mjs).
import { describe, it, expect } from 'vitest';
import { CLAUDE_DIRECTORY, CLAUDE_PLANS_NOTICE } from '../lib/claude-directory.mjs';
import { scrubText as chatgptScrubText } from '../lib/chatgpt-directory.mjs';
import { buildFreeDecisionTaste } from '../lib/free-decision-taste.mjs';

const textOf = (r) => r.content.map((c) => c.text).join('\n');

describe('nit 0: /mcp/claude names no plan on a walled tool', () => {
  // The two live lines, as server.mjs proWallAgentMessage and COMPARE_KEYLESS_MESSAGE build them.
  const PRO_WALL = 'analyze_site needs a paid DC Hub plan; this response is a preview. Relay the link.';
  const KEYLESS = 'Without a key, `compare_sites` returns each site verdict band and power band. '
    + 'Scores and figures need a paid DC Hub plan.';
  for (const [name, line] of [['pro wall', PRO_WALL], ['keyless teaser', KEYLESS]]) {
    it(name + ': the plan sentence goes, the gated result ends with the neutral line', () => {
      const out = CLAUDE_DIRECTORY.scrubToolResult({
        content: [{ type: 'text', text: 'Verdict band: CAUTION.\n' + line }],
        structuredContent: { _gated: true, verdict: 'CAUTION', agent_message: line },
      }, 'get_market_intel');
      const all = textOf(out) + JSON.stringify(out.structuredContent);
      expect(all).not.toMatch(/paid DC Hub plan|this response is a preview/i);
      expect(textOf(out)).toMatch(/Verdict band: CAUTION/);
      expect(out.content.at(-1).text).toBe(CLAUDE_PLANS_NOTICE);
    });
  }
});

describe('nit 1: get_grid_intelligence top-level as_of is never the serve time', () => {
  const SERVED = '2026-10-17T00:20:38Z';
  it('headline UNMEASURED: as_of null, serve time moves to retrieved_at', () => {
    const { envelope } = buildFreeDecisionTaste('get_grid_intelligence', { iso: 'MISO', as_of: SERVED });
    expect(envelope.taste.headline.value).toBeNull();
    expect(envelope.as_of).toBeNull();
    expect(envelope.retrieved_at).toBe(SERVED);
    expect(envelope.as_of_basis).toMatch(/^UNMEASURED/);
  });
  it('headline measured: as_of kept, no retrieved_at added', () => {
    const { envelope } = buildFreeDecisionTaste('get_grid_intelligence',
      { iso: 'MISO', as_of: SERVED, demand_mw: 80000, demand_period: '2026-10-16T22' });
    expect(envelope.as_of).toBe(SERVED);
    expect(envelope.retrieved_at).toBeUndefined();
  });
});

describe('nit 3: get_energy_prices taste note names no unnamed page', () => {
  it('drops "the page shows the options"', () => {
    const { envelope } = buildFreeDecisionTaste('get_energy_prices',
      { retail_rates: { avg_cents_kwh: 9.1, latest_period: '2026' }, filter: { state: 'TX' } });
    expect(envelope._taste_note).toBeTruthy();
    expect(envelope._taste_note).not.toMatch(/the page/i);
  });
});

describe('nit 4: US$ is not double-prefixed', () => {
  for (const [label, scrub] of [['claude', CLAUDE_DIRECTORY.scrubText], ['chatgpt', chatgptScrubText]]) {
    it(label + ': "US$70" -> "USD 70", "$70" -> "USD 70"', () => {
      expect(scrub('The service costs US$70 per month.')).toBe('The service costs USD 70 per month.');
      expect(scrub('A US$ 1.2 billion deal.')).toBe('A USD 1.2 billion deal.');
      expect(scrub('A $70 fee.')).toBe('A USD 70 fee.');
    });
  }
});
