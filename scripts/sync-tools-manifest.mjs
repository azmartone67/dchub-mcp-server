#!/usr/bin/env node
// ============================================================================
// Single-source-of-truth for the MCP tool manifest.
//
// server.mjs (the live gateway) is the ONLY place tools are defined. This script
// DERIVES the tool list + count from its trackedTool() registrations and keeps
// the manifest surfaces in sync, so the version/tool-count drift that registries
// scrape (mcp-server.json had 42 while server.mjs registers 47) can't recur.
//
//   node scripts/sync-tools-manifest.mjs           # CHECK (CI guard; exit 1 on drift)
//   node scripts/sync-tools-manifest.mjs --fix     # rewrite mcp-server.json + version strings
//
// Canonical version  = server.json .version
// Canonical tool set = name+description of every trackedTool(srv, '<name>', '<desc>', …) in server.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = process.argv.includes('--fix');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJSON = (f) => JSON.parse(read(f));

// ---- canonical version -----------------------------------------------------
const VERSION = readJSON('server.json').version;

// ---- canonical tool list (parsed from server.mjs) --------------------------
// Matches: trackedTool(srv, 'name', '<string literal>' …  — handles single OR
// double quotes with escapes, across newlines. Falls back to the existing
// description if a literal can't be safely evaluated (e.g. concatenation).
function canonicalTools() {
  const src = read('server.mjs');
  const re = /trackedTool\(\s*srv\s*,\s*'([a-z_]+)'\s*,\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
  const existing = Object.fromEntries((tryReadTools() || []).map((t) => [t.name, t.description]));
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    let description = existing[name] || '';
    try { description = (0, eval)(m[2]); } catch { /* keep fallback */ }
    out.push({ name, description });
  }
  return out;
}
function tryReadTools() { try { return readJSON('mcp-server.json').tools; } catch { return null; } }

const tools = canonicalTools();
const COUNT = tools.length;
const names = new Set(tools.map((t) => t.name));

// Single source for the honest M&A deal-count phrase: DEDUPED distinct deals.
// The raw ~4.3k deal-table row count is a ~2.9x over-claim (AUTO-<date> ingest
// re-inserts one deal per day — one atNorth deal held 945 rows). Referenced by
// --print-deals (the daily About/manifest heal) AND the drift-guard CANON below,
// so the number lives in ONE place and the automated layer keeps it honest.
// ★2026-07-28: was '1,400+' — stale since the 07-24 dedup rebase raised the
// canonical floor to 1,500+ (live distinct = 1,553). See ai_surface_canon.
const DEALS_FLOOR = '1,500+';

// Facilities floor — the OTHER canonical quantity that appears in registry
// prose. It had no entry here at all, which is why smithery.yaml advertised
// "21,000+ facilities" (the pre-dedup RAW discovered_facilities row count)
// for four days after canon moved to 12,650+ and nothing noticed.
const FACILITIES_FLOOR = '12,650+';

// --print-count: emit the live tool count (from server.mjs) and exit. Lets the
// daily-manifest-sync workflow feed the SAME source-of-truth number into the
// GitHub About field, which aggregators (Glama) mirror but no manifest file owns.
if (process.argv.includes('--print-count')) { console.log(COUNT); process.exit(0); }
// --print-deals: emit the canonical deal-count phrase — same purpose. The daily
// workflow heals the GitHub About deal count the same way it heals the tool count,
// so the 2,000+ -> 4,000+ drift (that no auto-heal watched) cannot recur.
if (process.argv.includes('--print-deals')) { console.log(DEALS_FLOOR); process.exit(0); }

// ---- surfaces to keep in sync ---------------------------------------------
// ★2026-07-28: some registry-facing files intermix CURRENT paste-ready copy
// with HISTORICAL narrative ("Since then we've shipped v2.3.2: 47 tools").
// Healing those files wholesale would rewrite history into a lie; excluding
// them wholesale (the previous approach) left their live copy stale — that is
// how REGISTRY-LISTINGS.md, the very file a human pastes from to correct a
// listing, kept advertising 79 tools and 21k+ facilities. So the unit of
// exclusion is the LINE, not the file: a line carrying `canon:frozen` is a
// deliberate historical statement and every heal below skips it.
const FROZEN = /canon:frozen/;
const healLines = (txt, fn) =>
  txt.split('\n').map((ln) => (FROZEN.test(ln) ? ln : fn(ln))).join('\n');
