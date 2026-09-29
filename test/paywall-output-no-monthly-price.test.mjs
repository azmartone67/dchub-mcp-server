// paywall-output-no-monthly-price.test.mjs — runtime paywall text names no
// monthly plan price; the frozen unlock_more_data DESCRIPTION does not move.
//
// ★2026-09-28 (owner rule 09-27: the only price DC Hub states is the $10 pack).
// _paidPlansLine() rendered "Developer $49/mo · Pro $99/mo" into BOTH the
// unlock_more_data tool description and the auto-mint envelope's
// upgrade_instructions (buildAutoMintBlock). The description is frozen: /mcp
// tools/list stays byte-identical until 2026-10-02
// (test/claude-directory-catalog.test.mjs) and reaches /mcp/chatgpt
// (frz-chatgpt-toolset). So the line is split:
//   _paidPlansOutputLine() — OUTPUT, "Paid plans: https://dchub.cloud/pricing"
//   _paidPlansLine()       — the description only, byte-identical
//
// SCOPE, stated so nobody reads more into a green run: other runtime strings
// still quote "$99/mo" / "$49/mo" through _priceLabel() — the paywall-contract
// relay arms ("… or Pro at $99/mo"), _rungsText / _ladderText, pro_hint, the
// compare_sites Pro wall, the claim_free_key monitor line. Those sit in the
// Claude relay wording frozen until the 2026-10-01 readout
// (frz-claude-relay-wording) and move with it; they are listed in the PR, and
// the ratchet below fails if the number of such call sites GROWS.
//
// Hard-gate qualified: real server on 127.0.0.1 against a local stub, network
// fenced, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { _paidPlansLine, _paidPlansOutputLine, PRICING_URL } from '../lib/tier-canon.mjs';
import { startHarness, fenceNetwork, GUESS_ARGS } from './helpers/claude-directory-harness.mjs';

const MONTHLY = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|month)\b|per month|a month)/i;
const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'));
// Code lines only: comment lines and trailing `// …` tails are history, not claims.
const CODE = SRC.split('\n').map((l, i) => [i + 1, l])
  .filter(([, l]) => !/^\s*(\/\/|\/\*|\* )/.test(l))
  .map(([n, l]) => [n, l.replace(/\s\/\/.*$/, '')]);

// 27 code lines on 2026-09-28, the same on origin/main (this change touches no
// _priceLabel site). Lower it when a frozen relay line moves after 10-01.
const PRICE_LABEL_SITES_CEILING = 27;

let H, fence;
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness(); });
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('the output line', () => {
  it('points at the pricing page and states no monthly price', () => {
    expect(_paidPlansOutputLine()).toBe('Paid plans: ' + PRICING_URL);
    expect(PRICING_URL).toBe('https://dchub.cloud/pricing');
    expect(_paidPlansOutputLine()).not.toMatch(MONTHLY);
  });

  it('CONTROL: the description variant still carries the monthly prices (so the pattern can fail)', () => {
    expect(_paidPlansLine()).toMatch(MONTHLY);
  });
});

describe('_paidPlansLine is description-only', () => {
  it('server.mjs calls it exactly once, inside the unlock_more_data description', () => {
    const calls = CODE.filter(([, l]) => /_paidPlansLine\(\)/.test(l));
    expect(calls.map(([n]) => n)).toHaveLength(1);
    expect(calls[0][1]).toContain("Unlock DC Hub\\'s full depth.");
  });

  it('the upgrade_instructions both read the output line', () => {
    const lines = CODE.filter(([, l]) => /Have the human open upgrade_url and complete checkout/.test(l));
    expect(lines).toHaveLength(2);
    for (const [, l] of lines) {
      expect(l).toContain('_paidPlansOutputLine()');
      expect(l).not.toContain('_paidPlansLine()');
    }
  });

  // Ratchet, not a fix: the frozen relay copy still prices through _priceLabel.
  // A NEW runtime call site must fail here; removing one lowers the ceiling.
  it('runtime _priceLabel( call sites in server.mjs do not grow', () => {
    const n = CODE.filter(([, l]) => /_priceLabel\(/.test(l)).length;
    expect(n).toBeLessThanOrEqual(PRICE_LABEL_SITES_CEILING);
  });
});

describe('tool OUTPUT on the _paidPlansLine path', () => {
  it.each(['get_grid_intelligence', 'get_market_intel', 'rank_markets'])(
    '%s auto-mint upgrade_instructions: pricing link, no $49/mo or $99/mo', async (tool) => {
      const prev = process.env.MCP_ENVELOPE_COLLAPSE;
      process.env.MCP_ENVELOPE_COLLAPSE = '0';   // keep upgrade_instructions in the payload
      try {
        const r = await H.call('/mcp', tool, GUESS_ARGS[tool] || {});
        const sc = r.msg?.result?.structuredContent || {};
        const found = JSON.stringify(sc).match(/"upgrade_instructions":"((?:[^"\\]|\\.)*)"/);
        expect(found, `${tool}: no upgrade_instructions — the path under test did not run`).toBeTruthy();
        const text = JSON.parse('"' + found[1] + '"');
        expect(text).toContain('Paid plans: https://dchub.cloud/pricing');
        expect(text).not.toMatch(/\$49\/mo|\$99\/mo/);
        expect(text).not.toMatch(MONTHLY);
      } finally {
        if (prev === undefined) delete process.env.MCP_ENVELOPE_COLLAPSE; else process.env.MCP_ENVELOPE_COLLAPSE = prev;
      }
    });
});

describe('tools/list did not move', () => {
  it('/mcp unlock_more_data description is byte-identical to the committed manifest (still quotes the plans line)', async () => {
    const tools = (await H.list('/mcp')).msg.result.tools;
    const live = tools.find((t) => t.name === 'unlock_more_data').description;
    const committed = MANIFEST.tools.find((t) => t.name === 'unlock_more_data').description;
    expect(live).toBe(committed);
    expect(live).toContain('Also ' + _paidPlansLine() + '.');
  });
});
