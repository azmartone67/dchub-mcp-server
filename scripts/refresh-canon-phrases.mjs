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
  // ★ substations JOINS THE PHRASE SET 2026-09-09. The endpoint has always
  //   published it ("127,000+"), but this script copied only four fields, so
  //   every surface quoting a substation count was hand-typed and drifted:
  //   README and integrations/chatgpt/instructions.txt said 126,000+ while
  //   scripts/smithery_description.txt said 127,000+ — three files, two
  //   answers, none of them healable. A field the source publishes and the
  //   snapshot drops is a number nothing owns.
  const fields = { facilities: body.facilities, countries: body.countries, deals: body.deals,
                   markets: body.markets, substations: body.substations };
  const bad = Object.entries(fields).filter(([, v]) => !isPhrase(v)).map(([k]) => k);
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
    facilities: fields.facilities,
    countries: fields.countries,
    deals: fields.deals,
    markets: fields.markets,
    substations: fields.substations,
  };
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
  const same = prev && ['tools', 'facilities', 'countries', 'deals', 'markets', 'substations'].every((k) => prev[k] === snap[k]);
  if (same) {
    console.log('canon-phrases refresh: ✓ snapshot already matches live canon — not rewriting (retrieved_at stays at last change)');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap, null, 2) + '\n');
  console.log(`canon-phrases refresh: ✓ wrote ${path.relative(ROOT, OUT)} — tools ${tools} · facilities ${snap.facilities} · countries ${snap.countries} · deals ${snap.deals} · markets ${snap.markets}`);
}

// Run only as a CLI. Importing this module (the guard test does) must not fire
// a network fetch or rewrite the snapshot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
