// =============================================================================
// Listing surfaces state no monthly price — only the $10 pack.
// -----------------------------------------------------------------------------
// ★2026-09-28 (owner rule 09-27; dec-price-canon, dec-mcp-paid-means-pro).
// Glama and mcpservers re-scan README.md; the official registry cascades
// server.json; registry scrapes read mcp-server.json's top-level description;
// Smithery reads smithery.yaml; Cline reads llms-install.md. The README said
// "Developer ($49/mo)" and "Pro ($99/mo)" after the rule, and nothing failed.
//
// Scope is deliberate: mcp-server.json `tools[]` is generated from server.mjs,
// whose unlock_more_data description is frozen until after 2026-10-01
// (frz-claude-relay-wording), and smithery.yaml `description:` is
// frz-smithery-description (moved by its own owner-requested PR). Neither is
// scanned here; everything else in these files is.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MONTHLY = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|month)\b|per month|a month)/gi;

const SURFACES = {
  'README.md': () => read('README.md'),
  'server.json (description)': () => JSON.parse(read('server.json')).description,
  'mcp-server.json (top-level description)': () => JSON.parse(read('mcp-server.json')).description,
  // 2026-11-14 (owner): the pricing block is gone, so the whole file is swept.
  'smithery.yaml': () => read('smithery.yaml'),
  'llms-install.md': () => read('llms-install.md'),
};

describe('listing surfaces carry no monthly price', () => {
  for (const [name, get] of Object.entries(SURFACES)) {
    it(`${name}: no "$N/mo"`, () => {
      const text = get();
      expect(text.length, `${name} is empty — nothing to check`).toBeGreaterThan(50);
      expect(text.match(MONTHLY) || [], `${name} states a monthly price`).toEqual([]);
    });
  }

  it('MUST-FAIL CONTROL: the pattern catches the forms that shipped', () => {
    for (const s of ['Developer ($49/mo)', 'Pro $99/mo', '$49 / month', '$99 per month']) {
      expect(s.match(MONTHLY), s).not.toBeNull();
    }
    expect('$10 one-time pack of 1,000 API credits'.match(MONTHLY)).toBeNull();
  });

  it('README states no pack price and carries no /pricing link', () => {
    const r = read('README.md');
    // 2026-10-09: listing copy names no price (mcp#861). 2026-11-14 (owner listing rule): no /pricing link
    // and no plan wording either; DCHUB_API_KEY is described as optional.
    expect(r).not.toContain('$10 one-time pack');
    expect(r).not.toContain('https://dchub.cloud/pricing');
    expect(r).not.toMatch(/free[- ]tier|paid plans?\b/i);
    expect(r).toMatch(/`DCHUB_API_KEY` is optional/);
  });
});
