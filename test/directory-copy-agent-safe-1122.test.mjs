// Directory- and agent-facing copy rules for the surfaces fixed on 2026-11-22.
//
// - Glama's connector "Restrictions" row read "Free tier works with no key (previews). A free key
//   or email unlocks more daily calls; full data on some tools needs a paid plan (/pricing)". It is
//   a publisher-declared field on Glama's admin page (asserted 2026-10-10), not read from any repo
//   file, so canonical/listing-copy.json `glama_setup_restrictions` is now the one source it is
//   pasted from.
// - The repo-root Cursor/Grok Build manifest (.cursor-plugin/plugin.json) was v1.1.1 with "98 tools".
// - The root skill (rendered from canonical/skill.md) named claim_free_key, which /mcp no longer
//   lists, pointed at "plans and trial" on /pricing, and used the retired "DC Hub Intelligence".
// - plugins/dchub-copilot had no .mcp.json, which xai-org/plugin-marketplace's indexer reads.
//
// Rule (owner): directory and agent-facing copy names no price, plan, "free", credits, trial,
// calls-per-day, or counts. Offline: reads committed files only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const COMMERCE = [
  [/\$\s?\d/, 'a price'],
  [/\/pricing\b/, 'the pricing page'],
  [/\bfree\b/i, '"free"'],
  [/\bpaid\b/i, '"paid"'],
  [/\btrials?\b/i, '"trial"'],
  [/\bcredits?\b/i, '"credits"'],
  [/\b(pro|starter|business|enterprise|developer|team) (plan|tier)\b/i, 'a plan name'],
  [/\b(calls?|requests?) ?(per|a|\/) ?day\b|\bdaily (calls|allowance|limit|quota)\b/i, 'calls per day'],
  [/claim_free_key/, 'the retired claim_free_key tool'],
  [/DC Hub Intelligence/, 'the retired "DC Hub Intelligence" name'],
];
const COUNTS = [
  [/\b\d+(?:[ -](?:live|MCP|read-only))*[ -]tools?\b/i, 'a tool count'],
  [/\b\d[\d,]*\+?\s+(countries|markets|deals|facilities|assets)\b/i, 'a coverage count'],
];
const violations = (text, rules) => rules.filter(([rx]) => rx.test(text)).map(([, why]) => why);

describe('Glama connector Restrictions row: canonical source', () => {
  const COPY = JSON.parse(read('canonical/listing-copy.json'));
  it('is the directory-safe sentence', () => {
    expect(COPY.glama_setup_restrictions).toBe('DCHUB_API_KEY is optional.');
  });
  it('breaks no commerce or count rule', () => {
    expect(violations(COPY.glama_setup_restrictions, [...COMMERCE, ...COUNTS])).toEqual([]);
  });
});

describe('repo-root Cursor / Grok Build manifest', () => {
  const M = JSON.parse(read('.cursor-plugin/plugin.json'));
  const PKG = JSON.parse(read('package.json'));
  it('tracks the package version', () => {
    expect(M.version).toBe(PKG.version);
  });
  it('leads with the orchestration positioning and execute_plan, with no count or commerce', () => {
    expect(M.description).toMatch(/orchestration layer for data center and energy intelligence/);
    expect(M.description).toMatch(/execute_plan/);
    expect(M.description).toMatch(/Data Center Power Index \(DCPI\)/);
    expect(violations(M.description, [...COMMERCE, ...COUNTS])).toEqual([]);
  });
  it('points at the canonical endpoint', () => {
    const mcp = JSON.parse(read(M.mcpServers));
    expect(mcp.mcpServers.dchub.url).toBe('https://dchub.cloud/mcp');
  });
});

describe('root skill (canonical/skill.md and its rendered copies)', () => {
  const FILES = ['canonical/skill.md', 'skill.md', 'skills/dc-hub-data-center-intelligence/SKILL.md',
    'kiro-power/skills/dc-hub-live-data/SKILL.md'];
  for (const f of FILES) {
    // Body counts and the "tools" metadata are agent-facing and owned by the heal engine
    // (test/listing-canon.test.mjs, test/skill-source-heals-canon-1104.test.mjs). The frontmatter
    // description is what skill directories display, so it carries no count.
    it(`${f}: no commerce, no retired tool or name; description has no count`, () => {
      const s = read(f);
      expect(violations(s, COMMERCE)).toEqual([]);
      const desc = s.match(/^description: (.+)$/m)[1];
      expect(violations(desc, [...COMMERCE, ...COUNTS])).toEqual([]);
    });
    it(`${f}: execute_plan is the front door and the key tool is get_api_key`, () => {
      const s = read(f);
      expect(s).toMatch(/orchestration layer for data center and energy intelligence/);
      expect(s).toMatch(/Start with `execute_plan`/);
      expect(s).toMatch(/`get_api_key`/);
      expect(s).toMatch(/DCHUB_API_KEY` is optional/);
    });
  }
});

describe('Grok Build marketplace: plugins/dchub-copilot/.mcp.json', () => {
  it('declares the hosted server exactly as the indexer expects', () => {
    expect(JSON.parse(read('plugins/dchub-copilot/.mcp.json'))).toEqual(
      { mcpServers: { dchub: { type: 'http', url: 'https://dchub.cloud/mcp' } } });
  });
});

describe('Python SDK module docstring', () => {
  it('says the key is optional, without commerce copy or the retired tool', () => {
    const doc = read('sdk/python/dchub/client.py').split('"""')[1];
    expect(doc).toMatch(/DCHUB_API_KEY is optional/);
    expect(violations(doc, COMMERCE)).toEqual([]);
  });
});
