// Offline tests for dchub/ai-sdk: a fake DC Hub client and a fake `ai` module,
// so the wiring is checked without the network or an installed AI SDK.
import assert from "node:assert";
import { test } from "node:test";
import { dchubTools, resultText, DEFAULT_VIA } from "../ai-sdk.mjs";
import { DESCRIPTION_PREFIX } from "../compose.mjs";

const fakeAi = {
  tool: (def) => ({ ...def, _isTool: true }),
  jsonSchema: (s) => ({ _jsonSchema: s }),
};

function fakeClient({ isError = false } = {}) {
  const calls = [];
  return {
    calls,
    async listTools() {
      return [
        { name: "get_grid_data", description: "Grid.", inputSchema: { type: "object", properties: { iso: { type: "string" } } } },
        { name: "rank_markets", description: "Rank.", inputSchema: { type: "object", properties: {} } },
      ];
    },
    async callRaw(name, args) {
      calls.push([name, args]);
      return { content: [{ type: "text", text: `{"tool":"${name}","as_of":"2026-11-09"}` }], isError };
    },
  };
}

test("builds one AI SDK tool per requested DC Hub tool, with DC Hub's schema", async () => {
  const client = fakeClient();
  const set = await dchubTools({ ai: fakeAi, client, tools: ["get_grid_data"] });
  assert.deepStrictEqual(Object.keys(set), ["get_grid_data"]);
  const t = set.get_grid_data;
  assert.ok(t._isTool);
  assert.ok(t.description.startsWith(DESCRIPTION_PREFIX));
  assert.deepStrictEqual(t.inputSchema._jsonSchema.properties, { iso: { type: "string" } });
});

test("execute calls the remote tool and returns its text unchanged", async () => {
  const client = fakeClient();
  const set = await dchubTools({ ai: fakeAi, client, tools: "all", prefix: "dchub_" });
  assert.deepStrictEqual(Object.keys(set).sort(), ["dchub_get_grid_data", "dchub_rank_markets"]);
  const out = await set.dchub_get_grid_data.execute({ iso: "ERCOT" });
  assert.deepStrictEqual(client.calls, [["get_grid_data", { iso: "ERCOT" }]]);
  assert.strictEqual(out, '{"tool":"get_grid_data","as_of":"2026-11-09"}');
});

test("an MCP error result becomes a thrown tool error", async () => {
  const set = await dchubTools({ ai: fakeAi, client: fakeClient({ isError: true }), tools: ["get_grid_data"] });
  await assert.rejects(() => set.get_grid_data.execute({ iso: "X" }), /get_grid_data/);
});

test("an unknown tool name fails at build time", async () => {
  await assert.rejects(() => dchubTools({ ai: fakeAi, client: fakeClient(), tools: ["nope"] }), /does not serve: nope/);
});

test("a module without tool/jsonSchema is rejected", async () => {
  await assert.rejects(() => dchubTools({ ai: {}, client: fakeClient() }), /Vercel AI SDK/);
});

test("resultText joins text parts and serialises others", () => {
  assert.strictEqual(resultText({ content: [{ type: "text", text: "a" }, { type: "image", data: "x" }] }), 'a\n{"type":"image","data":"x"}');
  assert.strictEqual(resultText(undefined), "");
  assert.strictEqual(DEFAULT_VIA, "ai-sdk");
});
