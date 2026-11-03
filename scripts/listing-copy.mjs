// =============================================================================
// listing-copy — the one file directory listings are written from, and its rules.
// -----------------------------------------------------------------------------
// canonical/listing-copy.json is the single source of truth for what a
// third-party MCP directory says about DC Hub: Glama, LobeHub, PulseMCP,
// mcpservers.org, MCP Hive, mcp.so and the rest. A person or an agent (Grok's
// auto-sync) pastes or pushes FROM it; nothing writes a listing from memory.
//
// Fields:
//   tagline     the owner-approved DC Hub tagline (2026-10-09; the 2026-09-29
//               "agentic procurement endpoint" line is retired), exact wording,
//               no superlative ever added. TAGLINE below is the pinned value.
//   short       one-sentence summary
//   long        the Long description. Byte-equal to scripts/smithery_description.txt
//               (trimmed), which smithery-freshness.yml pushes to Smithery, so the
//               two cannot drift. test/listing-copy.test.mjs enforces it.
//   glama_400   the Glama-sized description, at most GLAMA_MAX chars
//   tight       the variant for tight caps (owner 2026-10-10), at most TIGHT_MAX
//               chars: DCPI lead + the MCP URL. cursor_directory caps at 280, so
//               it got `short` (no URL), plus the backend Capacity Source line
//               (118) on the submitter path. TIGHT_MAX leaves room for that line.
//   tool_count  the served /mcp tools/list count (healed by sync-tools-manifest)
//   price_line  exactly PRICE_LINE
//   endpoints   exactly endpointsLine(tool_count)
//   capacity_blurb  the Capacity Source paste line (owner, 2026-09-29): count-free,
//               price-free, and it names source_capacity and dchub.cloud/listings
//   updated_at  YYYY-MM-DD of the last copy edit
//
// COPY RULES (owner-approved 2026-09-28). No field may state:
//   - a facility count (the count is withdrawn, owner decision 2026-09-27)
//   - a monthly price ("$99/mo", "$49 per month", ...)
//   - a plan named with its price ("$49 Developer", "Pro $99")
//   - "$10 unlocks full answers"
//   - "seven layers"
//   - an INTERNAL DIRECTIVE (2026-10-15, finding #116292): a line written to
//     whoever composes or submits the listing ("Canon prices: ...", "Do not
//     print exact facility counts"), or internal governance vocabulary (an
//     owner-rule reference, a finding id, the agent-contract keywords of the
//     MCP instructions). MCP Collection published exactly that pair of lines
//     as the About text of the DC Hub listing, because a submitting agent
//     pasted its own brief into the description field. The rules are scoped
//     to PUBLIC DESCRIPTION strings; the MCP initialize instructions, llms.txt,
//     the skill files and the tool descriptions are addressed to agents on
//     purpose and are not read by them (test/public-descriptions-no-internal-
//     directives.test.mjs names each one and why).
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
export const TIGHT_MAX = 160;
export const PRICE_LINE = 'Paid plans: dchub.cloud/pricing';  // Grok DCPI rollout 2026-10-09: listings name no price, only the pricing page
export const REST_URL = 'https://dchub.cloud/api/v1';
export const MCP_URL = 'https://dchub.cloud/mcp';
export const FIELDS = ['tagline', 'short', 'long', 'glama_400', 'tight', 'tool_count', 'price_line', 'endpoints', 'capacity_blurb', 'glama_live', 'mcpmarket_live', 'updated_at'];
export const TEXT_FIELDS = ['tagline', 'short', 'long', 'glama_400', 'tight', 'price_line', 'endpoints', 'capacity_blurb', 'glama_live', 'mcpmarket_live'];

/** The owner-approved tagline, character for character (Jonathan, 2026-10-09).
 *  canonical/listing-copy.json `tagline` must equal it; test/listing-copy.test.mjs. */
export const TAGLINE = 'Live data center, power, grid, fiber and deal data for AI agents and site selection.';

