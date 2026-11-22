// Owner 2026-11-21 ("fix the 300+ markets in the tool descriptions too"): no tool
// description names a market count. /.well-known/mcp.json republishes the live
// tools/list, so "DCPI scores 300+ markets" in get_market_dcpi_rank and "re-scores
// 300+ DC Hub markets" in simulate_scenario were the last counts in that file.
// Guards the BUILT tools/list (what the zone worker and registries read) and the
// checked-in copies that mirror it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DCPI_AGENT_LEAD } from '../lib/agent-outreach.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET_COUNT = /\b\d[\d,]*\+?\s+(?:DC Hub\s+|DCPI\s+|metro\s+)?markets\b/i;
const COPIES = ['toolspec.json', 'mcp-server.json', 'integrations/packs/power.json',
  'integrations/packs/site.json', 'integrations/docker/catalog.yaml'];

describe('tool descriptions name no market count', () => {
  it('the regex catches the removed phrasings (not vacuous)', () => {
    expect(MARKET_COUNT.test('DCPI scores 300+ markets daily')).toBe(true);
    expect(MARKET_COUNT.test('re-scores 300+ DC Hub markets under your deltas')).toBe(true);
    expect(MARKET_COUNT.test('DCPI scores markets daily')).toBe(false);
  });

  it('no tool description in the built tools/list states a market count', async () => {
    const S = await import('../server.mjs');
    const tools = (await S._buildToolsListResult(null)).tools;
    expect(tools.length).toBeGreaterThan(60);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.get_market_dcpi_rank.description).toContain('DCPI scores markets daily');
    expect(byName.simulate_scenario.description).toContain('re-scores every DC Hub market');
    const hits = tools.filter((t) => MARKET_COUNT.test(t.description || '')).map((t) => t.name);
    expect(hits).toEqual([]);
  });

  it('the outreach lead and the checked-in copies carry no market count', () => {
    expect(MARKET_COUNT.test(DCPI_AGENT_LEAD)).toBe(false);
    for (const f of COPIES) {
      const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
      // catalog.yaml: only the `tools:` block. The server-level listing line above it
      // is canonical/listing-copy.json (owner canon floor), not a tool description.
      const s = f.endsWith('.yaml') ? raw.slice(raw.search(/^\s*tools:\s*$/m)) : raw;
      expect(s.length, f).toBeGreaterThan(500);
      expect(s.match(new RegExp(MARKET_COUNT.source, 'gi')), f).toBeNull();
    }
  });
});
