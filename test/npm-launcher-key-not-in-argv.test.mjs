// The npm launcher used to spawn mcp-remote with `--header X-API-Key:<key>`, so the
// caller's key sat on the child's command line, readable by anyone who can run `ps`
// (MCP Marketplace's security scan flagged it). The launcher now passes only a
// ${VAR} placeholder, which mcp-remote expands from its own environment.
//
// The launcher runs here against a stand-in mcp-remote that records the argv and env
// it was started with, so the test sees exactly what `ps` would.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createScratchRepo } from "./helpers/repo-sandbox.mjs";

const REAL_BIN = new URL("../npm-launcher/bin/dchub-mcp-server.mjs", import.meta.url);
const KEY = "dch_live_launcher_argv_probe_7f3a";

let box;
const run = (env) => {
  const out = path.join(box.root, `seen-${Math.random().toString(36).slice(2)}.json`);
  execFileSync(process.execPath, [path.join(box.root, "bin", "dchub-mcp-server.mjs")], {
    env: { PATH: process.env.PATH, SEEN_OUT: out, ...env },
    stdio: "ignore",
  });
  return JSON.parse(fs.readFileSync(out, "utf8"));
};

beforeAll(() => {
  box = createScratchRepo("dchub-launcher", { git: false });
  box.write("bin/dchub-mcp-server.mjs", fs.readFileSync(REAL_BIN, "utf8"));
  box.write("node_modules/mcp-remote/package.json", JSON.stringify({ name: "mcp-remote", version: "0.0.0-stub" }));
  // The stand-in records what it was started with: the same argv `ps` would list.
  box.write("node_modules/mcp-remote/dist/proxy.js",
    "require('fs').writeFileSync(process.env.SEEN_OUT, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\n");
  box.write("package.json", JSON.stringify({ name: "probe", type: "module" }));
});
afterAll(() => box.cleanup());

describe("npm launcher keeps the API key off the child command line", () => {
  it.each(["DCHUB_API_KEY", "X_API_KEY"])("%s: argv carries a placeholder, env carries the key", (name) => {
    const seen = run({ [name]: KEY });
    expect(seen.argv.join(" ")).not.toContain(KEY);
    const i = seen.argv.indexOf("--header");
    expect(i).toBeGreaterThan(-1);
    const m = /^X-API-Key:\$\{([A-Z_]+)\}$/.exec(seen.argv[i + 1]);
    expect(m, seen.argv[i + 1]).toBeTruthy();
    expect(seen.env[m[1]]).toBe(KEY);
  });

  it("no key: no header at all", () => {
    const seen = run({});
    expect(seen.argv).not.toContain("--header");
    expect(seen.argv.slice(0, 3)).toEqual(["https://dchub.cloud/mcp", "--transport", "http-only"]);
  });
});
