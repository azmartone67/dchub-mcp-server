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
import { packBundle, bundleDrift } from './dxt-bundle.mjs';

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

// ---- canonical ASSET-CLASS quantities --------------------------------------
// ★2026-08-30. The four phrase quantities above heal from canon_phrases.json.
// The ASSET-CLASS figures did not: server.mjs:12048 recorded them as "not yet
// in the phrases feed and remain hand-bound", and hand-bound is exactly how
// they rotted. Measured that morning against the LIVE gate — one session, one
// server, two answers:
//
//   initialize.instructions    330,000+ assets · 127k substations · 64k fiber
//   dchub://coverage resource  320,000+ assets · 126k substations · 55k fiber
//
// The coverage resource carried the CORRECT 19,500+ facilities and 300+ markets
// in the SAME paragraph — because those two heal and the asset figures did not.
// Fiber read 15% under live (55k vs 64,836 measured). And nothing could go red:
// instructions-compose.test.mjs asserts only that the KEY EXISTS in the facts
// object, and end-of-burst-hook.test.mjs asserts against its own hardcoded
// '320,000+' fixture, so both stayed green while the published copy drifted.
//
// The instructions blob already composes these live from canonical/mcp_facts.json
// (_composeInstructions, behind a freshness gate). This block puts every OTHER
// surface on that same file, so the two halves of one server cannot answer
// differently again.
//
// ★ Source is mcp_facts.json, NOT canon_phrases.json: the asset layers come from
//   /api/v1/infrastructure/stats and have no /api/v1/canon/phrases home. Same
//   floors-round-DOWN semantic, same refusal to invent a fallback.
const FACTS_FILE = 'canonical/mcp_facts.json';
const isAssetVal = (s) => typeof s === 'string' && /^\d{1,3}(?:,\d{3})*k?\+?$/.test(s);
const factsFatal = (msg) => {
  console.error(`FATAL (facts): ${msg}\n` +
    `${FACTS_FILE} is the ONLY source of asset-class quantities — there is\n` +
    `deliberately no hardcoded fallback, for the same reason canon_phrases.json\n` +
    `has none: a frozen number republishes stale canon under a green check.\n` +
    `Regenerate it in dchub-backend:  python3 mcp_facts_export.py`);
  process.exit(2);
};
let FACTS = null;
try { FACTS = readJSON(FACTS_FILE); }
catch (e) { factsFatal(`cannot read the facts snapshot — ${e.message}`); }

// Freshness: borrow server.mjs's OWN gate instead of keeping a second copy of
// 45. Past that age _composeInstructions stops publishing figures at all, so
// healing PERMANENT literals from a file that stale would bake in exactly the
// numbers the live blob has already decided it will not serve. Parsed out of
// the source text — never imported, because importing server.mjs boots a server.
{
  const mAge = /_FACTS_MAX_AGE_DAYS\s*=\s*(\d+)/.exec(read('server.mjs'));
  if (!mAge) factsFatal('server.mjs no longer exports _FACTS_MAX_AGE_DAYS — the '
    + 'freshness gate this heal borrows has moved; re-point it before healing.');
  const gen = Date.parse(FACTS.generated_at);
  if (!Number.isFinite(gen)) factsFatal(`generated_at is ${JSON.stringify(FACTS.generated_at)}, unparseable`);
  const ageDays = (Date.now() - gen) / 86400e3;
  if (ageDays > Number(mAge[1])) factsFatal(
    `the facts snapshot is ${ageDays.toFixed(0)}d old (gate ${mAge[1]}d). `
    + `_composeInstructions has already stopped publishing figures at this age; `
    + `healing literals from it would republish what the live blob refuses.`);
}

