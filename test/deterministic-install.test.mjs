// The dependency tree that ships must be the LOCKED one.
//
// ★2026-08-23. On 2026-08-21 every one of the 82 tools was dead for Claude
// Code and Claude Desktop: the SDK stamped `"$schema": draft-07` on every
// outputSchema and the bundled client rejected the lot ("unsupported
// dialect"). The fix (#215) strips the dialect — but the deeper exposure is
// that the SDK's schema-emission behaviour IS our wire contract, and the
// build was not pinned to a specific SDK.
//
// package.json asks for ^1.28.0. `npm install` may resolve anywhere in 1.x
// (1.30.0 is published) whenever the lockfile is absent or out of step, so
// the served schema shape could change without a single line of our code
// changing — and no test would see it, because every one of our probes runs
// against whatever got installed.
//
// `npm ci` installs the locked tree or exits non-zero, and REQUIRES a
// lockfile, so a missing one is a red build rather than a silent floating
// resolve.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("the build installs the locked dependency tree", () => {
  it("has a lockfile at all (npm ci requires one)", () => {
    expect(existsSync(join(ROOT, "package-lock.json"))).toBe(true);
  });

  for (const [file, needle] of [
    ["Dockerfile", /^RUN npm ci\b/m],
    ["railway.toml", /buildCommand\s*=\s*"npm ci"/],
    [".github/workflows/test.yml", /run:\s*npm ci\b/],
  ]) {
    it(`${file} uses npm ci, never npm install`, () => {
      const txt = read(file);
      expect(txt).toMatch(needle);
      // A bare `npm install` anywhere in an install step reintroduces the
      // floating resolve. Comments explaining WHY are fine, so only reject
      // it as a command.
      const asCommand = txt
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"))
        .filter((l) => /(^|\s)npm install(\s|$)/.test(l));
      expect(asCommand).toEqual([]);
    });
  }

  it("Dockerfile copies the lockfile deterministically", () => {
    const txt = read("Dockerfile");
    // `package-lock.json*` is a GLOB: it matches nothing, silently, when the
    // file is absent — which is exactly how an unpinned install survives a
    // build that looks like it pinned one.
    expect(txt).not.toMatch(/COPY .*package-lock\.json\*/);
    expect(txt).toMatch(/COPY package\.json package-lock\.json \.\//);
  });

  it("the lockfile pins one exact MCP SDK version", () => {
    const lock = JSON.parse(read("package-lock.json"));
    const entries = Object.entries(lock.packages || {}).filter(([k]) =>
      k.endsWith("node_modules/@modelcontextprotocol/sdk"),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const [, meta] of entries) {
      // an exact version, not a range — this is the wire contract
      expect(meta.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
