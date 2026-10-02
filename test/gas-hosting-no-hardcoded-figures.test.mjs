// get_hosting_capacity carried "278,799 published records across 18 utilities"
// typed by hand; live /api/v1/grid/hosting-capacity/coverage was 509,457 geometry
// rows / 20,023 feeders / 32 utilities (2026-10-02). get_gas_index carried a
// changelog figure "(122 -> 17,571 segments now counted)" in agent-facing copy.
// Coverage and segment counts move with every ingest, so no shipped description
// may state them; the no-args call lists current coverage. Same rule as
// refined-queue-no-hardcoded-figures.test.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// "278,799 published records", "18 utilities", "17,571 segments", "122 -> 17,571".
const FIGURE = /\b\d{1,3}(?:,\d{3})+\+?\s*(?:published\s+)?(?:records|feeders|segments)\b|\b\d{1,3}\+?\s+utilities\b|\b\d[\d,]*\s*->\s*\d[\d,]*\s*segments\b/i;

const WANT = { get_hosting_capacity: 'hosting', get_gas_index: 'gas' };

function descriptions() {
  const out = [];
  const spec = JSON.parse(readFileSync('toolspec.json', 'utf8'));
  for (const t of Array.isArray(spec) ? spec : spec.tools || []) if (WANT[t.name]) out.push([`toolspec.json:${t.name}`, t.description]);
  const man = JSON.parse(readFileSync('mcp-server.json', 'utf8'));
  for (const t of man.tools || []) if (WANT[t.name]) out.push([`mcp-server.json:${t.name}`, t.description]);
  for (const pk of ['grid', 'gas']) {
    const pack = JSON.parse(readFileSync(`integrations/packs/${pk}.json`, 'utf8'));
    for (const t of pack.tools || []) if (WANT[t.name]) out.push([`packs/${pk}.json:${t.name}`, t.description]);
  }
  const src = readFileSync('server.mjs', 'utf8');
  for (const [name, lead] of [['get_hosting_capacity', 'Utility-PUBLISHED feeder hosting capacity'], ['get_gas_index', 'Data Center Gas Index (DCGI)']]) {
    const i = src.indexOf(`'${name}'`);
    const m = new RegExp(`'${lead.replace(/[()]/g, '\\$&')}[^\\n]*'`).exec(src.slice(i));
    if (m) out.push([`server.mjs:${name}`, m[0]]);
  }
  return out;
}

describe('hosting-capacity and gas-index descriptions state no hard-coded counts', () => {
  const found = descriptions();
  it('finds every surface (guard cannot pass on an empty scan)', () => {
    expect(found.map(([f]) => f).sort()).toEqual([
      'mcp-server.json:get_gas_index', 'mcp-server.json:get_hosting_capacity',
      'packs/gas.json:get_gas_index', 'packs/grid.json:get_hosting_capacity',
      'server.mjs:get_gas_index', 'server.mjs:get_hosting_capacity',
      'toolspec.json:get_gas_index', 'toolspec.json:get_hosting_capacity']);
  });
  for (const [file, desc] of found) {
    it(`${file} has no records/utilities/segments figure`, () => {
      expect(desc).not.toMatch(FIGURE);
    });
  }
  it('the pattern catches the old strings', () => {
    expect('278,799 published records across 18 utilities').toMatch(FIGURE);
    expect('(122 -> 17,571 segments now counted)').toMatch(FIGURE);
  });
});
