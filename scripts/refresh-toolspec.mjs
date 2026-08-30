#!/usr/bin/env node
// ============================================================================
// refresh-toolspec.mjs (2026-08-30) — regenerate toolspec.json from the ONE
// surface that renders real JSON Schema for every tool: the live tools/list.
//
// WHY THIS EXISTS. toolspec.json was a snapshot that stopped being taken. On
// 2026-08-30 it held 79 tools against a live 83, and `properties` was EMPTY for
// every single one of them — each inputSchema was the bare {"type":"object"}.
// It was in sync-tools-manifest's COVERAGE list, so the daily job faithfully
// healed the PHRASE QUANTITIES inside it every day while the tool list itself
// rotted. That is the shape #269 named: a PARTIALLY healed surface reads more
// current than an untouched one, because every number beside the stale part is
// right.
//
// ★ WHAT THE VACUUM COST, concretely. server.mjs's ARG_ALIASES map guesses
// argument names for agents ({location} -> market, …). Its targets MUST be real
// declared properties, and server.mjs says outright that this repo "CANNOT
// assert that" because "validating against it would pass vacuously". So a
// property renamed upstream would leave a silent no-op alias and no test here
// would catch it. A schema file with no schemas did not merely fail to help —
// it blocked the guard that needed it.
//
// ★ DERIVE, NEVER RESTATE — same contract as refresh-tool-maturity.mjs and
// refresh-problem-taxonomy.mjs. Nothing here states a tool, a description or a
// property. It asks the gateway and writes down what it answers.
//
// FAIL-CLOSED, and closed means UNCHANGED: any transport error, non-ok body,
// missing tools/list frame, an empty tool list, or a result whose schemas are
// as vacuous as the file we are replacing -> log and exit 0 WITHOUT writing.
// Overwriting a good snapshot with a degraded one is the only outcome worse
// than leaving it stale, because the guard downstream would then validate
// against the degraded copy and pass.
//
// SHAPE IS PRESERVED: a bare ARRAY of {name, description, inputSchema}. That is
// what the file has always been and what a ChatGPT/OpenAI function-spec paste
// expects. Freshness is NOT stamped into it — test/toolspec-is-real.test.mjs
// detects staleness by comparing the NAMES against the trackedTool() set in
// server.mjs, which is deterministic, offline, and cannot become a time bomb
// the way an embedded date would.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'toolspec.json');
const MCP_URL = process.env.MCP_URL || 'https://dchub.cloud/mcp';

const bail = (why) => { console.log(`toolspec refresh: ✗ ${why} — leaving toolspec.json UNCHANGED`); process.exit(0); };

// Self-identify as OUR probe. `dchub-canon-probe` is already in
// mcp_calls_deloop.PROBE_PLATFORMS and the mcp_calls_identity exclusions, so
// this handshake is not published as external agent demand. A novel clientInfo
// name would quietly inflate the demand numbers this repo reports on.
const CLIENT = { name: 'dchub-canon-probe', version: '1' };
const HDRS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

function frame(text, id) {
  for (let ln of text.split('\n')) {
    if (ln.startsWith('data: ')) ln = ln.slice(6);
    ln = ln.trim();
    if (!ln.startsWith('{')) continue;
    try {
      const d = JSON.parse(ln);
      if (d.id === id) return d;
    } catch { /* not our frame */ }
  }
  return null;
}

async function main() {
  let sid, listText;
  try {
    const init = await fetch(MCP_URL, {
      method: 'POST', headers: HDRS,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: CLIENT } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!init.ok) bail(`initialize returned ${init.status}`);
    sid = init.headers.get('mcp-session-id');
    if (!sid) bail('initialize returned no mcp-session-id');
    const res = await fetch(MCP_URL, {
      method: 'POST', headers: { ...HDRS, 'mcp-session-id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) bail(`tools/list returned ${res.status}`);
    listText = await res.text();
  } catch (e) {
    bail(`transport error: ${String(e).slice(0, 120)}`);
  }

  const d = frame(listText, 2);
  if (!d) bail('no tools/list frame in the response');
  if (d.error) bail(`tools/list error: ${JSON.stringify(d.error).slice(0, 120)}`);
  const tools = d.result && d.result.tools;
  if (!Array.isArray(tools) || tools.length === 0) bail('tools/list carried no tools');

  const spec = tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object' },
  })).sort((a, b) => a.name.localeCompare(b.name));

  // The degradation check. The file we are replacing had 79 tools and ZERO
  // declared properties; writing another one of those would re-arm the exact
  // vacuum this script exists to end.
  const withProps = spec.filter((t) => Object.keys((t.inputSchema || {}).properties || {}).length > 0).length;
  if (withProps === 0) bail(`all ${spec.length} schemas came back with no properties`);

  const prev = (() => { try { return fs.readFileSync(OUT, 'utf8'); } catch { return null; } })();
  const next = JSON.stringify(spec, null, 2) + '\n';
  if (prev === next) {
    console.log(`toolspec refresh: ✓ already current — ${spec.length} tools, ${withProps} with declared properties`);
    return;
  }
  fs.writeFileSync(OUT, next);
  const props = spec.reduce((n, t) => n + Object.keys((t.inputSchema || {}).properties || {}).length, 0);
  console.log(`toolspec refresh: ✓ wrote toolspec.json — ${spec.length} tools, ${withProps} with schemas, ${props} declared properties`);
}

main();
