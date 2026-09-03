// ★2026-09-02 — one teardown path for every map a session occupies.
//
// There were TWO teardown paths and they disagreed. transport.onclose cleared
// five maps; the idle sweeper cleared THREE, leaving sessionSrv and
// _urlElicitSent to onclose. That is backwards — the sweeper's own comment
// says it exists for the case where the client drops "without calling DELETE
// /mcp and transport.onclose doesn't fire", so the one path that must not
// depend on onclose was delegating to it.
//
// sessionSrv is the expensive map: sessionId -> McpServer, one instance
// carrying all 83 tool definitions (~3.4MB). The map the sweeper could not
// reach was ~the entire heap.
//
// ★These assertions are BEHAVIOURAL. `'_releaseSession' in src` would pass on
// a call whose result is discarded, and a source check cannot tell whether the
// map list is complete. Each test below puts a real entry in every real map
// and asserts the release actually empties it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _releaseSession, _sessionMaps } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// ★The test holds its OWN list. Deriving it from _sessionMaps() would make
// these assertions circular: dropping a map from the server's list would also
// drop it from the fixture, and the test would stay green on the exact
// regression it exists to catch. (Measured — that is what the first draft did.)
const EXPECTED_MAPS = ['sessions', 'sessionMeta', 'sessionLastActive',
                       'sessionSrv', '_urlElicitSent'];

const each = (fn) => EXPECTED_MAPS.map((name) => fn(_sessionMaps()[name], name));
const seed = (sid, value) => each((m) => {
  if (typeof m.set === 'function') m.set(sid, value);
  else m.add(sid);
});
const sizes = () => each((m) => m.size);

describe('session release covers every session map', () => {
  it('releases exactly the maps a session occupies, BY NAME', () => {
    // ★Named, not counted. `length === 5` would pass if sessionSrv were
    // swapped for some other map, and it does not say WHAT went missing.
    // A sixth session map belongs both here and in _SESSION_MAPS.
    expect(Object.keys(_sessionMaps()).sort()).toEqual([...EXPECTED_MAPS].sort());
  });

  it('empties EVERY map, not just the three the sweeper used to reach', () => {
    const sid = 'test-sid-release-all';
    const before = sizes();
    seed(sid, { probe: true });
    expect(sizes()).toEqual(before.map((n) => n + 1));

    expect(_releaseSession(sid)).toBe(true);

    // ★The assertion that would have caught the original bug: sessionSrv and
    // _urlElicitSent must be empty too, not just sessions/meta/lastActive.
    expect(sizes()).toEqual(before);
    each((m, name) => expect(`${name}:${m.has(sid)}`).toBe(`${name}:false`));
  });

  it('is a no-op for an unknown or missing sid', () => {
    const before = sizes();
    expect(_releaseSession('never-seen')).toBe(false);
    expect(_releaseSession(undefined)).toBe(false);
    expect(_releaseSession('')).toBe(false);
    expect(sizes()).toEqual(before);
  });

  it('releases only the sid asked for', () => {
    seed('keep-me', { keep: true });
    seed('drop-me', { drop: true });
    _releaseSession('drop-me');
    each((m, name) => {
      expect(`${name}:${m.has('drop-me')}`).toBe(`${name}:false`);
      expect(`${name}:${m.has('keep-me')}`).toBe(`${name}:true`);
    });
    _releaseSession('keep-me');
  });
});

describe('both teardown paths route through the one release', () => {
  // Structural, and anchored to ONE occurrence each so a rename cannot make
  // these vacuously true.
  const sweeper = SRC.slice(SRC.indexOf('const cutoff = Date.now() - SESSION_IDLE_MS'),
                            SRC.indexOf('}, SESSION_SWEEP_MS)'));
  const onclose = SRC.slice(SRC.indexOf('transport.onclose = () => {'),
                            SRC.indexOf('transport.onclose = () => {') + 600);

  it('the idle sweeper no longer hand-deletes a partial map list', () => {
    expect(sweeper).toContain('_releaseSession(sid)');
    for (const m of ['sessions.delete(', 'sessionMeta.delete(',
                     'sessionLastActive.delete(', 'sessionSrv.delete(']) {
      expect(sweeper).not.toContain(m);
    }
  });

  it('onclose no longer hand-deletes a partial map list', () => {
    expect(onclose).toContain('_releaseSession(sid)');
    for (const m of ['sessions.delete(', 'sessionSrv.delete(',
                     '_urlElicitSent.delete(']) {
      expect(onclose).not.toContain(m);
    }
  });

  it('the sweep log reports the EXPENSIVE map, not just the cheap one', () => {
    // The old log printed only `active=${sessions.size}`, so an onclose
    // failure would leave sessions flat while sessionSrv grew to an OOM —
    // and Railway hides that crash loop (restart in place, same deploymentId).
    expect(sweeper).toContain('srv=${sessionSrv.size}');
    expect(sweeper).toContain('sessionSrv.size !== sessions.size');
  });
});
