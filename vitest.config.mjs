import { defineConfig } from "vitest/config";

// The repo's vitest suite lives in test/. The sdk/ packages ship their own
// runners (Python pytest, Node `node --test`), so scope collection to test/**
// to keep them out of the vitest run.
export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    // Live-prod suites (mcp, regression) sign their probes to dchub.cloud when
    // WEB_BOT_AUTH_PRIVATE_JWK is set; a no-op otherwise.
    setupFiles: ["./lib/web-bot-auth-preload.mjs"],
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
    // ★2026-11-12 — vitest 5 turns fsModuleCache on by default and never
    // prunes it. Each run writes the transformed server.mjs (~13 MB) under a
    // new content hash in node_modules/.vitest-cache, so every edit leaves a
    // copy behind. Measured on the owner's Mac: 49 GB in this checkout and
    // 46 GB in one worktree, 104 GB across seven, after two weeks on vitest 5.
    // server.mjs changes on nearly every run, so the cache rarely hits anyway.
    fsModuleCache: false,
  },
});
