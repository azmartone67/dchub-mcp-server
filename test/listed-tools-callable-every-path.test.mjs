// listed-tools-callable-every-path.test.mjs — every tool a path LISTS, that
// same path must CALL (Grok proof run 2026-11-16, item 7).
//
// THE REPORT. Grok's execute_plan proof run (2026-11-16) saw
// get_power_availability_timeline in tools/list on its partner connector and a
// failed tools/call for it there, while the same call answered on /mcp. A list
// that offers a tool the call path then refuses is the worst kind of drift: the
// agent picked the tool BECAUSE we listed it.
//
// Measured live the same day (keyless and with a partner key, 2026-11-16
// ~22:52Z): tools/list vs tools/call get_power_availability_timeline {state:OH}
// on all 32 POST paths. Every path that lists the tool answered the call with
// data or a preview; the refusal did not reproduce. So this file does not fix a
// line, it closes the class: list and call are decided by DIFFERENT code
// (tools/list goes through _packFilter / directoryToolsList / the core list,
// tools/call through the alias pass, the directory and core preludes and the
// SDK registry), and nothing pinned that they agree.
//
// WHAT IT ASSERTS, for EVERY path in MCP_PATHS (the exact list app.post serves):
//   tools/list, then tools/call for EVERY listed name, twice: with a key the
//   stub backend accepts as Pro (the partner case: a keyed caller) and with no
//   key (an OAuth path answers a keyless call with its sign-in challenge before
//   any tool is resolved, by design, so those are keyed-only). A call passes
//   when the path RESOLVED the tool — any answer, a validation error for the
//   empty arguments included — and fails when the answer is a resolution
//   refusal: "Unknown tool", "Tool <name> not found" or "Tool <name> disabled"
//   (the SDK's three), in a JSON-RPC error or in an isError result.
//
// Mutation-tested 2026-11-16: (a) the alias pass rewriting
// get_power_availability_timeline to an unregistered name failed it on every
// full-catalog, pack, grok and directory path that lists the tool; (b) the
// /mcp/core prelude refusing grid_power failed it on /mcp/core; (c) the
// directory prelude refusing get_power_availability_timeline failed it on
// /mcp/claude and /mcp/chatgpt. The vacuity check below proves the predicate
// fires on a real refusal from this server.
//
// Real handler over HTTP, local stub backend, no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const fence = fenceNetwork();
let H;

beforeAll(async () => {
  H = await startHarness();
}, 60_000);

afterAll(async () => {
  if (H) await H.stop();
  fence.restore();
});

const UA = { 'user-agent': 'listed-callable-guard/1.0' };
const KEYED = { ...UA, 'x-api-key': PRO_KEY };
const OAUTH_PATH = /\/oauth$/;

// A resolution refusal: the path did not find the tool at all. Anything else
// (data, a preview, a wall, an argument-validation error) means it resolved.
// 2026-11-27 (lib/unlisted-tool.mjs): a restricted endpoint refuses a real DC Hub tool it does not serve with
// "... not available on this endpoint ...", which is a resolution refusal too.
const REFUSAL = /\bUnknown tool\b|\bTool [A-Za-z0-9_.-]+ (not found|disabled)\b|\bnot available on this endpoint\b/;

function refusalOf(r) {
  const m = r.msg;
  if (!m) return r.status === 404 ? 'HTTP 404' : null;
  if (m.error && REFUSAL.test(String(m.error.message || ''))) return String(m.error.message);
  const res = m.result;
  if (res && res.isError && Array.isArray(res.content)) {
    const t = res.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join(' ');
    if (REFUSAL.test(t)) return t.slice(0, 160);
  }
  return null;
}

// With session: true the calls carry the Mcp-Session-Id initialize handed out,
// which is how a hosted connector calls, and routes through the session branch
// instead of the stateless handler.
async function listedNames(path, headers, session) {
  const i = await H.init(path, 'listed-callable-guard', headers);
  const sid = session ? i.headers.get('mcp-session-id') : null;
  const h = sid ? { ...headers, 'mcp-session-id': sid } : headers;
  if (sid) await H.post(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  const r = await H.list(path, h);
  const tools = r.msg && r.msg.result && r.msg.result.tools;
  return { names: Array.isArray(tools) ? tools.map((t) => t.name) : null, h, sid };
}

async function sweep(base, { skip = () => false, session = false } = {}) {
  const failures = [];
  const empty = [];
  let calls = 0;
  let sessions = 0;
  for (const path of H.S.MCP_PATHS) {
    if (skip(path)) continue;
    const { names, h: headers, sid } = await listedNames(path, base, session);
    if (sid) sessions += 1;
    if (!names || !names.length) { empty.push(path); continue; }
    for (const name of names) {
      calls += 1;
      const why = refusalOf(await H.call(path, name, {}, headers));
      if (why) failures.push(`${path} lists ${name} but tools/call refused it: ${why}`);
    }
  }
  return { failures, empty, calls, sessions };
}

describe('every tool a path lists is callable on that path', () => {
  it('the refusal predicate fires on real refusals from this server (not vacuous)', async () => {
    expect(refusalOf(await H.call('/mcp', 'no_such_tool_listed_callable_guard', {}, KEYED))).toBeTruthy();
    // /mcp/core does not list the canonical names, and refuses them.
    expect(refusalOf(await H.call('/mcp/core', 'get_power_availability_timeline', { state: 'OH' }, KEYED))).toBeTruthy();
    // /mcp/claude does not list claim_free_key, and refuses it.
    expect(refusalOf(await H.call('/mcp/claude', 'claim_free_key', {}, KEYED))).toBeTruthy();
  }, 30_000);

  it('MCP_PATHS is the served list and covers every listing kind', () => {
    expect(Array.isArray(H.S.MCP_PATHS)).toBe(true);
    expect(H.S.MCP_PATHS.length).toBeGreaterThan(20);
    for (const p of ['/mcp', '/mcp/grok', '/mcp/core', '/mcp/light', '/mcp/claude', '/mcp/chatgpt',
      '/mcp/hub-grok-bot', '/mcp/power', '/mcp/grid', '/mcp/oauth']) {
      expect(H.S.MCP_PATHS).toContain(p);
    }
  });

  it('keyed: every listed tool on every path resolves on tools/call', async () => {
    const { failures, empty, calls } = await sweep(KEYED);
    expect(empty, `paths whose tools/list returned no tools: ${empty.join(', ')}`).toEqual([]);
    expect(calls).toBeGreaterThan(500);
    expect(failures).toEqual([]);
  }, 300_000);

  it('keyed, in a session: every listed tool on every path resolves on tools/call', async () => {
    const { failures, empty, calls, sessions } = await sweep(KEYED, { session: true });
    expect(empty, `paths whose tools/list returned no tools: ${empty.join(', ')}`).toEqual([]);
    expect(calls).toBeGreaterThan(500);
    expect(sessions, 'initialize handed out no session id, so the session branch was not exercised').toBeGreaterThan(10);
    expect(failures).toEqual([]);
  }, 300_000);

  it('keyless: every listed tool on every non-OAuth path resolves on tools/call', async () => {
    const { failures, empty, calls } = await sweep(UA, { skip: (p) => OAUTH_PATH.test(p) });
    expect(empty, `paths whose tools/list returned no tools: ${empty.join(', ')}`).toEqual([]);
    expect(calls).toBeGreaterThan(500);
    expect(failures).toEqual([]);
  }, 300_000);
});
