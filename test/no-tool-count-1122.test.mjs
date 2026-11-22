// Owner 2026-11-22 ("fix the 98 tools count too"): after the market and deal sweeps
// (mcp#1634 … #1652) the copy agents, directories and visitors read names no tool
// count either. Functional counts stay: a light-list session is told how many
// tools ITS list shows, and the numeric tool_count fields stay structured data.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _composeInstructions, _INSTRUCTIONS_LEAN } from '../server.mjs';
import { pasteLine } from '../scripts/ecosystem-sync.mjs';
import { refreshOurCounts } from '../scripts/registry-pr-submit.mjs';
import { renderDirectoriesPage } from '../lib/directories-page.mjs';
import { renderBuildersPage } from '../lib/builders-page.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TOOL_COUNT = /\b\d[\d,]*\+?\s+(?:(?:live|MCP|read-only)\s+)*tools?\b|\{tool_count\}\s+tools?/i;
// Not coverage claims: lines frozen as history (`canon:frozen`), a dated 2026-07
// investigation note, and the core profile's size (a functional fact).
const ALLOWED = ['core profile: 10 tools', 'listed 29 tools but was MISSING', 'Headline "38 tools"'];
const hits = (t) => {
  let s = t.split('\n').filter((l) => !l.includes('canon:frozen')).join('\n');
  for (const a of ALLOWED) s = s.split(a).join('');
  return s.match(new RegExp(TOOL_COUNT.source, 'gi')) || [];
};

const COPY = [
  'README.md', 'llms-install.md', 'REGISTRY-LISTINGS.md', 'integrations/README.md',
  'skill.md', 'canonical/skill.md', 'skills/dc-hub-data-center-intelligence/SKILL.md',
  'kiro-power/skills/dc-hub-live-data/SKILL.md', 'canonical/github_description.txt',
  'canonical/listing-copy.json', 'canonical/registry-description-template.json',
  '.codex-plugin/plugin.json', '.cursor-plugin/plugin.json', 'plugins/dchub/.claude-plugin/plugin.json',
  'scripts/tier3_presence.sh',
];

describe('no tool count in agent, directory and visitor copy (owner 2026-11-22)', () => {
  for (const f of COPY) {
    it(`${f} names no tool count`, () => { expect(hits(read(f))).toEqual([]); });
  }

  it('smithery.yaml\'s published description names no tool count (comments may)', () => {
    const body = read('smithery.yaml').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(hits(body)).toEqual([]);
  });

  it('the initialize instructions (lean and full figures path) name no tool count', () => {
    expect(hits(_INSTRUCTIONS_LEAN)).toEqual([]);
    expect(_INSTRUCTIONS_LEAN).not.toMatch(/DC Hub: \d+ tools/);
    const facts = { generated_at: new Date().toISOString(), numbers: {
      countries: '170+', markets: '300+', deals: '2,000+', substations: '134,000+',
      infrastructure_assets_total: '330,000+', transmission_lines: '94,000+', fiber_routes: '58k',
      gas_pipelines: '32k', power_plants_us: '14k', submarine_cables: '720+', cable_landings: '1,900+',
      generating_units_global: '182k', live_feeds: 7, grid_regions: 49 } };
    const full = _composeInstructions(facts, Date.now());
    expect(full).toContain('COVERAGE: a global data-center facility map (170+ countries)');
    expect(hits(full)).toEqual([]);
    expect(hits(_composeInstructions(null, Date.now()))).toEqual([]);
  });

  it('server.mjs literals: the router description and the llms.txt fallback', () => {
    const src = read('server.mjs');
    expect(src).toContain('ADVISORY router: collapses the tool catalog to one starting point');
    expect(src).toContain("'MCP endpoint: https://dchub.cloud/mcp; start with");
  });

  it('the paste line, the directories page and the builders page name no tool count', () => {
    expect(hits(pasteLine({ tools: 98 }))).toEqual([]);
    const dir = renderDirectoriesPage({ directories: [] }, { tools: 98, now: new Date() });
    expect(dir).toContain('Same tools everywhere.');
    expect(dir).not.toMatch(/Same \d+ tools/);
    const b = renderBuildersPage({ tools: 98 });
    expect(b).not.toMatch(/\d+ tools over one endpoint/);
  });

  it('registry-pr-submit writes no tool count and the refresh pass strips ours', () => {
    const src = read('scripts/registry-pr-submit.mjs');
    expect(src).not.toMatch(/\$\{N_TOOLS\}/);
    for (const l of src.split('\n').filter((x) => /^\s*(entry:|const DESC =)/.test(x))) expect(hits(l)).toEqual([]);
    const out = refreshOurCounts('- [azmartone67/dchub-mcp-server](x) - DC Hub: 33 tools / 232 markets; 98 MCP tools.');
    expect(hits(out)).toEqual([]);
    expect(out).toContain('MCP tools');
    expect(refreshOurCounts(out)).toBeNull();
  });
});
