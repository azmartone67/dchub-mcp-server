// README is canonical hand prose (sync-tools-manifest.mjs), not a registry render.
// No server handler is called; every startup fetch is stubbed before import.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
let tools, realFetch;
beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200,
    headers: { 'content-type': 'application/json' } });
  const { createServer } = await import('../server.mjs');
  tools = createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; });

describe('README agent documentation policy', () => {
  it('separates current editorial quoting from delayed CC-BY and bulk/recurring licences', () => {
    for (const token of ['days from 2026-12-01', '30 days', 'earlier days',
      'any number of markets in editorial work', 'full current list',
      'more than 25 markets in one piece', 'recurring', 'monthly Rankings',
      'terms#dcpi-current-data', 'An API CC-BY label does not override']) {
      expect(readme).toContain(token);
    }
    expect(readme).not.toContain('free to cite under CC BY 4.0.');
  });
  it('keeps sub-scores, upstream/ODbL and confidential responses outside a blanket grant', () => {
    for (const token of ['not CC-BY-4.0', 'redistribution licence',
      'OpenStreetMap: ODbL 1.0', 'attribution/share-alike',
      'raw system-operator readings', 'unresolved upstream rights',
      'opened details, matches and introductions remain confidential']) {
      expect(readme).toContain(token);
    }
  });
  it('does not require per-lookup approval or authorize credential, consent or spending actions', () => {
    for (const token of ['does not require separate approval for every lookup',
      'claim_free_key creates a credential and needs user authorization',
      'explicitly provides for that purpose', 'only after the user agrees to that version',
      'delegated scope and budget', 'spending authorization',
      'request_capacity_intro', 'provider acceptance still controls release',
      'complements existing agents, platforms and tools']) {
      expect(readme).toContain(token);
    }
  });
  it('validates the documented location example against the registered tool, not a business call', () => {
    const example = readme.match(/source_capacity\(min_mw=(\d+), location="([^"]+)"\)/);
    expect(example).not.toBeNull();
    const schema = tools.source_capacity.inputSchema;
    expect(schema.shape).toHaveProperty('location');
    expect(schema.shape).not.toHaveProperty('country');
    expect(schema.safeParse({ min_mw: Number(example[1]), location: example[2] }).success).toBe(true);
    expect(Object.keys(tools)).toHaveLength(94);
  });
});
