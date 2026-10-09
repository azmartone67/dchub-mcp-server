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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
  // ★2026-10-09: the docs no longer carry ANY Stripe link (the README / llms-install
  // $10 pack line came out with the DCPI-led listing copy, mcp#861). Zero links is
  // now the intended state, so the old "at least 2 links" floor is gone. What keeps
  // the scan from being vacuous is the control below: the pattern must still catch a
  // link if one is added back, and the offender test then judges its id.
  it('MUST-FAIL CONTROL: the id pattern still catches a pasted Stripe link', () => {
    const hit = [...'pay at https://buy.stripe.com/abc123XYZ now'.matchAll(ID)];
    expect(hit.map((m) => m[1])).toEqual(['abc123XYZ']);
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

// ── served code, not just docs (2026-09-29, fix/checkout-links-canonical) ────
//
// The doc scan above trusts `canonicalIds()`, and that set is partly
// SELF-REFERENTIAL: it accepts whatever id the `const DEVELOPER_URL = '…'`
// literal in server.mjs happens to hold. Re-point that literal at a dead or
// retired link and the doc guard widens its own canon to match. Nothing here
// scanned server.mjs or lib/ for a retired id either — only the four docs.
//
// These tests close both holes:
//   1. every buy.stripe.com id in a SERVED file (every tracked file outside
//      test/ and node_modules/) is canonical: the snapshot's stripe_link map
//      (derived from backend GET /api/v1/tiers → routes/_stripe_links.py) plus
//      the one-time pack;
//   2. the server.mjs URL constants equal the snapshot, not merely themselves;
//   3. the known-bad ids (backend tests/test_stripe_link_canonical.py
//      KNOWN_NONCANONICAL_IDS + the retired Pro/founding links) appear in no
//      served code line — comments are history and stay allowed, and the one
//      legacy-attribution key in _GO_PLAN_BY_LINK is inbound-only (it maps a
//      click on an old link already in the wild to a plan; nothing emits it).
const SRC_SERVER = readFileSync(join(ROOT, 'server.mjs'), 'utf8');

// Mirror of backend routes/_stripe_links.py STRIPE_LINKS['metered'] (== 'pack5').
// The pack is not a tier rung, so the /api/v1/tiers snapshot does not carry it;
// this CI has no backend checkout to read it from. Named once, here.
const PACK_ID = '9B69AU08y2FfbSR55UaZi0i';

// Ids that must never be served again. Full ids from the backend's
// tests/test_stripe_link_canonical.py and routes/_stripe_links.py history.
const RETIRED_IDS = {
  '00w28o7BqaXLeP31QIaZi04': 'legacy Pro link (not in any canonical map)',
  '7sY5kE8F4fs13mI0PEaZi0c': 'Developer typo, capital I (Stripe 200 error page)',
  '14k14og7w7Zz9KJ8i6aZi02': 'older Developer link ("$9/mo dev")',
  '6oU00k6wW7ZzcWV9maaZi03': 'unmapped legacy link',
  '8x2dRa5sS6V79KJ3aMaZi0a': 'unmapped legacy link',
  '7sY7sM9J8enX7CB69YaZi0l': 'retired $299/mo Pro link',
  'eVq5kE4oOfs13mleGuaZi0h': 'retired $199/mo Pro link',
  '9B6fZi1cCdjT3ml8i6aZi00': 'retired pre-r-founder99 founding link',
  '00w28s3kK0x7f5355UaZi0k': 'minted-then-deactivated $79 Developer link',
};
// The single sanctioned non-comment occurrence of a retired id.
const LEGACY_ATTRIBUTION_LINE = /^\s*'7sY7sM9J8enX7CB69YaZi0l': 'pro', +\/\/ RETIRED \$299\/mo link — kept for legacy click attribution$/;

const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'coverage']);
const SCAN_EXT = /\.(mjs|js|cjs|json|md|txt|html|ya?ml)$/;

