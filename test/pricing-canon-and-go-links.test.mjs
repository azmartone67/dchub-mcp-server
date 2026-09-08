// pricing-canon-and-go-links.test.mjs — pricing #3 + #7
//
// WAS founding-visible-and-go-links.test.mjs. That file pinned the OPPOSITE
// policy and this is the reversal, kept in one place so the history is legible:
//
//   2026-09-02 (#3): the $99 founding licence — 10 of 14 active external subs,
//     the only plan that sold — was in NO plan list an agent read. Fixed by
//     sourcing every price from canonical/tier_limits.json and leading with
//     Founding.
//   2026-09-05 (r-price-collapse, owner call): measured over 90d of Stripe
//     checkout sessions, EVERY self-serve price above $99 closed 0 of 76.
//     $99 closed 8 of 43. So Pro IS $99 and founding — which was always the
//     same tier at the same price — collapses into it. The scarcity framing
//     ("while seats last") retires with it.
//   2026-09-08: the snapshot had never been updated. server.mjs still quoted
//     Pro $299 and, worse, PRO_URL was a hardcoded literal pointing at the
//     $299 payment link. Verified by loading both live Stripe pages:
//         dRm28s2gGcfP6yx0PEaZi0p -> $99.00 per month
//         7sY7sM9J8enX7CB69YaZi0l -> $299.00 per month   (what we served)
//
// #7 MEASURED 2026-09-02 00:32Z: /upgrade?key=… (three emit sites) 302s to the
//    /pricing WALL (paywall_nointent); only /go/c/<token> reaches Stripe (3/3).
//    The three sites emit key-bound /go/c links (k-/pk- refs the webhook honours).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PLAN_PRICE, FOUNDING_URL, PRO_URL, _priceLabel, _paidPlansLine, _keyBoundSubUrl,
  _keyBoundPackUrl, _keyBoundUpgradeUrl, _keyBoundTiers, _goUrl,
} from '../server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
const SNAP = JSON.parse(readFileSync(join(ROOT, 'canonical/tier_limits.json'), 'utf8'));
const SECRET = 'test-internal-key-not-a-real-secret';
const KEY = 'dch_live_test_key_0001';
const KHASH = createHash('sha256').update(KEY).digest('hex');

// The retired $299 payment link. Named once, here, so a test can assert we
// never point at it again without restating the URL at every call site.
const RETIRED_PRO_299 = 'https://buy.stripe.com/7sY7sM9J8enX7CB69YaZi0l';

let _saved;
beforeEach(() => { _saved = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = SECRET; delete process.env.DCHUB_GO_LINKS; });
afterEach(() => { if (_saved === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = _saved; });

/** Decode a /go/c link the way routes/checkout_click_tracker.py does. */
function decode(url) {
  expect(url.startsWith('https://dchub.cloud/go/c/')).toBe(true);
  const token = url.replace('https://dchub.cloud/go/c/', '');
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  expect(createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32)).toBe(sig);
  const [plan, ref] = Buffer.from(payload, 'base64url').toString().split('|');
  return { plan, ref };
}

describe('#3 — every price is sourced, and Pro is the $99 that sells', () => {
  it('the snapshot prices Pro at 99 and PLAN_PRICE mirrors the snapshot', () => {
    expect(SNAP.price_usd_month.pro).toBe(99);
    expect(PLAN_PRICE).toEqual(SNAP.price_usd_month);
    expect(_priceLabel('pro')).toBe('$' + SNAP.price_usd_month.pro + '/mo');
  });
  it('founding is retired as a RUNG — no price, so no copy can quote one', () => {
    expect(SNAP.price_usd_month.founding).toBeUndefined();
    expect(_priceLabel('founding')).toBe(null);
    // ★ The LINK survives on purpose: 10 existing founding subscriptions and
    // every founding /go link already in the wild still have to resolve and
    // still have to attribute. Retiring the offer is not deleting the SKU.
    expect(typeof FOUNDING_URL).toBe('string');
  });
  it('the published pricing envelope drops founding_usd_month entirely', () => {
    // server.mjs spreads founding_usd_month in only when the rung has a finite
    // price. With founding retired that spread must contribute NOTHING — the
    // field disappears rather than publishing null, which would read to an
    // agent as "a founding tier exists, price unknown".
    expect(Number.isFinite(PLAN_PRICE.founding)).toBe(false);
    const envelope = {
      ...(Number.isFinite(PLAN_PRICE.founding) ? { founding_usd_month: PLAN_PRICE.founding } : {}),
      developer_usd_month: PLAN_PRICE.developer,
      pro_usd_month: PLAN_PRICE.pro,
    };
    expect(envelope).toEqual({ developer_usd_month: 49, pro_usd_month: 99 });
    expect('founding_usd_month' in envelope).toBe(false);
  });
  it('the paid-plans line offers Developer and Pro, and never mentions Founding', () => {
    const line = _paidPlansLine();
    expect(line).toContain('Developer $' + SNAP.price_usd_month.developer + '/mo');
    expect(line).toContain('Pro $' + SNAP.price_usd_month.pro + '/mo');
    expect(line).not.toMatch(/founding/i);
    expect(line).not.toMatch(/seats last/i);
  });
  it('no price is a literal in server.mjs code (49, 99, 299 appear only via the canon)', () => {
    // code only: drop comment lines AND trailing `// …` tails (the Stripe link
    // table annotates each link with its price — history, not a claim).
    const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\* )/.test(l)).map((l) => l.replace(/\s\/\/.*$/, ''));
    const bad = code.filter((l) => /\$(?:49|99|299)\/mo/.test(l) || /(?:developer|pro|founding)_usd_month:\s*\d/.test(l));
    expect(bad.map((l) => l.trim().slice(0, 100))).toEqual([]);
  });
  it('the checkout ladder offers pro and no longer offers founding', () => {
    expect(SRC).toMatch(/\{ id: 'pro', +label: _priceLabel\('pro'\)/);
    expect(SRC).not.toMatch(/id: 'founding'/);
    expect(SRC).toContain("'[Paid plans — ' + _paidPlansLine() + '](https://dchub.cloud/pricing'");
  });
});

