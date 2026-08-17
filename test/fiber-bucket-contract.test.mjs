// fiber-bucket-contract (2026-08-17): the mcp-server half of a CROSS-REPO pin.
//
// The near_net_bucket enum served in get_fiber_readiness's description is
// authored HERE but produced by dchub-backend's
// routes/connectivity_score.py::_bucket(). When backend #2731 added the
// "unknown" bucket, this description kept advertising the old four-value enum
// for a day (#195 fixed it) — and an agent that meets an undocumented
// "unknown" reads it as the bad end of the scale, reinstating exactly the
// false greenfield claim #2731 removed. sync-tools-manifest guards
// server.mjs <-> mcp-server.json; nothing guarded server.mjs <-> _bucket().
//
// ★ COUNTERPART: dchub-backend/tests/test_fiber_bucket_contract.py pins the
// same list against _bucket()'s actual return values. If THIS test fails
// because the enum legitimately changed, update the description AND the
// backend pin, then `node scripts/sync-tools-manifest.mjs --fix` (the
// manifest is GENERATED — never hand-edit it). A cross-repo change cannot be
// forced from one repo's CI — the pin makes whichever side changes first
// fail loudly and name the other side.
//
// Deliberately network-free: reads server.mjs off disk. The live suite is
// network-flaky; a contract pin must never be.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// Must equal PINNED_BUCKETS in the backend counterpart (set semantics —
// order in the doc is presentation, the value set is the contract).
const BUCKETS = ['on-net', 'near-net', 'acceptable', 'build-required', 'unknown'];

// Pull the description literal out of the registration call itself —
// transcribing the text here would drift from the live surface, which is the
// exact failure class this repo keeps hitting (manifests are not the source
// of truth). Same extraction as front-door-routing-descriptions.test.mjs.
function descOf(tool) {
  const at = SRC.indexOf(`trackedTool(srv, '${tool}',`);
  if (at < 0) return null;
  const rest = SRC.slice(at);
  const m = rest.match(/trackedTool\(srv, '[a-z_0-9]+',\s*\n?\s*'((?:[^'\\]|\\.)*)'/);
  return m ? m[1] : null;
}

describe('near_net_bucket cross-repo contract pin', () => {
  const desc = descOf('get_fiber_readiness');

  it('finds the get_fiber_readiness registration (extraction positive control)', () => {
    // A silently-null extraction must FAIL here, never quietly pass the
    // suite — an advisory that cannot run reads as good news.
    expect(desc, 'get_fiber_readiness registration not found — tool renamed or extractor broken').toBeTruthy();
    expect(desc.length).toBeGreaterThan(200);
  });

  it('documents exactly the buckets backend _bucket() can return', () => {
    const m = desc.match(/near_net_bucket \(([^)]+)\)/);
    expect(m, 'near_net_bucket enum not documented in the description').toBeTruthy();
    const listed = [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
    expect(listed.length, `unparseable enum segment: ${m[1]}`).toBeGreaterThan(0);
    expect([...listed].sort()).toEqual([...BUCKETS].sort());
  });

  it('keeps "unknown" tied to carrier_data_coverage none_in_region (the trap guard)', () => {
    // The enum alone is a TRAP (#195): without these semantics an agent reads
    // "unknown" as bad. Token pins, not prose pins — rewording is fine as
    // long as the structural link survives.
    expect(desc).toContain('carrier_data_coverage');
    expect(desc).toContain('none_in_region');
    expect(desc).toContain('NOT "bad"');
  });
});
