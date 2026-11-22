// Owner 2026-11-22 ("Remove both counts from those docs and server resources
// too" -> "Yes, do it here"): after the listing/manifest sweeps (mcp#1634,
// #1638, #1642, #1644, #1647) the docs, skill files, the server's about and
// instructions text and the registry/paste-line generators name no market
// count and no deal count either. Countries, tools and assets are unchanged.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _composeInstructions } from '../server.mjs';
import { pasteLine } from '../scripts/ecosystem-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MARKET_COUNT = /\b\d[\d,]*\+?\s+(?:(?:DC\s+Hub|DCPI|DCPI-scored|metro|scored|US|US\s+power)\s+)?markets?\b/gi;
const DEAL_COUNT = /\b\d[\d,]*\+?\s+(?:tracked\s+)?(?:M&A\s+)?(?:deals?|transactions?)\b/gi;
// Not coverage claims: a licence threshold and a tool's argument range.
const ALLOWED = ['more than 25 markets', '2–4 markets'];

function counts(text) {
  let t = text;
  for (const a of ALLOWED) t = t.split(a).join('');
  return [...t.matchAll(MARKET_COUNT), ...t.matchAll(DEAL_COUNT)].map((m) => m[0]);
}

const DOCS = [
  'README.md', 'llms-install.md', 'REGISTRY-LISTINGS.md', 'skills/README.md',
  'skill.md', 'canonical/skill.md', 'skills/dc-hub-data-center-intelligence/SKILL.md',
  'kiro-power/skills/dc-hub-live-data/SKILL.md',
];

describe('no market or deal count in docs, skills and server text (owner 2026-11-22)', () => {
  for (const f of DOCS) {
    it(`${f} names no market or deal count`, () => {
      expect(counts(read(f))).toEqual([]);
    });
  }

  it('the composed initialize instructions (figures path) name neither count', () => {
    const facts = { generated_at: new Date().toISOString(), numbers: {
      countries: '170+', markets: '300+', deals: '2,000+', substations: '134,000+',
      infrastructure_assets_total: '330,000+', transmission_lines: '94,000+', fiber_routes: '58k',
      gas_pipelines: '32k', power_plants_us: '14k', submarine_cables: '720+', cable_landings: '1,900+',
      generating_units_global: '182k', live_feeds: 7, grid_regions: 49 } };
    const out = _composeInstructions(facts, Date.now());
    expect(out).toContain('170+ countries');            // the figures path ran
    expect(out).not.toContain('300+');
    expect(out).not.toContain('2,000+');
    expect(out).toContain('markets scored daily (Data Center Power Index / DCPI)');
    expect(out).toContain('tracked M&A deals.');
  });

  it('the dchub://about resource text names neither count', () => {
    const src = read('server.mjs');
    const i = src.indexOf("'# DC Hub — Data Center & Energy Intelligence");
    expect(i).toBeGreaterThan(0);
    const about = src.slice(i, src.indexOf('\n', i));
    expect(counts(about)).toEqual([]);
    expect(about).toContain('Markets scored daily by the DCPI');
    expect(about).toContain('Tracked M&A deals + hyperscaler');
  });

  it('the ecosystem-sync paste line names neither count, even when the SSOT has them', () => {
    const line = pasteLine({ tools: 98, markets: '300+', deals: '2,000+' });
    expect(counts(line)).toEqual([]);
    expect(line).toContain('98 MCP tools');
    expect(line).toContain('tracked M&A deals');
  });

  it('new registry entries written by registry-pr-submit name neither count', () => {
    const src = read('scripts/registry-pr-submit.mjs');
    const lines = src.split('\n').filter((l) => /^\s*(entry:|const DESC =)/.test(l));
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) {
      expect(l, l.slice(0, 80)).not.toMatch(/\$\{MARKETS\}|\$\{DEALS\}/);
      expect(counts(l), l.slice(0, 80)).toEqual([]);
    }
  });
});
