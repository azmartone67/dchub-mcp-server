// Note F (owner; Grok item 11, 2026-11-16): agent-facing and discovery copy does not say
// "higher limits" (nor "higher daily limits", "raise your limits", "for higher limits") and does
// not point at pricing for them. Grok's AI summary of DC Hub still said "email binding for higher
// limits"; these are the publish surfaces this repo ships to registries, marketplaces and agents.
//
// Left on purpose (owner calls, not discovery files): lib/tier-canon.mjs mirrors the backend's
// PINNED free_tier_rule, which still ends "Higher limits: dchub.cloud/pricing.", and the keyed
// bind-email wall in server.mjs ("only if you want higher limits — <rungs>").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const HIGHER = /higher (?:daily )?limits|raise your limits|for higher limits/i;

const DOCS = [
  'README.md', 'REGISTRY-LISTINGS.md', 'llms-install.md', 'integrations/README.md',
  'integrations/langchain-dchub/README.md', 'sdk/python/README.md', 'smithery.yaml',
  'dxt/manifest.json', 'mcp-server.json', 'server.json', 'toolspec.json', 'npm-launcher/README.md',
];

describe('discovery and publish copy says no "higher limits"', () => {
  it('control: the pattern catches the pinned canon sentence and each old line', () => {
    for (const old of [
      'With an email: 50 calls/day (up to 10 full answers per tool per day). Higher limits: dchub.cloud/pricing.',
      'set header `X-API-Key` from https://dchub.cloud/connect for higher daily limits.',
      'title: "DC Hub API key — paste one to raise your limits"',
      'free email-verified dev key for higher limits; paid tiers for full data volume.',
    ]) expect(HIGHER.test(old), old).toBe(true);
  });
  for (const p of DOCS) {
    it(p, () => {
      const t = read(p);
      expect(t.length, p).toBeGreaterThan(200);   // non-vacuous: the file was read
      const m = t.match(HIGHER);
      expect(m && t.slice(Math.max(0, m.index - 120), m.index + 40), p).toBeNull();
    });
  }
});
