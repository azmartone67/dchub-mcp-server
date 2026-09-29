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
// ★2026-10 relay batch (frz-claude-relay-wording lifted after the 10-01
// readout): the runtime strings that still priced through _priceLabel() — the
// paywall-contract relay arms ("on DC Hub Pro, $99/mo"), _rungsText /
// _subRungText / _ladderText, the unlock_more_data plan labels, pro_hint, the
// Land & Power / compare_sites Pro wall, the claim_free_key monitor line, the
// depth-tease and quota walls and the auto-mint `pricing` block — now name
// and link a plan without pricing it. The ratchet is 0: no runtime
// _priceLabel( call site may come back, and the sweep below calls EVERY /mcp
// tool in six caller contexts and fails on any monthly price in the output.
//
// SCOPE: tools/list (the unlock_more_data description) and the /mcp
// initialize instructions still carry "$49/mo"; they are byte-frozen until
// 2026-10-02T00:00Z and move in the stacked 10-02 PR, which extends this guard
// to them. The sweep therefore reads tools/call output only.
//
// Hard-gate qualified: real server on 127.0.0.1 against a local stub, network
// fenced, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { _paidPlansLine, _paidPlansOutputLine, PRICING_URL } from '../lib/tier-canon.mjs';
import { startHarness, fenceNetwork, GUESS_ARGS, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const MONTHLY = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|month)\b|per month|a month)/i;
const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'));
// Code lines only: comment lines and trailing `// …` tails are history, not claims.
const CODE = SRC.split('\n').map((l, i) => [i + 1, l])
  .filter(([, l]) => !/^\s*(\/\/|\/\*|\* )/.test(l))
  .map(([n, l]) => [n, l.replace(/\s\/\/.*$/, '')]);

// 27 code lines on 2026-09-28; 1 after the 10-01 relay batch — the /mcp
// initialize instructions (_INSTR_TAIL), byte-frozen until 2026-10-02 and moved
// by the stacked 10-02 PR. Every runtime (tools/call) site is gone.
const PRICE_LABEL_SITES_CEILING = 1;
// The fake backend PLANTS this sentence in every data response (it is backend
// data passed through, not a string this server writes). The sweep strips it
// and a control asserts it really is present, so the strip hides nothing else.
const PLANTED_BACKEND_NOTE = 'Rows 4-12 come with the $10 pack or Pro at $99/mo. Upgrade to Pro now.';
const FREE_KEY = 'dch_live_FREEsweepKey0123456789abcdef';

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
  it('runtime _priceLabel( call sites in server.mjs: only the frozen instructions line is left', () => {
    const sites = CODE.filter(([, l]) => /_priceLabel\(/.test(l));
    expect(sites.length).toBeLessThanOrEqual(PRICE_LABEL_SITES_CEILING);
    for (const [n, l] of sites) expect(l, `server.mjs:${n}`).toMatch(/^const _INSTR_TAIL = /);
  });

  it('_subRungText names a plan without pricing it (and still drops a rung the canon does not carry)', () => {
    const body = SRC.slice(SRC.indexOf('function _subRungText('), SRC.indexOf('const _PACK_RUNG'));
    expect(body).toContain('_planOnLadder(plan)');
    expect(body).not.toMatch(/_priceLabel|PLAN_PRICE|_usd_month/);
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

// Every /mcp tool, six caller contexts: anonymous; anonymous in the paywall
// contract (the relay arms); a free key; a free key in the contract; a Pro key;
// envelope collapse off (keeps upgrade_* fields). Output only — see SCOPE.
describe('tools/call OUTPUT: no monthly price on any /mcp tool', () => {
  const CONTEXTS = [
    ['anonymous', {}, {}],
    ['anonymous, paywall contract', {}, { DCHUB_PAYWALL_CONTRACT: 'on' }],
    ['free key', { 'x-api-key': FREE_KEY }, {}],
    ['free key, paywall contract', { 'x-api-key': FREE_KEY }, { DCHUB_PAYWALL_CONTRACT: 'on' }],
    ['pro key', { 'x-api-key': PRO_KEY }, {}],
    ['envelope collapse off', {}, { MCP_ENVELOPE_COLLAPSE: '0' }],
  ];
  let TOOLS = [];
  const seen = { plant: 0, calls: 0, relayArm: 0, walls: 0 };
  beforeAll(async () => { TOOLS = (await H.list('/mcp')).msg.result.tools.map((t) => t.name); });

  it.each(CONTEXTS)('%s', async (_label, headers, env) => {
    const prev = {};
    for (const [k, v] of Object.entries(env)) { prev[k] = process.env[k]; process.env[k] = v; }
    const offenders = [];
    try {
      for (const name of TOOLS) {
        if (/^delete_/.test(name)) continue;
        const r = await H.call('/mcp', name, GUESS_ARGS[name] || { ...GUESS_ARGS }, headers);
        const body = String(r.body || '');
        seen.calls++;
        if (body.includes(PLANTED_BACKEND_NOTE)) seen.plant++;
        if (/on DC Hub Pro/.test(body)) seen.relayArm++;
        if (/\/go\/c\/|\/upgrade\/h\//.test(body)) seen.walls++;
        const m = body.split(PLANTED_BACKEND_NOTE).join('').match(MONTHLY);
        if (m) {
          const i = body.split(PLANTED_BACKEND_NOTE).join('').indexOf(m[0]);
          offenders.push(`${name}: …${body.split(PLANTED_BACKEND_NOTE).join('').slice(Math.max(0, i - 80), i + m[0].length)}`);
        }
      }
    } finally {
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    expect(offenders).toEqual([]);
  }, 300_000);

  // Non-vacuity: the sweep reached tools, walls and the relay arms, and the
  // one thing it strips is the fixture's own sentence.
  it('CONTROL: the sweep ran every tool, hit paywalls and the Pro relay arm, and the stripped note is the planted one', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(90);
    expect(seen.calls).toBeGreaterThanOrEqual(CONTEXTS.length * 85);
    expect(seen.walls).toBeGreaterThan(50);
    expect(seen.relayArm).toBeGreaterThan(0);
    expect(seen.plant).toBeGreaterThan(0);
    expect(PLANTED_BACKEND_NOTE).toMatch(MONTHLY);
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