const liveLines = (txt) => txt.split('\n').filter((ln) => !FROZEN.test(ln)).join('\n');

const problems = [];
// Pending fixes keyed by file so multiple fixes to the SAME file chain instead
// of clobbering each other (e.g. smithery.yaml gets both a version rewrite and
// a tool-count rewrite). readCur() sees earlier pending fixes.
const pending = new Map();
const readCur = (f) => pending.get(f) ?? read(f);
const pend = (f, content) => pending.set(f, content);

// server.json — the OFFICIAL-registry publish source (cascades to the GitHub MCP
// Registry mirror). Its description is evergreen (no tool count to drift); the only
// count lives in _meta.toolCount, so keep just that honest daily. We do NOT bump
// server.json.version here — the canonical version is operator-owned. When this fix
// changes server.json, daily-manifest-sync.yml auto-publishes a PUBLISH-ONLY patch
// bump (scripts/registry-autopublish.mjs) so the listing refreshes the SAME DAY.
{
  const sj = readJSON('server.json');
  const meta = sj._meta && sj._meta['io.modelcontextprotocol.registry/publisher-provided'];
  if (meta && meta.toolCount !== COUNT) {
    problems.push(`server.json _meta.toolCount ${meta.toolCount} != ${COUNT}`);
    if (FIX) { meta.toolCount = COUNT; pend('server.json', JSON.stringify(sj, null, 2) + '\n'); }
  }
}

// mcp-server.json — the manifest that feeds registry scrapes
{
  const m = readJSON('mcp-server.json');
  const cur = (m.tools || []).map((t) => t.name);
  const missing = [...names].filter((n) => !cur.includes(n));
  const extra = cur.filter((n) => !names.has(n));
  if (m.version !== VERSION) problems.push(`mcp-server.json version ${m.version} != ${VERSION}`);
  if (missing.length) problems.push(`mcp-server.json MISSING ${missing.length} tools: ${missing.join(', ')}`);
  if (extra.length) problems.push(`mcp-server.json has ${extra.length} STALE tools: ${extra.join(', ')}`);
  if (FIX) { m.version = VERSION; m.tools = tools; if ('tools_count' in m) m.tools_count = COUNT;
    pend('mcp-server.json', JSON.stringify(m, null, 2) + '\n'); }
}

// version strings in the other registry-facing files. --fix REWRITES them:
// before 2026-07-11 this was check-only, so every operator version bump of
// server.json (the canonical version source) broke CI until package.json +
// smithery.yaml were hand-edited — the v2.4.6 republish failed two runs in a
// row exactly this way.
{
  const pj = JSON.parse(readCur('package.json'));
  if (pj.version !== VERSION) {
    problems.push(`package.json version ${pj.version} != ${VERSION}`);
    if (FIX) { pj.version = VERSION; pend('package.json', JSON.stringify(pj, null, 2) + '\n'); }
  }
  const sy = readCur('smithery.yaml');
  if (!sy.includes(VERSION)) {
    problems.push(`smithery.yaml does not contain canonical version ${VERSION}`);
    if (FIX) pend('smithery.yaml', sy.replace(/^version:\s*.*$/m, `version: "${VERSION}"`));
  }
}

