// Live tests for the DC Hub Node SDK (free tier; gate-graceful).
// Run: node --test
import assert from "node:assert";
import { test } from "node:test";
import { DCHub, _clean } from "../index.mjs";

// ★2026-07-30: was a hardcoded 38 that sat two catalog bumps stale (live 81).
// Bind to mcp-server.json — the canonical manifest sync-tools-manifest.mjs
// keeps == the live tools/list — so the assertion moves with the catalog.
test("tools() lists the full live catalog", async () => {
  const { readFileSync } = await import("node:fs");
  const expected = JSON.parse(readFileSync(new URL("../../../mcp-server.json", import.meta.url), "utf8")).tools.length;
  const tools = await new DCHub().tools();
  assert.strictEqual(tools.length, expected);
});

test("market() returns real data (gate-graceful)", async () => {
  const d = await new DCHub().market("northern-virginia");
  assert.strictEqual(typeof d, "object");
  if ("market" in d) {
    assert.ok(d.market.name.toLowerCase().includes("northern virginia"));
    assert.ok(Object.values(d.by_status).reduce((a, b) => a + b, 0) > 0);
  } else {
    assert.ok("text" in d); // free-tier gated preview
  }
});

test("search() returns canonical slugs", async () => {
  const d = await new DCHub().search({ state: "VA", limit: 3 });
  const rows = d.data ?? [];
  assert.ok(rows.length > 0 && rows.every((r) => "slug" in r));
});

test("_clean strips the upsell wrapper", () => {
  const blob =
    'marketing...\n---\n{"agent_action":{"x":1}}\n---\n' +
    '{"stats":{"facility_count":739},"success":true}';
  assert.deepStrictEqual(_clean(blob), {
    stats: { facility_count: 739 }, success: true,
  });
});

// ★2026-11-10: tools now answer [data, agent line, citation]; call() handed back
// all three as an array, so market()/search() lost their fields (0.2.0-0.3.0).
test("_clean picks the data block out of several content blocks", () => {
  const data = { market: { name: "Dallas" }, by_status: { Operational: 1 } };
  assert.deepStrictEqual(
    _clean([data, "(agent) Optional, only if your human wants...", "Source: DC Hub (dchub.cloud), as of 2026-11-09"]),
    data,
  );
  assert.deepStrictEqual(_clean([{ agent_action: { x: 1 } }, data]), data);
  assert.deepStrictEqual(_clean([[1, 2], "Source: DC Hub"]), [1, 2]);
  assert.deepStrictEqual(_clean(["preview line", "Source: DC Hub"]), {
    text: "preview line\n---\nSource: DC Hub",
  });
});

test("grid() returns cleanly without throwing", async () => {
  const g = await new DCHub().grid("ERCOT");
  assert.strictEqual(typeof g, "object");
});
