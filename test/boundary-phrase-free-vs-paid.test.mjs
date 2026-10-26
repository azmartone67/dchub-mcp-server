// boundary-phrase-free-vs-paid.test.mjs — the relay's lead sentence says "paid"
// only where the tool really sells a paid plan (owner 2026-10-26).
//
// Every wall's for_your_human.message (and the two keyless fallback lines) read
// "Your AI assistant hit DC Hub's paid data boundary on <tool>", directly above
// the wall line that now offers the answer FREE for an email (mcp#1163/#1164).
// An agent relaying the message told the person it was paid. Measured live
// 2026-10-26 18:22Z on a keyless get_grid_data MISO call.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as S from '../server.mjs';

describe('_boundaryPhrase', () => {
  it('a free-tier wall is the caller\'s free-tier limit, never "paid"', () => {
    for (const tool of ['get_grid_data', 'get_grid_intelligence', 'get_interconnection_queue',
                        'get_water_risk', 'get_energy_prices', 'get_market_intel']) {
      expect(S._boundaryPhrase(tool), tool).toBe('free-tier limit');
    }
  });

  it('a tool that really sells a paid plan keeps "paid data boundary"', () => {
    for (const tool of ['analyze_site', 'compare_sites']) {      // Pro-only / Land & Power
      expect(S._boundaryPhrase(tool), tool).toBe('paid data boundary');
    }
  });

  it('no relay sentence hard-codes "paid data boundary" outside the helper', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const hits = code.match(/paid data boundary/g) || [];
    expect(hits.length).toBe(1);                                  // the helper's own return
    expect(code).toMatch(/hit DC Hub’s ' \+ _boundaryPhrase\(toolName\)/);
    expect((code.match(/hit DC Hub\\u2019s ' \+ _boundaryPhrase\(name\)/g) || []).length).toBe(2);
  });
});