// smithery tool-count comments + README/llms-install "N tools"
// ★2026-07-28 widened: REGISTRY-LISTINGS.md is the paste-ready copy a human
// uses to correct a listing by hand — it advertised "79 tools" while live was
// 81, so the manual repair path propagated stale copy too. The skills/ files
// ship to agents and read "70 read-only tools". None of these carry changelog
// history (the reason submission/ docs stay excluded), so the count heal is safe.
for (const f of ['smithery.yaml', 'README.md', 'llms-install.md',
                 'REGISTRY-LISTINGS.md', 'skills/README.md',
                 'skills/dc-hub-data-center-intelligence/SKILL.md',
                 'scripts/tier3_presence.sh']) {
  const txt = readCur(f);
  // Match "N tools", "N MCP tools", AND the shields.io badge form "badge/tools-N-color".
  // Both slipped past CI before: the README body said "48 MCP tools" (2026-06-25) and
  // separately the Tools badge said tools-48 while the body said 49 (2026-06-26).
  const live = liveLines(txt);   // historical (canon:frozen) lines are not claims about now
  const counts = [
    ...[...live.matchAll(/(\d+)(?: MCP)? tools/g)].map((x) => Number(x[1])),
    ...[...live.matchAll(/badge\/tools-(\d+)/g)].map((x) => Number(x[1])),
  ];
  const wrong = counts.filter((c) => c !== COUNT && c > 20); // ignore small unrelated numbers
  if (wrong.length) {
    problems.push(`${f} has tool-count(s) ${[...new Set(wrong)].join('/')} != ${COUNT}`);
    if (FIX) pend(f, healLines(txt, (ln) => ln
      .replace(/\b(\d+)( MCP)? tools\b/g, (s, n, mcp) => (Number(n) > 20 ? `${COUNT}${mcp || ''} tools` : s))
      .replace(/badge\/tools-(\d+)/g, (s, n) => (Number(n) > 20 ? `badge/tools-${COUNT}` : s))));
  }
}

// ---- smithery.yaml tools[] LIST — the surface Smithery actually crawls -----
// ★2026-07-28, root cause of a listing that sat two revisions stale: the loop
// above heals the tool-count COMMENT ("81 tools") but NOTHING owned the
// `tools:` list underneath it. The comment said 81; the list carried 74 names.
// Smithery crawls the list. Derive it from canonicalTools() (server.mjs is the
// SoT, same source mcp-server.json already uses) so the two cannot disagree.
{
  const sy = readCur('smithery.yaml');
  const block = sy.match(/^tools:\n((?:[ \t]*-[ \t]+\S+\n)+)/m);
  if (!block) {
    problems.push('smithery.yaml: no parseable `tools:` list — the crawled surface is unverifiable');
  } else {
    const listed  = [...block[1].matchAll(/-[ \t]+(\S+)/g)].map((x) => x[1]);
    const missing = tools.map((t) => t.name).filter((n) => !listed.includes(n));
    const extra   = listed.filter((n) => !names.has(n));
    if (missing.length || extra.length) {
      problems.push(
        `smithery.yaml \`tools:\` list has ${listed.length} entries != ${COUNT} live` +
        (missing.length ? ` — MISSING ${missing.join(', ')}` : '') +
        (extra.length ? ` — STALE ${extra.join(', ')}` : ''));
      if (FIX) pend('smithery.yaml',
        sy.replace(block[0], 'tools:\n' + tools.map((t) => `  - ${t.name}\n`).join('')));
    }
  }
}

