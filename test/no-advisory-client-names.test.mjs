// Grok Brain note 2026-11-24 NEW 1 (neutrality rule): an advisory-client name was used as the worked example in
// generate_site_analysis's public tool description (tools/list, toolspec.json, mcp-server.json). This guard scans
// every public text surface this repo ships for any name on a HASHED list, so the names themselves never live in
// the public repo. Extra names can be supplied in CI via the DCHUB_NEUTRALITY_NAMES secret (comma-separated).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/neutrality-hashes.json'), 'utf8'));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sha = (s) => createHash('sha256').update(s).digest('hex');

const HASHES = new Set(spec.hashes);
for (const n of (process.env.DCHUB_NEUTRALITY_NAMES || '').split(',').map((x) => norm(x)).filter(Boolean)) HASHES.add(sha(n));
const MAX_WORDS = Math.max(spec.max_words, ...[...(process.env.DCHUB_NEUTRALITY_NAMES || '').split(',')].map((x) => norm(x).split(' ').length));

export function findHashedNames(text) {
  const words = norm(text).split(' ').filter(Boolean);
  const hits = [];
  for (let i = 0; i < words.length; i++) {
    for (let k = 1; k <= MAX_WORDS && i + k <= words.length; k++) {
      const gram = words.slice(i, i + k).join(' ');
      if (HASHES.has(sha(gram))) hits.push({ at_word: i, hash: sha(gram).slice(0, 12) });
    }
  }
  return hits;
}

// Every surface that copies tool text or instructions to the public.
const SURFACES = ['server.mjs', 'toolspec.json', 'mcp-server.json', 'server.json', 'llms.txt', 'llms-install.md',
  'README.md', 'AGENTS.md', 'npm-launcher/README.md', '.well-known/mcp.json', 'server-card.json'];

describe('no advisory-client names in public tool text', () => {
  it('hash list is non-trivial', () => { expect(HASHES.size).toBeGreaterThanOrEqual(10); });
  for (const f of SURFACES) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    it(`${f} carries no hashed client name`, () => {
      expect(findHashedNames(readFileSync(p, 'utf8'))).toEqual([]);
    });
  }
});
