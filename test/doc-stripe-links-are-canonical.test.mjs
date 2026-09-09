// doc-stripe-links-are-canonical.test.mjs (2026-09-09)
//
// WHY. README.md advertised the Developer plan with
//     https://buy.stripe.com/7sY5kE8F4fs13mI0PEaZi0c
// The canonical link is ...13ml0... — lowercase L. The README carried a
// capital I. server.mjs had ALREADY been corrected (its DEVELOPER_URL comment
// documents the fix: "r88h: was ...13mI0... (capital I) — unified to the
// canonical _stripe_links.py value"). The README was never updated with it.
//
// ★ IT RETURNS HTTP 200. Stripe serves its "Something went wrong — the page
// you were looking for could not be found" page with a 200, so a status-code
// check passes and a link-checker reports it healthy. Verified in a browser
// 2026-09-09: the capital-I link renders that error; the canonical one renders
// "Subscribe to DC Hub Developer $49.00 per month".
//
// This is the highest-cost class of stale doc there is: the README is what
// directories and registries scrape, so a dead checkout propagates outward and
// every reader who clicks it is a lost sale that looks like disinterest.
//
// WHAT THIS PINS. Every buy.stripe.com link in a tracked doc must be one of
// the ids this repo actually treats as canonical — the canonical/tier_limits
// snapshot plus the module-level URL constants in server.mjs. A link that is
// not in that set cannot be verified by anything here and must not ship.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['README.md', 'llms-install.md', 'DATA_QUALITY.md', 'REGISTRY-LISTINGS.md'];
const ID = /buy\.stripe\.com\/([A-Za-z0-9]+)/g;

function canonicalIds() {
  const ids = new Set();
  const snap = JSON.parse(readFileSync(join(ROOT, 'canonical/tier_limits.json'), 'utf8'));
  for (const url of Object.values(snap.stripe_link || {})) {
    const m = /buy\.stripe\.com\/([A-Za-z0-9]+)/.exec(String(url));
    if (m) ids.add(m[1]);
  }
  // The one-time pack and the session-bound consts live in server.mjs, not the
  // tier snapshot — they are not tier rungs.
  const src = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
  for (const m of src.matchAll(/const\s+(?:DEVELOPER_URL|STARTER_URL|CREDITS_URL|METERED_URL)\s*=\s*'https:\/\/buy\.stripe\.com\/([A-Za-z0-9]+)'/g)) {
    ids.add(m[1]);
  }
  return ids;
}

describe('every Stripe link in a tracked doc is canonical', () => {
  // ★ FLOOR. The assertion below is "no offenders". A doc that stops carrying
  // Stripe links at all — renamed, emptied, restructured — would also produce
  // zero offenders and pass while protecting nothing.
  it('the scan still finds Stripe links to check', () => {
    let n = 0;
    for (const d of DOCS) {
      if (!existsSync(join(ROOT, d))) continue;
      n += [...readFileSync(join(ROOT, d), 'utf8').matchAll(ID)].length;
    }
    expect(n, 'no buy.stripe.com links found in any tracked doc — this guard '
      + 'now protects nothing; either the docs changed shape or DOCS is stale').toBeGreaterThanOrEqual(4);
  });

  it('the canonical id set is non-empty', () => {
    expect(canonicalIds().size).toBeGreaterThanOrEqual(4);
  });

  it('no doc links to a non-canonical Stripe id', () => {
    const ok = canonicalIds();
    const bad = [];
    for (const d of DOCS) {
      if (!existsSync(join(ROOT, d))) continue;
      const lines = readFileSync(join(ROOT, d), 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(ID)) {
          if (!ok.has(m[1])) bad.push(`${d}:${i + 1}  ${m[1]}`);
        }
      });
    }
    expect(bad, 'a doc advertises a Stripe link this repo does not treat as '
      + 'canonical. Stripe serves unknown links as a 200 error page, so this '
      + 'will not show up as a broken link — check it in a browser:\n  '
      + bad.join('\n  ')).toEqual([]);
  });

  it('the dead capital-I Developer link never comes back', () => {
    for (const d of DOCS) {
      if (!existsSync(join(ROOT, d))) continue;
      expect(readFileSync(join(ROOT, d), 'utf8'),
        `${d} carries the dead Developer link (…13mI0…, capital I)`)
        .not.toContain('7sY5kE8F4fs13mI0PEaZi0c');
    }
  });
});
