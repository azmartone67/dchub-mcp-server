// Owner 2026-11-22 ("Remove counts from docs/ and the integration READMEs too?" ->
// "Yes, do it here"): docs/ and integrations/*/README.md state no catalog tool total,
// market count or deal count. Kept: a few served-list sizes and examples, and lines
// frozen as history. Owner 2026-11-22 ("fix the power-grid and arcade served counts
// too", "fix the copilot served count too"): the /mcp/power and /mcp/grid sizes, the
// Arcade profile sizes and the Copilot guide's subset size are gone too, and so is the
// Copilot example's "last 5 deals" ("fix the last 5 deals count too").
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COUNT = /\b\d[\d,]*\+?\s+(?:(?:live|MCP|read-only)\s+)*tools?\b|\b\d[\d,]*\+?\s+(?:(?:DC\s+Hub|DCPI|DCPI-scored|metro|scored|US|US\s+power)\s+)?markets?\b|\b\d[\d,]*\+?\s+(?:tracked\s+)?(?:M&A\s+)?(?:deals?|transactions?)\b/gi;
// Served-list sizes and examples once allowed here are all gone (owner 2026-11-22, last:
// "fix the Available Actions 12 Tools count too"); add an entry only with the owner's word.
const ALLOWED = [];

function files() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.md$/.test(e.name)) out.push(rel);
    }
  };
  walk('docs');
  for (const e of fs.readdirSync(path.join(ROOT, 'integrations'), { withFileTypes: true })) {
    const f = path.join('integrations', e.name, 'README.md');
    if (e.isDirectory() && fs.existsSync(path.join(ROOT, f))) out.push(f);
  }
  return out;
}

export function countsIn(text) {
  return text.split('\n')
    .filter((l) => !l.includes('canon:frozen'))
    .map((l) => ALLOWED.reduce((s, re) => s.replace(re, ''), l))
    .flatMap((l) => l.match(COUNT) || []);
}

describe('no tool, market or deal count in docs/ and integration READMEs (owner 2026-11-22)', () => {
  const list = files();
  it('walks the tree (not vacuous)', () => {
    expect(list.length).toBeGreaterThan(20);
    expect(list).toContain('docs/one-click-install.md');
    expect(list).toContain(path.join('integrations', 'gemini', 'README.md'));
  });
  for (const f of list) {
    it(`${f} names no catalog count`, () => {
      expect(countsIn(fs.readFileSync(path.join(ROOT, f), 'utf8'))).toEqual([]);
    });
  }
  it('the detector catches the forms that were removed', () => {
    expect(countsIn('`https://dchub.cloud/mcp` (98 tools, keyless')).toEqual(['98 tools']);
    expect(countsIn('fiber, gas, 2,000+ M&A deals, plus')).toEqual(['2,000+ M&A deals']);
    expect(countsIn('300+ markets scored daily')).toEqual(['300+ markets']);
    // The served-size exceptions are gone (owner 2026-11-22), so these read as counts now.
    expect(countsIn('Lean (recommended default, 12 tools)')).toEqual(['12 tools']);
    expect(countsIn('## Available Actions (12 Tools)')).toEqual(['12 Tools']);
    expect(countsIn('This guide uses a subset of 10 tools (')).toEqual(['10 tools']);
    expect(countsIn('and list the last 5 deals with price per MW.')).toEqual(['5 deals']);
    expect(countsIn('it advertises 15 tools; `/mcp/grid` (17 tools)')).toEqual(['15 tools', '17 tools']);
  });
});

describe('power-grid, Arcade and Copilot name no served size (owner 2026-11-22)', () => {
  const SIZE = /\b\d+[ -](?:(?:power and grid|composite read-only|read-only|DC Hub)\s+)?tools?\b|\b\d+-tool\b|\b(?:ten|eleven|twelve|fifteen|seventeen)\s+(?:[\w-]+\s+){0,2}tools\b|\(\d+ tools\)|\bsubset of \d+ tools\b/i;
  it('CONTROL: the detector reads the old wordings', () => {
    for (const s of ['it advertises 15 tools;', '15 tools = 11 listed + the 4-tool shared spine', '`/mcp/grid` (17 tools)',
      '**Lean (recommended default, 12 tools):**', '**Read-only (67 tools):**', 'It exposes ten composite read-only tools',
      'Focused listing: 11 power and grid tools plus the 4-tool shared spine', 'This guide uses a subset of 10 tools (']) expect(s, s).toMatch(SIZE);
  });
  for (const f of ['docs/power-grid-server.md', 'integrations/arcade/README.md', 'registry/power-grid.server.json', 'integrations/copilot/README.md']) {
    it(`${f} states no tool count`, () => {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(text.length).toBeGreaterThan(500);
      expect(text.match(SIZE)?.[0] ?? null, f).toBeNull();
    });
  }
});