/** Words that may never be bolted onto the tagline ("the only", "first", ...). */
export const TAGLINE_SUPERLATIVE = /\b(?:the only|only|first|on the planet|world'?s|largest|leading|best|number one|premier|ultimate)\b|#1/i;

/** Where the Capacity Source sentence starts inside `long` (owner, 2026-09-29). */
export const CAPACITY_SENTENCE_ANCHOR = 'Capacity Source adds';

export const endpointsLine = (n) => `${n} MCP tools at ${MCP_URL} plus a REST API at ${REST_URL}`;

// Internal-directive markers (finding #116292, 2026-10-15). Each is a phrase that
// only makes sense said to the PERSON OR AGENT WRITING a listing, or that names
// internal governance. A public description says what DC Hub is and does, in the
// third person. The same four shapes are fenced on the backend submit path
// (dchub-backend routes/white_glove_propagation.py listing_copy_violations).
// Regexes are global so every hit is named; MUST/FRONT DOOR stay case-sensitive
// (they are agent-contract keywords, not English).
export const INTERNAL_DIRECTIVE_RULES = [
  // "Canon prices: $10 pack, ..." / "canon rules are ..." (a label, not the word
  // "canon" or "canonical" in prose; "/api/v1/canon" has no space-then-noun).
  ['internal_canon_label',
    /\bcanon\s+(?:prices?|rules?|floors?|copy|phrases?|wording|offers?|figures?)\s*(?::|\bare\b|\bis\b)/gi,
    'no internal canon label ("Canon prices: ...")'],
  // "Do not print exact facility counts." An order about how to write the copy.
  ['internal_do_not',
    /\b(?:do not|don't|never)\s+(?:print|state|quote|publish|paste|include|mention|name|round|invent|guess|reuse|cite|say|write|show|assume|ignore)\b/gi,
    'no instruction to whoever writes the listing ("Do not print ...")'],
  ['internal_agent_contract', /\bMUST (?:CALL|NOT|USE|ALWAYS)\b|\bFRONT DOOR\b/g,
    'no agent-contract keywords (MUST CALL, FRONT DOOR)'],
  ['internal_governance_ref',
    /\bowner(?:'s)?[ -](?:rule|decision|directive|call|approved|policy|brief)\b|\bG-\d{4}-\d+\b|\bfrz-[a-z0-9-]+\b/gi,
    'no internal governance reference (owner rule, finding id)'],
];

// Each rule: [id, regex, what it bans]. Regexes are global so every hit is named.
export const COPY_RULES = [
  ['monthly_price',
    /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|mon|month)\b|(?:per|a|each)\s+month\b|monthly\b)/gi,
    'no monthly prices'],
  // "$49 Developer", "Pro $99", "Developer ($49)": a plan priced without "/mo".
  // The $10 credit pack is not a plan and is not matched.
  ['plan_price',
    /\$\s?\d[\d,]*(?:\.\d+)?\)?\s+(?:Starter|Developer|Pro|Enterprise)\b|\b(?:Starter|Developer|Pro|Enterprise)\s+\(?\$\s?\d/g,
    'no plan priced in listing copy (prices live at dchub.cloud/pricing)'],
  ['ten_unlocks_full_answers', /\$\s?10\b[^.]{0,40}?\bunlocks?\b[^.]{0,20}?\bfull\s+answers?\b/gi,
    'no "$10 unlocks full answers"'],
  ['seven_layers', /\b(?:seven|7)\s+(?:[a-z-]+\s+)?layers?\b/gi, 'no "seven layers"'],
  ...INTERNAL_DIRECTIVE_RULES,
];

/** Only the internal-directive breaches in a text: [{ rule, match, why }]. */
export function internalDirectiveViolations(text) {
  const s = String(text ?? '');
  const out = [];
  for (const [rule, rx, why] of INTERNAL_DIRECTIVE_RULES) {
    for (const m of s.matchAll(rx)) out.push({ rule, match: m[0], why });
  }
  return out;
}

/** Every copy-rule breach a text contains: [{ rule, match, why }]. */
export function copyRuleViolations(text) {
  const s = String(text ?? '');
  const out = [];
  for (const f of findFacilityFloors(s)) {
    out.push({ rule: 'facility_count', match: f, why: 'no facility count (withdrawn, owner decision 2026-09-27)' });
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
 *  current copy: a normalised prefix of `short`, `glama_400` and `long`, and
 *  (2026-09-29) of the ones a listing may LEAD with instead: `tagline`, the
 *  Capacity Source sentence at the end of `long`, and `capacity_blurb`. Grok
 *  rewrites directory listings to open with the tagline + the Capacity Source
 *  line; on the old prefix-only set those read as drift while current.
 *  A fingerprint match is only half the verdict: the read-back still runs
 *  copyRuleViolations() on the whole text, so a tagline-led listing that also
 *  carries a count or a monthly price is still drift. */
export function copyFingerprints(copy) {
  if (!copy) return [];
  const long = String(copy.long ?? '');
  const at = long.indexOf(CAPACITY_SENTENCE_ANCHOR);
  const capacitySentence = at >= 0 ? long.slice(at) : '';
  return [...new Set([copy.short, copy.glama_400, copy.long, copy.tight, copy.tagline, capacitySentence, copy.capacity_blurb]
    .map((v) => norm(v).slice(0, FINGERPRINT_CHARS))
    .filter((s) => s.length >= 40))];
}

/** Does this read-back text show the current listing copy? */
export function showsCurrentCopy(text, fingerprints) {
  if (!fingerprints?.length) return false;
  const t = norm(text);
  return fingerprints.some((f) => t.includes(f));
}
