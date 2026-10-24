// integrations/docker/catalog.yaml — DC Hub for Docker's MCP Toolkit (2026-10-24).
// The format is docker/mcp-gateway pkg/catalog/types.go; the file is generated
// from toolspec.json + canonical/listing-copy.json and must never drift from them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildCatalog, shortToolDescription, CATALOG_PATH, RAW_URL, SERVER_NAME, TOOL_DESC_MAX,
} from '../scripts/build-docker-catalog.mjs';
import { loadListingCopy } from '../scripts/listing-copy.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TOOLS = JSON.parse(read('toolspec.json'));
const COPY = loadListingCopy();

describe('buildCatalog', () => {
  const text = buildCatalog({ short: 'Short "quoted" copy:\nwith a newline.' }, [
    { name: 'b_tool', description: 'Second. More text.' },
    { name: 'a_tool', description: 'First tool: does a thing.' },
  ]);

  it('is a top-level catalog with one remote server on our endpoint', () => {
    expect(text).toMatch(/^name: "dchub"$/m);
    expect(text).toMatch(/^displayName: "DC Hub"$/m);
    expect(text).toMatch(/^registry:\n {2}dchub:\n {4}name: "dchub"\n {4}type: "remote"$/m);
    expect(text).toMatch(/^ {4}remote:\n {6}url: "https:\/\/dchub\.cloud\/mcp"\n {6}transport_type: "streamable-http"$/m);
  });

  it('quotes every string, so copy with quotes, colons or newlines cannot break the YAML', () => {
    expect(text).toContain('description: "Short \\"quoted\\" copy:\\nwith a newline."');
  });

  it('lists tools sorted by name with their first sentence', () => {
    const i = text.indexOf('name: "a_tool"');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(text.indexOf('name: "b_tool"'));
    expect(text).toContain('description: "First tool: does a thing."');
    expect(text).toContain('description: "Second."');
  });

  it('refuses to build from no copy or no tools', () => {
    expect(() => buildCatalog(null, TOOLS)).toThrow(/short copy/);
    expect(() => buildCatalog(COPY, [])).toThrow(/no tools/);
  });
});

describe('shortToolDescription', () => {
  it('keeps a short first sentence whole and caps a long one on a word', () => {
    expect(shortToolDescription('Grid data. Then more.')).toBe('Grid data.');
    const long = shortToolDescription(`${'word '.repeat(80)}end.`);
    expect(long.length).toBeLessThanOrEqual(TOOL_DESC_MAX);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/wor…$/);
  });
});

describe('the committed catalog', () => {
  it('equals what toolspec.json and listing-copy.json generate (run --fix if not)', () => {
    expect(read(CATALOG_PATH)).toBe(buildCatalog(COPY, TOOLS));
  });

  it('carries every tool in toolspec.json', () => {
    const names = [...read(CATALOG_PATH).matchAll(/^ {6}- name: "([^"]+)"$/gm)].map((m) => m[1]);
    expect(names.sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it('daily-manifest-sync regenerates it and stages it', () => {
    const wf = read('.github/workflows/daily-manifest-sync.yml');
    expect(wf).toContain('run: node scripts/build-docker-catalog.mjs --fix');
    const owned = wf.slice(wf.indexOf('OWNED="'), wf.indexOf('"', wf.indexOf('OWNED="') + 7));
    expect(owned).toContain(CATALOG_PATH);
  });

  it('both READMEs give the import command for this exact file', () => {
    for (const p of ['README.md', 'integrations/docker/README.md']) {
      expect(read(p)).toContain(`docker mcp catalog import ${RAW_URL}`);
      expect(read(p)).toContain(`docker mcp server enable ${SERVER_NAME}`);
    }
  });
});
