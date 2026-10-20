#!/usr/bin/env node
// Checks that a DC Hub MCP endpoint meets what Arcade's "Remote MCP" server type
// needs (docs.arcade.dev/guides/mcp-gateways/add-remote-servers, read 2026-10-20):
//   - reachable over Streamable HTTP (POST JSON-RPC, JSON or SSE reply);
//   - tools only (Arcade does not carry prompts, resources or sampling, so the
//     server's `instructions` never reach an Arcade agent; each result has to
//     carry its own cite_as / as_of);
//   - every tool in the chosen gateway profile is listed and read-only;
//   - one keyless call returns cite_as and as_of in the result itself.
//
// Usage:
//   node integrations/arcade/check-arcade-compat.mjs [--profile lean|read_only|core_endpoint] [--uri URL]
// DCHUB_API_KEY in the environment is sent as X-API-Key, as Arcade would send
// ${secret:DCHUB_API_KEY}. Requests carry DC Hub's QA markers so this check is
// not counted as Arcade traffic.

import { readFileSync } from 'node:fs';

export const CONFIG = JSON.parse(
  readFileSync(new URL('./arcade-remote-server.json', import.meta.url), 'utf8'));

// A Streamable HTTP reply is either a JSON body or an SSE stream whose `data:`
// lines carry the JSON-RPC message. Returns the first JSON-RPC object, or null.
export function parseRpcBody(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (s.startsWith('{')) {
    try { return JSON.parse(s); } catch { return null; }
  }
  for (const line of s.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const m = JSON.parse(line.slice(5).trim());
      if (m && m.jsonrpc === '2.0') return m;
    } catch { /* keep scanning */ }
  }
  return null;
}

// Compares a tools/list result with a profile's allowlist. Pure.
export function checkToolList(tools, allowlist) {
  const byName = new Map((tools || []).map((t) => [t.name, t]));
  const missing = allowlist.filter((n) => !byName.has(n));
  const notReadOnly = allowlist.filter(
    (n) => byName.has(n) && (byName.get(n).annotations || {}).readOnlyHint !== true);
  return { listed: byName.size, missing, notReadOnly, ok: !missing.length && !notReadOnly.length };
}

// True when a tool result carries both attribution fields somewhere in its
// text or structuredContent. Pure.
export function hasCitation(result) {
  const parts = [];
  for (const c of (result && result.content) || []) if (c && typeof c.text === 'string') parts.push(c.text);
  if (result && result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  const all = parts.join('\n');
  return { cite_as: /"?cite_as"?\s*[:=]/.test(all), as_of: /"?as_of"?\s*[:=]/.test(all) };
}

export function requestHeaders(env = process.env) {
  const h = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'user-agent': 'dchub-qa-readonly arcade-compat-check',
    'X-DCHub-QA': '1',
    ...CONFIG.headers,
  };
  if (env.DCHUB_API_KEY) h['X-API-Key'] = env.DCHUB_API_KEY;
  return h;
}

async function rpc(uri, headers, id, method, params) {
  const res = await fetch(uri, {
    method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const sid = res.headers.get('mcp-session-id');
  const ctype = res.headers.get('content-type') || '';
  const msg = parseRpcBody(await res.text());
  return { status: res.status, ctype, sid, msg };
}

// The keyless call each profile makes to prove attribution rides the result.
export const PROBE_CALL = Object.freeze({
  lean: ['search_facilities', { query: 'Ashburn', limit: 3 }],
  read_only: ['search_facilities', { query: 'Ashburn', limit: 3 }],
  core_endpoint: ['facility_lookup', { query: 'Ashburn' }],
});

export async function run({ uri, profile = 'lean', env = process.env, log = console.log } = {}) {
  const prof = CONFIG.gateway_profiles[profile];
  const allow = prof?.tools;
  if (!allow || !PROBE_CALL[profile]) throw new Error(`unknown profile ${profile}`);
  uri = uri || prof.uri || CONFIG.uri;
  const headers = requestHeaders(env);
  const fails = [];

  const init = await rpc(uri, headers, 1, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'arcade-compat-check', version: '1' },
  });
  log(`initialize: HTTP ${init.status} ${init.ctype.split(';')[0]} server=${init.msg?.result?.serverInfo?.version ?? '?'}`);
  if (init.status !== 200 || !init.msg?.result) fails.push('initialize did not return a result over Streamable HTTP');
  if (init.sid) headers['mcp-session-id'] = init.sid;

  const list = await rpc(uri, headers, 2, 'tools/list', {});
  const tl = checkToolList(list.msg?.result?.tools, allow);
  log(`tools/list: ${tl.listed} listed; profile ${profile}: ${allow.length} tools, missing=${tl.missing.join(',') || 'none'}, not read-only=${tl.notReadOnly.join(',') || 'none'}`);
  if (!tl.ok) fails.push('profile tools missing or not read-only');

  const [probeName, probeArgs] = PROBE_CALL[profile];
  const call = await rpc(uri, headers, 3, 'tools/call', { name: probeName, arguments: probeArgs });
  const cit = hasCitation(call.msg?.result);
  log(`tools/call ${probeName}: HTTP ${call.status} cite_as=${cit.cite_as} as_of=${cit.as_of}`);
  if (!cit.cite_as || !cit.as_of) fails.push('tool result lacks cite_as or as_of');

  log(fails.length ? `FAIL: ${fails.join('; ')}` : 'PASS: ready to register in Arcade as a Remote MCP server');
  return { ok: !fails.length, fails };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  run({ uri: arg('--uri'), profile: arg('--profile') || 'lean' })
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch((e) => { console.error(e.message || e); process.exit(2); });
}
