// Offline: what search() actually puts on the wire. No network — fetch is
// replaced, and the captured tools/call arguments are asserted.
//
// 2026-09-25 QA: search({ q: "Ashburn" }) returned Hampton first. The SDK sent
// `q`, but search_facilities declares `query` (the server maps it to the
// backend's parameter), so `q` was an undeclared argument dropped before the
// handler and the call returned the unfiltered fleet. Measured the same day:
// GET /api/v1/facilities?query=Ashburn -> "Level 3 Ashburn" first; with no
// text filter -> "Equinix Hampton xScale Campus" first.
import assert from "node:assert";
import { test } from "node:test";
import { DCHub } from "../index.mjs";

function capture() {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const result = body.method === "tools/call"
      ? { content: [{ type: "text", text: JSON.stringify({ data: [] }) }] }
      : {};
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": "s1" },
    });
  };
  const toolArgs = () => calls.find((c) => c.method === "tools/call")?.params;
  return { toolArgs, restore: () => { globalThis.fetch = orig; } };
}

test("search({ q }) sends the tool's declared `query` argument, never `q`", async () => {
  const cap = capture();
  try {
    await new DCHub({ apiKey: "" }).search({ q: "Ashburn", state: "VA" });
    const p = cap.toolArgs();
    assert.strictEqual(p.name, "search_facilities");
    assert.deepStrictEqual(p.arguments, { limit: 5, query: "Ashburn", state: "VA" });
    assert.ok(!("q" in p.arguments));
  } finally { cap.restore(); }
});

test("search({ query }) is accepted and wins over q", async () => {
  const cap = capture();
  try {
    await new DCHub({ apiKey: "" }).search({ query: "Dallas", q: "ignored", limit: 2 });
    assert.deepStrictEqual(cap.toolArgs().arguments, { limit: 2, query: "Dallas" });
  } finally { cap.restore(); }
});

test("search() with no text sends no text argument", async () => {
  const cap = capture();
  try {
    await new DCHub({ apiKey: "" }).search({ country: "US" });
    assert.deepStrictEqual(cap.toolArgs().arguments, { limit: 5, country: "US" });
  } finally { cap.restore(); }
});
