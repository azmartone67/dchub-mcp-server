#!/usr/bin/env node
// ============================================================================
// refresh-canon-phrases.mjs (2026-07-30) — pull the five canonical phrase
// quantities from the OWNER endpoint into a committed snapshot.
//
// WHY: six "12,650+" literals sat in server.mjs tool descriptions while the
// initialize instructions had been rebound to live canon (#105), and the sync
// script's own floors (FACILITIES_FLOOR '12,650+', DEALS_FLOOR '1,500+') were
// actively HEALING the registry files back to the stale values. Three repos
// each kept a private copy of the same numbers; every copy rotted on its own
// schedule. The owner is ONE endpoint — /api/v1/canon/phrases, backed by
// ai_surface_canon.resolve_canon(), which self-heals every quantity live from
// the DB (countries since dchub-backend PR #1949). The dchub-frontend heal
// (scripts/heal-agent-tool-count.mjs) already reads it daily; this script
// makes THIS repo read the same owner.
//
// WHY A COMMITTED SNAPSHOT instead of fetching inside sync-tools-manifest.mjs:
// the sync script runs in CHECK mode on every CI run (manifest-consistency,
// the guard test). A network fetch there would make CI non-deterministic — a
// blip would fail unrelated PRs, and a healed tree would flag as drifted the
// moment the fetch fell back to stale constants. So: this script (network,
// daily job only) writes canonical/canon_phrases.json; the sync script (no
// network, every run) reads the committed snapshot. Values move ONLY via a
// commit, atomically with the surfaces healed to them.
//
// FAIL-CLOSED, like the frontend heal: any missing/implausible field, any
// non-live source, any fetch error → log and exit 0 WITHOUT writing. The
// committed snapshot (last verified canon) stays in force. Never fail the
// workflow on a blip; never persist a degraded response.
//
//   node scripts/refresh-canon-phrases.mjs          # fetch + write if valid
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'canonical', 'canon_phrases.json');
const URL_ = 'https://dchub.cloud/api/v1/canon/phrases';

const isPhrase = (s) => typeof s === 'string' && /^\d[\d,]*\+$/.test(s);

// ── the source decision, hoisted so it can be tested without a network call ──
// The endpoint labels its body "<resolver> (<marker>)". Only the MARKER is a
// claim about freshness; the resolver name in front of it is an implementation
// detail that has now changed twice.
export const KNOWN_MARKERS = ['live', 'pinned', 'degraded', 'fallback', 'cached'];

export function sourceMarker(source) {
  return String(source || '').match(/\(([a-z][a-z-]*)\)\s*$/)?.[1] || null;
}

/** The quantity keys of a snapshot — everything that is not metadata.
 *
 * Exported because the change-detection below walks it: a guard that wants to
 * know "would an updated substation count be noticed" should ask this, not
 * grep the source for a hardcoded key list. */
export const quantityKeys = (o) => Object.keys(o || {})
  .filter((k) => !k.startsWith('_') && k !== 'retrieved_at');

const readSnapshot = () => {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; }
};

/** Every floor phrase in a canon body, plus the reasons to refuse.
 *
 * Pure: no network, no filesystem. `prev` is the committed snapshot (or null).
 * Returns {fields, bad} — a non-empty `bad` means keep what is committed.
 */
export function selectPhrases(body, prev) {
  const RESERVED = new Set(['source']);      // label, not a quantity
  const candidates = Object.entries(body).filter(
    ([k, v]) => typeof v === 'string' && !k.startsWith('_') && !RESERVED.has(k));
  const fields = Object.fromEntries(candidates.filter(([, v]) => isPhrase(v)));

  // ★ A SCAN THAT CAN FIND NOTHING NEEDS A FLOOR. Discovery by shape means a
  //   body that returned {} would yield zero fields, zero complaints and an
  //   EMPTY snapshot — which sync-tools-manifest treats as fatal, but only
  //   after this script has already overwritten the good file. These five have
  //   been published continuously since the feed existed; requiring them turns
  //   "found nothing" into a refusal instead of a silent erase.
  const REQUIRED = ['facilities', 'countries', 'deals', 'markets', 'substations'];
  const bad = REQUIRED.filter((k) => !isPhrase(fields[k]));

  // ★ PROSE IS NOT A QUANTITY, BUT A QUANTITY THAT TURNED INTO PROSE IS A
  //   CORRUPT SOURCE. dcpi_regions is legitimately a sentence ("North America,
  //   Europe and Asia-Pacific") and is correctly skipped by shape. A field that
  //   was a phrase in the COMMITTED snapshot and is not one now is the other
  //   case entirely, and silently dropping it would republish the old number
  //   under a green check — refuse instead.
  for (const [k, v] of candidates) {
    if (!isPhrase(v) && isPhrase(prev?.[k])) bad.push(`${k} (was ${prev[k]}, now ${JSON.stringify(v)})`);
  }
  return { fields, bad };
}

/** 'heal' | 'keep' | 'fail' — what a body entitles us to do to canon. */
export function decide(body) {
  const marker = sourceMarker(body?.source);
  if (body?.ok === true && marker && !KNOWN_MARKERS.includes(marker)) return 'fail';
  if (body?.ok !== true || marker !== 'live') return 'keep';
  return 'heal';
}

