// The once-per-session email nudge strip left `Ask your human: "" Then make ONE call` on every keyless answer after
// the first (measured live 2026-11-27 on get_gas_intelligence and get_fiber_readiness): the sentence it removes is the
// quoted question of the agent line. The quoted form now becomes a plain ask; the one call it names stays.
import { describe, it, expect } from 'vitest';
import { dailyClaimAgentText } from '../lib/daily-habit.mjs';
import { withEmailAsk } from '../lib/wall-identity-v2.mjs';
import { stripNudge, QUOTED_NUDGE_PLAIN } from '../lib/email-nudge-once.mjs';

// The agent line exactly as a keyless answer carries it: daily-habit builds it, wall-identity-v2 rewrites the sentence.
const shipped = (market) => withEmailAsk({ content: [{ type: 'text', text: dailyClaimAgentText(market) }] }, market);

describe('stripping the nudge from the quoted agent line', () => {
  for (const market of ['', 'dallas']) {
    it(`leaves no empty quotes and keeps the one call (market=${market || 'none'})`, () => {
      const before = shipped(market).content[0].text;
      expect(before).toMatch(/^Ask your human: "Share an email with get_api_key/);   // non-vacuity: the real input
      const after = stripNudge(shipped(market)).content[0].text;
      expect(after).not.toContain('""');
      expect(after).not.toContain('Share an email with get_api_key to keep this answer');
      expect(after.startsWith(QUOTED_NUDGE_PLAIN + ' ONE call, `')).toBe(true);   // the key tool's name is the server's
      expect(after).toContain('Send that key as the X-API-Key header.');
    });
  }

  it('the same line inside a JSON text block and structuredContent is fixed too', () => {
    const line = shipped('dallas').content[0].text;
    const r = { content: [{ type: 'text', text: JSON.stringify({ next: line }) }], structuredContent: { next: line } };
    const out = stripNudge(r);
    expect(JSON.parse(out.content[0].text).next.startsWith(QUOTED_NUDGE_PLAIN)).toBe(true);
    expect(out.structuredContent.next.startsWith(QUOTED_NUDGE_PLAIN)).toBe(true);
  });

  it('the bare sentence elsewhere is still removed as before', () => {
    const s = 'Answer. Share an email with get_api_key to keep this answer and get a daily change note. More.';
    expect(stripNudge({ content: [{ type: 'text', text: s }] }).content[0].text).toBe('Answer. More.');
  });
});
