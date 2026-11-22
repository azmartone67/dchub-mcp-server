// Owner 2026-11-22 ("fix the registry refresh pass counts too"): the refresh pass in
// scripts/registry-pr-submit.mjs edits our own line on lists that already carry DC
// Hub. It used to rewrite market and deal numbers to the canon value, which wrote
// counts back into third-party lists. It now removes them; only the tool count is
// refreshed. Our current punkpeye entry has no counts, so it must stay untouched.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshOurCounts } from '../scripts/registry-pr-submit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OURS = '- [azmartone67/dchub-mcp-server](https://github.com/azmartone67/dchub-mcp-server) - DC Hub: ';
const COUNT = /\b\d[\d,]*\+?\s+(?:(?:DCPI(?:-scored)?|US|power|tracked|M&A)\s+)*(?:markets?|deals?|transactions?)\b/i;

describe('registry refresh pass removes market and deal counts (owner 2026-11-22)', () => {
  it('strips every tool, market and deal count from our line', () => {
    const line = `${OURS}33 tools / 232 markets / 2,000 deals; DCPI (300+ US power markets), 1,600+ tracked M&A deals, 1,500+ M&A transactions, 300+ DCPI markets.`;
    const out = refreshOurCounts(line);
    expect(out).not.toBeNull();
    expect(out).not.toMatch(COUNT);
    // ★2026-11-22 (owner, "fix the 98 tools count too"): tools lose their count too.
    expect(out).not.toMatch(/\b\d+\s+(?:MCP\s+)?tools\b/);
    expect(out).toContain('MCP tools');
    expect(out).toContain('DCPI-scored US power markets');
    expect(out).toContain('tracked M&A deals');
    expect(out).toContain('tracked M&A transactions');
    expect(out).not.toMatch(/DCPI-scored DCPI/);
  });

  it('is idempotent: a second pass changes nothing', () => {
    const once = refreshOurCounts(`${OURS}232 markets, 2,000+ tracked M&A deals.`);
    expect(once).not.toBeNull();
    expect(refreshOurCounts(once)).toBeNull();
  });

  it('never touches another server\'s line', () => {
    const other = '- [other/thing](https://github.com/other/thing) - 50 tools, 120 markets, 900 deals.';
    expect(refreshOurCounts(other)).toBeNull();
    const both = refreshOurCounts(`${OURS}232 markets.\n${other}`);
    expect(both.split('\n')[1]).toBe(other);
  });

  it('leaves the current count-free entry alone (no refresh PR)', () => {
    const live = `${OURS}Data center, power and gas intelligence from DC Hub: facilities, US power market scores, M&A deals, ISO grid telemetry, fiber routes and energy prices.`;
    expect(refreshOurCounts(live)).toBeNull();
  });

  it('the refresh PR title and body state no market or deal count', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/registry-pr-submit.mjs'), 'utf8');
    expect(src).not.toMatch(/\$\{MARKETS\}|\$\{DEALS\}/);
    expect(src).not.toMatch(/\$\{N_TOOLS\}/);
    expect(src).toContain("title: 'Refresh DC Hub MCP entry (drop stale tool, market and deal counts)'");
  });
});
