// list_transactions states no hard deal count (owner 2026-11-06).
//
// The description said "1,800+ tracked deals (2019-present)" (Grok saw "1,700+") while the
// keyed tool answered total_count=451, and keyless total_count is null. Owner call: drop the
// number and point at total_count. Every copy of the description moves together: server.mjs
// (what /mcp serves) and the derived manifests registries and toolkits read.
// /mcp/chatgpt and /mcp/claude serve their own reviewed text (lib/chatgpt-directory.mjs,
// lib/claude-directory.mjs), which never carried a number; this file does not touch them.
// toolspec.json is regenerated from the LIVE tools/list daily, so it is checked for the number
// only, not for byte equality with server.mjs (the live render differs in places).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
// A magnitude in front of "deals" / "transactions": "1,800+ tracked deals", "451 deals".
const DEAL_FLOOR = /\d[\d,]*\+?\s+(?:tracked\s+)?(?:M&A\s+)?(?:deals|transactions)/i;

function serverDescription() {
  const src = read('server.mjs');
  const m = src.match(/trackedTool\(srv, 'list_transactions', '((?:[^'\\]|\\.)*)'/);
  return m ? m[1] : null;
}

const COPIES = {
  'server.mjs': serverDescription,
  'mcp-server.json': () => JSON.parse(read('mcp-server.json')).tools.find((t) => t.name === 'list_transactions')?.description,
  'toolspec.json': () => JSON.parse(read('toolspec.json')).find((t) => t.name === 'list_transactions')?.description,
  'integrations/packs/deals.json': () => {
    const j = JSON.parse(read('integrations/packs/deals.json'));
    return (j.tools || []).find((t) => t.name === 'list_transactions')?.description;
  },
};

describe('list_transactions description carries no deal count', () => {
  it('the pattern really fires on the old text (non-vacuity)', () => {
    for (const old of ['capital deals — 1,800+ tracked deals (2019-present)', '1,700+ tracked deals', '451 deals']) {
      expect(DEAL_FLOOR.test(old), old).toBe(true);
    }
  });

  it.each(Object.keys(COPIES))('%s: found, points at total_count, no hard number', (f) => {
    const d = COPIES[f]();
    expect(d, `${f}: list_transactions description not found, so this check would pass on nothing`).toBeTruthy();
    expect(d.length, f).toBeGreaterThan(200);
    expect(d, f).toMatch(/total_count/);
    expect(d, f).not.toMatch(DEAL_FLOOR);
  });
});
