// pack-buys-depth.test.mjs — 2026-10-29 (owner: "pack buys full answers").
//
// Behind DCHUB_PACK_BUYS_DEPTH (default OFF) a credit may pay for one full answer on a decision
// tool or a depth-tease tool, at DCHUB_PACK_DEPTH_CREDITS credits per answer (default 20, so a
// $10 pack = 50 full answers; at the normal 1 credit a pack would buy ~1,000 full answers and
// make the Developer plan pointless). Pins: off is the 10-08 canon exactly; on opens only the
// tools it should; Pro-only, Land & Power and the directory / Claude / core profiles stay out;
// and the cost the cascade charges is the cost the flag sets.
//
// Qualifies for the hard gate: the only socket is a 127.0.0.1 stub the import points at.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
import { CLAUDE_PROFILE } from '../lib/claude-directory.mjs';
import { CORE_PROFILE } from '../lib/core-profile.mjs';

let S, stub, prevBase, prevFlag, prevCredits;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevFlag = process.env.DCHUB_PACK_BUYS_DEPTH;
  prevCredits = process.env.DCHUB_PACK_DEPTH_CREDITS;
  delete process.env.DCHUB_PACK_BUYS_DEPTH;
  delete process.env.DCHUB_PACK_DEPTH_CREDITS;
  S = await import('../server.mjs');
});

afterEach(() => {
  delete process.env.DCHUB_PACK_BUYS_DEPTH;
  delete process.env.DCHUB_PACK_DEPTH_CREDITS;
});

afterAll(async () => {
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevFlag !== undefined) process.env.DCHUB_PACK_BUYS_DEPTH = prevFlag;
  if (prevCredits !== undefined) process.env.DCHUB_PACK_DEPTH_CREDITS = prevCredits;
  await new Promise((r) => stub.close(r));
});

const DECISION = 'get_interconnection_queue';   // a decision tool (preview-only) and a 5-credit tool
const DEPTH = 'list_transactions';              // a depth-tease tool
const RATIONED = 'hyperscaler_deals';           // a rationed paid-class tool the pack always bought

describe('flag off: the 2026-10-08 canon, unchanged', () => {
  it('is off by default and parses like the other switches', () => {
    expect(S._packBuysDepthOn({})).toBe(false);
    expect(S._packBuysDepthOn({ DCHUB_PACK_BUYS_DEPTH: '0' })).toBe(false);
    expect(S._packBuysDepthOn({ DCHUB_PACK_BUYS_DEPTH: '' })).toBe(false);
    for (const v of ['1', 'true', 'yes', 'on', 'ON']) expect(S._packBuysDepthOn({ DCHUB_PACK_BUYS_DEPTH: v })).toBe(true);
  });
  it('the pack opens neither a decision tool nor a depth-tease tool, and still opens the rationed one', () => {
    expect(S._packOpensTool(DECISION)).toBe(false);
    expect(S._packOpensTool(DEPTH)).toBe(false);
    expect(S._packOpensTool(RATIONED)).toBe(true);
  });
  it('a credit costs what it always did', () => {
    expect(S._creditCost(DECISION)).toBe(5);
    expect(S._creditCost(DEPTH)).toBe(1);
    expect(S._creditCost(RATIONED)).toBe(1);
  });
});

describe('flag on', () => {
  it('the pack opens a decision tool and a depth-tease tool', () => {
    process.env.DCHUB_PACK_BUYS_DEPTH = '1';
    expect(S._packOpensTool(DECISION)).toBe(true);
    expect(S._packOpensTool(DEPTH)).toBe(true);
    expect(S._packOpensTool(RATIONED)).toBe(true);   // control: unchanged
  });
  it('one such answer costs DCHUB_PACK_DEPTH_CREDITS (default 20); other tools keep their cost', () => {
    process.env.DCHUB_PACK_BUYS_DEPTH = '1';
    expect(S._creditCost(DECISION)).toBe(20);
    expect(S._creditCost(DEPTH)).toBe(20);
    expect(S._creditCost(RATIONED)).toBe(1);
    process.env.DCHUB_PACK_DEPTH_CREDITS = '10';
    expect(S._creditCost(DECISION)).toBe(10);
  });
  it('a bad credit value falls back to 20, never to 1 or to a free answer', () => {
    for (const bad of ['0', '-3', 'abc', '2.5', '5000', '']) {
      expect(S._packDepthCredits({ DCHUB_PACK_DEPTH_CREDITS: bad })).toBe(20);
    }
    expect(S._packDepthCredits({ DCHUB_PACK_DEPTH_CREDITS: '40' })).toBe(40);
  });
  // The explicit Pro-only / Land & Power exclusion in _packDepthTool is defence in depth: no tool is in
  // both those sets and the decision / depth-tease sets today, so no input can exercise it alone
  // (a mutation that drops it survives). This pins the outcome, which is what must not change.
  it('a Pro-only tool and a Land & Power tool stay closed to the pack', () => {
    process.env.DCHUB_PACK_BUYS_DEPTH = '1';
    for (const t of ['analyze_site', 'compare_sites', 'get_dchub_recommendation', 'export_dataset', 'get_composite_site_score']) {
      expect(S._packOpensTool(t), t).toBe(false);
    }
  });
  it('the over-cap coaching sells the pack only where the pack now buys a full answer', () => {
    // off: the 10-08 canon, a decision / depth-tease tool never sells the pack and says it does not deepen
    expect(S._capCoachSellsPack(DECISION)).toBe(false);
    expect(S._capCoachSellsPack(DEPTH)).toBe(false);
    expect(S._capCoachSellsPack(RATIONED)).toBe(true);
    process.env.DCHUB_PACK_BUYS_DEPTH = '1';
    expect(S._capCoachSellsPack(DECISION)).toBe(true);
    expect(S._capCoachSellsPack(DEPTH)).toBe(true);
    expect(S._capCoachSellsPack(RATIONED)).toBe(true);
    // never for a Pro-only tool or on a directory profile, which keep their own commerce rules
    expect(S._capCoachSellsPack('analyze_site')).toBe(false);
    expect(S._capCoachSellsPack(DECISION, { profile: DIRECTORY_PROFILE })).toBe(false);
  });
  it('a tool that is not paid-class is not touched', () => {
    process.env.DCHUB_PACK_BUYS_DEPTH = '1';
    expect(S._packDepthTool('search')).toBe(false);
    expect(S._packDepthTool('claim_free_key')).toBe(false);
    expect(S._packDepthTool('')).toBe(false);
  });
  it('the directory, Claude and core profiles are never opened, and keep their old cost', () => {
    process.env.DCHUB_PACK_BUYS_DEPTH = '1';
    for (const profile of [DIRECTORY_PROFILE, CLAUDE_PROFILE, CORE_PROFILE]) {
      expect(S._packOpensTool(DECISION, { profile }), profile).toBe(false);
      expect(S._packOpensTool(DEPTH, { profile }), profile).toBe(false);
      expect(S._creditCost(DECISION, { profile }), profile).toBe(5);
    }
    // the control: the same call on the plain profile is open
    expect(S._packOpensTool(DECISION, { profile: undefined })).toBe(true);
  });
});
