// r-mpp-phantom (2026-08-18): MPP_PRICE named two tools that do not exist.
//
// MPP_COVERED_TOOLS is derived from MPP_PRICE's keys and is published to
// agents in two places — `_wallMachinePay()` and unlock_more_data's
// machine_pay block — under a note that reads "The tools in covered_tools ARE
// [payable] — if one of them ...". So a phantom key is not inert: it hands an
// agent that has just hit the paywall a re-route to a tool that returns
// unknown-tool. A dead end offered at the exact moment the agent was willing
// to pay.
//
//   get_site_capacity_report — zero occurrences in server.mjs
//   get_developer_brief      — server.mjs:5587 already said in a COMMENT that
//                              it "does not exist"
//
// Both were advertised from 2026-06-21 (f845d94) until 2026-08-18. A comment
// noting the tool is missing did not stop it being sold; only a build failure
// does. Live probe 2026-08-18: tools/list serves 82 tools and 6 declare
// mpp_pay — exactly the exposed members of the 8-entry price table.
//
// Same family as r-mpp-arg-channel: the declaration and the reader lived
// apart, so nothing tied the claim to the thing it claimed about.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MPP_COVERED_TOOLS } from '../mpp-hook.mjs';

// The registration call IS the inventory — read the source rather than
// transcribing a list that would drift the same way the price table did.
// (Same extraction as test/discovery-coverage.test.mjs.)
const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const REGISTERED = [...SRC.matchAll(/^\s*trackedTool\(srv, '([a-z_0-9]+)'/gm)].map(m => m[1]);

describe('MPP covered tools are real tools', () => {
  it('reads a plausible registration inventory (guard against a broken regex)', () => {
    // A regex that silently matched nothing would make the assertion below
    // pass vacuously — the empty-parse-passes-all trap.
    expect(REGISTERED.length).toBeGreaterThan(70);
    expect(REGISTERED).toContain('analyze_site');
    expect(new Set(REGISTERED).size).toBe(REGISTERED.length);
  });

  it('reads a non-empty covered list', () => {
    // Likewise: an empty MPP_COVERED_TOOLS would satisfy "every element is
    // registered" for free.
    expect(MPP_COVERED_TOOLS.length).toBeGreaterThan(3);
  });

  it('every covered tool is actually registered', () => {
    const registered = new Set(REGISTERED);
    const phantom = MPP_COVERED_TOOLS.filter(t => !registered.has(t));
    expect(
      phantom,
      `MPP_PRICE names tools that are not registered in server.mjs, and `
      + `covered_tools is published to agents at the paywall as a re-route `
      + `target: ${phantom.join(', ')}. Price a tool when it ships, not before.`,
    ).toEqual([]);
  });

  it('does not re-admit the two phantoms by name', () => {
    // Belt and braces: the generic check above is the real guard, but these
    // two specific names were live for two months and are the ones most
    // likely to be pasted back in from an old branch or an old doc.
    expect(MPP_COVERED_TOOLS).not.toContain('get_site_capacity_report');
    expect(MPP_COVERED_TOOLS).not.toContain('get_developer_brief');
  });

  it('still covers the flagship value-moment tools', () => {
    // The fix must not have shrunk the rail past the tools it was extended
    // onto in r-mpp-flagships (2026-06-28).
    for (const t of ['analyze_site', 'compare_sites', 'site_selection_canvas',
      'get_grid_intelligence', 'get_fiber_intel', 'get_market_intel']) {
      expect(MPP_COVERED_TOOLS).toContain(t);
    }
  });
});
