// The shared harness keeps the port it picked until server.mjs is imported, and reports a listen error.
//
// Smoke run 45608807788 (main, 2026-11-25): test/floor-masked-preview-offer.test.mjs failed with
// "listen EADDRINUSE 127.0.0.1:45755" and then "Hook timed out in 60000ms". startHarness picked a free port,
// released it, imported server.mjs (seconds), then listened on it. With one vitest worker per file another
// process was handed the port in between, and the listen error was never caught.
//
// helpers/port-grabber-server.mjs stands in for server.mjs and tries to take the picked port during its own import.
import { describe, it, expect, afterAll } from 'vitest';
import { startHarness } from './helpers/claude-directory-harness.mjs';

const GRABBER = new URL('./helpers/port-grabber-server.mjs', import.meta.url).href;
let H;
afterAll(async () => { if (H) { await H.S.releaseGrab(); await H.stop(); } });

describe('claude-directory-harness: the picked port cannot be taken while the server is imported', () => {
  it('a listener that tries the port during the import is refused, and the harness then serves on that port', async () => {
    // Without the hold the grab succeeds and startHarness now rejects with EADDRINUSE: this await throws.
    H = await startHarness({ serverUrl: GRABBER });
    expect(H.S.grab.port, 'the stand-in tried the port the harness picked').toBe(H.PORT);
    expect(H.S.grab, 'the port was still held during the import').toMatchObject({ took: false, code: 'EADDRINUSE' });
    const res = await H.get('/anything');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  }, 20_000);
});
