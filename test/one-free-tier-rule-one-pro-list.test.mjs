// one-free-tier-rule-one-pro-list.test.mjs — Grok audit 2026-10-06, item 5 (MCP half).
// The Pro-only list is five tools (the backend's routes.mcp_tool_catalog.pro_only_tool_names() is held
// to the same five by its own test), and no served string says an email is required to get a key: the
// free key is `claim_free_key`, no email, and an email only raises the daily limit.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
// code lines only: comments are history, not copy
const CODE = SRC.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\s\/\/\s.*$/, '')).join('\n');

describe('Pro-only list', () => {
  it('is exactly the five tools the backend publishes (routes/mcp_tool_catalog.pro_only_tool_names)', () => {
    const m = /const PRO_ONLY_TOOLS = new Set\(\[([\s\S]*?)\]\);/.exec(SRC);
    expect(m, 'PRO_ONLY_TOOLS literal moved: this guard would be vacuous').toBeTruthy();
    const names = [...m[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(names).toEqual(['analyze_site', 'compare_sites', 'export_dataset', 'generate_site_analysis', 'get_dchub_recommendation']);
  });
});

describe('served copy never makes an email a requirement for a key', () => {
  it('no served string says "email only" / "email-only" (the key flow takes no email)', () => {
    const hits = [...CODE.matchAll(/[^\n]{0,60}email[- ]only[^\n]{0,40}/gi)].map((m) => m[0].trim());
    expect(hits).toEqual([]);
  });
  it('the automated-usage block points at claim_free_key / /connect#free-key, not /signup', () => {
    const i = CODE.indexOf('Automated usage detected');
    expect(i).toBeGreaterThan(-1);
    const block = CODE.slice(i, i + 900);
    expect(block).toContain('no email needed');
    expect(block).not.toContain('https://dchub.cloud/signup');
  });
});
