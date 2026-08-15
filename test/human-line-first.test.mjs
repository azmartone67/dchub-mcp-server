// r-human-first (2026-08-15, conversion item 1) — relay-delivery prose
// hardening.
//
// MEASURED (2026-08-15, adversarially verified): zero /relay or /upgrade/h
// URLs have EVER been fetched by anything — the link dies inside the agent's
// context because it rides as a TRAILING line and summarization eats trailing
// lines first. The fix is placement, not mechanics: the ONE human link becomes
// the FIRST line of the prose in high-intent / paywall / auto-trial-exhausted
// responses, as a short self-contained markdown line built to be quoted
// verbatim, with an explicit instruction sentence. Exactly ONE such line per
// response; no competing CTA precedes it.
//
// These tests pin the two invariants BY BEHAVIOR on the exported composer,
// plus source-level pins that the response sites actually route through it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildHumanFirstLine, composeHumanFirst, HUMAN_FIRST_MARKER } from '../server.mjs';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

const URL_H = 'https://dchub.cloud/upgrade/h/payload.sig';
const URL_RELAY = 'https://dchub.cloud/relay/tok-human';

describe('human line is FIRST', () => {
  it('the composed response text STARTS with the human line (link included)', () => {
    const out = composeHumanFirst(URL_H, '## 🔒 `analyze_site` is a paid feature\n\n👤 **Tell your human:** $10 …');
    expect(out.startsWith(HUMAN_FIRST_MARKER)).toBe(true);
    // the link is on the FIRST line, before any competing CTA
    const firstLine = out.split('\n')[0];
    expect(firstLine).toContain(URL_H);
    expect(out.indexOf(HUMAN_FIRST_MARKER)).toBeLessThan(out.indexOf('Tell your human'));
  });

  it('the line is one short self-contained markdown line + a verbatim-relay instruction', () => {
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
    expect(line).toMatch(/VERBATIM/);           // the explicit relay instruction
    expect(line.toLowerCase()).toContain('first line of');
  });

  it('no URL → body byte-identical (no empty scaffold emitted)', () => {
    const body = 'preview text';
    expect(composeHumanFirst(null, body)).toBe(body);
    expect(composeHumanFirst(undefined, body)).toBe(body);
    expect(composeHumanFirst('', body)).toBe(body);
    expect(buildHumanFirstLine(null)).toBe('');
  });
});

describe('human line is UNIQUE per response', () => {
  it('composing over a body that already carries the line does NOT stack a second', () => {
    const once = composeHumanFirst(URL_H, 'body');
    const twice = composeHumanFirst(URL_RELAY, once);
    expect(twice).toBe(once);
    const count = twice.split(HUMAN_FIRST_MARKER).length - 1;
    expect(count).toBe(1);
  });

  it('the marker is a single stable string shared by builder and dedupe check', () => {
    expect(buildHumanFirstLine(URL_H).startsWith(HUMAN_FIRST_MARKER)).toBe(true);
  });
});

describe('response sites route through the composer (source pins)', () => {
  it('trial_taste_inline / trial_preview / blocked_paid_only / metered wall all compose human-first', () => {
    // one definition + at least 4 call sites
    const uses = (SRC.match(/composeHumanFirst\(/g) || []).length;
    expect(uses).toBeGreaterThanOrEqual(5);
    // the preview + blocked sites prefer the durable /relay human link
    expect(SRC).toContain("(_hiClaim && _hiClaim.human_url)");
    expect(SRC).toContain("(_hiClaim2 && _hiClaim2.human_url)");
    // both hoisted paywall-extras spreads reuse the SAME minted object (no
    // second token minted for the prose)
    expect(SRC).toContain('..._pwx,');
    expect(SRC).toContain('..._pwx2,');
  });

  it('buildHighIntentClaimBlock no longer appends a trailing human line', () => {
    // the retired carrier: '👤 Show your human their own link'
    expect(SRC).not.toContain('Show your human their own link');
  });
});