async function main() {
  let body;
  try {
    const r = await fetch(URL_, {
      headers: { 'User-Agent': 'dchub-mcp-canon-refresh/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    body = await r.json();
  } catch (e) {
    console.log(`canon-phrases refresh: fetch failed (${String(e?.message || e)}) — keeping the committed snapshot`);
    return;
  }

  // Only a LIVE resolution may move the snapshot. The endpoint's PINNED
  // fallback path is itself honest floors, but "last verified live" beats
  // "current fallback" — a degraded backend must not update canon.
  //
  // ★ GATE ON THE MARKER, NOT ON THE RESOLVER'S NAME. This used to require
  //   /resolve_canon \(live\)/. On 2026-09-08 04:53 the backend renamed that
  //   label to "resolve_public_floors (live)" (dchub-backend 90648b2de). The
  //   body stayed live, healthy and correct; only the function's name moved.
  //   The gate stopped matching, this script took the quiet fallback below,
  //   and the workflow went on reporting SUCCESS. canon_phrases.json froze at
  //   2026-09-07 while live canon went 20,900+ -> 21,400+, and because every
  //   registry file and README quantity is generated FROM this snapshot, one
  //   dead predicate published a stale count in 34 places.
  //
  //   "(live)" is the claim that actually matters. The name in front of it is
  //   an implementation detail and has now changed twice.
  const marker = sourceMarker(body?.source);
  const verdict = decide(body);

  if (verdict === 'fail') {
    // ★ LOUD, not quiet. A healthy body wearing a marker we do not recognise is
    //   the exact shape that froze canon for two days behind a green workflow.
    //   Fail the run so the next rename is a red build, not silent staleness.
    console.error(`canon-phrases refresh: UNRECOGNISED source marker "(${marker})" `
      + `in source "${body?.source}". Canon is NOT being healed. Teach `
      + `KNOWN_MARKERS this marker (and add it to the live list if it means live).`);
    process.exit(1);
  }

  if (verdict === 'keep') {
    console.log(`canon-phrases refresh: source is "${body?.source}" (not live) — keeping the committed snapshot`);
    return;
  }
  const tools = Number(body.tools);
  // ★ substations JOINED THE PHRASE SET 2026-09-09. The endpoint has always
  //   published it ("127,000+"), but this script copied only four fields, so
  //   every surface quoting a substation count was hand-typed and drifted:
  //   README and integrations/chatgpt/instructions.txt said 126,000+ while
  //   scripts/smithery_description.txt said 127,000+ — three files, two
  //   answers, none of them healable. A field the source publishes and the
  //   snapshot drops is a number nothing owns.
  //
  // ★2026-09-20 — AND THAT FIX GUARANTEED THE RECURRENCE. Adding the one
  //   field left SIX still dropped. Measured that morning, the endpoint
  //   published eleven phrase fields and this snapshot copied five; assets,
  //   dcpi_countries, fiber_routes, news_sources and transmission_lines were
  //   all "a number nothing owns" by the same sentence above. The visible
  //   cost: scripts/smithery_description.txt — the blurb a human pastes into
  //   the Smithery listing — published "64,000+ fiber routes" against a
  //   measured 58,183. Not stale, OVER by ~5,800, on a public listing.
  //
  // So the set is no longer a LIST OF NAMES. Every string the endpoint
  // publishes in floor-phrase shape is copied; a field it adds later joins
  // with no edit here. Names appear below only as a FLOOR (see REQUIRED),
  // never as the definition of what is eligible.
  const { fields, bad } = selectPhrases(body, readSnapshot());
  if (!Number.isInteger(tools) || tools < 20 || tools > 500) bad.push('tools');
  if (bad.length) {
    console.log(`canon-phrases refresh: implausible field(s) ${bad.join(', ')} — keeping the committed snapshot`);
    return;
  }

  const snap = {
    _generated_by: 'scripts/refresh-canon-phrases.mjs',
    _source: URL_,
    _warning: 'CANONICAL SNAPSHOT — DO NOT HAND-EDIT. Refreshed by daily-manifest-sync; consumed by sync-tools-manifest.mjs (and the smithery-canon-guard test) as the source for every phrase quantity in server.mjs + the registry files.',
    retrieved_at: new Date().toISOString(),
    tools,
    // spread, not enumerated — a third name list here would drift from the two
    // above the moment the feed gains a field, which is the whole bug.
    ...Object.fromEntries(Object.keys(fields).sort().map((k) => [k, fields[k]])),
  };
  // ★ The comparison walks the SNAPSHOT's own keys, plus the previous file's,
  //   so a field being REMOVED from the feed counts as a change. Comparing only
  //   the new keys would call a shrunk snapshot "already matching" and never
  //   write — freezing a field at its last value with nothing to show for it.
  const prev = readSnapshot();
  const compare = new Set([...quantityKeys(snap), ...quantityKeys(prev)]);
  const same = prev && [...compare].every((k) => prev[k] === snap[k]);
  if (same) {
    console.log('canon-phrases refresh: ✓ snapshot already matches live canon — not rewriting (retrieved_at stays at last change)');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap, null, 2) + '\n');
  const shown = quantityKeys(snap).filter((k) => k !== 'tools')
    .map((k) => `${k} ${snap[k]}`).join(' · ');
  console.log(`canon-phrases refresh: ✓ wrote ${path.relative(ROOT, OUT)} — tools ${tools} · ${shown}`);
}

// Run only as a CLI. Importing this module (the guard test does) must not fire
// a network fetch or rewrite the snapshot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
