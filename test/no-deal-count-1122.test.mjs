// Owner 2026-11-22 ("fix the 2,000+ deals count too"): the copy agents and
// registries read names no deal count, the same as tools, facilities and markets.
// "tracked M&A deals" says what is covered without a number that can go stale
// (it read "2,000+" against a 1,900+ canon once). Mirrors the 11-21 market sweep:
// mcp-server.json, smithery.yaml, the registry template that renders both, the
// GitHub About text, the Claude Desktop extension (manifest + shipped bundle) and
// the ChatGPT Actions schema + GPT instructions.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyRuleViolations } from '../scripts/listing-copy.mjs';
import { packBundle } from '../scripts/dxt-bundle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
export const DEAL_COUNT = /\b\d[\d,]*\+?\s+(?:tracked\s+)?(?:M&A\s+)?(?:deals?|transactions?)\b|\{deals\}/i;

function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

const SURFACES = {
  'mcp-server.json': () => strings(JSON.parse(read('mcp-server.json'))),
  'smithery.yaml': () => [read('smithery.yaml')],
  'canonical/registry-description-template.json': () => strings(JSON.parse(read('canonical/registry-description-template.json'))),
  'canonical/github_description.txt': () => [read('canonical/github_description.txt')],
  'dxt/manifest.json': () => strings(JSON.parse(read('dxt/manifest.json'))),
  'integrations/chatgpt/openapi.json': () => strings(JSON.parse(read('integrations/chatgpt/openapi.json'))),
  'integrations/chatgpt/instructions.txt': () => [read('integrations/chatgpt/instructions.txt')],
};

describe('no deal count in agent/registry copy (owner 2026-11-22)', () => {
  for (const [f, get] of Object.entries(SURFACES)) {
    it(`${f} names no deal count`, () => {
      const hits = get().filter((s) => DEAL_COUNT.test(s)).map((s) => s.match(DEAL_COUNT)[0]);
      expect(hits).toEqual([]);
    });
  }

  it('the shipped dchub.dxt bundle is the count-free manifest, repacked', () => {
    const built = packBundle((src) => fs.readFileSync(path.join(ROOT, src)));
    expect(Buffer.compare(built, fs.readFileSync(path.join(ROOT, 'dchub.dxt')))).toBe(0);
  });

  it('the coverage is still named, without a number', () => {
    expect(read('dxt/manifest.json')).toContain('tracked M&A deals');
    expect(read('integrations/chatgpt/openapi.json')).toContain('fiber routes, and tracked M&A deals.');
    expect(read('integrations/chatgpt/instructions.txt')).toContain('- Tracked M&A transactions');
    expect(read('mcp-server.json')).toContain('verdicts, tracked M&A deals, AI Capacity Index');
    // owner 2026-11-26 capabilities messaging: the About text no longer names
    // deals at all (so it cannot carry a deal count); it names its coverage as
    // grid, interconnection, fiber, site and market data. The no-count check
    // above still runs on it.
    expect(read('canonical/github_description.txt')).toContain('Live grid, interconnection, fiber, site and market data for AI agents');
  });

  it('the listing copy rule rejects a deal count and allows the new phrasing', () => {
    expect(copyRuleViolations('2,000+ tracked M&A deals').map((v) => v.rule)).toEqual(['deal_count']);
    expect(copyRuleViolations('2,000+ M&A transactions tracked').map((v) => v.rule)).toEqual(['deal_count']);
    expect(copyRuleViolations('tracked M&A deals and a hyperscaler $1B+ deal tracker')).toEqual([]);
  });
});
