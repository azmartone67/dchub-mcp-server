// =============================================================================
// listing-copy — the one file directory listings are written from, and its rules.
// -----------------------------------------------------------------------------
// canonical/listing-copy.json is the single source of truth for what a
// third-party MCP directory says about DC Hub: Glama, LobeHub, PulseMCP,
// mcpservers.org, MCP Hive, mcp.so and the rest. A person or an agent (Grok's
// auto-sync) pastes or pushes FROM it; nothing writes a listing from memory.
//
// Fields:
//   short       one-sentence tagline
//   long        the Long description. Byte-equal to scripts/smithery_description.txt
//               (trimmed), which smithery-freshness.yml pushes to Smithery, so the
//               two cannot drift. test/listing-copy.test.mjs enforces it.
//   glama_400   the Glama-sized description, at most GLAMA_MAX chars
//   tool_count  the served /mcp tools/list count (healed by sync-tools-manifest)
//   price_line  exactly PRICE_LINE
//   endpoints   exactly endpointsLine(tool_count)
//   capacity_blurb  the Capacity Source paste line (owner, 2026-09-29): count-free,
//               price-free, and it names source_capacity and dchub.cloud/listings
//   updated_at  YYYY-MM-DD of the last copy edit
//
// COPY RULES (owner-approved 2026-09-28). No field may state:
//   - a facility count (the count is withdrawn: "corroborated count pending")
//   - a monthly price ("$99/mo", "$49 per month", ...)
//   - "$10 unlocks full answers"
//   - "seven layers"
// copyRuleViolations() is the one implementation; the ecosystem-sync read-back
// uses the same function on what a live listing shows.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFacilityFloors } from './canon-floor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LISTING_COPY_PATH = 'canonical/listing-copy.json';
export const GLAMA_MAX = 400;
export const PRICE_LINE = '$10 one-time pack of 1,000 API credits';
export const REST_URL = 'https://dchub.cloud/api/v1';
export const MCP_URL = 'https://dchub.cloud/mcp';
export const FIELDS = ['short', 'long', 'glama_400', 'tool_count', 'price_line', 'endpoints', 'capacity_blurb', 'updated_at'];
export const TEXT_FIELDS = ['short', 'long', 'glama_400', 'price_line', 'endpoints', 'capacity_blurb'];

export const endpointsLine = (n) => `${n} MCP tools at ${MCP_URL} plus a REST API at ${REST_URL}`;

// Each rule: [id, regex, what it bans]. Regexes are global so every hit is named.
export const COPY_RULES = [
  ['monthly_price',
    /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|mon|month)\b|(?:per|a|each)\s+month\b|monthly\b)/gi,
    'no monthly prices'],
  ['ten_unlocks_full_answers', /\$\s?10\b[^.]{0,40}?\bunlocks?\b[^.]{0,20}?\bfull\s+answers?\b/gi,
    'no "$10 unlocks full answers"'],
  ['seven_layers', /\b(?:seven|7)\s+(?:[a-z-]+\s+)?layers?\b/gi, 'no "seven layers"'],
];

/** Every copy-rule breach a text contains: [{ rule, match, why }]. */
export function copyRuleViolations(text) {
  const s = String(text ?? '');
  const out = [];
  for (const f of findFacilityFloors(s)) {
    out.push({ rule: 'facility_count', match: f, why: 'no facility count (corroborated count pending)' });
  }
  for (const [rule, rx, why] of COPY_RULES) {
    for (const m of s.matchAll(rx)) out.push({ rule, match: m[0], why });
  }
  return out;
}

/** The parsed listing copy, or null when the file is absent or unreadable. */
export function loadListingCopy(root = ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, LISTING_COPY_PATH), 'utf8'));
  } catch {
    return null;
  }
}

const norm = (s) => String(s ?? '')
  .replace(/&(?:amp|#x27|#39|quot|lt|gt|nbsp);/g, (m) => ({ '&amp;': '&', '&#x27;': "'", '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[m])
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

// A directory truncates, re-wraps and entity-encodes what it stores, so the
// read-back matches a normalised PREFIX of each variant, not the whole string.
export const FINGERPRINT_CHARS = 80;

/** The strings a live listing must contain (any one) to count as showing the
 *  current copy: a normalised prefix of `short`, `glama_400` and `long`. */
export function copyFingerprints(copy) {
  if (!copy) return [];
  return [...new Set(['short', 'glama_400', 'long']
    .map((k) => norm(copy[k]).slice(0, FINGERPRINT_CHARS))
    .filter((s) => s.length >= 40))];
}

/** Does this read-back text show the current listing copy? */
export function showsCurrentCopy(text, fingerprints) {
  if (!fingerprints?.length) return false;
  const t = norm(text);
  return fingerprints.some((f) => t.includes(f));
}
