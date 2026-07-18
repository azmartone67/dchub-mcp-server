// Drift-gate for the per-platform tuned-description pipeline.
//
// THE BUG THIS PREVENTS (has now shipped TWICE — the 2026-07-11 expansion wave
// and Kimi/Moonshot on 2026-07-17): a platform is added to the backend tuner
// (ai_platform_tool_tuner.TUNED_PLATFORMS) but the three gateway maps drift out
// of sync, so a real client silently serves GENERIC tool descriptions.
//
// The live request path is:
//   detectPlatformFromInit(clientInfo.name) / detectPlatform(ua)
//     -> _platformOverrides(platform)
//     -> _DESC_BY_PLATFORM.get(platform)        (populated for _DESC_KNOWN_PLATFORMS)
//
// So the invariant is: every platform we FETCH overrides for
// (_DESC_KNOWN_PLATFORMS) MUST be produceable by BOTH detection paths — else a
// _DESC_KNOWN entry no detector can emit is dead weight, and a detector output
// not in _DESC_KNOWN never gets overrides. Adding a platform now forces all
// three maps to agree or this gate goes red.
//
// See memory: reference_dchub_tuner_warmcache_platforms.
import { describe, it, expect } from 'vitest';
import { detectPlatform, detectPlatformFromInit, _DESC_KNOWN_PLATFORMS } from '../server.mjs';

describe('per-platform tuned-description 3-list sync (drift-gate)', () => {
  it('is a non-empty, de-duplicated list', () => {
    expect(_DESC_KNOWN_PLATFORMS.length).toBeGreaterThan(0);
    expect(new Set(_DESC_KNOWN_PLATFORMS).size).toBe(_DESC_KNOWN_PLATFORMS.length);
  });

  it('every fetched platform is detectable via clientInfo.name (init path)', () => {
    for (const p of _DESC_KNOWN_PLATFORMS) {
      expect(
        detectPlatformFromInit({ params: { clientInfo: { name: p } } }, ''),
        `clientInfo.name="${p}" must canonicalize to "${p}" — add it to detectPlatformFromInit()`,
      ).toBe(p);
    }
  });

  it('every fetched platform is detectable via User-Agent (UA fallback path)', () => {
    for (const p of _DESC_KNOWN_PLATFORMS) {
      expect(
        detectPlatform(`Mozilla/5.0 (${p})`),
        `UA containing "${p}" must canonicalize to "${p}" — add it to detectPlatform()`,
      ).toBe(p);
    }
  });

  it('includes kimi and canonicalizes every Moonshot/Kimi alias to "kimi"', () => {
    expect(_DESC_KNOWN_PLATFORMS).toContain('kimi');
    for (const alias of ['kimi', 'moonshot', 'kimi-k2', 'moonshotai']) {
      expect(detectPlatformFromInit({ params: { clientInfo: { name: alias } } }, '')).toBe('kimi');
      expect(detectPlatform(`Mozilla/5.0 ${alias}`)).toBe('kimi');
    }
  });
});
