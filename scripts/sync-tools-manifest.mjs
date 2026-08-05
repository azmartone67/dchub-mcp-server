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
// Canonical phrase quantities = canonical/canon_phrases.json (the committed
//   snapshot of /api/v1/canon/phrases — see scripts/refresh-canon-phrases.mjs)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = process.argv.includes('--fix');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJSON = (f) => JSON.parse(read(f));

// Pending fixes keyed by file so multiple fixes to the SAME file chain instead
// of clobbering each other (e.g. smithery.yaml gets both a version rewrite and
// a tool-count rewrite). readCur() sees earlier pending fixes. Declared ABOVE
// canonicalTools() since 2026-07-30: the server.mjs quantity heal runs BEFORE
// the tool list is derived, so a single --fix regenerates mcp-server.json from
// the HEALED descriptions instead of converging one run later.
const problems = [];
const pending = new Map();
const readCur = (f) => pending.get(f) ?? read(f);
const pend = (f, content) => pending.set(f, content);

// ---- canonical version -----------------------------------------------------
const VERSION = readJSON('server.json').version;

// ---- canonical tool list (parsed from server.mjs) --------------------------
// Matches: trackedTool(srv, 'name', '<string literal>' …  — handles single OR
// double quotes with escapes, across newlines. Falls back to the existing
// description if a literal can't be safely evaluated (e.g. concatenation).
function canonicalTools() {
  const src = readCur('server.mjs');
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

// The COUNT is heal-invariant (quantity healing never adds or removes a
// trackedTool registration), so it is safe to derive before the heal below.
const COUNT = canonicalTools().length;

// ---- canonical phrase quantities -------------------------------------------
// ★2026-07-30 SNAPSHOT-DRIVEN. Repo-local constants used to BE the canon — and
// they went stale twice (DEALS_FLOOR sat at '1,500+' after the floor moved to
// 1,600+; FACILITIES_FLOOR sat at '12,650+' for six days after the fleet
// reached 15,3xx), which means the --fix heal was actively rewriting registry
// surfaces BACK to stale values while CI reported clean. A repo-local constant
// is just one more copy that rots — and it rotted a third time before being
// removed outright on 2026-08-05 (see below).
//
// The authority is now canonical/canon_phrases.json — a committed snapshot of
// /api/v1/canon/phrases (the SAME owner endpoint the dchub-frontend heal
// reads; backed by ai_surface_canon.resolve_canon(), every quantity self-heals
// live from the DB — countries since dchub-backend PR #1949).
// daily-manifest-sync refreshes the snapshot via
// scripts/refresh-canon-phrases.mjs, then runs this script with --fix, then
// commits the snapshot ATOMICALLY with every healed surface — so CHECK mode
// stays deterministic (no network) and a canon move needs no edit here.
//
// ★2026-08-05 SNAPSHOT-ONLY. The X_FLOOR constants are GONE. They were
// documented as "the fail-closed fallback for a missing or mangled snapshot",
// but falling back to a frozen number fails OPEN: it lets the heal go on
// publishing a quantity nobody re-verified, which is the precise failure this
// whole mechanism exists to prevent. And it recurred — FACILITIES_FLOOR was
// still '15,300+' on 2026-08-05 against a live canon of 16,500+, so the one
// script whose job is healing counts to canon carried a stale count of its own.
//
// The "floor DOWN, never inflate" semantic those constants expressed is
// preserved, but it lives UPSTREAM where it belongs: resolve_canon() emits the
// already-rounded floor form ('16,500+' for a 16,5xx fleet). This script's job
// is to CONSUME that floor, never to re-freeze it — a floor pinned in source is
// a floor that stops tracking the thing it is a floor of.
//
// So an unusable snapshot is a hard stop. No number is better than a stale one:
// exiting non-zero fails the CI guard loudly instead of silently healing every
// registry surface to whatever this file last remembered.
const CANON_FILE = 'canonical/canon_phrases.json';
const isPhraseVal = (s) => typeof s === 'string' && /^\d[\d,]*\+$/.test(s);
const canonFatal = (msg) => {
  console.error(`FATAL (canon): ${msg}\n` +
    `${CANON_FILE} is the ONLY source of canonical phrase quantities — there is\n` +
    `deliberately no hardcoded fallback, because a frozen number republishes stale\n` +
    `canon under a green check. Restore the file from git, or regenerate it:\n` +
    `  node scripts/refresh-canon-phrases.mjs`);
  process.exit(2);
};
let SNAP = null;
try { SNAP = readJSON(CANON_FILE); }
catch (e) { canonFatal(`cannot read the canon snapshot — ${e.message}`); }
const P = {};
for (const key of ['deals', 'facilities', 'markets', 'countries']) {
  if (!isPhraseVal(SNAP[key])) {
    canonFatal(`key "${key}" is ${JSON.stringify(SNAP[key])}, not a floor phrase like "16,500+". ` +
      `Refusing to heal registry surfaces from a malformed snapshot.`);
  }
  P[key] = SNAP[key];
}

// --print-count: emit the live tool count (from server.mjs) and exit. Lets the
// daily-manifest-sync workflow feed the SAME source-of-truth number into the
// GitHub About field, which aggregators (Glama) mirror but no manifest file owns.
if (process.argv.includes('--print-count')) { console.log(COUNT); process.exit(0); }
// --print-deals: emit the canonical deal-count phrase — same purpose. The daily
// workflow heals the GitHub About deal count the same way it heals the tool count,
// so the 2,000+ -> 4,000+ drift (that no auto-heal watched) cannot recur.
if (process.argv.includes('--print-deals')) { console.log(P.deals); process.exit(0); }

// ---- quantity guard (derived, not denylisted) ------------------------------
// ★2026-07-28 (deals/facilities), ★2026-07-30 (markets/countries): the old
// deal rule was a DENYLIST of shapes — /\b[2-9][,.]?000\+/, carrying the
// comment "never 1,400+ or 12,650+". It was therefore written to PERMIT the
// exact value that went stale, and it structurally could not match "21,000+".
// A denylist has to predict the wrong answers; a derived rule only has to know
// the right one, so it cannot be written to permit a stale value. markets
// joined 2026-07-30: its old denylist /\b(?:2\d{2}|300)\+?\s+markets/ flagged
// the CANONICAL floor form "300+" and permitted the stale exact "311" —
// backwards on both ends.
//
// Number shape: proper thousands grouping with optional 'k' / '+' — the loose
// [\d,]* form matched "100," inside "(0-100, per market)" and would have
// "healed" a score range into a market count. Values below 50 are ignored so
// ordinary prose ("compare 2 markets", "13 ready workflows") never trips the
// guard. markets/countries are plural-only for the same reason ("per market").
// The facilities rule SKIPS "tracked facilities": that phrase is the raw
// discovery-pile basis of the verified-of-tracked provenance claims ("4,903
// analyst-verified of 21,900+ tracked facilities"), a DIFFERENT quantity from
// the deduped-fleet canon — healing it to the fleet figure would corrupt the
// verified/tracked distinction. It has no canon key yet; if the raw-pile
// phrase ever joins /api/v1/canon/phrases, wire it here instead of removing
// the skip.
//
// ★2026-08-05 NOUN COVERAGE. The facilities rule knew exactly one word for the
// thing it counts — `facilit(y|ies)` — so the fleet count went stale in the
// plainest English there is. REGISTRY-LISTINGS.md, the file a human pastes
// from to correct a listing by hand, advertised "15,300+ data centers
// worldwide" and "search 15,300+ data centers across 170+ countries" against a
// canon of 16,500+, and BOTH scan and heal were blind to it — CHECK said the
// tree was clean. Two distinct holes:
//   • no "data center(s)" noun — the marketing word for a facility;
//   • number-AFTER-noun — "facility search (15,300+)" puts the quantity in a
//     trailing parenthesis, a shape the number-first matcher structurally
//     cannot see (the same class of hole the server.mjs AFTER_NOUN rules
//     already close for "**Facilities:** N+").
// Both are closed below, through the SAME helper for scan and heal.
//
// The widened noun brings one hazard the old one could not have: "a 100 MW
// data center" is a CAPACITY claim, not a fleet count, and it appears verbatim
// in server.mjs sample intents ("how much power is available in ERCOT for a
// 100 MW data center") — a file this guard heals. 100 clears bigEnough, so
// without a guard the heal would have written "16,500+ MW data center" into
// the live gateway. A power unit anywhere between the number and the noun
// means the number sizes a BUILD, not the fleet: never a count, always skipped.
const NUM = String.raw`\d{1,3}(?:,\d{3})*k?\+?`;
// FLOOR = the "16,500+" claim shape — NUM with the '+' REQUIRED. Used only by
// the number-after-noun rules, where a bare parenthesised integer is far more
// likely to be a scale, a score range or an ID than a fleet claim.
const FLOOR = String.raw`\d{1,3}(?:,\d{3})*k?\+`;
const FACILITY_NOUN = String.raw`facilit(?:y|ies)|data[\s-]+cent(?:er|re)s?`;
const CAPACITY_UNIT = /\b(?:[kKmMgGtT]?W|[kKmMgGtT]?Wh|[kKmM]?VA)\b/;
const RAW_PILE = /\btracked\s+(?:facilit|data[\s-]+cent)/i;
const QUANTITIES = [
  // transactions: README said "1,500+ tracked M&A transactions" and the deals-only noun missed it.
  // ★2026-08-05 `tracked M&A` with the head noun ELIDED — REGISTRY-LISTINGS.md
  // line 134 reads "…reach hyperscaler $1B+ deals, 1,600+ tracked M&A, gas-vs-grid
  // economics…". Same sentence as one of the stale facility claims below, same
  // root cause (a noun the rule did not know), invisible for the same reason.
  // Listed LAST so the fuller "tracked M&A deals" alternative still wins the match.
  { noun: String.raw`tracked\s+(?:M&A\s+)?(?:deals?|transactions?)|M&A\s+(?:deals?|transactions?)|deals?\b|tracked\s+M&A\b`,
    canon: () => P.deals, label: 'deal count' },
  { noun: FACILITY_NOUN, canon: () => P.facilities, label: 'facility count',
    skip: (m) => RAW_PILE.test(m) || CAPACITY_UNIT.test(m),
    // number-AFTER-noun: "facility search (15,300+)" / "data centers (16,500+)"
    after: [new RegExp(
      String.raw`((?:${FACILITY_NOUN})(?:\s+[A-Za-z&/-]+){0,3}\s*\()(${FLOOR})(\))`, 'gi')] },
  { noun: String.raw`markets\b`,   canon: () => P.markets,   label: 'market count' },
  { noun: String.raw`countries\b`, canon: () => P.countries, label: 'country count' },
];
const quantityRx = (noun) => new RegExp(String.raw`(${NUM})(\s+(?:[A-Za-z&/-]+\s+){0,3}?(?:${noun}))`, 'gi');
const qtyValue = (s) => {
  const stripped = s.replace(/\+$/, '');
  const k = /k$/i.test(stripped);
  return Number(stripped.replace(/,/g, '').replace(/k$/i, '')) * (k ? 1000 : 1);
};
const bigEnough = (s) => qtyValue(s) >= 50;

// ---- line-unit exclusions + span-aware matcher ------------------------------
// ★2026-07-28: some registry-facing files intermix CURRENT paste-ready copy
// with HISTORICAL narrative ("Since then we've shipped v2.3.2: 47 tools").
// Healing those files wholesale would rewrite history into a lie; excluding
// them wholesale (the previous approach) left their live copy stale — that is
// how REGISTRY-LISTINGS.md, the very file a human pastes from to correct a
// listing, kept advertising 79 tools and 21k+ facilities. So the unit of
// exclusion is the LINE, not the file: a line carrying `canon:frozen` is a
// deliberate historical statement and every heal below skips it.
//
// ★2026-07-30: scan and heal share ONE span-aware matcher. The previous
// line-by-line heal could not fix a claim wrapped across a line break
// ("1,500+\ntracked M&A deals" in tier3_presence.sh) that the full-text scan
// DID flag — CHECK would fail forever on a claim --fix could not reach. The
// matcher runs on the full text and consults every line the match touches:
// any frozen line (or, when commentAware, any //-comment line) excludes it
// from BOTH scan and heal, symmetrically.
const FROZEN = /canon:frozen/;
const healLines = (txt, fn) =>
  txt.split('\n').map((ln) => (FROZEN.test(ln) ? ln : fn(ln))).join('\n');
const liveLines = (txt) => txt.split('\n').filter((ln) => !FROZEN.test(ln)).join('\n');
const spanExcluded = (txt, m, commentAware) => {
  const lineStart = txt.lastIndexOf('\n', m.index) + 1;
  const endIdx = m.index + m[0].length;
  const lineEnd = txt.indexOf('\n', endIdx);
  const span = txt.slice(lineStart, lineEnd === -1 ? txt.length : lineEnd);
  if (FROZEN.test(span)) return true;
  if (commentAware && span.split('\n').some((l) => /^\s*\/\//.test(l))) return true;
  return false;
};
// applyRx: run `rx` over `txt`; for each non-excluded match call decide(m) —
// return a replacement string to heal it, or null to leave it. Returns the
// (possibly) healed text; decide() does its own problem reporting.
const applyRx = (txt, rx, decide, commentAware) => {
  let out = '', last = 0;
  for (const m of txt.matchAll(rx)) {
    if (spanExcluded(txt, m, commentAware)) continue;
    const rep = decide(m);
    if (rep == null || rep === m[0]) continue;
    out += txt.slice(last, m.index) + rep;
    last = m.index + m[0].length;
  }
  return out + txt.slice(last);
};
// One quantity rule against one file: reports drift into `problems` and
// returns healed text. Same code path for CHECK and FIX — they cannot diverge.
const applyQuantities = (file, txt, rules, commentAware) => {
  let out = txt;
  for (const { noun, canon, label, skip, after } of rules) {
    out = applyRx(out, quantityRx(noun), (m) => {
      if (m[1] === canon() || !bigEnough(m[1])) return null;
      if (skip && skip(m[0])) return null;
      problems.push(`${file}: "${m[0].trim().replace(/\s+/g, ' ')}" — stale ${label} (canonical ${canon()})`);
      return canon() + m[2];
    }, commentAware);
    // ★2026-08-05 number-AFTER-noun rules (3 groups: prefix, number, suffix).
    // Same file, same skip, same report — a claim must not become invisible
    // just because the copywriter put the quantity in a trailing parenthesis.
    for (const rx of after || []) {
      out = applyRx(out, rx, (m) => {
        if (m[2] === canon() || !bigEnough(m[2])) return null;
        if (skip && skip(m[0])) return null;
        problems.push(`${file}: "${m[0].trim().replace(/\s+/g, ' ')}" — stale ${label} (canonical ${canon()})`);
        return m[1] + canon() + m[3];
      }, commentAware);
    }
  }
  return out;
};

// ---- server.mjs — the live gateway's OWN prose quantities -------------------
// ★2026-07-30: previously excluded as "operator-owned SoT". That policy let
// six "12,650+" literals sit in tool DESCRIPTIONS for days after the
// initialize instructions had been rebound to live canon — same file, same
// figures, two truths. The PROSE stays operator-owned; the five phrase
// QUANTITIES inside it are canon-owned now and heal from the snapshot.
// Rules specific to this file:
//   • COMMENT lines (^\s*//) are NEVER scanned or healed — the retired-over-
//     claim history ("Retired over-claims: …") and dated rebind notes must
//     stay true. (canon:frozen is honored too, via the shared matcher.)
//   • countries heals ONLY in facilities-anchored shapes — "facilities across
//     N+ countries", "facilities (N+ countries)", "**Facilities:** N+ across
//     N+ countries". get_global_power's "182,000+ geolocated units across
//     170+ countries" describes the GEM dataset's own coverage, not DC Hub's
//     fleet, and must never track our canon.
//   • "N tools" heals against COUNT — derived from this very file, so the
//     initialize instructions can never disagree with tools/list.
{
  const f = 'server.mjs';
  let txt = readCur(f);
  const before = txt;
  txt = applyQuantities(f, txt, QUANTITIES.filter((q) => q.label !== 'country count'), true);
  // number-AFTER-noun shapes in the reference resources
  const AFTER_NOUN = [
    { rx: /(\*\*Facilities:\*\*\s+)(\d[\d,]*\+)/g, canon: () => P.facilities, label: 'facility count' },
    { rx: /(\*\*Markets:\*\*\s+)(\d[\d,]*\+)/g,    canon: () => P.markets,    label: 'market count' },
  ];
  for (const { rx, canon, label } of AFTER_NOUN) {
    txt = applyRx(txt, rx, (m) => {
      if (m[2] === canon()) return null;
      problems.push(`${f}: "${m[0].trim()}" — stale ${label} (canonical ${canon()})`);
      return m[1] + canon();
    }, true);
  }
  const C_ANCHORED = [
    /(facilit(?:y|ies)\s+across\s+)(\d[\d,]*\+)(\s+countries)/gi,
    /(facilit(?:y|ies)\s*\()(\d[\d,]*\+)(\s+countries\))/gi,
    /(\*\*Facilities:\*\*\s+\d[\d,]*\+\s+across\s+)(\d[\d,]*\+)(\s+countries)/g,
  ];
  for (const rx of C_ANCHORED) {
    txt = applyRx(txt, rx, (m) => {
      if (m[2] === P.countries) return null;
      problems.push(`${f}: "${m[0].trim()}" — stale country count (canonical ${P.countries})`);
      return m[1] + P.countries + m[3];
    }, true);
  }
  txt = applyRx(txt, /\b(\d+)((?: MCP)? tools)\b/g, (m) => {
    if (Number(m[1]) <= 20 || Number(m[1]) === COUNT) return null;
    problems.push(`${f}: "${m[0].trim()}" — stale tool count (live ${COUNT})`);
    return `${COUNT}${m[2]}`;
  }, true);
  if (FIX && txt !== before) pend(f, txt);
}

// Tool list is derived AFTER the heal above (readCur sees the pending healed
// content), so mcp-server.json ships the healed descriptions in the same run.
const tools = canonicalTools();
const names = new Set(tools.map((t) => t.name));

// ---- surfaces to keep in sync ---------------------------------------------

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
  // ★2026-07-30: description drift counts too — the tools[] here is DERIVED,
  // so a healed server.mjs description must propagate on the same run.
  const curDesc = Object.fromEntries((m.tools || []).map((t) => [t.name, t.description]));
  const descDrift = tools.filter((t) => t.description && curDesc[t.name] !== undefined && curDesc[t.name] !== t.description);
  if (descDrift.length) problems.push(`mcp-server.json has ${descDrift.length} tool description(s) drifted from server.mjs: ${descDrift.slice(0, 5).map((t) => t.name).join(', ')}${descDrift.length > 5 ? ', …' : ''}`);
  // ★2026-08-03: the TOP-LEVEL description is canon-owned now. It used to be
  // scanned check-only ("hand-authored JSON"), which meant every canon roll
  // left it stale and waiting for a human — and since the guard fails CI, it
  // blocked the next unrelated PR until someone hand-edited one sentence. That
  // happened on two consecutive days (15,700+ -> 15,900+, then 15,900+ ->
  // 16,100+). "Hand-authored" was never a real obstacle: this block already
  // machine-writes version, tools[] and tools_count into the same file.
  // The PROSE stays operator-owned; only the five phrase QUANTITIES inside it
  // heal, through the exact helper the other eight surfaces use — so this
  // sentence can no longer drift, and no longer taxes an unrelated change.
  if (typeof m.description === 'string' && m.description) {
    const healedDesc = applyQuantities('mcp-server.json (top-level description)',
                                       m.description, QUANTITIES, false);
    if (FIX) m.description = healedDesc;
  }
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
// ★2026-07-30 (PR #107) widened further: integrations/ + docs/ living copy and
// the dxt manifest carried "58/70 tools" — same rot, surfaces the loop never
// scanned. outreach-emails.md stays out (sent-mail record, not current copy).
for (const f of ['smithery.yaml', 'README.md', 'llms-install.md',
                 'REGISTRY-LISTINGS.md', 'skills/README.md',
                 'skills/dc-hub-data-center-intelligence/SKILL.md',
                 'scripts/tier3_presence.sh', 'integrations/README.md',
                 'integrations/cohere/README.md', 'integrations/mcp-clients/README.md',
                 'integrations/openrouter/README.md', 'integrations/poe/README.md',
                 'integrations/gemini/README.md', 'integrations/youcom/README.md',
                 'docs/one-click-install.md', 'docs/contacts.md', 'docs/pilot-pack.md',
                 'docs/distribution-targets.md', 'docs/canonical-workflows.md',
                 'scripts/smithery_description.txt', 'dxt/manifest.json']) {
  const txt = readCur(f);
  // Match "N tools", "N MCP tools", AND the shields.io badge form "badge/tools-N-color".
  // Both slipped past CI before: the README body said "48 MCP tools" (2026-06-25) and
  // separately the Tools badge said tools-48 while the body said 49 (2026-06-26).
  const live = liveLines(txt);   // historical (canon:frozen) lines are not claims about now
  const counts = [
    ...[...live.matchAll(/(\d+)(?: MCP| read-only)? tools/g)].map((x) => Number(x[1])),
    ...[...live.matchAll(/badge\/tools-(\d+)/g)].map((x) => Number(x[1])),
  ];
  const wrong = counts.filter((c) => c !== COUNT && c > 20); // ignore small unrelated numbers
  if (wrong.length) {
    problems.push(`${f} has tool-count(s) ${[...new Set(wrong)].join('/')} != ${COUNT}`);
    if (FIX) pend(f, healLines(txt, (ln) => ln
      .replace(/\b(\d+)( MCP| read-only)? tools\b/g, (s, n, mcp) => (Number(n) > 20 ? `${COUNT}${mcp || ''} tools` : s))
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
// all three so the listing can't silently drift again.
//
// glama.json's schema (https://glama.ai/mcp/schemas/server.json) permits ONLY
// `maintainers` — it CANNOT hold a description or a static tool list. So the Glama
// listing's DESCRIPTION is re-derived by Glama from the GitHub repo "About" + README
// on re-crawl, and its tools[] from live `node server.mjs --stdio` introspection
// (verified working, emits all 58). We therefore (1) assert glama.json stays
// schema-valid, (2) keep server.json's positioning intact, and (3) lock the
// coverage prose Glama re-derives from.
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

  // (3) COVERAGE prose: every phrase quantity (deals, facilities, markets,
  // countries — see QUANTITIES above) must equal the snapshot canon. Scans
  // HAND-AUTHORED prose ONLY — never mcp-server.json's derived tools[]
  // (regenerated from server.mjs by --fix; for mcp-server.json we check the
  // top-level .description field only). server.mjs has its own dedicated
  // block above (comment-skipping + GEM-safe anchored countries).
  // ★2026-07-30 widened: the integrations/, dxt/ and living docs/ copy carried
  // "12,650+ facilities … 170+ countries … 311 markets … 1,400+ deals" for
  // days — every file that makes a CURRENT claim belongs here. Files that
  // narrate history (docs/outreach-emails.md — records of emails actually
  // sent) stay out: healing a record of what was said rewrites history.
  const COVERAGE = [
    'README.md', 'smithery.yaml', 'llms-install.md', 'REGISTRY-LISTINGS.md',
    'server.json', 'integrations/chatgpt/openapi.json', 'integrations/chatgpt/instructions.txt',
    'scripts/tier3_presence.sh', 'skills/README.md',
    'skills/dc-hub-data-center-intelligence/SKILL.md',
    // ★2026-07-30 additions — all pure current-claim copy:
    'integrations/README.md', 'integrations/chatgpt/README.md',
    'integrations/cohere/README.md', 'integrations/copilot/dchub-mcp.yaml',
    'integrations/openrouter/tools.json', 'dxt/manifest.json',
    'docs/canonical-workflows.md', 'docs/distribution-targets.md',
    'scripts/smithery_description.txt',
    // ★2026-07-30 (PR #107) additions — current-claim copy the 07-30 sweep
    // found stale (21k+/12,650+/58 tools era): per-platform integration
    // READMEs, living docs/, the legacy python server's docstrings, the
    // ChatGPT toolspec snapshot, and outreach one-pagers still to be sent.
    'integrations/gemini/README.md', 'integrations/openrouter/README.md',
    'integrations/mcp-clients/README.md', 'integrations/poe/README.md',
    'integrations/youcom/README.md', 'integrations/langchain/dchub_tools.py',
    'integrations/llamaindex/dchub_tools.py',
    'docs/one-click-install.md', 'docs/contacts.md', 'docs/pilot-pack.md',
    'dchub_mcp_server.py', 'toolspec.json', 'TELEGEOGRAPHY-OUTREACH.md',
  ];
  for (const f of COVERAGE) {
    let txt; try { txt = readCur(f); } catch { continue; }
    const healed = applyQuantities(f, txt, QUANTITIES, false);
    if (FIX && healed !== txt) pend(f, healed);
  }
  // ★2026-08-03: the mcp-server.json top-level description USED to be scanned
  // here, check-only. It is now HEALED in the mcp-server.json block above,
  // which is also the block that writes the file — one pend, one write, no
  // second scan reporting the same sentence twice (a doubled problem line
  // reads as two stale surfaces and inflates every drift report).
}

// ---- canonical FACTS drift-guard (pricing / coverage) ----------------------
// canonical/mcp_facts.json is generated by dchub-backend/mcp_facts_export.py from
// the Python SoTs (tier_registry + canonical_stats). The Node repo can't import
// those, so this JSON is the cross-language bridge — that drift is exactly why
// "Pro $199", "countries 140", and "EU ~12 zones" kept reappearing here. We CHECK
// the registry surfaces against it. Auto-rewriting prose is fragile, so facts
// drift FAILS CI but is NOT --fix'd: re-run the exporter + correct the surface.
// (The phrase QUANTITIES moved to canonical/canon_phrases.json above — this
// guard keeps the pricing + grid-coverage facts.)
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
  console.log(`✓ synced to v${VERSION} / ${COUNT} tools / ${P.facilities} facilities · ${P.countries} countries · ${P.deals} deals · ${P.markets} markets — wrote: ${[...pending.keys()].join(', ') || '(nothing)'}`);
  if (factProblems.length) console.warn('⚠ FACTS DRIFT (not auto-fixable — re-run dchub-backend/mcp_facts_export.py, then edit the surface):\n  - ' + factProblems.join('\n  - '));
  process.exit(0);
}
console.log(`canonical: v${VERSION} / ${COUNT} tools / ${P.facilities} facilities · ${P.countries} countries · ${P.deals} deals · ${P.markets} markets${SNAP ? '' : ' (snapshot missing — fallback constants)'}`);
const allProblems = [...problems, ...factProblems];
if (allProblems.length) { console.error('MANIFEST/FACTS DRIFT:\n  - ' + allProblems.join('\n  - ') + '\n\nTool drift → node scripts/sync-tools-manifest.mjs --fix. Facts drift → match canonical/mcp_facts.json.'); process.exit(1); }
console.log('✓ all manifest + facts surfaces consistent');
