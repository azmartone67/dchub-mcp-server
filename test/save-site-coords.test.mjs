// r-lonfix (2026-07-16): save_site's zod shape only declared lat/lon, and the
// MCP SDK's zod parse strips undeclared keys SILENTLY — so a save sent with
// `lng` (or `longitude`/`latitude`) reached the backend coordinate-less and
// was persisted at (0, 0) while reporting "Saved!". 19 of the 23 saves in the
// 30 days before the fix had longitude=0. These tests pin the normalizer that
// folds every coordinate-name convention back into lat/lon, and the
// missing-coordinate rejection that replaced the silent (0, 0) write.
import { describe, it, expect } from 'vitest';
import { _extractCoordArgs } from '../server.mjs';

describe('_extractCoordArgs — coordinate alias folding (save_site)', () => {
  it('passes canonical lat/lon through unchanged', () => {
    expect(_extractCoordArgs({ lat: 36.9, lon: -76.3 }))
      .toEqual({ lat: 36.9, lon: -76.3, missing: [] });
  });
  it('folds lng into lon (the convention that used to be silently dropped)', () => {
    expect(_extractCoordArgs({ lat: 36.9, lng: -76.3 }))
      .toEqual({ lat: 36.9, lon: -76.3, missing: [] });
  });
  it('folds longitude/latitude long names', () => {
    expect(_extractCoordArgs({ latitude: 36.9, longitude: -76.3 }))
      .toEqual({ lat: 36.9, lon: -76.3, missing: [] });
  });
  it('canonical short names win when both conventions are present', () => {
    expect(_extractCoordArgs({ lat: 1, latitude: 2, lon: 3, lng: 4, longitude: 5 }))
      .toEqual({ lat: 1, lon: 3, missing: [] });
  });
  it('treats an explicit 0 as a VALID coordinate, not missing', () => {
    expect(_extractCoordArgs({ lat: 0, lon: 0 }))
      .toEqual({ lat: 0, lon: 0, missing: [] });
  });
  it('reports missing coords instead of defaulting them', () => {
    expect(_extractCoordArgs({ lat: 36.9, name: 'x' }).missing).toEqual(['lon']);
    expect(_extractCoordArgs({ lon: -76.3 }).missing).toEqual(['lat']);
    expect(_extractCoordArgs({}).missing).toEqual(['lat', 'lon']);
    expect(_extractCoordArgs(null).missing).toEqual(['lat', 'lon']);
  });
});
