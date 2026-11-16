// enterprise-hint-quotes-no-stale-floor.test.mjs — r-sku-wall, 2026-09-24
//
// The high-intent hint told agents Enterprise was "$25k+/yr data licensing".
// DC Hub sells Enterprise from $12,000/yr (dchub-backend
// tier_registry.ENTERPRISE_FROM_USD_YEAR, /pricing). This server has no copy of
// that anchor, so the hint names no figure and points at the page that does:
// say nothing before saying a wrong price.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
// comments are history, not copy
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1');

describe('agent-facing Enterprise copy', () => {
  it('quotes no stale $25k floor', () => {
    expect(code).not.toMatch(/\$25k/i);
  });
  it('the scan can fire on the text it replaced', () => {
    expect("high_intent_enterprise_url ($25k+/yr data ").toMatch(/\$25k/i);
  });
  it('the high-intent hint is the email route alone (note K item 8, 2026-11-15)', () => {
    // v14 (owner 2026-10-10) named the Enterprise lane by its field beside a Developer link. Note K item 8: the hint
    // names one route (the email) and no plan lane; high_intent_enterprise_url stays a machine field.
    expect(code).toContain('high_intent_instructions:   highIntentInstructions(name, claim.count)');
    const fn = code.slice(code.indexOf('export function highIntentInstructions('));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/`bind_email`/);
    expect(body).not.toMatch(/enterprise|developer|paid|\bplans?\b|\$\d/i);
  });
});
