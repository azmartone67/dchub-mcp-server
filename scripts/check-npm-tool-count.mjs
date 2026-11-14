#!/usr/bin/env node
// Does the npm package description state the tool count the LIVE server serves?
//
// 2026-11-13: live /mcp served 95 tools while `npm view dchub-mcp-server
// description` said "(94 tools)". The repo-side guard
// (test/tool-count-drift.test.mjs) only sees the npm-launcher/package.json in
// the tree; the registry copy changes only on publish, so it can lag a correct
// tree for weeks. This reads both live values and compares them.
//
//   node scripts/check-npm-tool-count.mjs
//
// exit 0: npm states the live count, or states no count at all (count-free copy
//         cannot drift)
// exit 1: npm states a different count -> ::warning:: annotation
// exit 2: could not read one side (network / npm) -> ::warning::, no verdict
//
// No secrets: a public server card and the public npm registry.
import { execFileSync } from 'node:child_process';

const PKG = process.env.NPM_PACKAGE || 'dchub-mcp-server';
const CARD = process.env.SERVER_CARD_URL || 'https://dchub.cloud/.well-known/mcp/server-card.json';
// Same claim forms as test/tool-count-drift.test.mjs.
const CLAIM = /\b(\d+)(?:[ -](?:live|MCP|read-only|DC Hub|registered|callable|public))*[ -]tools?\b/g;

const warn = (msg) => console.log(`::warning title=npm tool count::${msg}`);

async function liveCount() {
  const res = await fetch(`${CARD}?_=${Date.now()}`, {
    headers: { 'user-agent': 'dchub-qa-readonly', accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${CARD} -> HTTP ${res.status}`);
  const card = await res.json();
  const n = Array.isArray(card.tools) ? card.tools.length : null;
  if (!n) throw new Error(`${CARD}: no tools[] to count`);
  if (Number.isInteger(card.tools_count) && card.tools_count !== n)
    warn(`${CARD} disagrees with itself: tools_count ${card.tools_count} vs tools[] ${n}`);
  return { n, version: card.version || card.serverInfo?.version || '?' };
}

function npmDescription() {
  const out = execFileSync('npm', ['view', PKG, 'description', 'version', '--json'], { encoding: 'utf8', timeout: 60_000 });
  const j = JSON.parse(out);
  return { description: String(j.description || ''), version: j.version || '?' };
}

let live, npm;
try { live = await liveCount(); } catch (e) { warn(`could not read the live count: ${e.message}`); process.exit(2); }
try { npm = npmDescription(); } catch (e) { warn(`could not read npm ${PKG}: ${e.message}`); process.exit(2); }

const stated = [...npm.description.matchAll(CLAIM)].map((m) => Number(m[1]));
console.log(`live server card : v${live.version}, ${live.n} tools (${CARD})`);
console.log(`npm ${PKG}@${npm.version}: ${stated.length ? `states ${stated.join(', ')} tools` : 'states no tool count'}`);
console.log(`  "${npm.description}"`);

const wrong = stated.filter((n) => n !== live.n);
if (wrong.length) {
  warn(`npm ${PKG}@${npm.version} description says ${[...new Set(wrong)].join('/')} tools; live serves ${live.n}. `
    + 'Fix npm-launcher/package.json (prefer count-free wording) and publish a launcher release.');
  process.exit(1);
}
console.log(stated.length ? `OK: npm states the live count (${live.n}).` : 'OK: npm description is count-free; nothing to drift.');
