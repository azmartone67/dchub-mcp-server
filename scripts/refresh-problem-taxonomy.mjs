#!/usr/bin/env node
// ============================================================================
// refresh-problem-taxonomy.mjs (2026-07-31) — pull the canonical problem
// taxonomy (in_scope "this is a DC Hub question" + out_of_scope "when NOT to
// use DC Hub") from the OWNER endpoint into a committed snapshot.
//
// WHY: the positive routing vocabulary previously lived in three independent
// transcriptions (frontend heal TRIGGERS, this repo's execute_plan
// description, the backend's front-door pane) and they had already drifted —
// each copy internally consistent, so nothing detected it. The owner is ONE
// module — dchub-backend routes/problem_taxonomy.py, served at
// /api/v1/canon/taxonomy. This repo derives: server.mjs composes the
// initialize-instructions scope section and discover_tools' `not_for` from
// the snapshot at startup, and the taxonomy guard test asserts the
// execute_plan description covers every in_scope term.
//
// WHY A COMMITTED SNAPSHOT instead of fetching in server.mjs: same contract
// as refresh-canon-phrases.mjs — CI and startup must be deterministic and
// network-free; values move ONLY via a commit, atomically with the surfaces
// tested against them.
//
// FAIL-CLOSED: any fetch error, non-ok body, malformed list, or a COUNT
// inside an entry (the lists are count-free BY CONTRACT — a digit here is
// evidence of upstream breakage, not new canon) → log and exit 0 WITHOUT
// writing. The committed snapshot stays in force.
//
//   node scripts/refresh-problem-taxonomy.mjs          # fetch + write if valid
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'canonical', 'problem_taxonomy.json');
const URL_ = 'https://dchub.cloud/api/v1/canon/taxonomy';

const isCleanList = (v, min, max) =>
  Array.isArray(v) && v.length >= min && v.length <= max &&
  v.every((s) => typeof s === 'string' && s.length >= 10 && !/\d/.test(s));

// The snapshot's shape, in ONE place, so the staleness gate above can ask what
// this script would write rather than carrying a second hand-maintained list
// that drifts from the first.
export function buildSnapshot(body) {
  return {
    _generated_by: 'scripts/refresh-problem-taxonomy.mjs',
    _source: URL_,
    _warning: 'CANONICAL SNAPSHOT — DO NOT HAND-EDIT. Refreshed by daily-manifest-sync; consumed by server.mjs at startup (initialize instructions scope section + discover_tools not_for/not_collected + why_live_code phrase resolution) and by the taxonomy guard test. The owner is dchub-backend routes/problem_taxonomy.py.',
    retrieved_at: new Date().toISOString(),
    version: body.version,
    contract_hash: body.contract_hash,
    source: body.source,
    note: body.note,
    in_scope: body.in_scope,
    out_of_scope: body.out_of_scope,
    not_for_note: body.not_for_note,
    why_live_reasons: body.why_live_reasons,
    // v6 — named absence. Copied only when the owner serves it, so a v5 owner
    // does not produce a snapshot carrying an empty promise.
    ...(body.fields_not_collected ? {
      fields_not_collected: body.fields_not_collected,
      fields_not_collected_note: body.fields_not_collected_note,
    } : {}),
  };
}