// ---- glama.json + registry-listing COVERAGE drift-guard --------------------
// QA 2026-07-04: the public Glama listing (glama.ai/api/mcp/v1/servers/…) rotted
// to "33 tools · 232 US power markets · 2,000+ deals · tools:[]" while the live
// server was v2.4.4 / 58 tools / 311 markets. Root cause: nothing scanned (a)
// glama.json, (b) the human-facing COVERAGE prose (market + deal counts) that the
// registries echo, or (c) server.json's evergreen description. This block locks
// all three so the listing can't silently drift again (CHECK-only — coverage
// prose is not auto-rewritten because these strings carry sentence context).
//
// glama.json's schema (https://glama.ai/mcp/schemas/server.json) permits ONLY
// `maintainers` — it CANNOT hold a description or a static tool list. So the Glama
// listing's DESCRIPTION is re-derived by Glama from the GitHub repo "About" + README
// on re-crawl, and its tools[] from live `node server.mjs --stdio` introspection
// (verified working, emits all 58). We therefore (1) assert glama.json stays
// schema-valid, (2) keep server.json's positioning intact, and (3) lock the
// coverage prose Glama re-derives from.
const CANON = { markets: 311, dealsFloor: DEALS_FLOOR, facilitiesFloor: FACILITIES_FLOOR };
{
  // (1) glama.json must stay schema-valid — an invalid manifest makes Glama drop the listing
  try {
    const g = readJSON('glama.json');
    if (!Array.isArray(g.maintainers) || g.maintainers.length === 0)
      problems.push('glama.json: maintainers[] missing/empty — Glama rejects the manifest');
  } catch (e) { problems.push('glama.json: invalid JSON — ' + e.message); }

  // (2) server.json evergreen description must keep the canonical positioning
  const sjDesc = (readJSON('server.json').description || '');
  if (!/query and cite/i.test(sjDesc))
    problems.push('server.json: description lost canonical positioning ("… query and cite")');

  // (3) COVERAGE prose: no stale market (2xx) or deal (2,000+) counts. Canonical:
  // 311 markets · 3,000+ tracked deals. Scans HAND-AUTHORED prose ONLY — never
  // server.mjs (operator-owned SoT for tool descriptions) and never mcp-server.json's
  // derived tools[] (regenerated from server.mjs by --fix); for mcp-server.json we
  // check the top-level .description field only. Tool-count drift in submission/
  // integration docs is out of scope here (those files intermix changelog history);
  // the canonical manifests' counts are locked by the smithery/README loop above.
  // 2026-07-11: widened — "300+ markets" and "3,000+ deals" slipped through
  // (the 07-10 honest-numbers pass moved canon to 311 / 4,000+ but these
  // regexes only caught 2xx / 2,000+, so half the surfaces kept the old
  // floors). 311 itself must NOT match.
  const STALE = [
    { rx: /\b(?:2\d{2}|300)\+?\s+(?:US\s+)?(?:power\s+|DCPI[- ]?|DCPI-scored\s+)?markets?\b/i, why: `stale market count (canonical ${CANON.markets})` },
  ];
  // ★2026-07-28: the deal rule used to live in STALE as a DENYLIST of shapes —
  // /\b[2-9][,.]?000\+/, carrying the comment "never 1,400+ or 12,650+". It was
  // therefore written to PERMIT the exact value that went stale (1,400+ after
  // the 07-24 rebase to 1,500+), and it structurally cannot match "21,000+"
  // (after the leading 2 comes a 1, not a comma). Both stale numbers sat in
  // smithery.yaml — the file Smithery crawls — while this guard reported clean.
  //
  // Replaced with a DERIVED rule: find every "<n>+ <noun>" for a canonical
  // noun and flag any value that is not canon. A denylist has to predict the
  // wrong answers; this only has to know the right one, so it cannot be
  // written to permit a stale value.
  const QUANTITIES = [
    { noun: String.raw`tracked\s+(?:M&A\s+)?deals?|M&A\s+deals?|deals?\b`, canon: CANON.dealsFloor,      label: 'deal count' },
    { noun: String.raw`facilit(?:y|ies)`,                                  canon: CANON.facilitiesFloor, label: 'facility count' },
  ];
  const scanQuantities = (txt) => {
    const found = [];
    for (const { noun, canon, label } of QUANTITIES) {
      const rx = new RegExp(String.raw`(\d[\d,]*k?\+)\s+(?:[A-Za-z&/-]+\s+){0,3}?(?:${noun})`, 'gi');
      for (const mm of txt.matchAll(rx)) {
        if (mm[1] !== canon) found.push(`"${mm[0].trim()}" — stale ${label} (canonical ${canon})`);
      }
    }
    return found;
  };
  const COVERAGE = [
    'README.md', 'smithery.yaml', 'llms-install.md', 'REGISTRY-LISTINGS.md',
    'server.json', 'integrations/chatgpt/openapi.json', 'integrations/chatgpt/instructions.txt',
    'scripts/tier3_presence.sh', 'skills/README.md',
    'skills/dc-hub-data-center-intelligence/SKILL.md',
  ];
  for (const f of COVERAGE) {
    let txt; try { txt = readCur(f); } catch { continue; }
    for (const { rx, why } of STALE) { const m = txt.match(rx); if (m) problems.push(`${f}: "${m[0].trim()}" — ${why}`); }
    const q = scanQuantities(liveLines(txt));
    for (const why of q) problems.push(`${f}: ${why}`);
    // --fix heals the canonical quantities in place. Only the NUMBER is
    // rewritten; the surrounding prose is hand-authored and stays untouched.
    if (FIX && q.length) {
      let out = txt;
      for (const { noun, canon } of QUANTITIES) {
        out = healLines(out, (ln) => ln.replace(
          new RegExp(String.raw`(\d[\d,]*k?\+)(\s+(?:[A-Za-z&/-]+\s+){0,3}?(?:${noun}))`, 'gi'),
          (s, num, rest) => (num === canon ? s : canon + rest)));
      }
      if (out !== txt) pend(f, out);
    }
  }
  // mcp-server.json: top-level description only (tools[] descriptions derive from server.mjs)
  const mDesc = (readJSON('mcp-server.json').description || '');
  for (const { rx, why } of STALE) { const m = mDesc.match(rx); if (m) problems.push(`mcp-server.json (top-level description): "${m[0].trim()}" — ${why}`); }
}

