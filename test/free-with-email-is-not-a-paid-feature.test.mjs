// A tool a free key unlocks must not be advertised as "a paid feature".
//
// PAID_ONLY_TOOLS holds TWO classes under one name, and its own comments say
// so: six PRO-only premium tools, and a "FREE-with-email-key" group
// (get_interconnection_queue, compare_isos, list_transactions,
// hyperscaler_deals, get_facility, get_market_intel, ...). The second group
// needs a BOUND EMAIL, not a payment — `unlocked_tools` in the wall's own
// structuredContent lists them.
//
// The wall did not distinguish them. Measured on the live board 2026-09-20,
// after be#4939 made `blocked` countable on its own: 169 blocked signals
// platform-wide, get_interconnection_queue alone holding 135, and at least 157
// (93%) on tools this predicate marks FREE — every one told to pay.
//
// PRO_ONLY_TOOLS already exists to tell this truth (its r62b-conv comment: 33
// trials minted / 2 reconnected, because the wall told agents to retry with a
// key that could not unlock the tool). It is consulted in six places. This copy
// was not one of them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isFreeWithEmailTool, PAID_ONLY_TOOLS, HARD_WALL_HEADLINES,
         isHardWallText, _trialUnlockedTools, _trialUnlockedHint } from '../server.mjs';

describe('isFreeWithEmailTool', () => {
  it('marks the tools a bound email unlocks', () => {
    for (const t of ['get_interconnection_queue', 'compare_isos', 'list_transactions',
                     'hyperscaler_deals', 'get_facility', 'get_market_intel',
                     'rank_markets', 'ai_capacity_index']) {
      expect(isFreeWithEmailTool(t), t).toBe(true);
    }
  });

  it('does NOT mark the genuinely Pro tools', () => {
    for (const t of ['analyze_site', 'compare_sites', 'get_grid_intelligence',
                     'get_fiber_intel', 'get_dchub_recommendation',
                     'generate_site_analysis']) {
      expect(isFreeWithEmailTool(t), t).toBe(false);
    }
  });

  it('is false for tools that were never gated at all', () => {
    for (const t of ['search_facilities', 'get_news', 'why_dchub', 'not_a_tool']) {
      expect(isFreeWithEmailTool(t), t).toBe(false);
    }
  });

  it('is DERIVED, so promoting a tool to Pro flips it automatically', () => {
    // Not a second list: every member is in PAID_ONLY_TOOLS, and the two
    // classes partition it with nothing left over and nothing double-counted.
    const free = [...PAID_ONLY_TOOLS].filter(isFreeWithEmailTool);
    const pro = [...PAID_ONLY_TOOLS].filter((t) => !isFreeWithEmailTool(t));
    expect(free.length + pro.length).toBe(PAID_ONLY_TOOLS.size);
    expect(free.length).toBeGreaterThan(0);
    expect(pro.length).toBeGreaterThan(0);
    expect(free.some((t) => pro.includes(t))).toBe(false);
  });
});

describe('the wall copy branches on it', () => {
  const src = readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');
  const i = src.indexOf('const _freeWithEmail = isFreeWithEmailTool(name);');
  const block = src.slice(i, src.indexOf('r50 (2026-05-26)', i));

  it('reads the exported predicate, not a local copy of the rule', () => {
    expect(i).toBeGreaterThan(-1);
    expect(block).not.toContain('!PRO_ONLY_TOOLS.has(name)');
  });

  it('the free branch never calls the tool "a paid feature"', () => {
    const free = block.slice(block.indexOf('_mdAnon = _freeWithEmail'),
                             block.indexOf(': _isClaude'));
    expect(free).not.toContain('is a paid feature');
    expect(free).toContain('needs a free key, not a payment');
  });

  it('the free branch leads with bind_email', () => {
    const free = block.slice(block.indexOf('_mdAnon = _freeWithEmail'),
                             block.indexOf(': _isClaude'));
    expect(free).toContain('bind_email');
    // …and the fix-it-yourself line must come BEFORE the human ask.
    expect(free.indexOf('bind_email')).toBeLessThan(free.indexOf('Tell your human'));
  });

  it('the free branch drops the line that is false for it', () => {
    const free = block.slice(block.indexOf('_mdAnon = _freeWithEmail'),
                             block.indexOf(': _isClaude'));
    // Case-INSENSITIVE and anchored on the claim, not one spelling of it: an
    // earlier version of this assertion was case-sensitive, and a mutation
    // that recapitalised the same false sentence walked straight past it.
    expect(free).not.toMatch(/full depth still needs/i);
    expect(free).not.toMatch(/needs one of the unlocks above/i);
  });

  it('keeps EXACTLY ONE human ask, so composeHumanCta adds none and drops none', () => {
    const free = block.slice(block.indexOf('_mdAnon = _freeWithEmail'),
                             block.indexOf(': _isClaude'));
    expect((free.match(/\*\*Tell your human:\*\*/g) || []).length).toBe(1);
  });

  it('the PRO branch is untouched', () => {
    const pro = block.slice(block.indexOf(': _isClaude'));
    expect(pro).toContain('is a paid feature');
    expect(pro).toContain('full depth still needs one of the options above');
  });
});