async function main() {
  let body;
  try {
    const r = await fetch(URL_, {
      headers: { 'User-Agent': 'dchub-mcp-taxonomy-refresh/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    body = await r.json();
  } catch (e) {
    console.log(`taxonomy refresh: fetch failed (${String(e?.message || e)}) — keeping the committed snapshot`);
    return;
  }

  const bad = [];
  if (body?.ok !== true) bad.push('ok!==true');
  if (!Number.isInteger(body?.version) || body.version < 1) bad.push('version');
  if (!/^[0-9a-f]{16}$/.test(String(body?.contract_hash || ''))) bad.push('contract_hash');
  if (!isCleanList(body?.in_scope, 8, 40)) bad.push('in_scope');
  if (!isCleanList(body?.out_of_scope, 5, 40)) bad.push('out_of_scope');
  if (typeof body?.not_for_note !== 'string' || body.not_for_note.length < 40 || /\d/.test(body.not_for_note)) bad.push('not_for_note');
  // Taxonomy v2 (round-11): the enumerated live-data reason set. ENUM
  // discipline enforced at sync time — snake_case requires_* codes, digit-free
  // phrases, and a SMALL value space (an enum that grows a value per plan
  // class stops being an aggregation axis).
  const wlr = body?.why_live_reasons;
  const wlrOk = wlr && typeof wlr === 'object' && !Array.isArray(wlr) &&
    Object.keys(wlr).length >= 4 && Object.keys(wlr).length <= 12 &&
    Object.entries(wlr).every(([k, v]) => /^requires_[a-z_]+$/.test(k) &&
      typeof v === 'string' && v.length >= 20 && !/\d/.test(v));
  if (!wlrOk) bad.push('why_live_reasons');
  // Taxonomy v6: named absence. Validated but NOT required — an owner still on
  // v5 is a legitimate state, and hard-failing on it would stop the whole
  // refresh for a field that did not exist yesterday. Absent is fine; present
  // and malformed is not.
  const fnc = body?.fields_not_collected;
  if (fnc !== undefined) {
    const fncOk = Array.isArray(fnc) && fnc.length >= 1 && fnc.length <= 40 &&
      fnc.every(f => f && typeof f === 'object' &&
        typeof f.field === 'string' && f.field.length >= 3 &&
        Array.isArray(f.aliases) && f.aliases.length >= 1 &&
        f.aliases.every(a => typeof a === 'string' && a === a.toLowerCase()) &&
        typeof f.why === 'string' && f.why.length >= 20 &&
        typeof f.instead === 'string' && f.instead.length >= 10 &&
        // The honesty rule, enforced at SYNC time as well as at the owner:
        // `instead` must point at a DIFFERENT real field, never a substitute
        // for the missing one. A snapshot is a publishing surface too.
        !f.aliases.some(a => f.instead.toLowerCase().includes(a)));
    if (!fncOk) bad.push('fields_not_collected');
    if (typeof body?.fields_not_collected_note !== 'string' ||
        body.fields_not_collected_note.length < 40) bad.push('fields_not_collected_note');
  }
  if (bad.length) {
    console.log(`taxonomy refresh: invalid field(s) ${bad.join(', ')} — keeping the committed snapshot`);
    return;
  }

  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();

  // ★ The hash gate is not enough on its own, and 2026-08-31 proved it.
  //
  // This script copies an EXPLICIT key list. When the owner added
  // fields_not_collected (v6), the sync wrote a snapshot carrying v6's version
  // AND v6's contract_hash while silently dropping v6's actual new content —
  // and then, because the hash now matched, refused to rewrite it ever again.
  // The result is the worst possible state: a snapshot that LIES about being
  // current, permanently, and cannot self-heal.
  //
  // So the short-circuit now also requires that every key this script would
  // write is already present. Any future field added to the owner repairs
  // itself on the next run instead of needing someone to notice.
  const missingKeys = prev
    ? Object.keys(buildSnapshot(body)).filter(k => !(k in prev) && k !== 'retrieved_at')
    : [];
  if (prev && prev.contract_hash === body.contract_hash && missingKeys.length === 0) {
    console.log('taxonomy refresh: ✓ snapshot already matches the owner (contract_hash ' + body.contract_hash + ') — not rewriting');
    return;
  }
  if (prev && prev.contract_hash === body.contract_hash && missingKeys.length) {
    console.log(`taxonomy refresh: hash matches but snapshot is missing ${missingKeys.join(', ')} — rewriting to repair`);
  }

  const snap = buildSnapshot(body);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap, null, 2) + '\n');
  console.log(`taxonomy refresh: ✓ wrote ${path.relative(ROOT, OUT)} — v${snap.version} hash ${snap.contract_hash} (${snap.in_scope.length} in-scope / ${snap.out_of_scope.length} out-of-scope classes)`);
}

main();
