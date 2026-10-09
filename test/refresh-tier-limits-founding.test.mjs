// refresh-tier-limits-founding.test.mjs — owner decision 3a (2026-09-28)
//
// Founding is a CLOSED early-supporter cohort, not a public tier, so it may
// cost the SAME as Pro. scripts/refresh-tier-limits.mjs used to require
// founding < pro; from r-price-collapse (09-05, both $99) every daily refresh
// bailed "founding 99 is not below pro 99" and the whole tier snapshot froze.
//
// Pinned here:
//   founding == pro  → refresh WRITES (and the rest of the ladder refreshes)
//   founding <  pro  → refresh WRITES
//   founding >  pro  → FAIL-CLOSED, snapshot untouched
//   nonsense founding price (null, 0, negative, fractional) → FAIL-CLOSED
//   the older guards (ladder inversion, missing public tier, missing pro price)
//   still fail closed
//   founding's PRICE never reaches the snapshot (lib/tier-canon.mjs would put
//   it in _paidPlansLine() and the `pricing` block — served copy; the only
//   public price is the $10 pack and /mcp + /mcp/chatgpt are frozen), while
//   its stripe link stays for legacy /go attribution.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let stub, base, payload;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(payload));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${stub.address().port}`;
});
afterAll(() => new Promise((r) => stub.close(r)));

const FOUNDING_LINK = 'https://buy.stripe.com/14A9AUcVk4Nn1edcymaZi0o';
const PRO_LINK = 'https://buy.stripe.com/dRm28s2gGcfP6yx0PEaZi0p';

// The live ladder's shape (GET /api/v1/tiers, 2026-09-28): founding == pro.
function tiers(over) {
  const t = {
    anonymous:  { calls_per_day: null, price_usd_month: 0, allowance: { calls: null, period: null, previews: true, full_answers_per_tool_per_day: 2 } },
    free:       { calls_per_day: null, price_usd_month: 0, allowance: { calls: 10, period: 'lifetime', previews: false, full_answers_per_tool_per_day: null } },
    identified: { calls_per_day: 50, price_usd_month: 0, allowance: { calls: 50, period: 'day', previews: false, full_answers_per_tool_per_day: 10 } },
    starter:    { calls_per_day: 200, price_usd_month: 9, allowance: { calls: 6000, period: 'month' } },
    founding:   { calls_per_day: 2000, price_usd_month: 99, stripe_link: FOUNDING_LINK, allowance: { calls: 60000, period: 'month' } },
    developer:  { calls_per_day: 500, price_usd_month: 49, allowance: { calls: 500, period: 'day' } },
    pro:        { calls_per_day: 2000, price_usd_month: 99, stripe_link: PRO_LINK, allowance: { calls: 60000, period: 'month' } },
    team:       { calls_per_day: 2000, price_usd_month: 699 },
    enterprise: { calls_per_day: 100000, price_usd_month: null, allowance: { calls: 3000000, period: 'month' } },
  };
  for (const [k, v] of Object.entries(over || {})) t[k] = v === undefined ? undefined : { ...t[k], ...v };
  for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
  return { tiers: t, credit_pack: { price_usd: 10, credits: 1000 } };
}

function run() {
  const out = join(mkdtempSync(join(tmpdir(), 'tlf-')), 'tier_limits.json');
  writeFileSync(out, '{"sentinel":true}\n');
  return new Promise((resolve) => {
    execFile(process.execPath, [join(ROOT, 'scripts/refresh-tier-limits.mjs')], {
      env: { ...process.env, DCHUB_API_BASE: base, DCHUB_TIER_LIMITS_OUT: out, NODE_OPTIONS: '' },
    }, (err, stdout) => {
      const txt = readFileSync(out, 'utf8');
      const wrote = !txt.includes('sentinel');
      resolve({ stdout, wrote, snap: wrote ? JSON.parse(txt) : null, code: err ? err.code : 0 });
    });
  });
}