describe('HARD_WALL_HEADLINES is coupled to the copy', () => {
  const src = readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');

  it('every declared headline is actually emitted by a wall branch', () => {
    // Without this the list is prose: a renamed headline would leave
    // isHardWallText silently answering false for a real wall, and every test
    // that uses it as "was this walled" would go green on a broken wall.
    for (const h of HARD_WALL_HEADLINES) {
      const uses = src.split(h).length - 1;
      expect(uses, `headline never appears in server.mjs: ${h}`).toBeGreaterThan(1);
    }
  });

  it('both new free-with-email headlines are covered', () => {
    expect(isHardWallText('## 🔑 `x` needs a free key, not a payment')).toBe(true);
    expect(isHardWallText('## 🔑 `x` needs a bound email, not a payment')).toBe(true);
    expect(isHardWallText('## 🔒 `x` is a paid feature')).toBe(true);
    expect(isHardWallText('here is your data')).toBe(false);
  });
});

// r-unlocked-derived (2026-09-20). The trial envelope's machine-readable
// `unlocked_tools` — added "so a programmatic agent can act without parsing
// prose" — was a hand list, and it named three tools applyTierGate DENIES at
// free AND identified alike. Measured live 2026-09-20: the
// `needs a bound email, not a payment` wall for get_interconnection_queue
// shipped structuredContent.unlocked_tools containing its own name. The list is
// now derived from the gate at the trial's own tier.
describe('unlocked_tools is derived from the gate, not kept as a second list', () => {
  // The three the hand list got wrong: PAID_ONLY_TOOLS members in none of the
  // sets that can pass the free/identified gate, so a trial key never opens them.
  it.each(['get_pipeline', 'get_interconnection_queue', 'list_transactions'])(
    'no longer advertises %s, which the gate refuses', (t) => {
      expect(_trialUnlockedTools()).not.toContain(t);
      expect(_trialUnlockedHint()).not.toContain(t);
    });

  // The ones a trial key really does open — via ALWAYS_PARTIAL_PREVIEW's capped
  // full taste or KEYED_FREE_BONUS. Dropping these would be the opposite bug.
  it.each(['get_grid_intelligence', 'get_fiber_intel', 'get_grid_data', 'get_market_intel'])(
    'still advertises %s, which the gate allows', (t) => {
      expect(_trialUnlockedTools()).toContain(t);
      expect(_trialUnlockedHint()).toContain(t);
    });

  it('never advertises a tool outside PAID_ONLY_TOOLS (the hint describes the GATED set)', () => {
    for (const t of _trialUnlockedTools()) expect(PAID_ONLY_TOOLS.has(t), t).toBe(true);
  });

  it('annotates only the capped-full-taste tools with the daily cap', () => {
    const hint = _trialUnlockedHint();
    expect(hint).toMatch(/get_grid_intelligence \(full, \d+\/day\)/);
    // get_grid_data passes the gate outright (KEYED_FREE_BONUS), not as a taste.
    expect(hint).not.toMatch(/get_grid_data \(full, \d+\/day\)/);
  });
});
