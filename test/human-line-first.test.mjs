// r-human-first (2026-08-15) → r-data-first (2026-08-26) — relay-delivery prose
// placement.
//
// 08-15 MEASURED that zero /relay or /upgrade/h URLs had ever been fetched, and
// concluded the cause was PLACEMENT: the link rode as a trailing line and
// summarization eats trailing lines first. So it was hoisted to line 1 of every
// gated response.
//
// 08-26 MEASURED THE HOIST ITSELF, over the 14 days since it shipped, via
// GET /api/v1/mcp/conversion-funnel?days=14 — which excludes our own QA with the
// canonical real-UA predicate (the raw relay_opens table shows a flat 6-7/day,
// which is the probe, not humans):
//
//     5,704 paywall signals  ->  1 real handoff open  ->  0 converted
//
// One open on five thousand offers is not a working mechanism. Placement was not
// what was killing the link, so leading with it bought nothing — while costing
// the first thing an agent reads when deciding whether to keep using this
// server. The same anonymous rank_markets response measured 66% CTA by
// character with the JSON starting on line 3.
//
// So the line moved to the END and the data leads. What did NOT move: the marker
// string (published in the server instructions and partner docs — agents match
// on it), the verbatim-relay instruction, and exactly-one-per-response. Note the
// instruction still says "first line of your final answer": that is about the
// AGENT'S answer to its human, and it was never a claim about our own envelope.
// F7 (owner 2026-10-03): that instruction is no longer text. The follower line is gone
// and the relay ask is data (structuredContent.user_message + show_to_user); the marker,
// the line and exactly-one-per-response are unchanged.
//
// These tests pin the invariants BY BEHAVIOR on the exported composer, plus
// source-level pins that the response sites actually route through it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildHumanFirstLine, composeHumanCta, HUMAN_FIRST_MARKER } from '../server.mjs';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

const URL_H = 'https://dchub.cloud/upgrade/h/payload.sig';
const URL_RELAY = 'https://dchub.cloud/relay/tok-human';
const DATA = '{"markets":[{"slug":"northern-virginia","dcpi":91}],"_markets_total_in_pro":300}';

describe('data is FIRST, the human line TRAILS it', () => {
  it('the composed response text STARTS with the data, not with a CTA', () => {
    const out = composeHumanCta(URL_H, DATA);
    expect(out.startsWith(DATA)).toBe(true);
    // the payload is on line 1 — this is the whole point of r-data-first
    expect(out.split('\n')[0]).toBe(DATA);
    expect(out.indexOf(DATA)).toBeLessThan(out.indexOf(HUMAN_FIRST_MARKER));
  });

  it('the human line is still THERE, in full, with its link', () => {
    const out = composeHumanCta(URL_H, DATA);
    expect(out).toContain(HUMAN_FIRST_MARKER);
    expect(out).toContain(URL_H);
    // F7 (owner 2026-10-03): the relay instruction is data (user_message / show_to_user,
    // set by _humanLineToStructured), not a "_Agent: … VERBATIM" follower in the text.
    expect(out).not.toMatch(/VERBATIM/);
  });

  it('the CTA does not out-weigh the data it trails', () => {
    // The measured defect was 66% CTA by CHARACTER on a real anonymous
    // response. Pin the ratio, not just the order: re-stacking three CTA
    // paragraphs after the data would satisfy an order-only check.
    const out = composeHumanCta(URL_H, DATA);
    const ctaChars = out.length - DATA.length;
    expect(ctaChars).toBeLessThan(600);
  });

  it('the line is one short self-contained markdown line, with no VERBATIM follower (F7)', () => {
    const line = buildHumanFirstLine(URL_RELAY);
    const first = line.split('\n')[0];
    expect(first).toMatch(/^→ \*\*For your human:\*\* open https:\/\/dchub\.cloud\//);
    expect(first).toContain('unlock');          // says what the link does
    expect(first.length).toBeLessThan(200);     // quotable, not a paragraph
    // HONESTY (2026-08-15 review): the line rides ALL gated branches, where the
    // link shows what was found + purchase options — it does not unlock
    // on open, and no measurement backs a duration claim. Ban both.
    expect(first).not.toContain('30-second');
    expect(first).not.toMatch(/\d+[- ]second/);
    expect(first.toLowerCase()).toContain('see what your agent found');
    // F7 (owner 2026-10-03): the "_Agent: include the line above VERBATIM … first line of
    // your final answer" follower is gone; the line is carried as data instead
    // (structuredContent.user_message, show_to_user: true — _humanLineToStructured).
    expect(line).not.toMatch(/VERBATIM/);
    expect(line.trim().split('\n')).toHaveLength(1);
  });

  it('no URL → body byte-identical (no empty scaffold emitted)', () => {
    const body = 'preview text';
    expect(composeHumanCta(null, body)).toBe(body);
    expect(composeHumanCta(undefined, body)).toBe(body);
    expect(composeHumanCta('', body)).toBe(body);
    expect(buildHumanFirstLine(null)).toBe('');
  });
});

describe('human line is UNIQUE per response', () => {
  it('composing over a body that already carries the line does NOT stack a second', () => {
    const once = composeHumanCta(URL_H, DATA);
    const twice = composeHumanCta(URL_RELAY, once);
    expect(twice).toBe(once);
    const count = twice.split(HUMAN_FIRST_MARKER).length - 1;
    expect(count).toBe(1);
  });

  it('the marker is a single stable string shared by builder and dedupe check', () => {
    expect(buildHumanFirstLine(URL_H).startsWith(HUMAN_FIRST_MARKER)).toBe(true);
  });

  it('the marker VALUE is frozen — agents and partner docs match on it', () => {
    // Changing the placement was safe; changing this string is not. It is
    // published in the initialize instructions and in partner integration docs
    // as the thing to look for.
    expect(HUMAN_FIRST_MARKER).toBe('→ **For your human:**');
    expect(SRC).toContain('carries a prose line beginning "→ **For your human:**"');
  });
});

describe('response sites route through the composer (source pins)', () => {
  it('trial_taste_inline / trial_preview / blocked_paid_only / metered wall all compose the CTA', () => {
    // one definition + at least 4 call sites
    const uses = (SRC.match(/composeHumanCta\(/g) || []).length;
    expect(uses).toBeGreaterThanOrEqual(5);
    // the preview + blocked sites prefer the durable /relay human link
    expect(SRC).toContain("(_hiClaim && _hiClaim.human_url)");
    expect(SRC).toContain("(_hiClaim2 && _hiClaim2.human_url)");
    // both hoisted paywall-extras spreads reuse the SAME minted object (no
    // second token minted for the prose)
    expect(SRC).toContain('..._pwx,');
    expect(SRC).toContain('..._pwx2,');
  });

  it('the trial CTA composer also emits data before CTA', () => {
    // phase9L_clean_preview is the other half of the gated envelope: it joins
    // the trial payload to the upgrade CTA. If it ever goes back to
    // `cta + body`, the data stops leading no matter what composeHumanCta does.
    const fn = SRC.slice(SRC.indexOf('function phase9L_clean_preview('));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/return s\.replace\(\/\\s\*\$\/, ''\) \+ '\\n\\n---\\n\\n' \+ cta;/);
    expect(body).not.toMatch(/return cta \+ s;/);
  });

  it('buildHighIntentClaimBlock no longer appends a trailing human line', () => {
    // the retired carrier: '👤 Show your human their own link'
    expect(SRC).not.toContain('Show your human their own link');
  });
});