// noun → the exact phrase shapes these figures are published in. Deliberately
// narrow: "assets" alone is ordinary English, so the mapped-asset rule requires
// the word "mapped"; and "US power plants" must stay distinct from the GEM
// "global power generating units" sitting in the same sentence beside it.
const ASSET_QUANTITIES = [
  { key: 'infrastructure_assets_total', label: 'mapped-asset total',
    noun: String.raw`mapped\s+(?:[A-Za-z&/-]+\s+){0,2}assets\b` },
  { key: 'substations',        label: 'substation count',        noun: String.raw`substations\b` },
  { key: 'transmission_lines', label: 'transmission-line count', noun: String.raw`transmission\s+lines\b` },
  { key: 'fiber_routes',       label: 'fiber-route count',       noun: String.raw`fiber\s+routes\b` },
  { key: 'gas_pipelines',      label: 'gas-pipeline count',      noun: String.raw`gas\s+pipeline\s+segments\b` },
  { key: 'power_plants_us',    label: 'US power-plant count',    noun: String.raw`US\s+power\s+plants\b` },
  { key: 'submarine_cables',   label: 'subsea-cable count',      noun: String.raw`subsea\s+cables\b` },
  { key: 'cable_landings',     label: 'cable-landing count',     noun: String.raw`cable\s+landings\b` },
  { key: 'generating_units_global', label: 'generating-unit count',
    noun: String.raw`global\s+power\s+generating\s+units\b` },
].map(({ key, label, noun }) => {
  const v = FACTS.numbers?.[key];
  if (!isAssetVal(v)) factsFatal(
    `numbers.${key} is ${JSON.stringify(v)}, not a floor phrase like "330,000+" or "127k". `
    + `Refusing to heal published surfaces from a malformed snapshot.`);
  return { noun, label, canon: () => v };
});

