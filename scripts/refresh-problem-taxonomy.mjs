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
  if (bad.length) {
    console.log(`taxonomy refresh: invalid field(s) ${bad.join(', ')} — keeping the committed snapshot`);
    return;
  }

  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
  if (prev && prev.contract_hash === body.contract_hash) {
    console.log('taxonomy refresh: ✓ snapshot already matches the owner (contract_hash ' + body.contract_hash + ') — not rewriting');
    return;
  }

  const snap = {
    _generated_by: 'scripts/refresh-problem-taxonomy.mjs',
    _source: URL_,
    _warning: 'CANONICAL SNAPSHOT — DO NOT HAND-EDIT. Refreshed by daily-manifest-sync; consumed by server.mjs at startup (initialize instructions scope section + discover_tools not_for + why_live_code phrase resolution) and by the taxonomy guard test. The owner is dchub-backend routes/problem_taxonomy.py.',
    retrieved_at: new Date().toISOString(),
    version: body.version,
    contract_hash: body.contract_hash,
    source: body.source,
    note: body.note,
    in_scope: body.in_scope,
    out_of_scope: body.out_of_scope,
    not_for_note: body.not_for_note,
    why_live_reasons: body.why_live_reasons,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap, null, 2) + '\n');
  console.log(`taxonomy refresh: ✓ wrote ${path.relative(ROOT, OUT)} — v${snap.version} hash ${snap.contract_hash} (${snap.in_scope.length} in-scope / ${snap.out_of_scope.length} out-of-scope classes)`);
}

main();
