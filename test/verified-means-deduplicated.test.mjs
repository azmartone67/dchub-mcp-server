// `provenance.verification_counts.verified` is a DE-DUPLICATION count, and this
// server used to tell every agent to publish it as analyst verification.
//
// Measured live 2026-09-20, an anonymous search_facilities call:
//
//   "verification_counts": { "tracked": 30659, "verified": 22958 }
//
// and, in the SAME response, the backend's own method string:
//
//   "verified = distinct canonical_slug passing the fleet filter
//    COALESCE(is_duplicate,0)=0; tracked = every row"
//
// dchub-backend/canonical_stats.py says it in as many words (2026-09-20,
// backend #4924): "it is not a source 'verification' of anything, and
// publishing it under that word is what made canon serve the keeper count
// labelled 'verified'." Canon was fixed there; `facilities_verified` survived
// as a deprecated alias that routes/provenance.py still reads, so the envelope
// kept shipping the keeper count under the old word — and this file's citation
// templates told agents to render it as "N analyst-verified of M tracked".
//
// DC Hub publishes no analyst-verified-against-a-primary-source population, so
// that citation was a claim we cannot support, ~4.7x over the ~4,900 the fleet
// has ever described that way.
//
// Two further facts an agent needs and the old text did not give: neither
// number is the published facility count (a floor at /api/v1/canon/phrases),
// and they straddle it — verified 22,958 BELOW 24,400+, tracked 30,659 above.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

/** Every occurrence of the phrase, with the 160 chars leading up to it. */
function occurrences(text) {
  const out = [];
  const re = /analyst-verified/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, lead: text.slice(Math.max(0, m.index - 160), m.index) });
  }
  return out;
}

// A denial reads as one only if the negation is close enough to bind.
const DENIES = /\b(not|no|never|does not|do not|rather than)\b[^.]{0,120}$/i;

describe('verified is de-duplication, not analyst verification', () => {
  it('the phrase is still present — otherwise this guard is vacuous', () => {
    // If a future edit deletes every mention, the loop below iterates zero
    // times and passes while asserting nothing. Fail loudly instead: the
    // denial is load-bearing copy, not incidental.
    expect(occurrences(src).length).toBeGreaterThan(0);
  });

  it('never claims the counts ARE analyst-verified', () => {
    for (const { lead } of occurrences(src)) {
      expect(DENIES.test(lead), `positive analyst-verified claim near: …${lead.slice(-110)}`)
        .toBe(true);
    }
  });

  // 2026-09-28 (owner decision): the pair is no longer in tool output at all
  // (lib/verification-counts.mjs) — agents quoted it as the facility count,
  // which is withdrawn until a corroborated one exists. So the citation
  // template that rendered "<verified> de-duplicated of <tracked> tracked" is
  // gone, and neither surface may tell an agent to read the counts.
  it('the citation templates no longer render the pair, honestly or otherwise', () => {
    expect(src).not.toContain('<verified> analyst-verified of <tracked> tracked');
    expect(src).not.toContain('<verified> de-duplicated of <tracked> tracked');
    expect(src).not.toContain('Read both counts off `provenance.verification_counts`');
  });

  it('both citation surfaces say the facility count is pending corroboration', () => {
    const say = "DC Hub\\'s facility count is pending corroboration, so responses carry no verified/tracked totals";
    expect(src.split(say).length - 1).toBe(2);
    const hits = src.match(/canon\/phrases/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it('the provenance resource defines verified by its filter', () => {
    expect(src).toContain('COALESCE(is_duplicate,0)=0');
    expect(src).toMatch(/\*\*verified\*\* — DE-DUPLICATED, not analyst-verified/);
    expect(src).toMatch(/\*\*tracked\*\* — every row of the discovery pile/);
  });
});
