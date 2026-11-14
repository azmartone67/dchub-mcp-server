// The anonymous-cap walls reset with the DAILY per-IP count (platform review, 2026-11-14).
// One envelope said binding_limit anon_ip_daily ("today") beside resets_at 2026-12-01: the
// month start of the monthly site-report count. resets_at is now the binding limit's reset.
import { describe, it, expect } from 'vitest';
import { nextUtcDayStart, keylessCapWallQuota, keylessWallQuota, keylessCapEmailResult,
         keylessSoftCapEmailUpgrade } from '../lib/keyless-wall.mjs';

const NOW = new Date('2026-11-14T23:13:00Z');

describe('nextUtcDayStart', () => {
  it('is the next UTC midnight, across month and year ends', () => {
    expect(nextUtcDayStart(NOW)).toBe('2026-11-15T00:00:00Z');
    expect(nextUtcDayStart(new Date('2026-11-30T23:59:59Z'))).toBe('2026-12-01T00:00:00Z');
    expect(nextUtcDayStart(new Date('2026-12-31T00:00:00Z'))).toBe('2027-01-01T00:00:00Z');
    expect(nextUtcDayStart(new Date('2026-11-15T00:00:00Z'))).toBe('2026-11-16T00:00:00Z');
  });
});

describe('the anonymous-cap walls carry the daily reset', () => {
  it('keylessCapWallQuota: resets_at is tomorrow, the month start has its own name', () => {
    const q = keylessCapWallQuota(NOW);
    expect(q.resets_at).toBe('2026-11-15T00:00:00Z');
    expect(q.monthly_reports_reset_at).toBe(keylessWallQuota(NOW).resets_at);
    expect(q.monthly_reports_reset_at).toBe('2026-12-01T00:00:00Z');
    expect(q.remaining_this_month).toBe(0);
    expect(q.quota_basis).toMatch(/next UTC midnight/);
  });

  it('the hard wall result says daily once', () => {
    const r = keylessCapEmailResult({ name: 'find_sites', link: 'https://dchub.cloud/u/x', now: NOW,
      base: { error: 'anon_hard_wall', binding_limit: 'anon_ip_daily_hard', retry_after: 'UTC midnight' } });
    expect(r.structuredContent.binding_limit).toBe('anon_ip_daily_hard');
    expect(r.structuredContent.resets_at).toBe('2026-11-15T00:00:00Z');
    expect(JSON.stringify(r)).not.toMatch(/"resets_at":"2026-12-01/);
  });

  it('the soft cap _upgrade says daily once', () => {
    const out = keylessSoftCapEmailUpgrade({ data: [], _upgrade: { binding_limit: 'anon_ip_daily', remaining_today: 0 } },
      { name: 'get_retirement_headroom', link: 'https://dchub.cloud/u/x', now: NOW });
    expect(out._upgrade.binding_limit).toBe('anon_ip_daily');
    expect(out._upgrade.resets_at).toBe('2026-11-15T00:00:00Z');
    expect(out._upgrade.monthly_reports_reset_at).toBe('2026-12-01T00:00:00Z');
  });

  it('the analyze_site monthly-report quota is unchanged', () => {
    expect(keylessWallQuota(NOW).resets_at).toBe('2026-12-01T00:00:00Z');
  });
});
