// get_refined_queue's description once carried "~5,300 projects, 7 ISOs,
// ~1,744 GW" typed by hand; live was 5,594 / 10 / 1,777.5 (2026-10-02). The
// queue changes every refresh, so no shipped description may state a queue
// size. Same rule as tool/facility counts: point at the live snapshot instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// A queue SIZE: "~1,744 GW", "5,300 projects", "7 ISOs". Not the example query
// "show me 1 GW+ gas projects", which is a user ask, not a claim about the queue.
const FIGURE = /~\s?\d[\d,.]*\+?\s*(?:projects?|ISOs?|GW)\b|\b\d+\s+ISOs?\b|\b\d{1,3},\d{3}\+?\s*(?:projects?|GW)\b/i;

function refinedQueueDescriptions() {
  const out = [];
  const spec = JSON.parse(readFileSync('toolspec.json', 'utf8'));
  const tools = Array.isArray(spec) ? spec : spec.tools || [];
  for (const t of tools) if (t.name === 'get_refined_queue') out.push(['toolspec.json', t.description]);
  const man = JSON.parse(readFileSync('mcp-server.json', 'utf8'));
  for (const t of man.tools || []) if (t.name === 'get_refined_queue') out.push(['mcp-server.json', t.description]);
  const pack = JSON.parse(readFileSync('integrations/packs/grid.json', 'utf8'));
  for (const t of pack.tools || []) if (t.name === 'get_refined_queue') out.push(['packs/grid.json', t.description]);
  const src = readFileSync('server.mjs', 'utf8');
  const i = src.indexOf("'get_refined_queue'");
  const m = /'Server-side SET-REDUCTION[^\n]*'/.exec(src.slice(i));
  if (m) out.push(['server.mjs', m[0]]);
  return out;
}

describe('get_refined_queue states no hard-coded queue size', () => {
  const found = refinedQueueDescriptions();
  it('finds every surface (guard cannot pass on an empty scan)', () => {
    expect(found.map(([f]) => f).sort()).toEqual(['mcp-server.json', 'packs/grid.json', 'server.mjs', 'toolspec.json']);
  });
  for (const [file, desc] of found) {
    it(`${file} has no project/ISO/GW figure`, () => {
      expect(desc).not.toMatch(FIGURE);
    });
  }
  it('the pattern catches the old string', () => {
    expect('queue (~5,300 projects, 7 ISOs, ~1,744 GW)').toMatch(FIGURE);
  });
});
