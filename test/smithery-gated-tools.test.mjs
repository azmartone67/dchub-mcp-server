// smithery.yaml `gated_tools` is what Smithery shows as the paid-only list.
// It listed 6 tools, two of them not Pro-only (get_intelligence_index,
// get_infrastructure) and three Pro-only ones missing — Grok sweep item 27.
// The owner is PRO_ONLY_TOOLS in server.mjs; this keeps the two sets equal.
// The pricing block's developer line used to say "all tools except 7 Pro tools
// (10 full grid/fiber answers/day, ...)": a hand-typed count that outlived ladder
// stage 1 (2026-09-29), when get_grid_intelligence and get_fiber_intel left the
// Pro-only set and Developer got both in full. The line now points at gated_tools
// (the same words the zone worker's manifests use), and a count there fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');

function proOnlyFromServer() {
  const src = read('server.mjs');
  const m = src.match(/const PRO_ONLY_TOOLS = new Set\(\[([\s\S]*?)\]\);/);
  if (!m) return null;
  const body = m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  return [...body.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

function gatedFromSmithery() {
  const lines = read('smithery.yaml').split('\n');
  const i = lines.indexOf('gated_tools:');
  if (i < 0) return null;
  const out = [];
  for (const l of lines.slice(i + 1)) {
    const m = l.match(/^\s+-\s+([a-z_]+)\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out.sort();
}

// "7 Pro tools", "seven Pro-only tools", "5 gated tools": a count of the gated set typed by hand.
function statesToolCount(text) {
  return /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(pro|paid|gated|pro-only)(\s+|-)?(only\s+)?tools?\b/i.test(text);
}

describe('smithery.yaml gated_tools', () => {
  it('parses both lists (not vacuous)', () => {
    expect(proOnlyFromServer()?.length).toBeGreaterThanOrEqual(5);
    expect(gatedFromSmithery()?.length).toBeGreaterThanOrEqual(5);
  });
  it('equals PRO_ONLY_TOOLS in server.mjs', () => {
    expect(gatedFromSmithery()).toEqual(proOnlyFromServer());
  });

  it('the pricing block names the Pro-only set by pointing at gated_tools, never by a typed count', () => {
    const block = read('smithery.yaml').match(/^pricing:\n((?:[ \t]+.*\n)+)/m);
    expect(block, 'smithery.yaml has no pricing: block - this guard would check nothing').toBeTruthy();
    const lines = block[1].split('\n');
    const dev = lines.find((l) => /^\s+developer:/.test(l)) || '';
    expect(dev).toMatch(/gated_tools/);
    expect(statesToolCount(block[1])).toBe(false);
  });
  it('controls: the retired wording is caught, the current wording is not', () => {
    expect(statesToolCount('developer: "full results on all tools except 7 Pro tools (10 full grid/fiber answers/day)"')).toBe(true);
    expect(statesToolCount('developer: "full results on all tools except the seven Pro-only tools"')).toBe(true);
    expect(statesToolCount('pro: "2,000 calls/day + 5 Pro tools"')).toBe(true);
    expect(statesToolCount('developer: "500 calls/day; full results on every tool except the tools in gated_tools"')).toBe(false);
    expect(statesToolCount('pro: "2,000 calls/day + Pro tools, bulk export"')).toBe(false);
  });
});
