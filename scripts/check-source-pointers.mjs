#!/usr/bin/env node
// check-source-pointers.mjs -- link-check config/source-pointers.json (Grok spec item 7, 2026-11-24).
//
// For each pointer: HEAD the URL; if HEAD is refused or fails (some public sites answer HEAD with 403/405 and GET with
// 200: broadbandmap.fcc.gov and waterdata.usgs.gov did on 2026-11-24), GET it. A 2xx/3xx answer moves checked_on to
// today (UTC) and resets fail_count; anything else adds one to fail_count and records last_error. A pointer whose
// fail_count reaches 2 (two failed weekly checks in a row) is dropped from answers by lib/source-pointers.mjs; this
// script logs it. Links only: nothing is fetched beyond the status line.
//
// Usage: node scripts/check-source-pointers.mjs [--dry-run] [--file <path>]
// Exit 0 when the file was checked (failures are recorded in it, not raised); exit 2 when the file cannot be read.
// Run weekly by .github/workflows/source-pointers-check.yml, which opens a PR when the file changed.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const DEFAULT_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'source-pointers.json');
export const DROP_AFTER = 2;
const UA = 'Mozilla/5.0 (compatible; link-check/1.0)';
const ok = (s) => typeof s === 'number' && s >= 200 && s < 400;

async function one(url, method, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, redirect: 'follow', signal: ac.signal, headers: { 'user-agent': UA, accept: 'text/html,*/*' } });
    try { if (r.body && r.body.cancel) await r.body.cancel(); } catch (_e) { /* status only */ }
    return { status: r.status };
  } catch (e) {
    return { status: null, error: (e && (e.name === 'AbortError' ? 'timeout' : e.message)) || 'fetch failed' };
  } finally { clearTimeout(t); }
}

/** HEAD, then GET when HEAD is not 2xx/3xx. Returns { ok, status, method, error }. */
export async function checkUrl(url, { timeoutMs = 20000, fetchOne = one } = {}) {
  const h = await fetchOne(url, 'HEAD', timeoutMs);
  if (ok(h.status)) return { ok: true, status: h.status, method: 'HEAD' };
  const g = await fetchOne(url, 'GET', timeoutMs);
  if (ok(g.status)) return { ok: true, status: g.status, method: 'GET', head_status: h.status ?? null };
  return { ok: false, status: g.status ?? null, method: 'GET', head_status: h.status ?? null,
    error: g.error || `HTTP ${g.status}` };
}

/** The updated pointer list for one round of results (results[i] belongs to list[i]). Pure. */
export function applyResults(list, results, today) {
  return list.map((p, i) => {
    const r = results[i];
    if (!r) return p;
    if (r.ok) {
      const { last_error, ...rest } = p;   // a passing check clears the last failure
      return { ...rest, checked_on: today, fail_count: 0 };
    }
    return { ...p, fail_count: (Number(p.fail_count) || 0) + 1, last_error: `${today}: ${r.error || 'failed'}` };
  });
}

export async function main(argv = process.argv.slice(2), { fetchOne } = {}) {
  const dry = argv.includes('--dry-run');
  const fi = argv.indexOf('--file');
  const file = fi >= 0 && argv[fi + 1] ? argv[fi + 1] : DEFAULT_FILE;
  let list;
  try { list = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    console.error(`::error::cannot read ${file}: ${e.message}`);
    return 2;
  }
  if (!Array.isArray(list)) { console.error(`::error::${file} is not an array`); return 2; }
  const today = new Date().toISOString().slice(0, 10);
  const results = [];
  for (const p of list) {
    const r = p && typeof p.url === 'string' ? await checkUrl(p.url, { fetchOne }) : { ok: false, error: 'no url' };
    results.push(r);
    const how = r.ok ? `OK ${r.method} ${r.status}${r.head_status != null ? ` (HEAD ${r.head_status})` : ''}`
      : `FAIL ${r.error}${r.head_status != null ? ` (HEAD ${r.head_status})` : ''}`;
    console.log(`${(p && p.topic) || '?'}\t${(p && p.url) || '?'}\t${how}`);
  }
  const next = applyResults(list, results, today);
  for (const p of next) {
    if (Number(p.fail_count) >= DROP_AFTER) console.log(`::warning::${p.topic} pointer ${p.url} failed ${p.fail_count} checks in a row; it is dropped from answers until a check passes`);
    else if (Number(p.fail_count) > 0) console.log(`::notice::${p.topic} pointer ${p.url} failed this check (${p.fail_count} in a row)`);
  }
  const out = JSON.stringify(next, null, 2) + '\n';
  const changed = out !== readFileSync(file, 'utf8');
  if (dry) console.log(`dry run: ${changed ? 'the file would change' : 'no change'}`);
  else if (changed) { writeFileSync(file, out); console.log(`updated ${file}`); }
  else console.log('no change');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code; });
}