function servedFiles(dir = ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) servedFiles(join(dir, e.name), out); }
    else if (SCAN_EXT.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

function snapshotIds() {
  const snap = JSON.parse(readFileSync(join(ROOT, 'canonical/tier_limits.json'), 'utf8'));
  const ids = new Map();
  for (const [tier, url] of Object.entries(snap.stripe_link || {})) {
    const m = /^https:\/\/buy\.stripe\.com\/([A-Za-z0-9]+)$/.exec(String(url));
    if (m) ids.set(m[1], tier);
  }
  return ids;
}

/** Pure rule: [relPath, text] pairs → offenders (the controls below feed it synthetic lines). */
function servedOffenders(files, canon) {
  const bad = [];
  for (const [rel, text] of files) {
    // Comment syntax is per file type. A markdown `* ` bullet or `# ` heading
    // is served prose, not a comment (and JSON has no comments), so only code/yaml get those.
    const isMd = /\.(md|txt|html|json)$/.test(rel); // no comment syntax at all
    const lineComment = isMd ? /(?!)/ : /^\s*(\*|#)/;
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/buy\.stripe\.com\/([A-Za-z0-9-]+)/g)) {
        const code = line.slice(0, m.index);
        if ((!isMd && /(^|[^:])\/\//.test(code)) || lineComment.test(line)) continue; // inside a comment (`://` is not one)
        if (!canon.has(m[1])) bad.push(`${rel}:${i + 1}  unknown ${m[1]}`);
      }
      for (const [id, why] of Object.entries(RETIRED_IDS)) {
        const at = line.indexOf(id);
        if (at < 0) continue;
        if ((!isMd && /(^|[^:])\/\//.test(line.slice(0, at))) || lineComment.test(line)) continue;
        if (LEGACY_ATTRIBUTION_LINE.test(line)) continue;
        bad.push(`${rel}:${i + 1}  retired ${id} (${why})`);
      }
    });
  }
  return bad;
}

describe('every Stripe link in SERVED code is backend canon', () => {
  const canon = new Map([...snapshotIds(), [PACK_ID, 'metered']]);
  const files = servedFiles().map((f) => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')]);

  it('the snapshot carries the canonical Pro and Developer links', () => {
    // Values of backend routes/_stripe_links.py STRIPE_LINKS at 2026-09-29.
    const ids = snapshotIds();
    expect(ids.get('dRm28s2gGcfP6yx0PEaZi0p')).toBe('pro');
    expect(ids.get('7sY5kE8F4fs13ml0PEaZi0c')).toBe('developer');
    for (const id of Object.keys(RETIRED_IDS)) expect(ids.has(id), `snapshot carries retired ${id}`).toBe(false);
  });

  it('the scan reaches server.mjs, lib/ and the snapshot (floor)', () => {
    const rels = files.map(([r]) => r);
    for (const must of ['server.mjs', 'lib/tier-canon.mjs', 'canonical/tier_limits.json', 'README.md']) {
      expect(rels, `served scan no longer reads ${must}`).toContain(must);
    }
    const n = files.reduce((a, [, t]) => a + [...t.matchAll(/buy\.stripe\.com\/[A-Za-z0-9]/g)].length, 0);
    expect(n, 'served scan found almost no Stripe links — it protects nothing').toBeGreaterThanOrEqual(8);
  });

  it('server.mjs URL constants equal the snapshot, not merely themselves', () => {
    const ids = snapshotIds();
    const devId = [...ids].find(([, t]) => t === 'developer')?.[0];
    const lit = (name) => new RegExp(`const\\s+${name}\\s*=\\s*(?:process\\.env\\.[A-Z0-9_]+\\s*\\|\\|\\s*)?'https://buy\\.stripe\\.com/([A-Za-z0-9]+)'`).exec(SRC_SERVER)?.[1];
    expect(lit('DEVELOPER_URL'), 'DEVELOPER_URL literal not found').toBe(devId);
    expect(lit('METERED_URL'), 'METERED_URL literal not found').toBe(PACK_ID);
    expect(lit('CREDITS_URL'), 'CREDITS_URL literal not found').toBe(PACK_ID);
  });

  it('no served file carries a non-canonical or retired Stripe id', () => {
    const bad = servedOffenders(files, canon);
    expect(bad, 'served Stripe link(s) outside backend canon:\n  ' + bad.join('\n  ')).toEqual([]);
  });

  it('controls: the rule flags the legacy Pro link, the capital-I typo and an unknown id, and passes canon', () => {
    const f = (t) => servedOffenders([['x.mjs', t]], canon);
    expect(f("const PRO = 'https://buy.stripe.com/00w28o7BqaXLeP31QIaZi04';")).toHaveLength(2); // unknown + retired
    expect(f("u = 'https://buy.stripe.com/7sY5kE8F4fs13mI0PEaZi0c'")).toHaveLength(2);
    expect(f("'00w28o7BqaXLeP31QIaZi04': 'pro',")).toHaveLength(1); // bare id in code
    expect(f("u = 'https://buy.stripe.com/zzzNotReal000'")).toHaveLength(1);
    expect(f("u = 'https://buy.stripe.com/dRm28s2gGcfP6yx0PEaZi0p'")).toEqual([]);
    expect(f('// was https://buy.stripe.com/00w28o7BqaXLeP31QIaZi04')).toEqual([]); // history
    // …but in markdown a bullet or heading is served text, not a comment.
    expect(servedOffenders([['README.md', '* Pro → https://buy.stripe.com/00w28o7BqaXLeP31QIaZi04']], canon)).toHaveLength(2);
    expect(f("  '7sY7sM9J8enX7CB69YaZi0l': 'pro',        // RETIRED $299/mo link — kept for legacy click attribution")).toEqual([]);
  });
});