describe('#3b — the Pro checkout link is the $99 one, read from the snapshot', () => {
  it('PRO_URL comes from the snapshot, not a literal in server.mjs', () => {
    expect(PRO_URL).toBe(SNAP.stripe_link.pro);
    // The defect this pins: `const PRO_URL = 'https://buy.stripe.com/…'`.
    expect(SRC).not.toMatch(/^const PRO_URL *=/m);
  });
  it('PRO_URL is NOT the retired $299 payment link', () => {
    expect(PRO_URL).not.toBe(RETIRED_PRO_299);
    expect(SNAP.stripe_link.pro).not.toBe(RETIRED_PRO_299);
  });
});

describe('#7 — every key-bound upgrade link pays, and is measured', () => {
  it('no code line in server.mjs emits /upgrade?key= any more', () => {
    const bad = SRC.split('\n').map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => !/^\s*\/\//.test(l) && l.includes('dchub.cloud/upgrade?key='));
    expect(bad.map((b) => 'server.mjs:' + b.n)).toEqual([]);
  });
  it('a subscription link binds k-<sha256(key)> and names the plan, never a URL', () => {
    const got = decode(_keyBoundSubUrl(PRO_URL, KEY));
    expect(got.plan).toBe('pro');
    expect(got.ref).toBe('k-' + KHASH);
    expect(got.plan).not.toMatch(/https?:|stripe|\//);
  });
  it('the pack link binds pk-<sha256(key)> to the metered plan', () => {
    const got = decode(_keyBoundPackUrl(KEY));
    expect(got.plan).toBe('metered');
    expect(got.ref).toBe('pk-' + KHASH);
  });
  it('the single upgrade link is Pro — NOT founding, and never Developer', () => {
    expect(decode(_keyBoundUpgradeUrl(KEY)).plan).toBe('pro');
  });
  it('the tier map is starter/developer/pro — founding is not offered', () => {
    const t = _keyBoundTiers(KEY);
    expect(Object.keys(t)).toEqual(['starter', 'developer', 'pro']);
    for (const [plan, url] of Object.entries(t)) {
      const got = decode(url);
      expect(got.plan).toBe(plan);
      expect(got.ref).toBe('k-' + KHASH);
    }
  });
  it('fails OPEN to the direct Stripe link without a signing secret — never to a wall', () => {
    delete process.env.DCHUB_INTERNAL_KEY;
    const u = _keyBoundSubUrl(PRO_URL, KEY);
    expect(u.startsWith(PRO_URL)).toBe(true);
    expect(u).toContain('client_reference_id=k-' + KHASH);
    expect(u).not.toContain('/upgrade?');
  });
  it('the three former /upgrade?key= sites now call the key-bound builders', () => {
    expect(SRC).toContain('? _keyBoundUpgradeUrl(redeemed.api_key)');
    expect(SRC).toContain('const upgradeUrl = _keyBoundUpgradeUrl(mint.api_key);');
    expect(SRC).toContain('const _tiers = _keyBoundTiers(ctx.api_key);');
    expect(SRC).toContain('const _packKeyUrl = _keyBoundPackUrl(ctx.api_key);');
  });
  it('_goUrl knows BOTH pro links — the live one and the retired one', () => {
    // The retired link stays mapped so a click on one already in the wild is
    // still attributed instead of passing through unmeasured.
    expect(decode(_goUrl(PRO_URL + '?client_reference_id=k-x')).plan).toBe('pro');
    expect(decode(_goUrl(RETIRED_PRO_299 + '?client_reference_id=k-x')).plan).toBe('pro');
  });
  it('_goUrl still knows the founding link (legacy subs keep attributing)', () => {
    expect(decode(_goUrl(FOUNDING_URL + '?client_reference_id=k-x')).plan).toBe('founding');
  });
});
