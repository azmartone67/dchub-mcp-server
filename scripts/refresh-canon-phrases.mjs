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
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'canonical', 'canon_phrases.json');
const URL_ = 'https://dchub.cloud/api/v1/canon/phrases';

const isPhrase = (s) => typeof s === 'string' && /^\d[\d,]*\+$/.test(s);

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
  if (body?.ok !== true || !/resolve_canon \(live\)/.test(String(body?.source || ''))) {
    console.log(`canon-phrases refresh: source is "${body?.source}" (not live) — keeping the committed snapshot`);
    return;
  }
  const tools = Number(body.tools);
  const fields = { facilities: body.facilities, countries: body.countries, deals: body.deals, markets: body.markets };
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
  };
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
  const same = prev && ['tools', 'facilities', 'countries', 'deals', 'markets'].every((k) => prev[k] === snap[k]);
  if (same) {
    console.log('canon-phrases refresh: ✓ snapshot already matches live canon — not rewriting (retrieved_at stays at last change)');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap, null, 2) + '\n');
  console.log(`canon-phrases refresh: ✓ wrote ${path.relative(ROOT, OUT)} — tools ${tools} · facilities ${snap.facilities} · countries ${snap.countries} · deals ${snap.deals} · markets ${snap.markets}`);
}

main();
