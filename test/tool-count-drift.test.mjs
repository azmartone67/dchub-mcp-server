// Every first-party "<N> tools" claim must equal the full catalog count.
//
// WHY THIS EXISTS. 2026-11-13: live /mcp (v2.12.48) served 95 tools while the
// npm launcher, the Node and Python SDKs, the Postman collection, the Strands
// example and the Poe bots still said 94. scripts/sync-tools-manifest.mjs heals
// "N tools" prose only in the files it LISTS, so a file nobody added to a list
// rots silently and every check stays green. This guard inverts that: it scans
// EVERY git-tracked text file and needs a reason (below) to skip one. A new
// file is covered the day it lands.
//
// The count is the length of mcp-server.json's tools[] -- the same source
// test/grok-instructions-tool-count.test.mjs uses. sync-tools-manifest.mjs
// (manifest-consistency `check`) already fails when that array differs from
// the tools server.mjs registers, so it is the catalog, not a hand-typed 95.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COUNT = JSON.parse(readFileSync(path.join(ROOT, 'mcp-server.json'), 'utf8')).tools.length;

// ---- what is NOT a claim about today's catalog ------------------------------
// Whole files that RECORD the past. Rewriting them would turn a record into a
// lie; they are not copy anyone reads as current.
const EXCLUDED_FILES = [
  [/^test\//, 'tests and fixtures quote stale counts on purpose (must-fail inputs)'],
  [/(^|\/)CHANGELOG[^/]*$|(^|\/)RELEASE[-_]NOTES[^/]*$/i, 'changelogs narrate past releases'],
  [/^submissions\//, 'what was submitted to a directory on a given date'],
  [/^docs\/outreach-emails\.md$/, 'record of emails actually sent'],
  [/^canonical\/directories\.json$/, 'notes record what third-party listings showed on a date'],
  [/^DATA_QUALITY\.md$/, 'dated reconciliation log ("38 tools" at the time)'],
];

// Developer narration is not shipped copy. In repo-internal code (server.mjs,
// lib/, scripts/, workflows, Dockerfile) comments and Python docstrings record
// what was measured on a date ("tools/list serves 82 tools", server.mjs
// version-history notes), so they are skipped; string literals are NOT, since
// those are what the server and scripts emit. Code that SHIPS to users (the
// SDKs, integrations, launcher, bundles) is different: its comments and
// docstrings are the usage docs ("any of the 94 tools"), so every line counts.
const CODE_FILE = /\.(mjs|cjs|js|ts|py|sh|ya?ml|toml|gs)$|(^|\/)Dockerfile$/;
const SHIPPED_CODE = /^(sdk|integrations|npm-launcher|dxt|plugins|kiro-power)\//;
const COMMENT_LINE = /^\s*(\/\/|#|\/\*|\*)/;
const TRAILING_COMMENT = /\s(\/\/|#)\s.*$/;
// The repo-wide per-line opt-out the sync script already honours: a line
// carrying `canon:frozen` is a deliberate historical statement.
const FROZEN = /canon:frozen/;

// Counts of a NARROWER surface than /mcp, which legitimately differ from the
// catalog. Judged by context, never by size: the nearest subject before the
// number (same line, 120 chars) decides; only when there is none does the rest
// of the clause after it ("the 4-tool shared spine", "The 10-tool core
// server"). "/mcp serves 94 tools; /mcp/core serves 10": the 94's nearest
// subject is bare /mcp, so it is a catalog claim.
const PACK_WORDS = '\\/mcp\\/[a-z][\\w-]*|\\b(?:core|lean|light|pack|profile|starter|subset|spine|sweep|allowed_tools)\\b';
const PACK_SUBJECT = new RegExp(PACK_WORDS, 'gi');
const CATALOG_SUBJECT = /\/mcp(?![\w/-])/g;
const isPackCount = (line, idx, len) => {
  const before = line.slice(Math.max(0, idx - 120), idx);
  let last = null;
  for (const m of before.matchAll(PACK_SUBJECT)) last = { at: m.index, pack: true };
  for (const m of before.matchAll(CATALOG_SUBJECT)) if (!last || m.index > last.at) last = { at: m.index, pack: false };
  if (last) return last.pack;
  const after = line.slice(idx + len, idx + len + 30).split(/[;.,()|]/)[0];
  return new RegExp(PACK_WORDS, 'i').test(after);
};

// Named non-catalog counts the context rule cannot see. Each entry must still
// match a claim, so this list cannot outlive the text it excuses.
const KNOWN_NON_CATALOG = [
  ['integrations/arcade/README.md', '**Read-only (67 tools):**', 'Arcade read-only gateway profile = the /mcp/claude directory set (next line)'],
  ['scripts/claude_directory_listing.txt', 'gives Claude 67 read-only tools', 'Claude directory connector profile, pinned by its own tests'],
  ['integrations/copilot/planner-system-prompt.txt', '6 countries x 8 tools = 48', 'arithmetic in a planner prompt'],
  ['docs/power-grid-server.md', 'it advertises 15 tools', 'the /mcp/power pack this doc is about'],
  ['docs/power-grid-server.md', '15 tools = 11 listed', 'the /mcp/power pack this doc is about'],
  ['docs/power-grid-server.md', 'returns 15 tools', 'the /mcp/power pack this doc is about'],
  ['scripts/canon-floor.mjs', "findFacilityFloors('92 tools over", 'self-test input string'],
  ['sdk/python/dchub/manifest.py', '(53 tools, 45 with', 'dated snapshot of the REST tools-manifest it embeds, not /mcp'],
];

// ---- the claim forms ---------------------------------------------------------
// "95 tools", "95 MCP tools", "95 read-only tools", "a 95-tool server",
// "any of the 95 tools", "/mcp serves 95", "Tools exposed: 95", shields badge.
const CLAIM_RX = [
  /\b(\d+)(?:[ -](?:live|MCP|read-only|DC Hub|registered|callable|public))*[ -]tools?\b/g,
  /\/mcp(?![\w/-])\s+(?:serves|returns|lists|exposes)\s+(\d+)\b/g,
  /Tools exposed:\*{0,2}\s*(\d+)/g,
  /badge\/tools-(\d+)/g,
];

const BINARY_EXT = /\.(png|jpe?g|gif|ico|webp|pdf|zip|dxt|gz|woff2?|ttf|plist|xml)$/i;

function trackedTextFiles() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return out.split('\0').filter(Boolean).filter((f) => !BINARY_EXT.test(f));
}

export function findClaims(file, text) {
  const claims = [];
  const internal = CODE_FILE.test(file) && !SHIPPED_CODE.test(file);
  let inDocstring = false;
  text.split('\n').forEach((raw, i) => {
    if (FROZEN.test(raw)) return;
    let line = raw;
    if (internal) {
      if (file.endsWith('.py')) {
        const quotes = (raw.match(/"""|'''/g) || []).length;
        const wasIn = inDocstring;
        if (quotes % 2 === 1) inDocstring = !inDocstring;
        if (wasIn || quotes) return;               // a docstring line, or one that opens/closes one
      }
      if (COMMENT_LINE.test(line)) return;
      line = line.replace(TRAILING_COMMENT, '');
    }
    for (const rx of CLAIM_RX) {
      for (const m of line.matchAll(rx)) {
        claims.push({ file, line: i + 1, n: Number(m[1]), shown: m[0],
          pack: isPackCount(line, m.index, m[0].length), text: raw });
      }
    }
  });
  return claims;
}

function scan() {
  const files = trackedTextFiles();
  const scanned = [];
  const claims = [];
  for (const f of files) {
    if (EXCLUDED_FILES.some(([rx]) => rx.test(f))) continue;
    let buf;
    try { buf = readFileSync(path.join(ROOT, f)); } catch { continue; }   // tracked but deleted in the tree
    if (buf.includes(0)) continue;                                        // binary
    scanned.push(f);
    claims.push(...findClaims(f, buf.toString('utf8')));
  }
  return { files, scanned, claims };
}

const excused = (c) => KNOWN_NON_CATALOG.some(([f, phrase]) => c.file === f && c.text.includes(phrase) && phrase.includes(c.shown));

describe(`first-party tool-count claims equal the catalog (${COUNT})`, () => {
  const { files, scanned, claims } = scan();

  it('the scan is not vacuous: it walks the tree and sees current claims', () => {
    expect(COUNT).toBeGreaterThan(20);
    expect(files.length).toBeGreaterThan(500);
    expect(scanned.length).toBeGreaterThan(300);
    // These carry the count today and are healed daily; if the guard stops
    // seeing them it has stopped working, not found a clean tree.
    for (const f of ['README.md', 'smithery.yaml', 'llms-install.md']) {
      expect(scanned, f).toContain(f);
      expect(claims.some((c) => c.file === f && c.n === COUNT), `${f} has a ${COUNT} claim`).toBe(true);
    }
  });

  it('every stated tool count equals the full catalog, or is a named narrower surface', () => {
    const bad = claims
      .filter((c) => c.n !== COUNT && !c.pack && !excused(c))
      .map((c) => `${c.file}:${c.line}: "${c.shown}" != ${COUNT}  |  ${c.text.trim().slice(0, 160)}`);
    expect(bad, `stale tool counts (fix the copy, prefer count-free wording; and add the file to
the heal lists in scripts/sync-tools-manifest.mjs if it must keep a number):\n${bad.join('\n')}`).toEqual([]);
  });

  it('every KNOWN_NON_CATALOG entry still matches its file (no stale excuses)', () => {
    const dead = KNOWN_NON_CATALOG.filter(([f, phrase]) => !claims.some((c) => c.file === f && c.text.includes(phrase)));
    expect(dead.map(([f, p]) => `${f}: ${p}`)).toEqual([]);
  });

  it('context, not size, decides a pack count (controls)', () => {
    const judge = (t) => findClaims('x.md', t).map((c) => [c.n, c.pack]);
    expect(judge('/mcp serves 94 tools; /mcp/core serves 10.')).toEqual([[94, false], [94, false]]);
    expect(judge('/mcp/core (default, 10 tools) or /mcp (94 tools)')).toEqual([[10, true], [94, false]]);
    expect(judge('core profile: 10 tools for multi-server hosts')).toEqual([[10, true]]);
    expect(judge('any of the 3 tools')).toEqual([[3, false]]);           // small is not excused
    expect(judge('a 94-tool server')).toEqual([[94, false]]);
    expect(judge('the 4-tool shared spine')).toEqual([[4, true]]);
    expect(judge('Tools exposed: 94')).toEqual([[94, false]]);
    expect(judge('x 94 tools <!-- canon:frozen: record -->')).toEqual([]);
    expect(findClaims('a.mjs', '// measured: 82 tools')).toEqual([]);
    // shipped code: its comments and docstrings are the user docs, so they count
    expect(findClaims('sdk/a.py', '    dc.call("x")   # any of the 94 tools').map((c) => c.n)).toEqual([94]);
    expect(findClaims('sdk/a.mjs', ' *   await dc.call("x");  // any of the 94 tools').map((c) => c.n)).toEqual([94]);
    // internal code: comments and docstrings are narration; string literals are not
    expect(findClaims('scripts/a.py', 'x = 1  # live=47 tools')).toEqual([]);
    expect(findClaims('scripts/a.py', '"""Doc\nmeasured 82 tools\n"""\nMSG = "94 tools"').map((c) => [c.n, c.line])).toEqual([[94, 4]]);
    expect(findClaims('server.mjs', "text: 'DC Hub: 94 tools.'").map((c) => c.n)).toEqual([94]);
  });
});
