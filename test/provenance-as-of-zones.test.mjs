// G-2 slice 1: hour-only stamps are dated, and a source stamp with no zone is never shown with an
// invented Z (it says as_of_zone "unstated" instead).
import { describe, it, expect } from 'vitest';
import { buildProvenance } from '../lib/attribution.mjs';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const prov = (payload) => buildProvenance(payload, { now: NOW });

describe('hour-only stamps (EIA period spelling)', () => {
  it('"2026-10-03T16" is a data date, so as_of is set and the basis is not UNMEASURED', () => {
    const p = prov({ as_of: '2026-10-03T16', demand_mw: 1 });
    expect(p.as_of).toBe('2026-10-03T16:00:00');
    expect(p.as_of_zone).toBe('unstated');
    expect(p.as_of_basis).not.toMatch(/UNMEASURED/);
  });
  it('does not accept an hour that is not an hour', () => {
    expect(prov({ as_of: '2026-10-03T99' }).as_of).toBeNull();
  });
});

describe('zoneless date-times', () => {
  it('keep their spelling: no Z appended, zone flagged unstated', () => {
    const p = prov({ ercotqueue: { as_of: '2026-09-08T19:24:42' } });
    expect(p.as_of).toBe('2026-09-08T19:24:42');
    expect(p.as_of_zone).toBe('unstated');
  });
  it('do not depend on the server timezone', () => {
    const was = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(prov({ as_of: '2026-09-08T19:24:42' }).as_of).toBe('2026-09-08T19:24:42');
    } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
  });
});

describe('stamps that state a zone are unchanged', () => {
  it('Z and offsets still print as UTC ISO with no as_of_zone', () => {
    const z = prov({ as_of: '2026-10-03T16:00:00Z' });
    expect(z.as_of).toBe('2026-10-03T16:00:00.000Z');
    expect(z.as_of_zone).toBeUndefined();
    expect(prov({ as_of: '2026-10-03T09:00:00-07:00' }).as_of).toBe('2026-10-03T16:00:00.000Z');
  });
  it('a date-only stamp is shown as the date it is (G-2 2026-10-07: no invented time of day or zone)', () => {
    const p = prov({ as_of: '2026-10-03' });
    expect(p.as_of).toBe('2026-10-03');                    // was "2026-10-03T00:00:00.000Z"
    expect(p.as_of_zone).toBeUndefined();                  // a day has no zone to call unstated
    expect(p.as_of_basis).not.toMatch(/UNMEASURED/);
  });
  it('the oldest stamp wins and a zoneless one in the range keeps its spelling', () => {
    const p = prov({ as_of: '2026-10-03T16:00:00Z', generated_at: '2026-09-08T19:24:42' });
    expect(p.as_of).toBe('2026-09-08T19:24:42');
    expect(p.as_of_range).toEqual({ oldest: '2026-09-08T19:24:42', newest: '2026-10-03T16:00:00.000Z' });
  });
});

describe('stamps are shown as the source gave them (G-2 2026-10-07)', () => {
  it('zoneless microseconds are kept (were cut to milliseconds)', () => {
    const p = prov({ ercotqueue: { as_of: '2026-09-08T12:48:24.522976' } });
    expect(p.as_of).toBe('2026-09-08T12:48:24.522976');
    expect(p.as_of_zone).toBe('unstated');
  });
  it('a space-separated zoneless stamp is shown with the ISO T and nothing else changed', () => {
    expect(prov({ as_of: '2026-09-08 19:24:42' }).as_of).toBe('2026-09-08T19:24:42');
  });
  it('the range shows each end in its own spelling', () => {
    const p = prov({ as_of: '2026-10-03', generated_at: '2026-10-04T08:00:00Z' });
    expect(p.as_of).toBe('2026-10-03');
    expect(p.as_of_range).toEqual({ oldest: '2026-10-03', newest: '2026-10-04T08:00:00.000Z' });
  });
  it('ordering still runs on the instant: a date-only day binds against a later zoned stamp', () => {
    expect(prov({ as_of: '2026-10-04T08:00:00Z', generated_at: '2026-10-03' }).as_of).toBe('2026-10-03');
  });
  it('a zoned stamp with a non-UTC offset still prints as UTC ISO', () => {
    expect(prov({ as_of: '2026-10-03T09:00:00-07:00' }).as_of).toBe('2026-10-03T16:00:00.000Z');
  });
  it('an impossible date is not a stamp', () => {
    expect(prov({ as_of: '2026-13-45' }).as_of).toBeNull();
  });
});

// ── as_of_zone follows the as_of that won the merge (G-2 2026-10-07) ─────────
import { mergeProvenance } from '../lib/attribution.mjs';

describe('mergeProvenance: as_of_zone describes the winning as_of', () => {
  // live get_grid_data 2026-10-07: backend as_of "2026-10-07T03:00:00Z" (zone stated, be#6433)
  // merged with a derived block whose oldest stamp was the zoneless hour-only demand_period.
  const NOW2 = Date.parse('2026-10-07T12:00:00Z');   // the stamps below must not be "future" to the collector
  const derived = () => buildProvenance({ as_of: '2026-10-07T03' }, { now: NOW2 });

  it('control: the derived block does carry the unstated flag the merge used to leak', () => {
    expect(derived().as_of_zone).toBe('unstated');
  });
  it('a backend as_of that states its zone drops the inherited unstated flag', () => {
    const out = mergeProvenance({ as_of: '2026-10-07T03:00:00Z', source: 'EIA' }, derived());
    expect(out.as_of).toBe('2026-10-07T03:00:00Z');
    expect(out.as_of_zone).toBeUndefined();
  });
  it('an offset counts as a stated zone', () => {
    expect(mergeProvenance({ as_of: '2026-10-07T03:00:00-07:00' }, derived()).as_of_zone).toBeUndefined();
  });
  it('a zoneless backend as_of is flagged unstated even when the derived stamp was zoned', () => {
    const zonedDerived = buildProvenance({ as_of: '2026-10-07T03:00:00Z' }, { now: NOW2 });
    expect(zonedDerived.as_of_zone).toBeUndefined();
    const out = mergeProvenance({ as_of: '2026-10-07T03:00:00', source: 'x' }, zonedDerived);
    expect(out.as_of_zone).toBe('unstated');
  });
  it('an hour-only backend as_of is flagged unstated', () => {
    expect(mergeProvenance({ as_of: '2026-10-07T03' }, buildProvenance({ x: 1 }, { now: NOW2 })).as_of_zone).toBe('unstated');
  });
  it('a bare date carries no zone flag', () => {
    expect(mergeProvenance({ as_of: '2026-10-07' }, derived()).as_of_zone).toBeUndefined();
  });
  it('a backend that sends its own as_of_zone keeps it', () => {
    expect(mergeProvenance({ as_of: '2026-10-07T03:00:00Z', as_of_zone: 'utc' }, derived()).as_of_zone).toBe('utc');
  });
  it('no backend as_of: the derived flag stands (it describes the derived as_of)', () => {
    expect(mergeProvenance({ source: 'x' }, derived()).as_of_zone).toBe('unstated');
  });
  it('an unparseable backend as_of leaves the flag alone (nothing to compare against)', () => {
    expect(mergeProvenance({ as_of: 'last Tuesday' }, derived()).as_of_zone).toBe('unstated');
  });
});
