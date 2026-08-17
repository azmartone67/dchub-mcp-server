// r-value-object (2026-08-17): hyperscaler_deals output-schema contract.
//
// WHY THIS FILE EXISTS
// ====================
// The MCP SDK validates the handler's result against the tool's declared
// outputSchema AFTER the handler returns. A field whose declared type is
// narrower than what the backend actually emits therefore fails the WHOLE call
// with -32602 "Invalid structured content" — the agent gets no data, no
// preview, no paywall CTA and no human-relay link. It is the harshest possible
// failure mode on a monetised tool, and it is invisible to our own telemetry:
// mcp_tool_calls / mcp_call_log record the HANDLER's outcome, so all 259 calls
// in the 30d to 2026-08-17 logged `success = true` / `status = 'ok'` while
// every one of them actually returned a protocol error to the caller.
//
// This has now happened TWICE to the same tool, from the same cause — the
// backend enriching a bare number into a {value, display} pair:
//   * 2026-07-19  `capacity`   40.0        -> {value:1600.0, display:"1.6 GW"}
//   * 2026-08-17  `value_usd`  3.56e10     -> {value:3.56e10, display:"$35.6B"}
// The July fix loosened `capacity` only, so the identical August regression on
// `value_usd` shipped unnoticed. These tests pin BOTH fields against the shapes
// the backend really emits, so the next enrichment fails here instead of in
// production.
//
// The fixtures below are verbatim from a live read of the backend feed on
// 2026-08-17 (GET /api/v1/hyperscaler-deals?limit=3 on
// dchub-backend-production.up.railway.app). Kept as fixtures, not a live fetch,
// so this file qualifies for the deterministic HARD gate — see the rationale in
// .github/workflows/test.yml for why the live-API suite runs informational.
// The emitters are routes/hyperscaler_deals.py::_extract_dollars / _extract_mw.
import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../server.mjs';

let tool;
beforeAll(() => {
  tool = createServer()._registeredTools['hyperscaler_deals'];
});

const parse = async (payload) => tool.outputSchema.safeParseAsync(payload);

// A guard that silently stopped finding its target would pass unconditionally.
describe('the guard found what it is guarding', () => {
  it('hyperscaler_deals is registered and declares an outputSchema', () => {
    expect(tool, 'hyperscaler_deals not registered').toBeTruthy();
    expect(tool.outputSchema, 'hyperscaler_deals declares no outputSchema — this file would pass vacuously').toBeTruthy();
  });
});

describe('hyperscaler_deals accepts the shapes the backend actually emits', () => {
  it('the live 2026-08-17 payload parses (object value_usd AND object capacity)', async () => {
    const r = await parse({
      feed_name: 'Hyperscaler AI Deal Tracker',
      deals: [
        { id: 1, title: 'CoreWeave revenue doubles as debt pile reaches $35.6B',
          value_usd: { value: 35600000000.0, display: '$35.6B' }, capacity: null },
        { id: 2, title: 'OpenAI’s Project Camellia was on Georgia Power’s radar',
          value_usd: null, capacity: { value: 3200.0, display: '3200.0 MW' } },
        { id: 3, title: 'Nvidia in talks to back OpenAI’s $500bn Ohio data centre',
          value_usd: { value: 250000000000.0, display: '$250.0B' },
          capacity: { value: 10000.0, display: '10.0 GW' } },
      ],
      result_count: 3,
    });
    // Surface the real zod issue on failure — an "expected true, got false"
    // tells the next reader nothing about which field drifted.
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('an undisclosed deal (both fields null) parses', async () => {
    const r = await parse({ deals: [{ id: 9, value_usd: null, capacity: null }], result_count: 1 });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  // The pre-enrichment shapes must keep parsing: the feed is regex-extracted
  // per article, so a rollback or a partially-migrated window can legitimately
  // mix bare numbers and objects inside ONE response.
  it('the pre-2026 bare-number shapes still parse', async () => {
    const r = await parse({
      deals: [{ id: 10, value_usd: 1000000000, capacity: 40.0 }],
      result_count: 1,
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('a response mixing bare-number and object forms parses', async () => {
    const r = await parse({
      deals: [
        { id: 11, value_usd: 1000000000, capacity: 40.0 },
        { id: 12, value_usd: { value: 2.5e11, display: '$250.0B' }, capacity: { value: 10000.0, display: '10.0 GW' } },
      ],
      result_count: 2,
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});