describe('refresh-tier-limits — founding is a closed cohort (decision 3a)', () => {
  it('founding == pro ($99 == $99, the live ladder) refreshes the snapshot', async () => {
    payload = tiers();
    const r = await run();
    expect(r.stdout).not.toMatch(/FAIL-CLOSED/);
    expect(r.wrote, r.stdout).toBe(true);
    expect(r.snap.price_usd_month).toEqual({ starter: 9, developer: 49, pro: 99, team: 699, enterprise: null });
    expect(r.snap.calls_per_day.pro).toBe(2000);
  });

  it('founding < pro still refreshes', async () => {
    payload = tiers({ founding: { price_usd_month: 79 } });
    expect((await run()).wrote).toBe(true);
  });

  it('founding\'s PRICE is never written (served copy reads it); its LINK is kept', async () => {
    payload = tiers();
    const r = await run();
    expect(r.wrote, r.stdout).toBe(true);
    expect(Object.keys(r.snap.price_usd_month)).not.toContain('founding');
    expect(JSON.stringify(r.snap.price_usd_month)).not.toMatch(/founding/i);
    expect(r.snap.stripe_link.founding).toBe(FOUNDING_LINK);
    expect(r.snap.stripe_link.pro).toBe(PRO_LINK);
  });

  it('a retired founding rung (absent) is still fine', async () => {
    payload = tiers({ founding: undefined });
    const r = await run();
    expect(r.wrote, r.stdout).toBe(true);
    expect(r.snap.stripe_link.founding).toBeUndefined();
  });

  it('FAIL-CLOSED: founding > pro', async () => {
    payload = tiers({ founding: { price_usd_month: 100 } });
    const r = await run();
    expect(r.wrote).toBe(false);
    expect(r.stdout).toMatch(/FAIL-CLOSED.*founding 100 is above pro 99/);
  });

  it.each([
    ['null', null], ['zero', 0], ['negative', -99], ['fractional', 98.5], ['a string', '99'],
  ])('FAIL-CLOSED: founding price is %s', async (_, p) => {
    payload = tiers({ founding: { price_usd_month: p } });
    const r = await run();
    expect(r.wrote, r.stdout).toBe(false);
    expect(r.stdout).toMatch(/FAIL-CLOSED.*'founding'\.price_usd_month/);
  });

  it('FAIL-CLOSED: the existing guards still hold', async () => {
    // pro price missing (pro is a required priced rung)
    payload = tiers({ pro: { price_usd_month: null } });
    let r = await run();
    expect(r.wrote).toBe(false);
    expect(r.stdout).toMatch(/'pro'\.price_usd_month is null/);
    // per-day ladder inverts (developer below identified)
    payload = tiers({ developer: { calls_per_day: 40, allowance: { calls: 40, period: 'day' } } });
    r = await run();
    expect(r.wrote).toBe(false);
    expect(r.stdout).toMatch(/ladder inverts/);
    // a public tier missing from the ladder
    payload = tiers({ developer: undefined });
    r = await run();
    expect(r.wrote).toBe(false);
    expect(r.stdout).toMatch(/missing the public tier 'developer'/);
  });
});

describe('the committed snapshot keeps founding out of served copy', () => {
  it('no founding price in canonical/tier_limits.json, and no "Founding" in the plans line', async () => {
    const snap = JSON.parse(readFileSync(join(ROOT, 'canonical/tier_limits.json'), 'utf8'));
    expect(snap.price_usd_month.founding).toBeUndefined();
    // ★2026-10-02: _priceLabel / _paidPlansLine are retired (no monthly price
    // in served copy); the ladder check and the one plans line remain.
    const { _paidPlansOutputLine, _planOnLadder } = await import('../lib/tier-canon.mjs');
    expect(_planOnLadder('founding')).toBe(false);
    expect(_paidPlansOutputLine()).not.toMatch(/founding/i);
  });
});
