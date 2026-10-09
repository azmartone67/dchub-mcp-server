// refresh-tier-limits-rule.test.mjs — r-daily-quota (2026-09-27)
//
// /api/v1/tiers now publishes the free-tier rule (owner decision D2): anonymous
// and free carry a NULL calls_per_day, with `allowance` naming the real unit
// (anonymous: no call count; free: 10 in total). scripts/refresh-tier-limits.mjs
// used to bail on any null, which would have frozen the whole snapshot — prices
// and links included — the day the backend shipped. These pin that it accepts
// the new shape, still accepts the OLD one (so the two repos can merge in any
// order), and still fails closed on a null that names no unit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
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

const priced = {
  starter: { price_usd_month: 9 }, developer: { price_usd_month: 49 },
  pro: { price_usd_month: 99 }, team: { price_usd_month: 699 }, enterprise: { price_usd_month: null },
};
function tiers(over) {
  const t = {
    anonymous:  { calls_per_day: null, allowance: { calls: null, period: null, previews: true, full_answers_per_tool_per_day: 2 } },
    free:       { calls_per_day: null, allowance: { calls: 10, period: 'lifetime', previews: false, full_answers_per_tool_per_day: null } },
    identified: { calls_per_day: 50, allowance: { calls: 50, period: 'day', previews: false, full_answers_per_tool_per_day: 10 } },
    starter:    { calls_per_day: 200, allowance: { calls: 6000, period: 'month' } },
    developer:  { calls_per_day: 500, allowance: { calls: 500, period: 'day' } },
    pro:        { calls_per_day: 2000, allowance: { calls: 60000, period: 'month' } },
    enterprise: { calls_per_day: 100000, allowance: { calls: 3000000, period: 'month' } },
    team:       {},
  };
  for (const [k, v] of Object.entries(priced)) t[k] = { ...t[k], ...v };
  return { tiers: { ...t, ...(over || {}) }, credit_pack: { price_usd: 10, credits: 1000 } };
}

function run() {
  const out = join(mkdtempSync(join(tmpdir(), 'tl-')), 'tier_limits.json');
  writeFileSync(out, '{"sentinel":true}\n');
  return new Promise((resolve) => {
    execFile(process.execPath, [join(ROOT, 'scripts/refresh-tier-limits.mjs')], {
      env: { ...process.env, DCHUB_API_BASE: base, DCHUB_TIER_LIMITS_OUT: out },
    }, (err, stdout) => {
      const txt = readFileSync(out, 'utf8');
      resolve({ stdout, wrote: !txt.includes('sentinel'), snap: txt.includes('sentinel') ? null : JSON.parse(txt), code: err ? err.code : 0 });
    });
  });
}

