// Owner 2026-11-22 ("Remove counts from docs/ and the integration READMEs too?" ->
// "Yes, do it here"): docs/ and integrations/*/README.md state no catalog tool total,
// market count or deal count. Kept: the size of a specific served list (a pack
// server, a subset an integration hands its model) and lines frozen as history.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COUNT = /\b\d[\d,]*\+?\s+(?:(?:live|MCP|read-only)\s+)*tools?\b|\b\d[\d,]*\+?\s+(?:(?:DC\s+Hub|DCPI|DCPI-scored|metro|scored|US|US\s+power)\s+)?markets?\b|\b\d[\d,]*\+?\s+(?:tracked\s+)?(?:M&A\s+)?(?:deals?|transactions?)\b/gi;
// Served-list sizes and examples, not coverage claims.
const ALLOWED = [
  /it advertises 15 tools/, /15 tools = 11 listed/, /`\/mcp\/grid` \(17 tools\)/, /returns 15 tools/,
  /Lean \(recommended default, 12 tools\)/, /Read-only \(67 tools\)/, /a subset of 10 tools/, /the last 5 deals/, /Available Actions \(12 Tools\)/,
];

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
    expect(countsIn('Lean (recommended default, 12 tools)')).toEqual([]);
  });
});
