// The npm package `dchub-mcp-server` is the stdio launcher in npm-launcher/,
// not this repo root. npm served 2.12.19 while the server was 2.12.21 because
// the launcher had no source here and nothing tied the two versions together.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

describe("npm launcher", () => {
  const root = read("package.json");
  const launcher = read("npm-launcher/package.json");

  it("publishes the same version as the server", () => {
    expect(launcher.version).toBe(root.version);
  });

  it("is the launcher package, shipping only its bin", () => {
    expect(launcher.name).toBe("dchub-mcp-server");
    expect(launcher.files).toEqual(["bin", "README.md", "LICENSE"]);
    expect(launcher.bin["dchub-mcp-server"]).toBe("bin/dchub-mcp-server.mjs");
  });
});
