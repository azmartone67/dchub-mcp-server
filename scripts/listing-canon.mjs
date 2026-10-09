// listing-canon.mjs (2026-10-09, Grok->brain "publish from canon", item 2).
//
// One listing block, owned by dchub-backend (GET /api/v1/canon/listing), committed
// here as canonical/listing.json. This module is PURE (no network, no cwd): it
// judges the snapshot, renders the files that are generated from it, and checks
// that the other manifests agree with it. sync-tools-manifest.mjs calls it in
// CHECK and --fix; refresh-listing.mjs is the only thing that touches the network.
//
// It does not replace canonical/listing-copy.json (owner-approved tagline, $10
// pack line, Glama 400 copy). That file keeps its own tests; the two are checked
// against each other only on the tool count.

export const LISTING_PATH = 'canonical/listing.json';
export const CONTEXT7_PATH = 'context7.json';
export const SHORT_MAX = 160;
const REQUIRED = ['name', 'endpoint', 'version', 'as_of', 'tool_count', 'short_description',
  'long_description', 'categories', 'connect_url', 'cite_as', 'license'];
export const SUBMISSION_HEADER =
  '> **History. Do not paste.** This file records what was submitted and when. ' +
  'Current listing copy is generated from canon: `canonical/listing.json` ' +
  '(source: https://dchub.cloud/api/v1/canon/listing).';

/** Rule violations in a listing block. Same rules the backend test pins. */
export function listingProblems(L) {
  const bad = [];
  if (!L || typeof L !== 'object') return ['listing.json missing or not an object'];
  for (const k of REQUIRED) if (L[k] === undefined || L[k] === '') bad.push(`listing.${k} missing`);
  if (bad.length) return bad;
  if (L.name !== 'DC Hub Intelligence') bad.push(`listing.name is "${L.name}"`);
  if (L.short_description.length > SHORT_MAX) bad.push(`short_description is ${L.short_description.length} chars (max ${SHORT_MAX})`);
  if (!Number.isInteger(L.tool_count) || L.tool_count < 1) bad.push('tool_count is not a positive integer');
  const text = [L.short_description, L.long_description, L.auth].join(' ');
  if (/nexus/i.test(text)) bad.push('retired name in listing copy');
  if (/\$\s?\d/.test(text)) bad.push('price in listing copy');
  if (/—/.test(text)) bad.push('em dash in listing copy');
  if (/\b\d[\d,]*\+?\s+(?:data center |data-center )?facilit/i.test(text)) bad.push('facility number in listing copy');
  for (const f of [L.short_description, L.long_description]) {
    for (const m of f.matchAll(/\b(\d+)(?:[ -]MCP)?[ -]tools?\b/g)) {
      if (Number(m[1]) !== L.tool_count) bad.push(`"${m[0]}" != tool_count ${L.tool_count}`);
    }
  }
  return bad;
}

/** context7.json, generated whole. Description is the short listing line: no
 * instructions to agents, no promo wording (Grok brief). */
