import { defineConfig } from "vitest/config";

// The repo's vitest suite lives in test/. The sdk/ packages ship their own
// runners (Python pytest, Node `node --test`), so scope collection to test/**
// to keep them out of the vitest run.
export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    // ★2026-09-04 — the 5s default is not a timeout, it is a load meter.
    // 158 files run in parallel across 14 workers and several of them import
    // server.mjs (19k lines) more than once per test via vi.resetModules(), at
    // ~1s per re-evaluation when the box is saturated. Tests that take 2.5-5s
    // when measured alone therefore cross 5s under the suite and fail as
    // timeouts — a failure that says nothing about the code under test and
    // lands in the same by-name failure diff the repo uses to clear a change.
    // Measured on main: test/anon-hard-wall.test.mjs timed out at 5000ms in 3
    // of 3 full-suite runs, passing 10/10 on its own.
    //
    // This is a hang detector, not an assertion: nothing is weakened by giving
    // it room. A genuinely hung test still fails, 25s later.
    testTimeout: 30_000,
    // beforeAll/afterAll hooks bind ports and import server.mjs, so they need
    // the same headroom for the same reason.
    hookTimeout: 30_000,
  },
});
