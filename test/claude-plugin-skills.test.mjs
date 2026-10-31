// The Claude Code plugin (2026-10-31): .claude-plugin/marketplace.json makes the
// repo installable with `/plugin marketplace add azmartone67/dchub-mcp-server`,
// and skills/ ships with it. Skills are text an AGENT reads back to a user, so
// the agent-facing copy rule applies to them: no prices and no plan names (the
// result's human_url carries the offer). Before this test no guard scanned
// skills/ for either: copy-plan-name-and-price-ratchet reads server.mjs + lib/
// only, and the listing-copy rules exempt skills by design.
//
// Read-only: it scans committed files and runs its must-fail controls on strings.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

export const PRICE_RX = /\$\s?\d/;
export const PLAN_RX = /\b(Developer|Pro|Enterprise|Founding)\b/;

export function copyProblems(label, text) {
  const bad = [];
  text.split('\n').forEach((line, i) => {
    if (PRICE_RX.test(line)) bad.push(`${label}:${i + 1} price: ${line.trim()}`);
    if (PLAN_RX.test(line)) bad.push(`${label}:${i + 1} plan name: ${line.trim()}`);
  });
  return bad;
}

function skillFiles() {
  const out = [];
  for (const base of ['skills', 'kiro-power/skills']) {
    for (const d of fs.readdirSync(path.join(ROOT, base), { withFileTypes: true })) {
      if (d.isDirectory() && fs.existsSync(path.join(ROOT, base, d.name, 'SKILL.md'))) out.push(`${base}/${d.name}/SKILL.md`);
    }
  }
  return out;
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  return Object.fromEntries(m[1].split('\n').map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2]]));
}

describe('marketplace.json installs the plugin', () => {
  const mk = JSON.parse(read('.claude-plugin/marketplace.json'));
  const pl = JSON.parse(read('.claude-plugin/plugin.json'));
  it('names one plugin, sourced from the repo root, matching plugin.json', () => {
    expect(typeof mk.name).toBe('string');
    expect(mk.owner && mk.owner.name).toBeTruthy();
    expect(mk.plugins).toHaveLength(1);
    expect(mk.plugins[0].name).toBe(pl.name);
    expect(mk.plugins[0].source).toBe('./');
  });
  it('the root .mcp.json the plugin bundles points at the canonical remote', () => {
    const mcp = JSON.parse(read('.mcp.json'));
    expect(mcp.mcpServers.dchub.url).toBe('https://dchub.cloud/mcp');
  });
  it('plugin.json version equals server.json (the heal in sync-tools-manifest keeps it there)', () => {
    expect(pl.version).toBe(JSON.parse(read('server.json')).version);
  });
});

describe('every skill is well-formed', () => {
  const files = skillFiles();
  it('finds the workflow skills', () => {
    for (const s of ['dchub-site-screen', 'dchub-time-to-power-memo', 'dchub-market-compare', 'dchub-capacity-sourcing']) {
      expect(files).toContain(`skills/${s}/SKILL.md`);
    }
  });
  it.each(files.filter((f) => f.startsWith('skills/dchub-')))('%s: frontmatter name equals its folder', (f) => {
    const fm = frontmatter(read(f));
    expect(fm).not.toBeNull();
    expect(fm.name).toBe(f.split('/')[1]);
    expect((fm.description || '').length).toBeGreaterThan(60);
  });
});

describe('agent-facing plugin copy names no price or plan', () => {
  const files = [...skillFiles(), 'skills/README.md', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];
  it.each(files)('%s', (f) => {
    expect(copyProblems(f, read(f))).toEqual([]);
  });
  it('must-fail controls: the checks catch a price and a plan name', () => {
    expect(copyProblems('x', 'Unlock it for $99/mo')).toHaveLength(1);
    expect(copyProblems('x', 'needs a Pro key')).toHaveLength(1);
    expect(copyProblems('x', 'the Enterprise tier')).toHaveLength(1);
    expect(copyProblems('x', 'give the human_url exactly as written')).toEqual([]);
  });
});
