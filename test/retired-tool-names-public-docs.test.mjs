// ★2026-09-29 (round-3 AI-training findings): DeepSeek quoted `get_pocket_listings`
// and `request_listing_intro` as DC Hub tools. Both were renamed on 2026-09-13
// (Capacity Source): source_capacity, accept_capacity_terms and
// request_capacity_intro are the tools. The old names keep RESOLVING at call time
// through TOOL_ALIASES (pinned by test/capacity-source-tools.test.mjs), but nothing
// this repo publishes may ADVERTISE them again — every README, install guide,
// manifest and registry copy is text a crawler or a registry mirror can train on.
//
// Scope: every git-tracked file except the test suite itself. server.mjs is
// scanned too, with its comments and the TOOL_ALIASES literal removed: the alias
// map is the one place the old names must stay, and a served string (a tool
// description, the initialize instructions, a paywall line) is not a comment.
//
// Also pinned here: llms-install.md (the file Cline installs from) carries no
// plan-price table and no monthly price — plans live at https://dchub.cloud/pricing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RETIRED = /\b(get_pocket_listings?|request_listing_intro)\b/g;
const TEXT = /\.(md|txt|json|ya?ml|mjs|js|py|html|toml)$/i;

// Checkout-independent: the file list comes from git, not from a directory walk
// that would also read node_modules or a stray local file.
function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f && TEXT.test(f) && !f.startsWith('test/'));
}

// server.mjs minus comments and minus the TOOL_ALIASES object literal.
export function servedSource(src) {
  const start = src.indexOf('const TOOL_ALIASES = {');
  if (start === -1) throw new Error('TOOL_ALIASES literal not found — the strip below would be vacuous');
  const end = src.indexOf('\n};', start);
  const body = src.slice(0, start) + src.slice(end + 3);
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // a line comment starts at `//` preceded by start-of-line or whitespace, so
    // a URL (`https://…`) inside a string is not mistaken for one
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function offenders(files) {
  const bad = [];
  for (const f of files) {
    let txt = readFileSync(join(ROOT, f), 'utf8');
    if (f === 'server.mjs') txt = servedSource(txt);
    txt.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(RETIRED)) bad.push(`${f}:${i + 1}  ${m[1]}`);
    });
  }
  return bad;
}

describe('retired Capacity Source tool names are never advertised', () => {
  const files = trackedFiles();

  it('scans the public surfaces (floor: the scan is not vacuous)', () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
    for (const must of ['README.md', 'llms-install.md', 'llms.txt', 'server.json', 'smithery.yaml',
      'mcp-server.json', 'REGISTRY-LISTINGS.md', 'npm-launcher/README.md', 'server.mjs']) {
      expect(files, must).toContain(must);
    }
  });

  it('the TOOL_ALIASES strip removes only the alias map (control)', () => {
    const src = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
    expect(src.match(RETIRED)?.length ?? 0).toBeGreaterThan(0);   // they are in the alias map
    const served = servedSource(src);
    expect(served).toContain("trackedTool(srv, 'source_capacity'");
    expect(served.length).toBeGreaterThan(src.length * 0.5);
  });

  it('no tracked file outside the alias map names get_pocket_listings or request_listing_intro', () => {
    const bad = offenders(files);
    expect(bad, `retired tool names advertised:\n${bad.join('\n')}\n`
      + 'Use source_capacity / accept_capacity_terms / request_capacity_intro. '
      + 'The old names resolve through TOOL_ALIASES only.').toEqual([]);
  });

  it('the guard fires on a planted retired name (mutation control)', () => {
    const planted = 'Call get_pocket_listings, then request_listing_intro.';
    expect([...planted.matchAll(RETIRED)].map((m) => m[1]))
      .toEqual(['get_pocket_listings', 'request_listing_intro']);
    expect(servedSource("const TOOL_ALIASES = {\n  a: 'b',\n};\nconst X = 'get_pocket_listings'; // ok\n"))
      .toMatch(RETIRED);
  });
});

describe('llms-install.md carries no plan-price table', () => {
  const doc = readFileSync(join(ROOT, 'llms-install.md'), 'utf8');

  it('has no tier table and no monthly price', () => {
    expect(doc).not.toMatch(/^\|\s*Tier\s*\|/m);
    expect(doc).not.toMatch(/\$\s?\d[\d,.]*\s*\/\s*mo(nth)?\b/i);
    expect(doc).not.toMatch(/\bstarter\b/i);
  });

  it('links the pricing page and quotes the canon free-tier rule', async () => {
    // The composed rule is pinned verbatim to canon's free_tier by
    // test/free-tier-claims.test.mjs; this file must quote it whole.
    const { _freeTierRuleText } = await import('../lib/tier-canon.mjs');
    const rule = _freeTierRuleText();
    expect(rule).toMatch(/^Anonymous: /);
    expect(doc).toContain(rule);
    expect(doc).toContain('https://dchub.cloud/pricing');
  });
});
