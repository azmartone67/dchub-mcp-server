// readme-start-and-badges.test.mjs (Grok Note P items 1+2, 2026-11-16).
//
// The GitHub README (~28 KB) put Install at ~line 168, so a visitor had to scroll past the API,
// licensing and endpoint sections to find the one command. A "Start" block now sits directly under
// the badge row: the orchestration sentence, `npx -y dchub-mcp-server`, "No key needed for
// previews. Start with execute_plan." and /connect. The npm README stays short. Neither names a
// plan, a price, or paid/upgrade/trial (owner notes F/G/M/N).
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const README = read('README.md');
const NPM_README = read('npm-launcher/README.md');
const ORCH = 'The orchestration layer for data center and energy intelligence.';
const STAR = 'Star this repo to help other builders find DC Hub.';
const NO_PLAN_COPY = /\b(?:paid|upgrades?|upgrading|trials?|pricing)\b|\bfree[- ]tiers?\b|\$\s?\d|\/pricing\b|\b(?:Pro|Starter|Enterprise|Founding)\b|\bdeveloper plan\b/;

describe('npm README (npm-launcher/README.md)', () => {
  it('is under 2,000 characters', () => {
    expect(NPM_README.length).toBeLessThan(2000);
  });
  it('carries the orchestration line, the npx one-liner and "no key: previews"', () => {
    expect(NPM_README).toContain('The orchestration layer for data center and energy intelligence');
    expect(NPM_README).toContain('npx -y dchub-mcp-server');
    expect(NPM_README).toMatch(/\*\*No key:\*\* previews/);
  });
  it('carries an mcpServers JSON block that runs the launcher through npx', () => {
    const block = NPM_README.match(/```json\n([\s\S]*?)\n```/);
    expect(block).not.toBeNull();
    const cfg = JSON.parse(block[1]);
    expect(cfg.mcpServers.dchub.command).toBe('npx');
    expect(cfg.mcpServers.dchub.args).toEqual(['-y', 'dchub-mcp-server']);
  });
});

describe('GitHub README: Start block under the badge row', () => {
  const lines = README.split('\n');
  const badgeRow = lines.findIndex((l) => l.startsWith('[![Install in VS Code]'));
  const start = lines.indexOf('## Start');
  const usingHeading = lines.indexOf('## Using DC Hub data without MCP');
  const install = lines.indexOf('## Install');
  const nextHeading = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
  const block = lines.slice(start, nextHeading).join('\n');

  it('sits directly under the badge row, above "Using DC Hub data without MCP" and Install', () => {
    expect(badgeRow).toBeGreaterThan(-1);
    expect(usingHeading).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(badgeRow);
    expect(lines.slice(badgeRow + 1, start).every((l) => l.trim() === '')).toBe(true);
    expect(start).toBeLessThan(usingHeading);
    expect(start).toBeLessThan(install);
  });
  it('has the orchestration sentence, the npx one-liner, the previews line and /connect', () => {
    expect(block).toContain(ORCH);
    expect(block).toMatch(/```bash\nnpx -y dchub-mcp-server\n```/);
    expect(block).toContain('No key needed for previews. Start with execute_plan.');
    expect(block).toContain('https://dchub.cloud/connect');
  });
  it('the star line appears exactly once in the README', () => {
    expect(README.split(STAR).length - 1).toBe(1);
    expect(NPM_README).not.toContain(STAR);
  });
});

// Deal values are data, not plan pricing. Each allowlisted phrase must still be present, so the
// list cannot outlive its reason.
const DATA_DOLLARS = { 'README.md': ['hyperscaler $1B+ deal tracker'], 'npm-launcher/README.md': [] };
describe.each([['README.md', README], ['npm-launcher/README.md', NPM_README]])('%s: no plan or price copy', (name, raw) => {
  it('names no plan, no price, no paid/upgrade/trial', () => {
    let text = raw;
    for (const p of DATA_DOLLARS[name]) { expect(text).toContain(p); text = text.split(p).join(''); }
    const hit = text.match(NO_PLAN_COPY);
    expect(hit, hit && text.slice(Math.max(0, hit.index - 60), hit.index + 60)).toBeNull();
  });
});

describe('badge row', () => {
  const row = README.split('\n').find((l) => l.startsWith('[![Install in VS Code]')) || '';
  const badges = [...row.matchAll(/\[!\[([^\]]+)\]\(([^)]+)\)\]\(([^)]+)\)/g)].map((m) => ({ alt: m[1], img: m[2], href: m[3] }));

  it('VS Code and Cursor first, then Glama and GitHub stars', () => {
    expect(badges.slice(0, 4).map((b) => b.alt)).toEqual(['Install in VS Code', 'Add to Cursor', 'Glama score', 'GitHub stars']);
  });
  it('Glama: the score badge Glama serves, linked to the listing', () => {
    const g = badges.find((b) => b.alt === 'Glama score');
    expect(g.img).toBe('https://glama.ai/mcp/servers/azmartone67/dchub-mcp-server/badges/score.svg');
    expect(g.href).toBe('https://glama.ai/mcp/servers/azmartone67/dchub-mcp-server');
  });
  it('GitHub stars: shields.io, linked to the stargazers page', () => {
    const s = badges.find((b) => b.alt === 'GitHub stars');
    expect(s.img).toMatch(/^https:\/\/img\.shields\.io\/github\/stars\/azmartone67\/dchub-mcp-server(\?|$)/);
    expect(s.href).toBe('https://github.com/azmartone67/dchub-mcp-server/stargazers');
  });
  it('no Smithery install badge or CLI install (hosted proxy and CLI ended 2026-10-31)', () => {
    expect(README).not.toMatch(/smithery\.ai\/badge/i);
    expect(README).not.toMatch(/@smithery\/cli/i);
    expect(badges.some((b) => /smithery/i.test(b.img + b.href))).toBe(false);
  });
});

describe('social preview image (owner uploads it in Settings)', () => {
  const png = readFileSync(new URL('../docs/social-preview.png', import.meta.url));
  it('is a 1280x640 PNG under GitHub\'s 1 MB limit', () => {
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(640);
    expect(statSync(new URL('../docs/social-preview.png', import.meta.url)).size).toBeLessThan(1_000_000);
  });
});
