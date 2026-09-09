// The canon heal must key on the FRESHNESS MARKER, not the resolver's name.
//
// MEASURED 2026-09-09. canonical/canon_phrases.json last changed 2026-09-07
// 13:47 while daily-manifest-sync ran and reported SUCCESS on 09-08 13:44 and
// 09-09 13:44. Live canon had moved 20,900+ -> 21,400+.
//
// Cause: dchub-backend 90648b2de (2026-09-08 04:53) renamed the endpoint's
// label from "resolve_canon (live)" to "resolve_public_floors (live)". The body
// stayed live, healthy and correct — only the function's name moved. This
// script required /resolve_canon \(live\)/, stopped matching, took its quiet
// fallback and exited 0. Every README and registry quantity is GENERATED from
// that snapshot, so one dead predicate published a stale count in 34 places.
//
// ★ A silent fallback is what made two days of staleness invisible. A healthy
//   body wearing an unknown marker is now LOUD.
import { describe, expect, it } from 'vitest';
import { decide, sourceMarker, KNOWN_MARKERS } from '../scripts/refresh-canon-phrases.mjs';

const live = (source) => ({ ok: true, source, facilities: '21,400+', tools: 88 });

describe('sourceMarker', () => {
  it('reads the marker, whatever the resolver is called', () => {
    expect(sourceMarker('resolve_canon (live)')).toBe('live');
    expect(sourceMarker('resolve_public_floors (live)')).toBe('live');
    expect(sourceMarker('anything_at_all (live)')).toBe('live');
  });

  it('returns null when there is no marker to read', () => {
    expect(sourceMarker('resolve_canon')).toBeNull();
    expect(sourceMarker('')).toBeNull();
    expect(sourceMarker(undefined)).toBeNull();
  });
});

describe('decide', () => {
  it('heals on the CURRENT live label — the one that broke it', () => {
    expect(decide(live('resolve_public_floors (live)'))).toBe('heal');
  });

  it('still heals on the OLD live label', () => {
    expect(decide(live('resolve_canon (live)'))).toBe('heal');
  });

  it('heals on a live label that has not been invented yet', () => {
    expect(decide(live('some_future_resolver_v9 (live)'))).toBe('heal');
  });

  // ── the quiet paths, which are quiet BY DESIGN ────────────────────────────
  it('keeps the snapshot for a deliberately non-live body', () => {
    for (const m of KNOWN_MARKERS.filter((x) => x !== 'live')) {
      expect(decide(live(`resolve_public_floors (${m})`))).toBe('keep');
    }
  });

  it('keeps the snapshot when the backend says not-ok', () => {
    expect(decide({ ok: false, source: 'resolve_public_floors (live)' })).toBe('keep');
  });

  // ── the loud path, which is the whole point ───────────────────────────────
  it('FAILS on a healthy body wearing a marker we do not know', () => {
    expect(decide(live('resolve_public_floors (verified)'))).toBe('fail');
    expect(decide(live('resolve_public_floors (fresh)'))).toBe('fail');
  });

  it('does not fail merely because a body is unhealthy', () => {
    // ok:false + unknown marker is a backend problem, not a rename. Failing the
    // daily run on every blip would train the red out of the build.
    expect(decide({ ok: false, source: 'x (verified)' })).toBe('keep');
  });
});

// ── the control: the OLD predicate must be provably broken against today ────
describe('the predicate that froze canon', () => {
  it('the old regex does not match what the endpoint sends today', () => {
    const OLD = /resolve_canon \(live\)/;
    expect(OLD.test('resolve_public_floors (live)')).toBe(false);
    // and the new one does — otherwise this test proves nothing
    expect(decide(live('resolve_public_floors (live)'))).toBe('heal');
  });
});
