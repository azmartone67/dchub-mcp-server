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
// ★2026-10-02 catalog batch (the /mcp tools/list + instructions byte freeze
// ended 2026-10-02T00:00Z): the unlock_more_data DESCRIPTION ("Also Developer
// $49/mo · Pro $99/mo.") and the /mcp initialize instructions ("— or Developer
// $49/mo") now read _paidPlansOutputLine(), and _priceLabel() / _paidPlansLine()
// are retired from lib/tier-canon.mjs. The guard now covers every surface an
// agent reads: tools/call output (the sweep), tools/list and initialize on
// every profile path, and the committed manifests the registries mirror.
//
// Hard-gate qualified: real server on 127.0.0.1 against a local stub, network
// fenced, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import * as TC from '../lib/tier-canon.mjs';
import { _paidPlansOutputLine, PRICING_URL } from '../lib/tier-canon.mjs';
import { startHarness, fenceNetwork, GUESS_ARGS, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const MONTHLY = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|month)\b|per month|a month)/i;
const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'));
// Code lines only: comment lines and trailing `// …` tails are history, not claims.
const CODE = SRC.split('\n').map((l, i) => [i + 1, l])
  .filter(([, l]) => !/^\s*(\/\/|\/\*|\* )/.test(l))
  .map(([n, l]) => [n, l.replace(/\s\/\/.*$/, '')]);

// 27 code lines on 2026-09-28; 1 after the 10-01 relay batch (the frozen
// instructions); 0 after the 10-02 catalog batch, and the helper is retired.
const PRICE_LABEL_SITES_CEILING = 0;
// Every path that serves a tools/list or an initialize. /mcp/chatgpt is frozen
// for the OpenAI review (frz-chatgpt-toolset) and untouched here — it is READ,
// so a monthly price arriving there fails too.
const PROFILE_PATHS = ['/mcp', '/mcp/anthropic', '/mcp/claude', '/mcp/chatgpt', '/mcp/registry', '/mcp/grok'];
// The fake backend PLANTS this sentence in every data response (it is backend
// data passed through, not a string this server writes). The sweep strips it
// and a control asserts it really is present, so the strip hides nothing else.
const PLANTED_BACKEND_NOTE = 'Rows 4-12 come with the $10 pack or Pro at $99/mo. Upgrade to Pro now.';
const FREE_KEY = 'dch_live_FREEsweepKey0123456789abcdef';

