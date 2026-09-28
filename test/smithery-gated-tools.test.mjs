// smithery.yaml `gated_tools` is what Smithery shows as the paid-only list.
// It listed 6 tools, two of them not Pro-only (get_intelligence_index,
// get_infrastructure) and three Pro-only ones missing — Grok sweep item 27.
// The owner is PRO_ONLY_TOOLS in server.mjs; this keeps the two sets equal.
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

describe('smithery.yaml gated_tools', () => {
  it('parses both lists (not vacuous)', () => {
    expect(proOnlyFromServer()?.length).toBeGreaterThanOrEqual(5);
    expect(gatedFromSmithery()?.length).toBeGreaterThanOrEqual(5);
  });
  it('equals PRO_ONLY_TOOLS in server.mjs', () => {
    expect(gatedFromSmithery()).toEqual(proOnlyFromServer());
  });
});
