#!/usr/bin/env node
// qa-probe.mjs -- one live MCP tool call that is always marked read-only QA.
//
// WHY. On 2026-11-17 a colocation re-run probed live /mcp with plain curl and no QA marker, so about ten keyless
// calls were counted as real traffic, and the shared IP reached its anonymous daily wall mid-investigation. The
// server's QA skip (_isQaCaller) recognises only User-Agent `dchub-qa-readonly`, `X-DCHub-QA: 1` and the client
// name `dchub-qa-readonly`; a made-up marker protects nothing. This script sends all three on every call, so a
// probe cannot go out unmarked. Note: the markers keep a probe out of the counts; they do not lift the per-IP cap.
//
// Usage:
//   node scripts/qa-probe.mjs <tool> '<json args>' [--tag name] [--out file.json] [--url https://dchub.cloud/mcp]
//   node scripts/qa-probe.mjs execute_plan '{"intent":"Colocation options in Ashburn for 500 kW"}' --tag h2h
// Prints content[0] (the lead), the intent class and steps for execute_plan, and says plainly when the IP is walled.
// --out writes the full JSON-RPC result for replaying through local code.

import fs from 'node:fs';

export const QA_UA_PREFIX = 'dchub-qa-readonly';

/** The fetch init for one QA-marked tools/call. Pure (exported for test/qa-probe-markers.test.mjs). */
export function qaProbeRequest(tool, args, tag = 'probe') {
  const t = String(tag || 'probe').replace(/[^a-z0-9._-]/gi, '').slice(0, 40) || 'probe';
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'user-agent': `${QA_UA_PREFIX}/${t}`,
      'x-dchub-qa': '1',
      'x-mcp-client': QA_UA_PREFIX,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args || {},
      _meta: { clientInfo: { name: QA_UA_PREFIX, version: t } } } }),
  };
}

/** The JSON-RPC message from an SSE or plain JSON body, or null. */
export function parseRpcBody(text) {
  const s = String(text || '');
  const data = s.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
  try { return JSON.parse(data || s); } catch (_e) { return null; }
}

async function main(argv) {
  const [tool, rawArgs, ...rest] = argv;
  if (!tool) { console.error('usage: node scripts/qa-probe.mjs <tool> \'<json args>\' [--tag t] [--out f] [--url u]'); return 2; }
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  let args = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch (e) { console.error(`args are not JSON: ${e.message}`); return 2; }
  const url = opt('--url') || process.env.DCHUB_MCP_URL || 'https://dchub.cloud/mcp';
  const res = await fetch(url, qaProbeRequest(tool, args, opt('--tag') || 'probe'));
  const msg = parseRpcBody(await res.text());
  if (!msg) { console.error(`HTTP ${res.status}: body was not JSON-RPC`); return 1; }
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(msg, null, 2));
  const r = msg.result || {};
  const sc = r.structuredContent || {};
  if (sc.error === 'anon_hard_wall' || sc.binding_limit === 'anon_ip_daily_hard') {
    console.log(`WALLED: this IP reached the anonymous daily limit (${sc.limit ?? '?'}); retry after UTC midnight or replay saved payloads.`);
    return 3;
  }
  const lead = r.content && r.content[0] && r.content[0].text;
  console.log(String(lead || JSON.stringify(msg.error || r)).slice(0, 1500));
  if (sc._entity === 'plan_execution') {
    console.log(`\nintent_class: ${sc.intent_class}  planner: ${sc.planner_version}`);
    for (const e of sc.executed || []) console.log(`  ${e.step} ${e.tool} ${e.status} ${JSON.stringify(e.args || {})}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