let H, fence;
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness(); });
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('the output line', () => {
  it('points at the human_url link (never a pricing page) and states no monthly price', () => {
    // r-relay-contract (2026-10-06): no gate output names a pricing page; the unlock is human_url.
    expect(_paidPlansOutputLine()).toBe('Paid plans: on the page behind the human_url link');
    expect(_paidPlansOutputLine()).not.toMatch(/pricing|plans\//i);
    expect(PRICING_URL).toBe('https://dchub.cloud/pricing');
    expect(_paidPlansOutputLine()).not.toMatch(MONTHLY);
  });

  it('CONTROL: the pattern fires on the forms that shipped (so a clean read means absent)', () => {
    for (const x of ['Developer $49/mo · Pro $99/mo', '— or Developer $49/mo', 'on DC Hub Pro, $99/mo with',
      '"upgrade_price":"$99/mo"', '$49 per month', '$99 / month']) expect(x, x).toMatch(MONTHLY);
    for (const x of ['$10 one-time pack of 1,000 API credits', '$0.50 per call', '$0.50/call']) expect(x, x).not.toMatch(MONTHLY);
  });

  it('_priceLabel and _paidPlansLine are retired: nothing can render "$N/mo" from the canon', () => {
    expect(TC._priceLabel).toBeUndefined();
    expect(TC._paidPlansLine).toBeUndefined();
    expect(SRC).not.toMatch(/_priceLabel\b|_paidPlansLine\b/);
  });
});

describe('the plans line in server.mjs', () => {
  it('the unlock_more_data description and the /mcp instructions read the output line', () => {
    const desc = CODE.filter(([, l]) => l.includes("Unlock DC Hub\\'s full depth."));
    expect(desc).toHaveLength(1);
    expect(desc[0][1]).toContain("no subscription). ' + _paidPlansOutputLine() + '.");
    const instr = CODE.filter(([, l]) => /^const _INSTR_TAIL = /.test(l));
    expect(instr).toHaveLength(1);
    expect(instr[0][1]).toContain("' + _creditRuleText() + '; ' + _paidPlansOutputLine() + ') to relay");
  });

  it('the upgrade_instructions both read the output line', () => {
    const lines = CODE.filter(([, l]) => /Have the human open upgrade_url and complete checkout/.test(l));
    expect(lines).toHaveLength(2);
    for (const [, l] of lines) {
      expect(l).toContain('_paidPlansOutputLine()');
    }
  });

  // Ratchet, not a fix: the frozen relay copy still prices through _priceLabel.
  // A NEW runtime call site must fail here; removing one lowers the ceiling.
  it('no _priceLabel( call site in server.mjs code', () => {
    const sites = CODE.filter(([, l]) => /_priceLabel\(/.test(l));
    expect(sites.map(([n]) => n)).toHaveLength(PRICE_LABEL_SITES_CEILING);
  });

  it('_subRungText names a plan without pricing it (and still drops a rung the canon does not carry)', () => {
    const body = SRC.slice(SRC.indexOf('function _subRungText('), SRC.indexOf('const _PACK_RUNG'));
    expect(body).toContain('_planOnLadder(plan)');
    expect(body).not.toMatch(/_priceLabel|PLAN_PRICE|_usd_month/);
  });
});

describe('tool OUTPUT on the auto-mint path', () => {
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
        expect(text).toContain('Paid plans: on the page behind the human_url link');
        expect(text).not.toMatch(/dchub\.cloud\/(?:pricing|plans)/);
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

// ── tools/list + initialize: every profile path ─────────────────────────────
describe('tools/list and initialize: no monthly price on any profile path', () => {
  it.each(PROFILE_PATHS)('%s tools/list', async (p) => {
    const r = await H.list(p);
    expect(r.status, p).toBe(200);
    const tools = r.msg?.result?.tools || [];
    expect(tools.length, `${p}: empty tools/list — nothing was checked`).toBeGreaterThan(10);
    const bad = tools.filter((t) => MONTHLY.test(JSON.stringify(t)))
      .map((t) => `${t.name}: …${JSON.stringify(t).match(MONTHLY)[0]}`);
    expect(bad, p).toEqual([]);
    expect(r.body).not.toMatch(MONTHLY);
  });

  it.each(PROFILE_PATHS)('%s initialize instructions', async (p) => {
    const r = await H.init(p);
    const instr = r.msg?.result?.instructions;
    expect(typeof instr, `${p}: no instructions — nothing was checked`).toBe('string');
    expect(instr.length).toBeGreaterThan(100);
    expect(instr.match(MONTHLY), p).toBeNull();
    expect(r.body).not.toMatch(MONTHLY);
  });

  it('/mcp unlock_more_data description: the plans line, and it matches the committed manifest', async () => {
    const tools = (await H.list('/mcp')).msg.result.tools;
    const live = tools.find((t) => t.name === 'unlock_more_data').description;
    expect(live).toContain('no subscription). Paid plans: on the page behind the human_url link.');
    expect(live).not.toMatch(/dchub\.cloud\/(?:pricing|plans)/);
    // 2026-10-09: the tool description states no price (Grok listing sweep); the wall and the checkout page still do.
    expect(live).toContain('one-time 1,000 API credits');
    expect(live).not.toContain('$10');
    const committed = MANIFEST.tools.find((t) => t.name === 'unlock_more_data').description;
    expect(live).toBe(committed);
  });

  it('/mcp instructions keep the $10 pack and point at the pricing page', async () => {
    // 2026-10-06 (item 7): the pack line and plans pointer moved to the long form, served as the
    // resource dchub://instructions; the lean handshake states no price at all.
    const init = await H.init('/mcp');
    expect(init.msg.result.instructions).not.toMatch(/\$\d/);
    const sh = { 'mcp-session-id': init.headers.get('mcp-session-id') };
    await H.post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, sh);
    const instr = (await H.post('/mcp', { jsonrpc: '2.0', id: 77, method: 'resources/read',
      params: { uri: 'dchub://instructions' } }, sh)).msg.result.contents[0].text;
    expect(instr).toContain('💳 $10 one-time = 1,000 API credits');
    expect(instr).toContain('; Paid plans: on the page behind the human_url link) to relay to your human');
    expect(instr).not.toMatch(/dchub\.cloud\/(?:pricing|plans)/);
  });
});

// ── the committed manifests the registries and packs mirror ─────────────────
describe('committed tool manifests: no monthly price', () => {
  const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const PACKS = ['deals', 'fiber', 'gas', 'grid', 'site', 'siting', 'deepresearch']
    .flatMap((n) => [`integrations/packs/${n}.json`, `integrations/packs/${n}.managed-agent.json`]);
  it.each(['toolspec.json', 'mcp-server.json', 'dxt/manifest.json', ...PACKS])('%s', (f) => {
    let txt;
    try { txt = read(f); } catch { return; }   // a pack that is not emitted today
    expect(txt.length).toBeGreaterThan(50);
    expect(txt.match(new RegExp(MONTHLY.source, 'gi')) || [], f).toEqual([]);
  });
});
