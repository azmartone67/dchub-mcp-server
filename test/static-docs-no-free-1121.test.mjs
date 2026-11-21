// static-docs-no-free-1121.test.mjs — owner decision 6 (no-free sweep, 2026-11-21): static repo docs and registry
// listings carry no price sense of "free" ("free key", "free tier", "free dev key", "list ... free"), no calls/day
// figure, no credit pack and no price. claim_free_key stays as an identifier; what it returns is "an API key".
// Counts are out of scope here: they stay on the repo-derived surfaces scripts/sync-tools-manifest.mjs heals daily.
//
// Kept on purpose (not matched): the identifier claim_free_key, "free text" (a parameter sense), "free to cite / use"
// (the licence sense), the Capacity Source terms sentence "free of charge" (terms 2026-11-13, verbatim), and data
// figures such as "$1B+" deals. Not scanned: DATA_QUALITY.md (a dated probe record of what a free-tier key
// returned) and submissions/*.md (archived copies of what was submitted at the time). Deterministic: reads committed files only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

export const SURFACES = [
  'README.md', 'REGISTRY-LISTINGS.md', 'llms.txt', 'llms-install.md', 'smithery.yaml', 'dxt/manifest.json',
  'canonical/listing-copy.json', 'scripts/smithery_description.txt', 'canonical/registry-description-template.json',
  'server.json', 'glama.json', 'package.json', 'npm-launcher/package.json', 'npm-launcher/README.md',
  'canonical/github_description.txt', 'integrations/README.md', 'integrations/PROMPT.md', 'integrations/cohere/README.md',
  'scripts/registry-pr-submit.mjs',
  'integrations/langchain-dchub/README.md',
  'docs/SMITHERY-LISTING-PASTE.md', 'docs/contextual-triggers.md', 'docs/core-profile.md', 'docs/for-ai-assistants.md',
  'docs/one-click-install.md', 'docs/pilot-pack.md', 'docs/power-grid-server.md',
];
// "free" in a non-price sense, removed before the scan.
const nonPrice = (s) => s
  .replace(/\bclaim_free_key\b/g, '')
  .replace(/\bfree[- ]text\b/gi, '')
  .replace(/\bfree to (?:cite|use|reuse|start building)\b/gi, '')
  .replace(/\bfree of charge\b/gi, '')
  .replace(/\bfree up\b/gi, '')
  .replace(/\bfree grid capacity\b/gi, '')
  .replace(/\b(?:count|price)-free\b/gi, '')
  // mcp.so charges for its own listing; that is a third party's fee, not a DC Hub price.
  .replace(/paid \(\$39 one-time\)|\$39 one-time, behind a sign-in/g, '');
export const BANNED = [
  ['"free" (price sense)', /\bfree\b/i],
  ['calls/day', /\bcalls?\s*(?:\/|a|per)\s*day\b|\b\d[\d,]*\s*\/\s*day\b/i],
  ['credit pack', /\bcredit[- ]?packs?\b|\b\d[\d,]*\s+(?:API\s+)?credits\b/i],
  ['a price', /\$\s?\d[\d,.]*(?!\s*[BMK]\+|[BMK]\b)/],
];
export function offenders(name, text) {
  const out = [];
  const t = nonPrice(text);
  t.split('\n').forEach((line, i) => {
    for (const [label, re] of BANNED) {
      const m = re.exec(line);
      if (m) out.push(`${name}:${i + 1} ${label}: …${line.slice(Math.max(0, m.index - 50), m.index + 40)}…`);
    }
  });
  return out;
}

describe('static docs and registry listings: no price sense of "free", calls/day, credit pack or price', () => {
  it.each(SURFACES)('%s', (f) => {
    const text = read(f);
    expect(text.length).toBeGreaterThan(20);
    expect(offenders(f, text)).toEqual([]);
  });
  it('claim_free_key is still named, and described as returning an API key', () => {
    expect(read('smithery.yaml')).toContain('`claim_free_key` returns an API key');
    expect(read('llms.txt')).toContain('it returns an API\nkey');
  });
});

describe('must-fail control: the 2026-11-21 copy', () => {
  it.each([
    'Get a free key by calling the `claim_free_key` tool once',
    'A FREE key gives previews plus 2 full answers per tool per day',
    '`bind_email` for 50 calls/day',
    'Free tier, no signup',
    'operators and brokers list available data-center capacity free; buyers',
    'a one-time pack of 1,000 API credits',
    'Pro ($99/mo)',
  ])('%s', (bad) => { expect(offenders('x', bad).length).toBeGreaterThan(0); });
  it('lets the non-price senses through', () => {
    for (const ok of ['call `claim_free_key`', 'free text matched against', 'free to cite', 'free of charge', 'hyperscaler $1B+ tracker']) {
      expect(offenders('x', ok), ok).toEqual([]);
    }
  });
});
