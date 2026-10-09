#!/usr/bin/env node
// refresh-listing.mjs (2026-10-09): pull GET /api/v1/canon/listing into
// canonical/listing.json. Network lives here only; the sync check stays offline.
// FAIL-CLOSED like refresh-canon-phrases.mjs: any fetch error, non-200, or rule
// violation logs and exits 0 WITHOUT writing, so a blip never persists a bad copy.
//   node scripts/refresh-listing.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LISTING_PATH, listingProblems } from './listing-canon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.DCHUB_LISTING_URL || 'https://dchub.cloud/api/v1/canon/listing';

export async function main() {
  let body;
  try {
    const r = await fetch(URL_, { headers: { 'user-agent': 'dchub-listing-refresh/1.0' } });
    if (!r.ok) { console.log(`listing refresh skipped: ${URL_} answered ${r.status}`); return 0; }
    body = await r.json();
  } catch (e) { console.log(`listing refresh skipped: ${e.message}`); return 0; }
  const bad = listingProblems(body);
  if (bad.length) { console.log(`listing refresh refused, nothing written: ${bad.join('; ')}`); return 0; }
  const prev = fs.existsSync(path.join(ROOT, LISTING_PATH)) ? JSON.parse(fs.readFileSync(path.join(ROOT, LISTING_PATH), 'utf8')) : {};
  const { _comment } = prev;
  const next = { ...(_comment ? { _comment } : {}), ...body };
  const same = (a, b) => JSON.stringify({ ...a, as_of: 0 }) === JSON.stringify({ ...b, as_of: 0 });
  if (same(prev, next)) { console.log('listing unchanged'); return 0; }
  fs.writeFileSync(path.join(ROOT, LISTING_PATH), JSON.stringify(next, null, 2) + '\n');
  console.log(`listing.json updated (version ${next.version}, ${next.tool_count} tools, as_of ${next.as_of})`);
  return 0;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
