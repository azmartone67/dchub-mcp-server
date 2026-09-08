#!/usr/bin/env node
// ============================================================================
// Per-pack manifests, DERIVED — never transcribed.
//
// WHY THIS EXISTS. The alternative on the table was handing a document to our
// partner agents (Gemini, Grok, Meta, ChatGPT) and letting each one populate
// its own connector schema from it. That is a transcription step, and every
// transcription of a count into an agent config has produced the same defect:
// a stale number no fence watches. The Mistral Org Agent served "74 tools over
// 21,000+ facilities" for weeks because a human pasted it once and nothing
// re-read it. Agent prompts are an UNGUARDED canon surface.
//
// So the pack listings are generated from the same two owners the rest of the
// publish surfaces already use, and the generator is a CI check as well as a
// writer — same check/--fix contract as sync-tools-manifest.mjs:
//
//   node scripts/emit-pack-manifests.mjs          # CHECK (exit 1 on drift)
//   node scripts/emit-pack-manifests.mjs --fix    # rewrite integrations/packs/
//
// Owners, and neither is this file:
//   tool names + descriptions  ->  mcp-server.json  (kept in sync with the
//                                  trackedTool() registrations in server.mjs
//                                  by scripts/sync-tools-manifest.mjs)
//   pack membership            ->  MCP_PACKS in server.mjs (the same constant
//                                  the live handler filters with, imported
//                                  rather than re-parsed, so a listing cannot
//                                  describe a pack the server does not serve)
//
// ★ IT FAILS ON A NAME THE CATALOG DOES NOT HAVE. That is the whole point of
// generating: a rename in server.mjs turns into a red build here instead of a
// quietly shorter endpoint and a partner config that references a dead tool.
//
// ★ WHAT IT DELIBERATELY DOES NOT DO. It does not publish anything, and it does
// not touch /.well-known/mcp.json — that artifact is served by the Cloudflare
// zone worker edited in the dashboard, out of reach of any commit in this repo
// (see scripts/check-served-manifest.mjs for the full account). A pack listing
// that needs to reach a registry gets pasted there by a human, from this
// output, once the path is verified live by POST.
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'integrations', 'packs');
const FIX = process.argv.includes('--fix');

const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// Import rather than regex-parse: the listing must describe the SAME constant
// the request handler filters with. A parser is a second reading of the truth
// and can disagree with the first.
const S = await import(join(ROOT, 'server.mjs'));
const { MCP_PACKS, packToolNames } = S;

const manifest = readJSON('mcp-server.json');
const serverJson = readJSON('server.json');
const CATALOG = new Map(manifest.tools.map((t) => [t.name, t]));

const ENDPOINT = 'https://dchub.cloud';

const problems = [];

function buildPack(path, def) {
  const names = packToolNames(def);
  const tools = [];
  for (const n of names) {
    const t = CATALOG.get(n);
    if (!t) { problems.push(`${path} names "${n}", absent from mcp-server.json`); continue; }
    tools.push({ name: t.name, description: t.description });
  }
  return {
    // Ordered so a reader sees the identity before the payload.
    pack: def.pack,
    endpoint: `${ENDPOINT}/mcp/${def.pack}`,
    version: serverJson.version,
    scope: 'listing',
    scope_note:
      'A listing scope, not a permission scope. This endpoint ADVERTISES the tools below; '
      + 'entitlements are carried by the API key and tools/call still accepts any DC Hub tool by name. '
      + `The full catalog is ${ENDPOINT}/mcp.`,
    full_catalog: `${ENDPOINT}/mcp`,
    full_catalog_tool_count:
      serverJson._meta['io.modelcontextprotocol.registry/publisher-provided'].toolCount,
    tool_count: tools.length,
    carries_shared_spine: Boolean(def.spine),
    authentication: manifest.authentication,
    tools,
  };
}

// The Managed-Agent allowlist shape. Claude Managed Agents take `configs` as an
// ARRAY of {name, enabled, permission_policy} and support NO defer_loading, so
// every enabled tool's text rides the prompt every turn. A pack endpoint plus
// default_config.enabled:false and an explicit per-tool enable is the only way
// an integrator gets a small surface AND keeps tools added later switched off
// until reviewed. Emitted so nobody hand-types 88 entries to arrive at ten.
function buildAllowlist(pack) {
  return {
    _comment:
      'Claude Managed Agents (/v1/agents). configs is an ARRAY; defer_loading is NOT supported. '
      + 'default_config.permission_policy must be set explicitly — the toolset default is always_ask, '
      + 'which hangs any bridge with no human-approval surface on the FIRST tool call.',
    mcp_server_url: pack.endpoint,
    mcp_toolset: {
      default_config: { enabled: false, permission_policy: { type: 'always_allow' } },
      configs: pack.tools.map((t) => ({ name: t.name, enabled: true })),
    },
  };
}

const emitted = new Map();
for (const [path, def] of MCP_PACKS) {
  const pack = buildPack(path, def);
  emitted.set(`${def.pack}.json`, pack);
  emitted.set(`${def.pack}.managed-agent.json`, buildAllowlist(pack));
}

if (problems.length) {
  console.error('DRIFT — pack membership does not match the catalog:');
  for (const p of problems) console.error(`  · ${p}`);
  console.error('\nFix the pack definition in server.mjs (or re-run sync-tools-manifest.mjs if a');
  console.error('tool was renamed). This is not auto-repairable: only a human knows which of the');
  console.error('two sides is the one that moved.');
  process.exit(1);
}

const ser = (o) => `${JSON.stringify(o, null, 2)}\n`;
let drift = 0;

if (FIX) {
  // Rebuild the directory so a REMOVED pack's listing disappears. Leaving a
  // stale file behind is how a retired endpoint keeps getting published.
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, obj] of emitted) writeFileSync(join(OUT_DIR, name), ser(obj));
  console.log(`wrote ${emitted.size} file(s) to integrations/packs/`);
} else {
  const onDisk = existsSync(OUT_DIR) ? new Set(readdirSync(OUT_DIR)) : new Set();
  for (const [name, obj] of emitted) {
    const p = join(OUT_DIR, name);
    const cur = existsSync(p) ? readFileSync(p, 'utf8') : null;
    if (cur !== ser(obj)) { console.error(`DRIFT: integrations/packs/${name}`); drift++; }
    onDisk.delete(name);
  }
  for (const orphan of onDisk) { console.error(`ORPHAN: integrations/packs/${orphan} (no such pack)`); drift++; }
  if (drift) {
    console.error(`\n${drift} file(s) out of date. Run: node scripts/emit-pack-manifests.mjs --fix`);
    process.exit(1);
  }
  console.log(`OK — ${emitted.size} pack file(s) match ${MCP_PACKS.size} declared pack(s)`);
}

process.exit(0);
