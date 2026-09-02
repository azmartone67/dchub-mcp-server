// =============================================================================
// registry-pr-submit: one open PR per upstream; stop refreshing a decliner.
// -----------------------------------------------------------------------------
// Measured on punkpeye/awesome-mcp-servers at 2026-09-02T00:55Z (GitHub search
// `is:pr author:azmartone67 repo:punkpeye/awesome-mcp-servers`): 19 PRs by us —
// 1 merged (#7462, 2026-06-11), 16 closed UNMERGED, and TWO open at once:
// #12454 (2026-08-19, hand-opened on a different head) and #13272 (2026-08-31,
// opened by the refresh pass WHILE #12454 was open). openPR()'s idempotency
// check looked only for our head branch, so a PR from any other head was
// invisible to it, and nothing counted the declines: a refresh PR went out
// weekly to a maintainer who had closed every previous one.
//
// prGate() is the fix. These tests drive it with a fake search endpoint —
// including the measured punkpeye state — and pin the three rules:
//   · ANY open PR of ours → skip (add and refresh);
//   · refresh: ≥ REFRESH_MAX_DECLINED closed-unmerged → STOP;
//   · unreadable search → skip, never open blind.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { prGate, REFRESH_MAX_DECLINED, REFRESH_TARGETS } from '../scripts/registry-pr-submit.mjs';

const T = { key: 'punkpeye', upstream: 'punkpeye/awesome-mcp-servers', base: 'main', path: 'README.md' };
const ME = 'azmartone67';
const pr = (number, state, merged_at = null) =>
  ({ number, state, created_at: '2026-08-01T00:00:00Z', pull_request: { merged_at } });

/** Fake gh(method, path) that serves one search result set (or an HTTP error). */
const search = (items, status = 200) => async (method, path) => {
  expect(method).toBe('GET');
  expect(decodeURIComponent(path)).toContain(`repo:${T.upstream} author:${ME} type:pr`);
  return status < 300
    ? { ok: true, status, json: { total_count: items.length, items } }
    : { ok: false, status, json: { message: 'boom' } };
};

const declinedN = (n, from = 8000) => Array.from({ length: n }, (_, i) => pr(from + i, 'closed'));
// the measured punkpeye state
const MEASURED = [
  pr(13272, 'open'), pr(12454, 'open'),
  ...[10161, 9013, 8200, 8198, 8016, 7551, 7317, 7316, 7116, 6820, 6803, 6727, 3261, 3257, 1837, 1836].map((n) => pr(n, 'closed')),
  pr(7462, 'closed', '2026-06-11T06:10:21Z'),
];

describe('prGate — one open PR per upstream', () => {
  it('the measured punkpeye state is gated, naming both open PRs', async () => {
    const g = await prGate(T, ME, { kind: 'refresh', gh: search(MEASURED) });
    expect(g.skipped).toMatch(/open PR of ours already exists/);
    expect(g.skipped).toContain('#13272');
    expect(g.skipped).toContain('#12454');
    expect(g.open).toBe(2);
    expect(g.declined).toBe(16);
  });

  it('one open PR from a DIFFERENT head is enough (the head-branch check missed #12454)', async () => {
    for (const kind of ['add', 'refresh']) {
      const g = await prGate(T, ME, { kind, gh: search([pr(12454, 'open'), pr(7462, 'closed', '2026-06-11T00:00:00Z')]) });
      expect(g.skipped, kind).toContain('#12454');
    }
  });
});

describe('prGate — a refresh stops after REFRESH_MAX_DECLINED declines', () => {
  it('default cap is 3, and punkpeye is still the refresh target this protects', () => {
    expect(REFRESH_MAX_DECLINED).toBe(3);
    expect(REFRESH_TARGETS.map((t) => t.upstream)).toContain(T.upstream);
  });

  it('16 closed-unmerged, none open → STOPPED, with the count and the owner action', async () => {
    const g = await prGate(T, ME, { kind: 'refresh', gh: search([...declinedN(16), pr(7462, 'closed', '2026-06-11T00:00:00Z')]) });
    expect(g.stopped).toBe(true);
    expect(g.skipped).toMatch(/STOPPED — 16 of our PRs/);
    expect(g.skipped).toMatch(/Owner action/);
    expect(g.declined).toBe(16);
  });

  it('the cap is inclusive: exactly maxDeclined stops, one fewer proceeds', async () => {
    const at = await prGate(T, ME, { kind: 'refresh', maxDeclined: 3, gh: search(declinedN(3)) });
    expect(at.stopped).toBe(true);
    const under = await prGate(T, ME, { kind: 'refresh', maxDeclined: 3, gh: search(declinedN(2)) });
    expect(under.skipped).toBeNull();
    expect(under.declined).toBe(2);
  });

  it('merged PRs are not declines', async () => {
    const merged = [pr(1, 'closed', '2026-06-01T00:00:00Z'), pr(2, 'closed', '2026-06-02T00:00:00Z'), pr(3, 'closed', '2026-06-03T00:00:00Z')];
    const g = await prGate(T, ME, { kind: 'refresh', maxDeclined: 3, gh: search(merged) });
    expect(g.skipped).toBeNull();
    expect(g.declined).toBe(0);
  });

  it('the add path ignores the declined cap (verify-listed reports DECLINED there) but still honours an open PR', async () => {
    const g = await prGate(T, ME, { kind: 'add', maxDeclined: 3, gh: search(declinedN(16)) });
    expect(g.skipped).toBeNull();
    const withOpen = await prGate(T, ME, { kind: 'add', gh: search([...declinedN(16), pr(99, 'open')]) });
    expect(withOpen.skipped).toContain('#99');
  });
});

describe('prGate — fails closed', () => {
  it('an unreadable search skips rather than opening blind', async () => {
    for (const status of [403, 422, 500]) {
      const g = await prGate(T, ME, { kind: 'refresh', gh: search([], status) });
      expect(g.skipped, `HTTP ${status}`).toMatch(/cannot read our PR history/);
      expect(g.open).toBeNull();
    }
    const malformed = async () => ({ ok: true, status: 200, json: { items: 'not-an-array' } });
    const g = await prGate(T, ME, { kind: 'refresh', gh: malformed });
    expect(g.skipped).toMatch(/cannot read/);
  });
});

describe('the gate is wired into BOTH submit loops', () => {
  it('registry-pr-submit.mjs calls prGate before openPR on the add and refresh paths', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../scripts/registry-pr-submit.mjs', import.meta.url), 'utf8');
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/await prGate\(t, await whoAmI\(\), \{ kind: 'add' \}\)/g)).toHaveLength(1);
    expect(code.match(/await prGate\(t, await whoAmI\(\), \{ kind: 'refresh' \}\)/g)).toHaveLength(1);
    // each gate precedes its openPR call
    for (const kind of ['add', 'refresh']) {
      const g = code.indexOf(`{ kind: '${kind}' })`);
      const next = code.indexOf('await openPR(', g);
      expect(next, `${kind}: openPR must follow the gate`).toBeGreaterThan(g);
      expect(code.slice(g, next)).toMatch(/if \(gate\.skipped\)[^\n]*continue;/);
    }
  });
});
