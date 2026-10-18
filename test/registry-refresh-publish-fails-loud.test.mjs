// A registry publish that is neither "Successfully published" nor a duplicate
// version must FAIL the run. 2026-10-18: the registry's gateway returned a 504,
// the step printed a ::warning:: and the run went green with 2.12.39 unpublished.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const wf = readFileSync(new URL("../.github/workflows/registry-refresh.yml", import.meta.url), "utf8");
const start = wf.indexOf("Publish server.json to the official MCP registry");
const step = wf.slice(start, wf.indexOf("- name:", start + 10) > 0 ? wf.indexOf("- name:", start + 10) : undefined);

describe("registry-refresh publish step", () => {
  it("finds the publish step (non-vacuity)", () => {
    expect(start).toBeGreaterThan(0);
    expect(step).toContain("mcp-publisher publish");
    expect(step).toContain("Successfully published");
  });

  it("the unconfirmed-publish branch is an error that exits non-zero", () => {
    const i = step.indexOf("publish did not confirm success");
    expect(i).toBeGreaterThan(0);
    const branch = step.slice(Math.max(0, i - 40), step.indexOf("\n          fi", i));
    expect(branch).toContain("::error::");
    expect(branch).not.toContain("::warning::");
    expect(branch).toMatch(/exit 1/);
  });

  it("a duplicate version stays a notice, not a failure", () => {
    const i = step.indexOf("already on the registry");
    expect(i).toBeGreaterThan(0);
    expect(step.slice(Math.max(0, i - 40), i)).toContain("::notice::");
  });
});
