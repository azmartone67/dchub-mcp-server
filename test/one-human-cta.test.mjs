// r-one-human-cta (2026-09-03) — r-handoff's "ONE free taste + ONE human CTA"
// invariant, enforced at the last assembly point instead of in five emitters
// that cannot see each other.
//
// Measured live, anonymous rank_markets, 2026-09-03: 3,097 chars — 36% data,
// 64% CTA, THREE human asks, and the same 114-char signed checkout URL emitted
// twice. The old dedupe was keyed on ONE literal marker, so a second ask
// phrased '👤 **Tell your human:**' walked past the '→ **For your human:**'
// check.
import { describe, it, expect } from 'vitest';
import {
  composeHumanCta, HUMAN_FIRST_MARKER, _hasHumanCta, _dropRepeatCheckoutUrls,
} from '../server.mjs';

const URL_A = 'https://dchub.cloud/go/c/bWV0ZXJlZHxhLWE3NzAyZjQw.1d7794561298b7d4';
const URL_B = 'https://dchub.cloud/go/c/ZGlmZmVyZW50fGItOTk5.ffffffffffffffff';

describe('_hasHumanCta — every phrasing, not just the marker', () => {
  it('recognises the marker', () => {
    expect(_hasHumanCta(`${HUMAN_FIRST_MARKER} open https://x`)).toBe(true);
  });
  it('THE BUG: recognises the 👤 ask that used to walk past the check', () => {
    expect(_hasHumanCta('\u{1F464} **Tell your human:** to keep `rank_markets` — $10')).toBe(true);
  });
  it('recognises the paywall gap line', () => {
    expect(_hasHumanCta('🔒 Free tier: 3 of 10 shown. your human unlocks in one click')).toBe(true);
  });
  it('says no on data-only prose, and on junk input', () => {
    expect(_hasHumanCta('{"market":"ashburn-va","total_mw":5793}')).toBe(false);
    for (const junk of [undefined, null, 42, {}, []]) expect(_hasHumanCta(junk)).toBe(false);
  });
});

describe('_dropRepeatCheckoutUrls — keep the first, drop exact repeats', () => {
  it('drops the SECOND line carrying the same URL', () => {
    const out = _dropRepeatCheckoutUrls(
      `🔒 Free tier: 3 of 10 shown — your human unlocks → ${URL_A}\n` +
      `data line\n` +
      `\u{1F464} **Tell your human:** $10 = 1,000 calls → ${URL_A}\n`);
    expect(out.split('\n').filter((l) => l.includes(URL_A)).length).toBe(1);
    expect(out).toContain('🔒 Free tier');      // the FIRST ask survives
    expect(out).toContain('data line');          // data untouched
    expect(out).not.toContain('Tell your human');// the repeat is gone
  });

  it('NEVER removes a URL that appears only once', () => {
    const t = `ask one → ${URL_A}\nask two → ${URL_B}\n`;
    expect(_dropRepeatCheckoutUrls(t)).toBe(t);
  });

  it('keeps every line when there is no checkout URL at all', () => {
    const t = 'pure data\nmore data\n';
    expect(_dropRepeatCheckoutUrls(t)).toBe(t);
  });

  it('a line holding a repeat AND a fresh URL is KEPT (never lose a new link)', () => {
    const out = _dropRepeatCheckoutUrls(`first → ${URL_A}\nboth → ${URL_A} and ${URL_B}\n`);
    expect(out).toContain(URL_B);
    expect(out.split('\n').length).toBe(3);
  });

  it('survives junk input', () => {
    for (const junk of [undefined, null, 42, {}]) expect(_dropRepeatCheckoutUrls(junk)).toBe('');
  });
});

describe('composeHumanCta — the invariant end to end', () => {
  const live = `{"market":"ashburn-va","total_mw":5793}\n\n---\n` +
    `🔒 **Free tier: 3 of 10 results shown.** your human unlocks in one click → ${URL_A}\n\n` +
    `✅ **Free trial key — works instantly**\n\n` +
    `\u{1F464} **Tell your human:** to keep it past the trial — $10 → ${URL_A}\n`;

  it('THE FIX: does not append a third ask, and drops the duplicate URL', () => {
    const out = composeHumanCta('https://dchub.cloud/upgrade/h/tok', live);
    expect(out).not.toContain(HUMAN_FIRST_MARKER);                 // no 3rd ask appended
    expect(out.split('\n').filter((l) => l.includes(URL_A)).length).toBe(1);
    expect(out).toContain('"total_mw":5793');                      // data intact
    expect(out).toContain('Free trial key');                       // value demo intact
    expect(out.length).toBeLessThan(live.length);
  });

  it('a body with NO human ask still GETS one — the CTA is not removed', () => {
    const dataOnly = '{"market":"ashburn-va","total_mw":5793}\n';
    const out = composeHumanCta('https://dchub.cloud/upgrade/h/tok', dataOnly);
    expect(out).toContain(HUMAN_FIRST_MARKER);
    expect(out).toContain('"total_mw":5793');
  });

  it('no humanUrl → body returned, still deduped, never thrown', () => {
    const out = composeHumanCta(null, live);
    expect(out).not.toContain(HUMAN_FIRST_MARKER);
    expect(out).toContain('"total_mw":5793');
  });

  it('a non-string body degrades to the CTA alone rather than throwing', () => {
    // the body coerces to '', which carries no ask — so the CTA is still owed.
    const out = composeHumanCta('https://dchub.cloud/upgrade/h/tok', undefined);
    expect(typeof out).toBe('string');
    expect(out).toContain(HUMAN_FIRST_MARKER);
    expect(() => composeHumanCta(null, {})).not.toThrow();
  });
});