// ---- canonical FACTS drift-guard (pricing / coverage) ----------------------
// canonical/mcp_facts.json is generated by dchub-backend/mcp_facts_export.py from
// the Python SoTs (tier_registry + canonical_stats). The Node repo can't import
// those, so this JSON is the cross-language bridge — that drift is exactly why
// "Pro $199", "countries 140", and "EU ~12 zones" kept reappearing here. We CHECK
// the registry surfaces against it. Auto-rewriting prose is fragile, so facts
// drift FAILS CI but is NOT --fix'd: re-run the exporter + correct the surface.
const factProblems = [];
let facts = null;
try { facts = readJSON('canonical/mcp_facts.json'); } catch { /* not generated yet */ }
if (facts) {
  const proPrice = facts.pricing_usd_month?.pro;
  const euZones = facts.grid_coverage?.eu_entsoe_zones;
  for (const f of ['smithery.yaml', 'README.md', 'mcp-server.json']) {
    const txt = read(f);
    if (proPrice) for (const m of txt.matchAll(/\bpro\b[^\n$]{0,6}\$(\d{2,4})/gi))
      if (Number(m[1]) !== proPrice) factProblems.push(`${f}: Pro $${m[1]} != canonical $${proPrice}`);
    if (euZones) for (const m of txt.matchAll(/~?(\d{1,3})\+?\s+(?:EU|European)[A-Za-z \-]*?zones/g))
      if (Number(m[1]) !== euZones) factProblems.push(`${f}: EU-zone count ${m[1]} != canonical ${euZones}`);
  }
}

// ---- apply / report --------------------------------------------------------
if (FIX) {
  for (const [f, content] of pending) fs.writeFileSync(path.join(ROOT, f), content);
  console.log(`✓ synced to v${VERSION} / ${COUNT} tools — wrote: ${[...pending.keys()].join(', ') || '(nothing)'}`);
  if (factProblems.length) console.warn('⚠ FACTS DRIFT (not auto-fixable — re-run dchub-backend/mcp_facts_export.py, then edit the surface):\n  - ' + factProblems.join('\n  - '));
  process.exit(0);
}
console.log(`canonical: v${VERSION} / ${COUNT} tools`);
const allProblems = [...problems, ...factProblems];
if (allProblems.length) { console.error('MANIFEST/FACTS DRIFT:\n  - ' + allProblems.join('\n  - ') + '\n\nTool drift → node scripts/sync-tools-manifest.mjs --fix. Facts drift → match canonical/mcp_facts.json.'); process.exit(1); }
console.log('✓ all manifest + facts surfaces consistent');
