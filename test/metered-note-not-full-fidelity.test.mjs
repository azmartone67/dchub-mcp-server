import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { meteredTrialNote } from '../lib/metered-note.mjs';
import { detectGating } from '../lib/attribution.mjs';

// Live 2026-10-07: get_market_intel list, free tier: 10 of 132 markets (locked 122) and the
// note said "Full-fidelity trial answer 1 of 2 today".
const base = { call: 1, cap: 2, name: 'get_market_intel', bound: false };

describe('meteredTrialNote', () => {
  it('untouched answer: the exact legacy wording (trial and plan arms)', () => {
    expect(meteredTrialNote({ ...base, paidTaste: false, limited: false })).toBe(
      'Full-fidelity trial answer 1 of 2 today — keep or summarize these results for your human. '
      + 'After the last free call this tool returns a preview with one-click payment options '
      + '($10 one-time = 1,000 credits; free: bind_email lifts your daily cap).');
    expect(meteredTrialNote({ ...base, paidTaste: false, limited: false, bound: true })).toMatch(/1,000 credits\)\.$/);
    expect(meteredTrialNote({ ...base, paidTaste: true, limited: false })).toBe(
      'Full-fidelity answer 1 of the 2 included with your plan today on this tool. '
      + 'Unlimited full `get_market_intel` depth comes with DC Hub Developer — relay the link in human_url to your human.');
  });
  it('a tier-limited answer never says full-fidelity and says it is not the complete dataset', () => {
    for (const paidTaste of [false, true]) {
      const n = meteredTrialNote({ ...base, paidTaste, limited: true });
      expect(n).not.toMatch(/full-fidelity/i);
      expect(n).toMatch(/tier-limited/);
      expect(n).toMatch(/not present it as the complete dataset/);
      expect(n).toMatch(/1 of (the )?2/);
    }
  });
  it('the market-list payload IS detected as limited (so the server picks the limited note)', () => {
    const g = detectGating({ count: 10, total: 132, locked: 122, data: new Array(10).fill({}) });
    expect(g && g.withholding_proven).toBe(true);
    // control: an untrimmed payload is not limited
    expect(detectGating({ count: 3, total: 3, data: [1, 2, 3] })).toBeNull();
  });
});

describe('server.mjs builds the note through the helper', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  it('calls _meteredTrialNote with a gating-derived limited flag, and no inline Full-fidelity string remains', () => {
    expect(SRC).toContain('note: _meteredTrialNote({');
    expect(SRC).toMatch(/limited:[^\n]*_attrDetectGating\(_mtParsed\)/);
    expect(SRC).not.toContain("'Full-fidelity");
  });
});
