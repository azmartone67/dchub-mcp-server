// wall-exits.test.mjs — r-mpp-at-wall + r-relay-render (2026-08-10)
//
// THE LEAK THIS GUARDS
// Post-fix conversion window (the single-use-token race was fixed 2026-07-30,
// so this window is clean of it):
//
//     paywall hit 263 → high-intent 136 → relay minted 131 → HUMAN ACTED 0
//
// 131 relays minted, zero opened. Two separate things were wrong at the wall,
// and neither is the token:
//
//  1. THE RELAY WAS THE ONLY EXIT. We run a live Stripe MPP rail — $0.50/call,
//     no human, `recommended: "mpp"` — but it was reachable only from
//     unlock_more_data, a tool an agent must first be told to call. At a
//     generic wall an agent saw human checkout links and nothing else. Seven
//     external agent reviews in 2026-08 discussed our funnel at length and not
//     one mentioned MPP existed.
//
//  2. THE RELAY WAS SUMMARIZABLE. `for_your_human` was {message, url} with
//     nothing marking it non-summarizable — and summarizing tool output is the
//     default behaviour of every client we reach. "I hit a paywall, you'll
//     need to upgrade" is a faithful summary that destroys the only artifact
//     that mattered. The human never sees a link, so human_acted cannot fire.
//
// These tests are about the SHAPE of the exits at the wall. They do not claim
// the conversion moved — that is measured post-deploy, not asserted here.
// _wallMachinePay and buildHumanRelay are module-internal and buildHumanRelay
// needs a signing secret to mint, so these assert the SOURCE contract rather
// than importing server.mjs (which boots a listener) or requiring
// DCHUB_INTERNAL_KEY in CI. Source assertions are the right grain here: what
// broke was the SHAPE of the two exits, and a refactor that drops either block
// fails these loudly.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MPP_COVERED_TOOLS } from '../mpp-hook.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const slice = (from, to) => SRC.slice(SRC.indexOf(from), SRC.indexOf(to));

describe('MPP coverage list has ONE source', () => {
  it('exports the covered tools from the rail itself', () => {
    expect(Array.isArray(MPP_COVERED_TOOLS)).toBe(true);
    expect(MPP_COVERED_TOOLS.length).toBeGreaterThan(0);
    // The 8 tools the sidecar prices. If this list grows, it must grow in
    // MPP_PRICE — which is the point of exporting it.
    expect(MPP_COVERED_TOOLS).toContain('analyze_site');
    expect(MPP_COVERED_TOOLS).toContain('site_selection_canvas');
    expect(MPP_COVERED_TOOLS).toContain('get_grid_intelligence');
  });

  it('is frozen, so no consumer can mutate what agents are told is payable', () => {
    expect(Object.isFrozen(MPP_COVERED_TOOLS)).toBe(true);
  });

  it('no longer has a hand-maintained duplicate in server.mjs', () => {
    const src = SRC;
    // The old literal array. Its return would mean the list an agent is shown
    // can drift from the list the sidecar will actually accept.
    expect(src).not.toMatch(/covered_tools:\s*\[\s*'get_grid_intelligence'/);
    expect(src).toMatch(/covered_tools:\s*MPP_COVERED_TOOLS/);
  });
});

describe('relay render directive (r-relay-render)', () => {
  // buildHumanRelay needs DCHUB_INTERNAL_KEY to mint; assert on the source
  // contract so the test does not depend on a signing secret in CI.
  it('the relay artifact carries an explicit non-summarize directive', () => {
    const fn = SRC.slice(SRC.indexOf('function buildHumanRelay'),
                         SRC.indexOf('function buildHumanRelay') + 3000);
    expect(fn).toContain('render:');
    expect(fn).toContain('verbatim_link_required');
    expect(fn).toContain('_agent_instruction');
    // A pre-built markdown string is the cheapest correct action a model can
    // take — it can emit it with zero construction.
    expect(fn).toContain('markdown:');
    expect(fn).toMatch(/markdown: '\[.*\]\(' \+ _url \+ '\)'/);
  });

  it('keeps message and url intact for existing consumers', () => {
    const fn = SRC.slice(SRC.indexOf('function buildHumanRelay'),
                         SRC.indexOf('function buildHumanRelay') + 3000);
    // Purely additive: the two fields every current reader depends on must
    // keep their exact names. human_acted v2 reads the link's own open stamp,
    // so `url` in particular must not move.
    expect(fn).toMatch(/message: 'Your AI assistant hit DC Hub/);
    expect(fn).toMatch(/url: _url,/);
  });

  it('does NOT re-split the token — one artifact, one url', () => {
    const fn = SRC.slice(SRC.indexOf('function buildHumanRelay'),
                         SRC.indexOf('function buildHumanRelay') + 3000);
    // The 2026-07-30 fix already separated agent token from human url. This
    // change must not add a second mint or a second signature.
    expect((fn.match(/createHmac/g) || []).length).toBe(1);
    expect((fn.match(/upgrade\/h\//g) || []).length).toBe(1);
  });
});

describe('machine_pay at the wall (r-mpp-at-wall)', () => {
  it('is emitted beside for_your_human, not only from unlock_more_data', () => {
    const src = SRC;
    expect(src).toContain('const machine_pay = _wallMachinePay(toolName);');
    // Ordered before the human relay in the returned envelope.
    const idx = src.indexOf('...(machine_pay ? { machine_pay } : {}),');
    const idxHuman = src.indexOf('...(for_your_human ? { for_your_human } : {}),');
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(idxHuman);
  });

  it('never claims a non-covered tool is machine_payable', () => {
    const fn = slice('function _wallMachinePay', 'function buildHumanRelay');
    // machine_payable is derived from isMppTool, never hardcoded true — the
    // difference between routing an agent and lying to it.
    expect(fn).toContain('const payable = isMppTool(toolName);');
    expect(fn).toContain('machine_payable: payable,');
    expect(fn).not.toMatch(/machine_payable:\s*true/);
    // And price/how are null rather than misleading when it cannot be paid.
    expect(fn).toContain('price_usd: payable ?');
    expect(fn).toContain('how: payable ?');
  });

  it('tells an agent at an uncovered wall which tools ARE payable', () => {
    const fn = slice('function _wallMachinePay', 'function buildHumanRelay');
    expect(fn).toContain('covered_tools: MPP_COVERED_TOOLS');
    expect(fn).toContain('NOT on the per-call rail');
  });

  it('stays dark when the rail is off', () => {
    const fn = slice('function _wallMachinePay', 'function buildHumanRelay');
    // No MPP_ENABLED → no block at all, rather than a block advertising a rail
    // that cannot take payment.
    expect(fn).toContain('if (!mppEnabled()) return undefined;');
  });

  it('never breaks an envelope', () => {
    const fn = slice('function _wallMachinePay', 'function buildHumanRelay');
    expect(fn).toMatch(/catch \(_e\) \{ return undefined; \}/);
  });
});
