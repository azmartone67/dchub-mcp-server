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
    // Note V keyed follow-up (owner 2026-11-16): the token is internal; a paid boundary reads as the end of the
    // preview, so the helper's value never reaches the person's line.
    expect(code).toMatch(/if \(_bp !== 'free-tier limit'\) return 'Your AI assistant reached the end of the DC Hub preview'/);
    // Grok QA 2026-11-12: the wall line lives once in _relayLead (execute_plan has its own line there);
    // the relay builder and both relay steps call it.
    // Owner 2026-11-15: the person reads no tier label, so the internal 'free-tier limit' token is shown as "limit";
    // the line still reads the helper exactly once.
    expect((code.match(/const _bp = _boundaryPhrase\(tool\);\n/g) || []).length).toBe(1);
    expect((code.match(/return 'Your AI assistant hit DC Hub\\u2019s limit'/g) || []).length).toBe(1);
    expect(code).toMatch(/message: _relayLead\(toolName\) \+/);
    expect((code.match(/= _relayLead\(name, sc0\) \+ '\. Open '/g) || []).length).toBe(2);
  });
});
