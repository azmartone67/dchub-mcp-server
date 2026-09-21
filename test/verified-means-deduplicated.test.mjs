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

  it('the citation templates render the honest word', () => {
    expect(src).toContain('<verified> de-duplicated of <tracked> tracked');
    expect(src).not.toContain('<verified> analyst-verified of <tracked> tracked');
  });

  it('both citation surfaces say the pair is not the facility count', () => {
    // The floor lives at /api/v1/canon/phrases; verified sits below it and
    // tracked above it, so an agent that reads either as "how many facilities
    // DC Hub has" publishes a number no other DC Hub surface agrees with.
    const hits = src.match(/canon\/phrases/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/Neither number is the facility COUNT/);
  });

  it('the provenance resource defines verified by its filter', () => {
    expect(src).toContain('COALESCE(is_duplicate,0)=0');
    expect(src).toMatch(/\*\*verified\*\* — DE-DUPLICATED, not analyst-verified/);
    expect(src).toMatch(/\*\*tracked\*\* — every row of the discovery pile/);
  });
});
