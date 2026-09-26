// claude-directory-readout.test.mjs — r-claude-directory (2026-09-26)
//
// /mcp/claude traffic must stay OUT of the relay / 10-01 readout
// (frz-claude-relay-wording, dec-claude-go-c). The readout is built from what
// this server reports to dchub-backend when a relay line is shown or could be
// acted on, and from the Claude-connector arrival/challenge counters:
//   POST /api/v1/mcp/signal-paywall   mcp_upgrade_signals (message_shown, relay_specificity = r-arms)
//   POST /api/v1/mcp/track-paid-hit   mcp_high_intent_sessions (the funnel's relay_minted)
//   GET  /api/v1/mcp/should-mint-claim  claim links
//   POST /api/v1/keys/auto-mint       trial keys the relay pitch hands out
//   _chCounts (→ /api/v1/mcp/oauth-challenge/emit)  claude_connector_seen, challenges
// /mcp/claude shows no relay line, so none of those may fire from it — not from
// the call itself and not from execute_plan's loopback steps. Its ordinary
// usage rows (/api/v1/mcp/track) still go out, tagged source='claude-directory'
// so any readout query over mcp_tool_calls can exclude them.
//
// CONTROL: the same Claude-connector calls on /mcp DO fire those beacons.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CLAUDE_SOURCE, excludedFromRelayReadout, RELAY_READOUT_EXCLUDED_SOURCES, CLAUDE_PROFILE } from '../lib/claude-directory.mjs';
import { startHarness, fenceNetwork, GUESS_ARGS } from './helpers/claude-directory-harness.mjs';

const READOUT_BEACONS = ['/api/v1/mcp/signal-paywall', '/api/v1/mcp/track-paid-hit',
  '/api/v1/mcp/should-mint-claim', '/api/v1/keys/auto-mint', '/api/v1/mcp/high-intent/redeem'];
const TOOLS = ['get_grid_intelligence', 'get_fiber_intel', 'get_water_risk', 'get_market_intel', 'execute_plan'];
const UA = { 'user-agent': 'Claude-User' };
let H, fence;
const runs = {};

async function run(path) {
  const before = H.hits.length;
  const counts0 = new Map(H.S._chCounts);
  const init = await H.init(path, 'claude-ai', UA);
  const sid = init.headers.get('mcp-session-id');
  const hdr = sid ? { ...UA, 'mcp-session-id': sid } : UA;
  for (const t of TOOLS) await H.call(path, t, GUESS_ARGS, hdr);
  const hits = H.hits.slice(before);
  const counts = new Map(H.S._chCounts);
  const delta = {};
  for (const [k, v] of counts) { const d = v - (counts0.get(k) || 0); if (d) delta[k] = d; }
  return { hits, delta };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
  runs.mcp = await run('/mcp');
  runs.claude = await run('/mcp/claude');
}, 120_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

describe('CONTROL: the Claude connector on /mcp feeds the readout', () => {
  it('fires paywall signals, a high-intent hit, a claim check and a trial mint', () => {
    const paths = new Set(runs.mcp.hits.map((h) => h.path));
    for (const b of ['/api/v1/mcp/signal-paywall', '/api/v1/mcp/track-paid-hit', '/api/v1/mcp/should-mint-claim', '/api/v1/keys/auto-mint']) {
      expect(paths.has(b), b).toBe(true);
    }
  });
  it('bumps the Claude-connector arrival counter', () => {
    expect(runs.mcp.delta['claude_connector_seen:initialize']).toBe(1);
    expect(runs.mcp.delta['claude_connector_seen:tools/call']).toBe(TOOLS.length);
  });
});

describe('/mcp/claude is excluded from the readout', () => {
  it('no readout beacon fires, from the calls or from execute_plan steps', () => {
    const fired = runs.claude.hits.filter((h) => READOUT_BEACONS.includes(h.path)).map((h) => h.path);
    expect(fired).toEqual([]);
  });
  it('no challenge or arrival counter moves', () => {
    expect(runs.claude.delta).toEqual({});
  });
  it('every usage row it sends is tagged source=claude-directory, execute_plan steps included', () => {
    const rows = runs.claude.hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.event !== 'recipe_lifecycle');
    expect(rows.length).toBeGreaterThanOrEqual(TOOLS.length + 2);   // + loopback steps + execute_plan_steps
    for (const r of rows) expect(r.body.source, r.body.tool).toBe(CLAUDE_SOURCE);
    // The loopback steps are there (site_selection_canvas is a step, not a call we made).
    const tools = rows.map((r) => r.body.tool);
    expect(tools).toContain('execute_plan_steps');
    expect(tools.filter((t) => !TOOLS.includes(t) && t !== 'execute_plan_steps').length).toBeGreaterThan(0);
  });
  it('CONTROL: /mcp usage rows carry no source (canonical path, unchanged)', () => {
    const rows = runs.mcp.hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.event !== 'recipe_lifecycle');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.body.source == null, r.body.tool).toBe(true);
  });
});

describe('the predicate', () => {
  it('excludes the Claude profile and the claude-directory source, nothing else', () => {
    expect(excludedFromRelayReadout({ profile: CLAUDE_PROFILE })).toBe(true);
    expect(excludedFromRelayReadout({ source: CLAUDE_SOURCE })).toBe(true);
    expect(excludedFromRelayReadout({ source: 'anthropic-directory' })).toBe(false);   // /mcp/anthropic stays in
    expect(excludedFromRelayReadout({ profile: 'chatgpt_directory' })).toBe(false);
    expect(excludedFromRelayReadout({})).toBe(false);
    expect(excludedFromRelayReadout(null)).toBe(false);
    expect([...RELAY_READOUT_EXCLUDED_SOURCES]).toEqual([CLAUDE_SOURCE]);
  });
});
