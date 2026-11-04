// Grok #117627 (2026-11-04, no-connector assistant audit): the README said
// "HIFLD substation database" and the MCP data-sources resource said "HIFLD
// substation + transmission database", while llms.txt said the grid layers are
// OpenStreetMap-derived under ODbL 1.0 (owner decision 2026-10-20). An assistant
// reading two DC Hub surfaces got two licences for one layer. The README contact
// was a personal Gmail address; the site's contact is jonathan@dchub.cloud.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _DATA_SOURCES_MD } from '../server.mjs';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const sourcesLine = () => {
  const i = README.indexOf('## Data sources');
  return README.slice(i, README.indexOf('\n## ', i + 1));
};

describe('one licence for the grid layers on every surface (#117627)', () => {
  it('the MCP data-sources resource names the OSM layers as ODbL', () => {
    expect(_DATA_SOURCES_MD).toMatch(/OpenStreetMap substations, transmission lines and gas pipelines \(ODbL 1\.0/);
    expect(_DATA_SOURCES_MD).not.toMatch(/HIFLD substation \+ transmission database/);
  });

  it('the README data-sources section says the same', () => {
    const s = sourcesLine();
    expect(s.length).toBeGreaterThan(40);                // control: section found
    expect(s).toMatch(/OpenStreetMap substations, transmission lines and gas pipelines \(ODbL 1\.0/);
    expect(s).not.toMatch(/HIFLD substation database/);
  });

  it('the README has no unsourced competitor table and no personal contact', () => {
    expect(README).not.toMatch(/\| *datacenters\.com *\|/);
    expect(README).not.toMatch(/@gmail\.com/);
    expect(README).toMatch(/jonathan@dchub\.cloud/);
  });
});
