// ★2026-09-03 — DELETE /mcp is the THIRD eviction site, and it was not converted.
//
// PR #314 unified transport.onclose and the idle sweeper onto _releaseSession
// and its own comment says "Two callers, one list". There are THREE. The
// DELETE /mcp handler still hand-deleted a partial map list:
//
//     await sessions.get(sid).close();
//     sessions.delete(sid); sessionMeta.delete(sid); sessionLastActive.delete(sid);
//
// Three of five. Add a sixth session map to _SESSION_MAPS and DELETE still
// misses it — the exact regression #314's named-map registry exists to prevent.
//
// ★THE HEALTHY PATH DID NOT LEAK, and saying it did would be the easy wrong
// story. close() fires onclose as its LAST statement
// (webStandardStreamableHttp.js:630-639), so on a faithful transport DELETE
// cleans all five maps transitively. A fake that omits the callback under test
// proves nothing; the first probe of this defect used one and "found" a leak
// that does not exist.
//
// ★THE REAL DEFECT IS THE UNGUARDED await. `await sessions.get(sid).close()`
// has no try/catch, and Express 4 does NOT forward async-handler rejections to
// its error middleware. Measured against the pre-fix handler, by the two tests
// below: the request gets NO RESPONSE AT ALL — it hangs until the client gives
// up, not a 500 — and every one of the five maps still holds the sid. The
// process itself survives, because server.mjs registers a log-and-continue
// process.on('unhandledRejection') (r-crashguard), so this is invisible from
// the outside except as a stuck client.
//
// Recovery is the idle sweeper, and only because sessionLastActive is still
// populated — so it is a hang plus a delayed release, not a permanent leak.
// That is still wrong on both counts: the caller never gets an answer, and an
// McpServer (~3.4MB of tool definitions) stays resident until the sweep.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { app, _sessionMaps } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// The test holds its OWN key set, for the reason #314 documents: deriving it
// from _sessionMaps() would let a map dropped from the server also vanish from
// the fixture, keeping the test green on the regression it exists to catch.
const EXPECTED_MAPS = ['sessions', 'sessionMeta', 'sessionLastActive',
                       'sessionSrv', '_urlElicitSent'];

let server, base;

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

const maps = () => EXPECTED_MAPS.map((n) => [n, _sessionMaps()[n]]);

/** Seed every session map for `sid`; `sessions` gets the supplied transport. */
function seed(sid, transport) {
  for (const [name, m] of maps()) {
    const v = name === 'sessions' ? transport : { probe: true };
    if (typeof m.set === 'function') m.set(sid, v);
    else m.add(sid);
  }
}

const held = (sid) => maps().filter(([, m]) => m.has(sid)).map(([n]) => n);

afterEach(() => {
  for (const sid of ['sid-close-rejects', 'sid-onclose-silent', 'sid-healthy']) {
    for (const [, m] of maps()) m.delete(sid);
  }
});

/** DELETE with a hard client-side deadline, so a HANG is observable as one. */
async function del(sid, ms = 3000) {
  try {
    const r = await fetch(`${base}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sid },
      signal: AbortSignal.timeout(ms),
    });
    return { status: r.status, hung: false };
  } catch (e) {
    // TimeoutError => the handler never wrote a response.
    return { status: null, hung: e?.name === 'TimeoutError' || e?.name === 'AbortError' };
  }
}

describe('DELETE /mcp — the third eviction site', () => {
  it('a transport whose close() REJECTS still gets an answer, not a hang', async () => {
    // Pre-fix this test does not "fail an assertion" — the fetch times out,
    // because Express 4 leaves the rejected async handler's request open.
    const sid = 'sid-close-rejects';
    seed(sid, { close: async () => { throw new Error('transport close failed'); } });

    const r = await del(sid);

    expect(r.hung).toBe(false);
    expect(r.status).not.toBeNull();
    // 200: the session IS gone from this process either way, which is the only
    // thing the caller can act on. A 5xx would invite a retry that can only 404.
    expect(r.status).toBe(200);
  });

  it('a close() failure still releases EVERY map, not three of five', async () => {
    const sid = 'sid-close-rejects';
    seed(sid, { close: async () => { throw new Error('transport close failed'); } });
    expect(held(sid)).toEqual(EXPECTED_MAPS);

    await del(sid);

    // Pre-fix: all five retained (the throw skips every delete).
    // Half-fixed (guard, but still three hand-deletes): sessionSrv and
    // _urlElicitSent survive — the ~3.4MB McpServer among them.
    expect(held(sid)).toEqual([]);
  });

  it('releases every map when onclose does not fire back into the maps', async () => {
    // A transport that closes cleanly but does NOT invoke onclose — an
    // already-closed or replaced transport. The handler must not depend on a
    // callback firing to finish its own teardown; that is precisely the
    // reasoning #314 applied to the idle sweeper.
    const sid = 'sid-onclose-silent';
    let closed = false;
    seed(sid, { close: async () => { closed = true; } });

    const r = await del(sid);

    expect(closed).toBe(true);
    expect(r.status).toBe(200);
    expect(held(sid)).toEqual([]);
  });

  it('still 404s an unknown session, and touches no map', async () => {
    const before = maps().map(([n, m]) => `${n}:${m.size}`);
    const r = await del('never-seen-sid');
    expect(r.status).toBe(404);
    expect(maps().map(([n, m]) => `${n}:${m.size}`)).toEqual(before);
  });
});

describe('all THREE teardown paths route through the one release', () => {
  // #314 asserted this for the sweeper and onclose only, and its own comment
  // said "two callers". Anchored to the DELETE handler's slice so a rename
  // cannot make it vacuously true.
  const start = SRC.indexOf('app.delete(MCP_PATHS');
  const handler = SRC.slice(start, SRC.indexOf('});', start) + 3);

  it('the DELETE slice was actually found', () => {
    // Guards the two assertions below against passing on an empty string.
    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain('mcp-session-id');
    expect(handler.length).toBeGreaterThan(80);
  });

  it('DELETE no longer hand-deletes a partial map list', () => {
    expect(handler).toContain('_releaseSession(sid)');
    for (const m of ['sessions.delete(', 'sessionMeta.delete(',
                     'sessionLastActive.delete(', 'sessionSrv.delete(']) {
      expect(handler).not.toContain(m);
    }
  });

  it('DELETE guards the close() it awaits', () => {
    // Express 4 does not forward async rejections; an unguarded await here is
    // a hung request, not a 500.
    expect(handler).toMatch(/try\s*\{/);
    expect(handler).toMatch(/catch/);
  });
});

describe('/health reports the expensive map', () => {
  it('exposes session_servers alongside sessions', async () => {
    // #314 made the sweeper LOG sessionSrv drift, but a log-only signal is
    // invisible on Railway (restart-in-place under the same deploymentId keeps
    // it out of list-deployments). /health is the checkable-from-outside seam:
    // sessions flat while session_servers climbs is the OOM signature.
    const r = await fetch(`${base}/health`);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toHaveProperty('session_servers');
    expect(typeof j.session_servers).toBe('number');
  });
});