describe('refresh-tier-limits — the free-tier rule shape', () => {
  it('accepts null calls_per_day where allowance names a non-daily unit', async () => {
    payload = tiers();
    const r = await run();
    expect(r.wrote, r.stdout).toBe(true);
    expect(r.snap.calls_per_day).toEqual({ identified: 50, starter: 200, developer: 500, pro: 2000, enterprise: 100000 });
    expect(r.snap.allowance.anonymous).toEqual({ calls: null, period: null, full_answers_per_tool_per_day: 2 });
    expect(r.snap.allowance.free).toEqual({ calls: 10, period: 'lifetime' });
    expect(r.snap.allowance.identified.full_answers_per_tool_per_day).toBe(10);
    expect(r.snap.price_usd_month.pro).toBe(99);       // the rest of the snapshot still refreshes
  });

  it('still accepts the OLD shape, so merge order between repos does not matter', async () => {
    const old = tiers();
    for (const t of Object.values(old.tiers)) delete t.allowance;
    old.tiers.anonymous.calls_per_day = 5;
    old.tiers.free.calls_per_day = 10;
    payload = old;
    const r = await run();
    expect(r.wrote, r.stdout).toBe(true);
    expect(r.snap.calls_per_day.anonymous).toBe(5);
    expect(r.snap.allowance).toBeUndefined();
  });

  it('FAIL-CLOSED: a null calls_per_day with no unit is still a degraded read', async () => {
    payload = tiers({ free: { calls_per_day: null } });
    const r = await run();
    expect(r.wrote).toBe(false);
    expect(r.stdout).toMatch(/FAIL-CLOSED.*'free'\.calls_per_day is null/);
  });

  it('FAIL-CLOSED: a null calls_per_day whose allowance says per DAY', async () => {
    payload = tiers({ identified: { calls_per_day: null, allowance: { calls: 50, period: 'day' } } });
    const r = await run();
    expect(r.wrote).toBe(false);
  });

  it('FAIL-CLOSED: a malformed allowance', async () => {
    payload = tiers({ free: { calls_per_day: null, allowance: { calls: 10, period: 'fortnight' } } });
    expect((await run()).wrote).toBe(false);
    payload = tiers({ anonymous: { calls_per_day: null, allowance: { calls: 3, period: null } } });
    expect((await run()).wrote).toBe(false);
  });

  // B1 (D4, owner 2026-10-03; backend live 2026-10-03 22:09Z).
  it('B1: accepts the free key as a daily allowance with no call count', async () => {
    payload = tiers({ free: { calls_per_day: null, allowance: { calls: null, period: 'day', previews: true, full_answers_per_tool_per_day: 2 } } });
    const r = await run();
    expect(r.wrote, r.stdout).toBe(true);
    expect(r.snap.allowance.free).toEqual({ calls: null, period: 'day', full_answers_per_tool_per_day: 2 });
    expect(r.snap.calls_per_day.free).toBeUndefined();
    expect(r.snap.price_usd_month.pro).toBe(99);
  });

  it('B1 FAIL-CLOSED: a daily free allowance that names no full-answer unit', async () => {
    payload = tiers({ free: { calls_per_day: null, allowance: { calls: null, period: 'day', full_answers_per_tool_per_day: null } } });
    expect((await run()).wrote).toBe(false);
    payload = tiers({ free: { calls_per_day: null, allowance: { calls: null, period: 'day', full_answers_per_tool_per_day: 0 } } });
    expect((await run()).wrote).toBe(false);
  });

  it('FAIL-CLOSED: the per-day ladder still may not invert', async () => {
    payload = tiers({ developer: { calls_per_day: 40, allowance: { calls: 40, period: 'day' } } });
    const r = await run();
    expect(r.wrote).toBe(false);
    expect(r.stdout).toMatch(/ladder inverts/);
  });
});

// B1 (D4, live 2026-10-03): the backend publishes the free key as a daily
// allowance and A1 publishes anonymous with no full answers; the snapshot
// carries both, and the free-key copy reads the daily sentence from it.
describe('the committed snapshot carries the rule', () => {
  it('anonymous: previews only; free: a daily allowance with no call total', async () => {
    const snap = JSON.parse(readFileSync(join(ROOT, 'canonical/tier_limits.json'), 'utf8'));
    expect(snap.calls_per_day.anonymous).toBeUndefined();
    expect(snap.allowance.anonymous).toEqual({ calls: null, period: null });
    expect(snap.allowance.free).toEqual({ calls: null, period: 'day', full_answers_per_tool_per_day: 2 });
    expect(snap.calls_per_day.free).toBeUndefined();
    expect(snap.calls_per_day.identified).toBe(50);
    expect(snap.calls_per_day.developer).toBe(500);
    const { FREE_TIER, _rungNum, _freeKeyIsDaily, _freeTierRuleText } = await import('../lib/tier-canon.mjs');
    expect(_freeKeyIsDaily()).toBe(true);
    expect(FREE_TIER.free_calls_per_day).toBe('n/a');      // no total, and no copy reads it
    expect(FREE_TIER.identified_calls_per_day).toBe(50);
    expect(_rungNum('free')).toBeNull();
    expect(_rungNum('anonymous')).toBeNull();
    expect(_freeTierRuleText()).toBe('Anonymous: previews, no key needed. Free key: previews plus 2 full '
      + 'answers per tool per day. Add an email: 50 calls/day (up to 10 full answers per tool per day). '
      + 'Paid plans: dchub.cloud/pricing.');
    expect(existsSync(join(ROOT, 'scripts/refresh-tier-limits.mjs'))).toBe(true);
  });
});