// --print-count: emit the live tool count (from server.mjs) and exit. Lets the
// daily-manifest-sync workflow feed the SAME source-of-truth number into the
// GitHub About field, which aggregators (Glama) mirror but no manifest file owns.
if (process.argv.includes('--print-count')) { console.log(COUNT); process.exit(0); }
// --print-deals: emit the canonical deal-count phrase — same purpose. The daily
// workflow heals the GitHub About deal count the same way it heals the tool count,
// so the 2,000+ -> 4,000+ drift (that no auto-heal watched) cannot recur.
if (process.argv.includes('--print-deals')) { console.log(P.deals); process.exit(0); }
// --print-facilities: ★2026-08-31, and it closes the SAME blind spot the note
// above describes closing for deals. The About heal covered tools and deals and
// silently left the facilities figure alone, so "19,700+ facilities" sat in the
// GitHub About field against a canon of 19,900+ — on the one surface no manifest
// file owns and Glama mirrors verbatim. Two of three claims healed, the third
// unwatched, reported green: the shape this repo keeps finding.
if (process.argv.includes('--print-facilities')) { console.log(P.facilities); process.exit(0); }

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
  // ★2026-08-30 asset-class figures — same matcher, same reporting, same
  // comment-aware exclusion. That last part matters here more than anywhere
  // else: the dated rebind history in this file's header quotes the OLD
  // literals ("320,000+/126k/94k/55k/30k/…") and must stay true, so those
  // //-comment lines are never scanned and never healed.
  txt = applyQuantities(f, txt, ASSET_QUANTITIES, true);
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
  // ★2026-09-01: the adjective slot is why two counts rotted unseen. "82 live
  // MCP tools" (this file's own Smithery copy) and "70 live tools" in
  // docs/contextual-triggers.md — stale since 2026-07-08 against a canon of 83 —
  // matched NEITHER the detector nor the healer, because a word between the digits
  // and "tools" broke `(?: MCP)?`. Repeat the group so any run of known adjectives
  // is absorbed and preserved; the set stays closed so this cannot swallow prose.
  txt = applyRx(txt, /\b(\d+)((?: live| MCP| read-only)* tools)\b/g, (m) => {
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
  // ★2026-08-30 — this check used to be `!sy.includes(VERSION)`: does the canonical
  // version appear ANYWHERE in the file. That is not the same question as "does
  // this descriptor DECLARE the canonical version", and the gap is reachable.
  // Measured on 676255f, with the file's own established comment format:
  //
  //   line 5   # Last refreshed 2026-07-10 (83-tool / v2.12.1 canonical sync)…
  //   line 16  version: "9.9.9"
  //   $ node scripts/sync-tools-manifest.mjs -> exit 0
  //   ✓ all manifest + facts surfaces consistent
  //
  // The trigger is not hypothetical vandalism, it is HOUSEKEEPING: line 5 already
  // reads "(71-tool / v2.4.4 canonical sync)", so the routine act of refreshing
  // that comment to the current version blinds the guard on the key beside it.
  // Smithery is the listing this whole file is named for. Same rule as the
  // copilot descriptor below and server.mjs above: anchor at COLUMN 0 on the
  // declaration, compare the VALUE exactly, and make a missing anchor a hard
  // problem rather than a silent no-op. Also drops the old `\s*`, which spans
  // newlines and could carry the rewrite onto the following line.
  const sy = readCur('smithery.yaml');
  const SYRX = /^(version:[ \t]*")([^"\n]*)("[ \t]*)$/m;
  const sym = SYRX.exec(sy);
  if (!sym) {
    problems.push('smithery.yaml: top-level `version: "x.y.z"` key NOT FOUND — this heal '
      + 'anchors on a column-0, double-quoted `version:` line. If that key moved, lost its '
      + 'quotes or changed shape, re-anchor it here. Do not leave the version heal matching '
      + 'nothing: this is the descriptor Smithery crawls.');
  } else if (sym[2] !== VERSION) {
    problems.push(`smithery.yaml version ${sym[2]} != ${VERSION}`);
    if (FIX) pend('smithery.yaml', sy.replace(SYRX, `$1${VERSION}$3`));
  }
  // ★2026-08-30 — server.mjs, the publish surface this loop could not see.
  // The three surfaces above follow server.json. server.mjs did not, and on
  // 2026-08-29 the gap shipped: #262 bumped the canonical version to 2.12.1 to
  // trigger a registry republish, every manifest surface followed, and the LIVE
  // GATEWAY went on introducing itself as 2.12.0 — the version an agent
  // actually reads at McpServer init, at /health, and in the startup banner.
  // This script ran on that tree and printed "✓ all manifest + facts surfaces
  // consistent", because the one surface that had drifted was not in the loop.
  //
  // The drift WAS caught — by regression.test.mjs's publish-surface grep. But
  // that file sits in test.yml's `continue-on-error: true` live step, so it
  // could only ever report the drift, never block it, and main stayed red for a
  // day. This block is the blocking half: manifest-consistency.yml runs check
  // mode on every push and PR with no continue-on-error.
  //
  // OWNERSHIP IS UNCHANGED. server.json.version stays operator-owned and is
  // still never written here (see the server.json block above). server.mjs
  // simply joins package.json / smithery.yaml / mcp-server.json as a DERIVED
  // surface that follows it. No workflow edit is needed either: server.mjs is
  // already in daily-manifest-sync.yml's $OWNED list — the prose-quantity heal
  // writes it — so --fix is staged, committed and pushed by the same daily job.
  //
  // ★ Anchored on the SERVER_VERSION declaration, never a bare /version:/. The
  // trailing changelog on that same line is dated history ("2.12.0
  // (2026-08-12): …") and, like every comment this script touches, must stay
  // true. A missing anchor is a hard PROBLEM rather than a silent no-op: a
  // regex heal that quietly matches nothing is the precise silent-green shape
  // this script exists to kill, and it would leave the gateway free to drift
  // again under a green check.
  const sm = readCur('server.mjs');
  const SVRX = /(const SERVER_VERSION = \{ version: ')(\d+\.\d+\.\d+)('\s*\}\.version)/;
  const svm = SVRX.exec(sm);
  if (!svm) {
    problems.push('server.mjs: SERVER_VERSION literal NOT FOUND — this heal anchors on '
      + "`const SERVER_VERSION = { version: 'x.y.z' }.version`. If that declaration moved "
      + 'or changed shape, re-anchor it here. Do not leave the version heal matching '
      + 'nothing: server.mjs is the version the live gateway reports.');
  } else if (svm[2] !== VERSION) {
    problems.push(`server.mjs SERVER_VERSION ${svm[2]} != ${VERSION}`);
    if (FIX) pend('server.mjs', sm.replace(SVRX, `$1${VERSION}$3`));
  }

  // ★2026-08-30 — integrations/copilot/dchub-mcp.yaml, the paste-ready Copilot
  // descriptor. Same class as the server.mjs gap above, found the same day, but
  // with a sharper edge: this file was ALREADY covered by this script. It sits in
  // the COVERAGE list below AND in daily-manifest-sync.yml's $OWNED, so its
  // facility/market/deal/country counts self-healed every single day — while
  // nothing owned its `version:` key, which rotted to 2.1.13 against a canonical
  // 2.12.1. Eleven minor versions stale, under a daily job reporting success.
  // A PARTIALLY healed surface reads MORE current than an untouched one, because
  // every number beside the stale version is right.
  //
  // It belongs in this loop, not merely in COVERAGE, because it is a server
  // DESCRIPTOR in the same family as smithery.yaml — name / display_name /
  // description / version / server.transport / base_url -> https://dchub.cloud/mcp —
  // and integrations/copilot/README.md instructs a human to "Paste the YAML
  // manifest from dchub-mcp.yaml". That is exactly the paste-ready manual-repair
  // path the 2026-07-28 note below widened REGISTRY-LISTINGS.md to cover: a human
  // correcting a listing by hand propagates whatever version is sitting here.
  //
  // ★ ANCHORED at column 0 on the top-level `version:` key — never a bare
  // /^version:/m with \s*, which spans newlines. The tools[] entries below are
  // indented key/value blocks; no future nested `version` may capture this heal.
  // The value is compared EXACTLY, NOT via .includes() as smithery.yaml is above:
  // a descriptor that merely mentions the canonical version somewhere in its
  // prose is not a descriptor that DECLARES it.
  // A missing anchor is a hard PROBLEM, not a silent no-op — the server.mjs rule:
  // a regex heal that quietly matches nothing is the silent-green shape this
  // script exists to kill, and it would leave the hand-repair path free to drift
  // again under a green check.
  const CPY = 'integrations/copilot/dchub-mcp.yaml';
  const cp = readCur(CPY);
  const CPRX = /^(version:[ \t]*")([^"\n]*)("[ \t]*)$/m;
  const cpm = CPRX.exec(cp);
  if (!cpm) {
    problems.push(`${CPY}: top-level \`version: "x.y.z"\` key NOT FOUND — this heal `
      + 'anchors on a column-0, double-quoted `version:` line. If that key moved, lost '
      + 'its quotes or changed shape, re-anchor it here. Do not leave the version heal '
      + 'matching nothing: this file is the paste-ready copy a human uses to correct the '
      + 'Copilot listing by hand.');
  } else if (cpm[2] !== VERSION) {
    problems.push(`${CPY} version ${cpm[2]} != ${VERSION}`);
    if (FIX) pend(CPY, cp.replace(CPRX, `$1${VERSION}$3`));
  }

  // ★2026-08-30 — dxt/manifest.json, the Claude Desktop extension manifest.
  // OPERATOR-DIRECTED. This one is a judgment call rather than a found defect, and
  // it was made deliberately: the extension version was "1.0.0", set at creation
  // (a88e500) and never bumped, while the extension it packages tracked the server
  // through 12 minor releases. Claude Desktop shows this number to the user and
  // uses it to decide whether an installed extension is out of date, so a frozen
  // 1.0.0 means a user who installed on day one is never told anything changed.
  // The operator's call is that it follows server.json like every other DERIVED
  // surface here. (Contrast integrations/chatgpt/openapi.json, deliberately NOT in
  // this loop: c3da5da moved its info.version onto its own recipe-aligned line,
  // "promote recipe-aligned v1.2.3 spec". That is an ownership decision already
  // made, and this script must not undo it.)
  //
  // ★ TEXT-anchored, NOT JSON.parse/stringify like package.json and
  // mcp-server.json above. A round-trip through JSON is NOT byte-identical here:
  // the file stores "DC Hub — Data Center Intelligence" and stringify emits a
  // literal em-dash, a 19-byte reformat of lines this heal has no business
  // touching. It would also fight the COVERAGE loop below, which heals this same
  // file as raw TEXT — two writers, two formats, one file.
  //
  // ★ Anchored at 2-space indent on the top-level "version" key, and NOT on a bare
  // /"version":/ — line 2 is "dxt_version": "0.1", the DXT SPEC version, which is
  // not ours to move and must survive every heal. The optional trailing comma is
  // captured and replayed so the key can sit anywhere in the object. A missing
  // anchor is a hard PROBLEM, not a silent no-op — same rule as the three surfaces
  // above.
  const DXT = 'dxt/manifest.json';
  const dx = readCur(DXT);
  const DXRX = /^(  "version": ")([^"\n]*)("(?:,)?)$/m;
  const dxm = DXRX.exec(dx);
  if (!dxm) {
    problems.push(`${DXT}: top-level \`"version": "x.y.z"\` key NOT FOUND — this heal `
      + 'anchors on a 2-space-indented, double-quoted "version" line, deliberately NOT on a '
      + 'bare /"version":/ (line 2 is "dxt_version", the DXT spec version, which is not ours '
      + 'to move). If the key moved, was reindented or changed shape, re-anchor it here. Do '
      + 'not leave the version heal matching nothing: Claude Desktop reads this to decide '
      + 'whether an installed extension is stale.');
  } else if (dxm[2] !== VERSION) {
    problems.push(`${DXT} version ${dxm[2]} != ${VERSION}`);
    if (FIX) pend(DXT, dx.replace(DXRX, `$1${VERSION}$3`));
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
                 'docs/contextual-triggers.md',   // ★2026-09-01: was in NO list; "70 live tools" since 07-08
                 'docs/distribution-targets.md', 'docs/canonical-workflows.md',
                 'scripts/smithery_description.txt', 'dxt/manifest.json',
                 // ★2026-08-11 — the GitHub repo DESCRIPTION. It is METADATA, not
                 // a file, so no guard that walks the working tree could ever see
                 // it: git grep returns nothing and COVERAGE could not list it.
                 // It sat at "16,900+ facilities" against a canon of 17,300+ and
                 // propagated to a third-party listing that copied it in good
                 // faith. Mirrored here so this engine reaches it; the daily
                 // workflow PATCHes GitHub from this file. The file holds the
                 // description VERBATIM — no header, no comment — because its
                 // bytes are pushed as-is.
                 'canonical/github_description.txt']) {
  const txt = readCur(f);
  // Match "N tools", "N MCP tools", AND the shields.io badge form "badge/tools-N-color".
  // Both slipped past CI before: the README body said "48 MCP tools" (2026-06-25) and
  // separately the Tools badge said tools-48 while the body said 49 (2026-06-26).
  const live = liveLines(txt);   // historical (canon:frozen) lines are not claims about now
  const counts = [
    ...[...live.matchAll(/(\d+)(?: live| MCP| read-only)* tools/g)].map((x) => Number(x[1])),
    ...[...live.matchAll(/badge\/tools-(\d+)/g)].map((x) => Number(x[1])),
  ];
  const wrong = counts.filter((c) => c !== COUNT && c > 20); // ignore small unrelated numbers
  if (wrong.length) {
    problems.push(`${f} has tool-count(s) ${[...new Set(wrong)].join('/')} != ${COUNT}`);
    if (FIX) pend(f, healLines(txt, (ln) => ln
      .replace(/\b(\d+)((?: live| MCP| read-only)*) tools\b/g, (s, n, adj) => (Number(n) > 20 ? `${COUNT}${adj || ''} tools` : s))
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
    'canonical/github_description.txt',
    'server.json', 'integrations/chatgpt/openapi.json', 'integrations/chatgpt/instructions.txt',
    'scripts/tier3_presence.sh', 'skills/README.md',
    'skills/dc-hub-data-center-intelligence/SKILL.md',
    // ★2026-07-30 additions — all pure current-claim copy:
    'integrations/README.md', 'integrations/chatgpt/README.md',
    'integrations/cohere/README.md', 'integrations/copilot/dchub-mcp.yaml',
    'integrations/openrouter/tools.json', 'dxt/manifest.json',
    'docs/canonical-workflows.md', 'docs/distribution-targets.md',
    'docs/contextual-triggers.md',
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

// ---- dchub.dxt — the SHIPPED Claude Desktop bundle -------------------------
// ★2026-08-30. Everything above heals SOURCE. dchub.dxt is a committed BINARY at
// the repo root containing a COPY of dxt/manifest.json, and nothing built it: it
// was hand-zipped in a88e500, last repacked by hand on 2026-07-30 (#107), and then
// went a month without one. Measured on 887c250 the shipped manifest read
// "version 1.0.0 · 81 tools · 15,300+ facilities" against a canon of 2.12.1 / 83 /
// 19,500+ — so the daily job healed dxt/manifest.json every day while the file a
// user actually installs kept the old numbers. Neither this script nor $OWNED had
// ever heard of dchub.dxt (`grep -c` returned 0 in both), which is exactly why it
// could rot in the open: no guard was wrong, none existed.
//
// ★ Placed AFTER the COVERAGE loop, deliberately. The bundle must carry the FINAL
// manifest, and dxt/manifest.json is written by two heals — the version block far
// above and COVERAGE just above. readCur() returns this run's pending content, so
// packing here bundles the healed file rather than the one still on disk. Packing
// earlier would ship a one-run-stale bundle and converge only tomorrow.
//
// ★ Compares CONTENTS, never bytes — see scripts/dxt-bundle.mjs. Two zlib builds
// can deflate identically-valid streams to different bytes; a byte guard would go
// red for a reason unrelated to drift.
{
  const BUNDLE = 'dchub.dxt';
  const srcBytes = (f) => Buffer.from(readCur(f), 'utf8');
  let cur = null;
  try { cur = fs.readFileSync(path.join(ROOT, BUNDLE)); }
  catch { problems.push(`${BUNDLE}: MISSING — the shipped Claude Desktop bundle is not in the tree`); }
  if (cur) {
    const drift = bundleDrift(cur, srcBytes);
    if (drift.length) {
      problems.push(`${BUNDLE} ${drift.join('; ')} — repack with --fix`);
      if (FIX) pend(BUNDLE, packBundle(srcBytes));
    }
  } else if (FIX) {
    pend(BUNDLE, packBundle(srcBytes));
  }
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
