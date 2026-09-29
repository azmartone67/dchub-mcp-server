// No link to dxt.so anywhere in this repo.
//
// r-dead-directories (2026-09-29): dxt.so was an MCP directory. The domain lapsed
// and was re-registered, and it now serves a gambling-affiliate page. A link to
// it from our README, manifests or docs sends people, crawlers and agents to
// that site. Naming it in prose is fine; a LINK (scheme, protocol-relative //,
// www. host, or the domain followed by a path) is not. Same guard as
// dchub-backend tests/test_no_dxt_so_links.py and dchub-frontend
// tests/qa-no-dxt-so-links.test.mjs.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const d = 'dxt' + '.so'; // built from parts: this file must not trip itself
const D = d.replace('.', '\\.');
const LINK = new RegExp(
  `(?:https?:)?\\/\\/(?:[a-z0-9-]+\\.)*${D}\\b` +
  `|\\bwww\\.${D}\\b` +
  `|(?<![\\w.-])${D}\\/[\\w-]`, 'i');
const TEXT = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.ts', '.json',
  '.md', '.txt', '.xml', '.css', '.yml', '.yaml', '.py', '.sh', '.toml', '']);

describe('no dxt.so links', () => {
  it.each([`https://${d}/server/dchub`, `http://${d}`, `//${d}/x`, `www.${d}`,
    `see ${d}/submit`, `HTTPS://WWW.${d.toUpperCase()}/`,
    `<a href="https://${d}">`])('the pattern catches %s', (t) => {
    expect(LINK.test(t)).toBe(true);
  });

  it.each(['dxt_so', `the ${d} directory`, `${d}'s differentiator`,
    'files.dxt.sort', 'mydxt.solutions/x', 'a .dxt bundle'])(
    'the pattern leaves prose alone: %s', (t) => {
      expect(LINK.test(t)).toBe(false);
    });

  it('no tracked text file links to it', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter((f) => TEXT.has(extname(f).toLowerCase()));
    expect(files.length).toBeGreaterThan(100);
    const hits = [];
    for (const f of files) {
      let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      if (!text.toLowerCase().includes(d)) continue;
      text.split('\n').forEach((line, i) => {
        if (LINK.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
