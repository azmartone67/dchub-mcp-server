import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { withStarterPack } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

const res = (extra = {}) => ({
  content: [{ type: 'text', text: '{"ok":true}' }],
  structuredContent: { ok: true },
  ...extra,
});
let n = 0;
const sid = () => ({ session_id: `s-${++n}-${Math.random()}` });

describe('withStarterPack — content', () => {
  it('attaches the pack to structuredContent on a first call', () => {
    const out = withStarterPack(res(), 'get_grid_scoreboard', sid());
    expect(out.structuredContent.starter_pack).toBeTruthy();
    expect(out.structuredContent.starter_pack.call).toBe('execute_plan');
    expect(out.structuredContent.starter_pack.recipes).toHaveLength(5);
  });

  it('every recipe is a literal runnable intent, not a description', () => {
    const { recipes } = withStarterPack(res(), 'x', sid()).structuredContent.starter_pack;
    for (const r of recipes) {
      expect(typeof r.intent).toBe('string');
      expect(r.intent.length).toBeGreaterThan(20);
      // an intent is a QUESTION to pass through, so it must not name our tools
      expect(r.intent).not.toMatch(/execute_plan|plan_query|get_[a-z_]+/);
    }
  });

  it("covers Perplexity's five high-intent recipes", () => {
    const { recipes } = withStarterPack(res(), 'x', sid()).structuredContent.starter_pack;
    const names = recipes.map((r) => r.recipe);
    for (const want of ['market_selection', 'grid_and_queue', 'site_analysis',
                        'fiber_power_pairing', 'compare_markets']) {
      expect(names).toContain(want);
    }
  });

  it('adds prose too — most hosts render content[], not structuredContent', () => {
    const out = withStarterPack(res(), 'x', sid());
    const txt = out.content.map((c) => c.text).join(' ');
    expect(txt).toContain('execute_plan');
    expect(txt).toContain('rank markets for a 200 MW AI campus');
  });
});

describe('withStarterPack — safety', () => {
  it('fires at most once per session', () => {
    const c = sid();
    const first = withStarterPack(res(), 'x', c);
    const second = withStarterPack(res(), 'x', c);
    expect(first.structuredContent.starter_pack).toBeTruthy();
    expect(second.structuredContent.starter_pack).toBeUndefined();
  });

  it('skips when there is no session id, rather than spamming every call', () => {
    // No id to dedupe on means we cannot bound the cost — the safe default is
    // silence, not a pack on every single response.
    const out = withStarterPack(res(), 'x', {});
    expect(out.structuredContent.starter_pack).toBeUndefined();
  });

  it('does not duplicate the execute_plan explanation already in the response', () => {
    const r = res({ content: [{ type: 'text', text: 'call `execute_plan` first' }] });
    const out = withStarterPack(r, 'x', sid());
    // structured pack still attaches (it carries the recipes, which the
    // front-door nudge does not) but the prose is not repeated
    expect(out.structuredContent.starter_pack).toBeTruthy();
    expect(out.content).toHaveLength(1);
  });

  it('never touches an error response', () => {
    const out = withStarterPack(res({ isError: true }), 'x', sid());
    expect(out.structuredContent.starter_pack).toBeUndefined();
  });

  it('is fail-soft on a malformed result', () => {
    expect(() => withStarterPack(null, 'x', sid())).not.toThrow();
    expect(() => withStarterPack({}, 'x', sid())).not.toThrow();
    expect(() => withStarterPack(res({ content: 'not-an-array' }), 'x', sid())).not.toThrow();
  });

  it('honours the kill switch', () => {
    const prev = process.env.DCHUB_STARTER_PACK;
    process.env.DCHUB_STARTER_PACK = '0';
    try {
      expect(withStarterPack(res(), 'x', sid()).structuredContent.starter_pack).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.DCHUB_STARTER_PACK;
      else process.env.DCHUB_STARTER_PACK = prev;
    }
  });
});

describe('withStarterPack — WIRING (the part that made the old nudge reach nobody)', () => {
  // The 07-21 front-door nudge was applied only on the CLEAN full-data return.
  // Every anonymous/trial/preview path returns earlier and exits the handler, so
  // the nudge never ran for them — verified live 2026-07-28. These assertions
  // pin the fix at the OUTERMOST callback, where all return paths have merged.
  it('is applied at the registerTool callback, not on one inner return', () => {
    const m = SRC.match(/}\s*,\s*async \(args, extra\) => withStarterPack\(/);
    expect(m, 'withStarterPack must wrap the registerTool callback').toBeTruthy();
  });

  it('wraps the fully-processed result, so it sees every return path', () => {
    expect(SRC).toMatch(/withStarterPack\(\s*_scrubCommerce\(_ensureStructured\(await _stamped/);
  });

  it('is NOT attached beside withFrontDoorNudge on the clean-only path', () => {
    // If it were, it would inherit exactly the reachability bug it exists to fix.
    //
    // ★ Anchored on the CHAIN, not on `return ` (2026-08-05). The pattern used
    //   to require the literal "return withReturnNudge(", so adding ANY outer
    //   wrapper at the chokepoint made the match null and the test failed with
    //   "expected null to be truthy" — a failure that says nothing about
    //   withStarterPack, which is the only thing this test is about. The
    //   assertion below is unchanged and still the whole point.
    const cleanReturn = SRC.match(/withReturnNudge\(withCookbookHint\(withFrontDoorNudge\([^\n]*/);
    expect(cleanReturn).toBeTruthy();
    expect(cleanReturn[0]).not.toContain('withStarterPack');
  });
});

describe('starter pack prose ordering (Perplexity, 07-28)', () => {
  it('leads each line with the RECIPE NAME, not the question', () => {
    const out = withStarterPack(res(), 'get_grid_scoreboard', sid());
    const line = out.content.map((c) => c.text).join('\n')
      .split('\n').find((l) => l.includes('market_selection'));
    expect(line).toBeTruthy();
    // action before paraphrase — survives client truncation of long blocks
    expect(line.indexOf('market_selection')).toBeLessThan(line.indexOf('execute_plan'));
    expect(line.indexOf('execute_plan')).toBeLessThan(line.indexOf('rank markets'));
  });
});
