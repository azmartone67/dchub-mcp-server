// readme-links-are-not-dead-ends.test.mjs — Grok audit 2026-10-06, item 6.
// "grab a free key" pointed at GET /api/v1/keys/claim (405 JSON) and "add the MCP server" at /mcp (raw
// JSON). A clickable README link must land a person on a page: never an /api/ route, an MCP endpoint
// or a .json file (those belong in code spans, which are not links). Offline by design (CI has no
// network); the live status of the allowed targets is checked by hand when this changes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
// markdown links and bare <autolinks>, badges excluded (their targets are third-party image hosts)
const LINKS = [...README.matchAll(/(?<!\!)\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1])
  .filter((u) => !/\.(svg|png|gif)(\?|$)/.test(u));   // a badge image inside a link is an <img>, not a destination

describe('README links', () => {
  it('the scan reaches the links (non-vacuity)', () => {
    expect(LINKS.length).toBeGreaterThan(15);
  });
  it('no clickable dchub.cloud link is an API route, an MCP endpoint or a JSON file', () => {
    const bad = LINKS.filter((u) => /^https:\/\/dchub\.cloud\/(api\/|mcp(\/|$|\?)|\.well-known\/)/.test(u) || /\.json(\?|#|$)/.test(u));
    expect(bad).toEqual([]);
  });
  it('"add the MCP server" goes to /connect and the key is optional, never a free-key offer', () => {
    expect(README).toContain('[add the MCP server](https://dchub.cloud/connect)');
    // owner listing rule 2026-11-14: the key is optional, not a "free key" offer
    expect(README).toContain('`DCHUB_API_KEY` is optional');
    expect(README).not.toMatch(/#free-key/);
    expect(README).not.toMatch(/grab a free key|paste a free key/i);
    expect(README).not.toMatch(/\]\(https:\/\/dchub\.cloud\/api\/v1\/keys\/claim\)/);
  });
});
