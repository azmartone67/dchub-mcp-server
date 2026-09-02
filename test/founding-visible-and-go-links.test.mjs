// founding-visible-and-go-links.test.mjs — QA sweep 2026-09-02, pricing #3 + #7
//
// #3 MEASURED 00:33Z: the $99 founding licence — 10 of 14 active external
//    subscriptions, the only plan that sells — was in NO plan list an agent
//    reads (unlock_more_data: $10/$9/$49/$299; get_dchub_recommendation's
//    upgrade block: {developer 49, pro 299}). Now every price comes from
//    canonical/tier_limits.json via lib/tier-canon.mjs and founding leads.
// #7 MEASURED 00:32Z: /upgrade?key=… (three emit sites) 302s to the /pricing
//    WALL (paywall_nointent); only /go/c/<token> reaches Stripe (3/3). The
//    three sites now emit key-bound /go/c links (k-/pk- refs the webhook
//    already honours).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PLAN_PRICE, FOUNDING_URL, _priceLabel, _paidPlansLine, _keyBoundSubUrl, _keyBoundPackUrl,
  _keyBoundUpgradeUrl, _keyBoundTiers, _goUrl,
} from '../server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
const SNAP = JSON.parse(readFileSync(join(ROOT, 'canonical/tier_limits.json'), 'utf8'));
const SECRET = 'test-internal-key-not-a-real-secret';
const KEY = 'dch_live_test_key_0001';
const KHASH = createHash('sha256').update(KEY).digest('hex');

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

describe('#3 — the founding price is sourced, not stated', () => {
  it('the snapshot carries founding at a price below pro, and PLAN_PRICE mirrors it', () => {
    expect(SNAP.price_usd_month.founding).toBe(99);
    expect(SNAP.price_usd_month.founding).toBeLessThan(SNAP.price_usd_month.pro);
    expect(PLAN_PRICE).toEqual(SNAP.price_usd_month);
    expect(_priceLabel('founding')).toBe('$' + SNAP.price_usd_month.founding + '/mo');
  });
  it('the paid-plans line leads with Founding and quotes every price from the snapshot', () => {
    const line = _paidPlansLine();
    expect(line.startsWith('Founding $' + SNAP.price_usd_month.founding + '/mo')).toBe(true);
    expect(line).toContain('Developer $' + SNAP.price_usd_month.developer + '/mo');
    expect(line).toContain('Pro $' + SNAP.price_usd_month.pro + '/mo');
  });
  it('no price is a literal in server.mjs code (49, 99, 299 appear only via the canon)', () => {
    // code only: drop comment lines AND trailing `// …` tails (the Stripe link
    // table annotates each link with its price — history, not a claim).
    const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\* )/.test(l)).map((l) => l.replace(/\s\/\/.*$/, ''));
    const bad = code.filter((l) => /\$(?:49|99|299)\/mo/.test(l) || /(?:developer|pro|founding)_usd_month:\s*\d/.test(l));
    expect(bad.map((l) => l.trim().slice(0, 100))).toEqual([]);
  });
  it('unlock_more_data lists founding; the auto-mint upgrade block prices founding', () => {
    expect(SRC).toMatch(/\.\.\.\(founding \? \[\{ id: 'founding', label: _priceLabel\('founding'\)/);
    expect(SRC).toMatch(/founding_usd_month: PLAN_PRICE\.founding/);
    expect(SRC).toContain("'[Paid plans — ' + _paidPlansLine() + '](https://dchub.cloud/pricing'");
  });
});

describe('#7 — every key-bound upgrade link pays, and is measured', () => {
  it('no code line in server.mjs emits /upgrade?key= any more', () => {
    const bad = SRC.split('\n').map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => !/^\s*\/\//.test(l) && l.includes('dchub.cloud/upgrade?key='));
    expect(bad.map((b) => 'server.mjs:' + b.n)).toEqual([]);
  });
  it('a subscription link binds k-<sha256(key)> and names the plan, never a URL', () => {
    const got = decode(_keyBoundSubUrl(FOUNDING_URL, KEY));
    expect(got.plan).toBe('founding');
    expect(got.ref).toBe('k-' + KHASH);
    expect(got.plan).not.toMatch(/https?:|stripe|\//);
  });
  it('the pack link binds pk-<sha256(key)> to the metered plan', () => {
    const got = decode(_keyBoundPackUrl(KEY));
    expect(got.plan).toBe('metered');
    expect(got.ref).toBe('pk-' + KHASH);
  });
  it('the single upgrade link is the founding licence while the rung exists', () => {
    expect(decode(_keyBoundUpgradeUrl(KEY)).plan).toBe('founding');
  });
  it('the tier map carries founding beside starter/developer/pro, all key-bound', () => {
    const t = _keyBoundTiers(KEY);
    expect(Object.keys(t)).toEqual(['starter', 'founding', 'developer', 'pro']);
    for (const [plan, url] of Object.entries(t)) {
      const got = decode(url);
      expect(got.plan).toBe(plan);
      expect(got.ref).toBe('k-' + KHASH);
    }
  });
  it('fails OPEN to the direct Stripe link without a signing secret — never to a wall', () => {
    delete process.env.DCHUB_INTERNAL_KEY;
    const u = _keyBoundSubUrl(FOUNDING_URL, KEY);
    expect(u.startsWith(FOUNDING_URL)).toBe(true);
    expect(u).toContain('client_reference_id=k-' + KHASH);
    expect(u).not.toContain('/upgrade?');
  });
  it('the three former /upgrade?key= sites now call the key-bound builders', () => {
    expect(SRC).toContain('? _keyBoundUpgradeUrl(redeemed.api_key)');
    expect(SRC).toContain('const upgradeUrl = _keyBoundUpgradeUrl(mint.api_key);');
    expect(SRC).toContain('const _tiers = _keyBoundTiers(ctx.api_key);');
    expect(SRC).toContain('const _packKeyUrl = _keyBoundPackUrl(ctx.api_key);');
  });
  it('_goUrl knows the founding link (so it is wrapped, not passed through)', () => {
    expect(decode(_goUrl(FOUNDING_URL + '?client_reference_id=k-x')).plan).toBe('founding');
  });
});