export function renderContext7(L) {
  const doc = {
    $schema: 'https://context7.com/schema/context7.json',
    projectTitle: L.name,
    description: L.short_description,
    excludeFolders: ['test', 'submissions', 'node_modules', 'sdk', 'integrations'],
    rules: [],
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

const CONTEXT7_BAD = /\b(you must|always|never|ignore|call |use this|best|leading|#1|free trial|sign up)\b/i;
export function context7Problems(text, L) {
  const bad = [];
  if (text === null) return [`${CONTEXT7_PATH} is missing (run sync-tools-manifest --fix)`];
  let j;
  try { j = JSON.parse(text); } catch (e) { return [`${CONTEXT7_PATH}: invalid JSON, ${e.message}`]; }
  if (text !== renderContext7(L)) bad.push(`${CONTEXT7_PATH} differs from canonical/listing.json`);
  if (CONTEXT7_BAD.test(String(j.description || ''))) bad.push(`${CONTEXT7_PATH} description reads as an instruction or promo`);
  return bad;
}

/** Add the do-not-paste header under the title line of a submissions file. */
export function withSubmissionHeader(md) {
  if (md.includes(SUBMISSION_HEADER)) return md;
  const nl = md.indexOf('\n');
  return md.slice(0, nl + 1) + '\n' + SUBMISSION_HEADER + '\n' + md.slice(nl + 1);
}

/** Tool-count claims in a manifest's strings that disagree with canon. */
export function countClaimProblems(label, text, count) {
  const bad = [];
  for (const m of text.matchAll(/\b(\d+)(?:[ -](?:live|MCP|read-only))*[ -]tools?\b/g)) {
    if (Number(m[1]) > 20 && Number(m[1]) !== count) bad.push(`${label}: "${m[0]}" != ${count} (canon listing)`);
  }
  return bad;
}

/** The snapshot with every tool-count claim moved to `count` (what --fix writes when
 * server.mjs gains or loses a registration; the daily refresh then confirms it
 * against canon). Only the count fields and the "N tools" phrases move. */
export function healListingCount(L, count) {
  const fix = (t) => t.replace(/\b\d+((?:[ -](?:live|MCP|read-only))*[ -]tools?\b)/g, (m, tail) => `${count}${tail}`);
  return {
    ...L,
    tool_count: count,
    tool_counts: { ...(L.tool_counts || {}), mcp: count },
    short_description: fix(L.short_description),
    long_description: fix(L.long_description),
  };
}

/** Move every "N tools" claim above the small-number floor to `count` (same pattern and floor as
 * countClaimProblems, so a heal can never leave what the check still reports). */
export function healCountClaims(text, count) {
  return text.replace(/\b(\d+)((?:[ -](?:live|MCP|read-only))*[ -]tools?\b)/g,
    (m, n, tail) => (Number(n) > 20 ? `${count}${tail}` : m));
}

// ---- skill.md and its repo copies (Grok publish-from-canon, item 2, PR 3) ------------------
// canonical/skill.md is the one source (Grok's skills-proposed.md). Every other copy is
// rendered from it: only the frontmatter `name` changes, because the Agent Skills spec
// requires `name` to equal the skill's directory. The tool count follows the registered tools.
export const SKILL_SOURCE = 'canonical/skill.md';
export const SKILL_TARGETS = [
  { path: 'skill.md', name: 'dchub' },
  { path: 'skills/dc-hub-data-center-intelligence/SKILL.md', name: 'dc-hub-data-center-intelligence' },
  { path: 'kiro-power/skills/dc-hub-live-data/SKILL.md', name: 'dc-hub-live-data' },
];
const NAME_RX = /^(---\n(?:[^\n]*\n)*?name: )[^\n]+/;

export function healSkillCount(src, count) {
  return healCountClaims(src, count).replace(/("tools"\s*:\s*)\d+/, `$1${count}`);
}

export function renderSkill(src, name) {
  if (!NAME_RX.test(src)) throw new Error('renderSkill: no frontmatter name to rewrite');
  return src.replace(NAME_RX, `$1${name}`);
}

export function skillProblems(src, count) {
  const bad = [];
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return ['canonical/skill.md: no frontmatter'];
  const desc = fm[1].match(/^description: (.+)$/m)?.[1] || '';
  if (!desc) bad.push('canonical/skill.md: no description');
  if (desc.length > 1024) bad.push(`canonical/skill.md: description is ${desc.length} chars (max 1024)`);
  if (!/^name: dchub$/m.test(fm[1])) bad.push('canonical/skill.md: source name must be "dchub"');
  if (/nexus/i.test(src)) bad.push('canonical/skill.md: retired name');
  if (/—/.test(src)) bad.push('canonical/skill.md: em dash');
  if (/\b\d[\d,]*\+?\s+(?:data center |data-center )?facilit/i.test(src)) bad.push('canonical/skill.md: facility number');
  if (/\$\s?\d/.test(src)) bad.push('canonical/skill.md: price');
  for (const b of countClaimProblems('canonical/skill.md', src, count)) bad.push(b);
  const meta = src.match(/"tools"\s*:\s*(\d+)/);
  if (!meta) bad.push('canonical/skill.md: metadata has no "tools" count');
  else if (Number(meta[1]) !== count) bad.push(`canonical/skill.md: metadata tools ${meta[1]} != ${count}`);
  return bad;
}
