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

test("grid() returns cleanly without throwing", async () => {
  const g = await new DCHub().grid("ERCOT");
  assert.strictEqual(typeof g, "object");
});
