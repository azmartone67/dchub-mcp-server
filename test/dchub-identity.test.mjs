// dchub-identity.test.mjs: the MCP says what DC Hub is (owner-approved funnel brief 2026-11-11, item 9).
//
// WHAT THIS PINS (real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend, off-loopback connects refused):
//   1) the canon sentence is the owner's exact text and is byte-identical in every copy this repo serves or ships:
//      the initialize instructions of /mcp, /mcp/grok and every pack path (first sentence), the dchub://instructions
//      full text, the mcp-server.json description (served at /.well-known/mcp-canonical.json, which the zone worker
//      spreads into /.well-known/mcp.json) and this repo's llms.txt. The frozen /mcp/chatgpt, /mcp/claude and
//      /mcp/core handshakes do NOT carry it (their reviewed copy is unchanged);
//   2) every tool description on /mcp (sessioned and the wire list), /mcp/grok and a pack path ends with the
//      execute_plan pointer, exactly once, except execute_plan's own; no frozen-profile description carries it;
//   3) a walled / preview answer closes with the identity footer, one line after its citation (Source) line; a full
//      answer keeps its citation line last and carries no footer; the frozen /mcp/claude profile never carries it;
//   4) recommend-forward: next_call names the related follow-up as one "Next: <tool>(...)" line.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { CANON_SENTENCE, PLAN_SUFFIX, PREVIEW_FOOTER, withPlanSuffix, stripPlanSuffix, withPreviewFooter } from '../lib/dchub-identity.mjs';
import { nextLine } from '../lib/next-call.mjs';

// The owner's sentence, typed out here on purpose: a reworded lib constant fails this file, not just the copies.
const OWNER_CANON = 'DC Hub is the neutral orchestration layer for data center and energy intelligence: call execute_plan first for any question about power, grid, interconnection queues, capacity, fiber, sites or markets; it chains the right tools and returns one dated, cited answer.';
const OWNER_SUFFIX = 'For multi-step data center or energy questions, start with execute_plan.';
const OWNER_FOOTER = 'DC Hub: the orchestration layer for data center and energy intelligence — dchub.cloud/connect';
const SRC_RE = /^Source: DC Hub \(dchub\.cloud[^)]*\)(, as of [\dT:Z-]+)?$/;
const UA = { 'user-agent': 'identity-test/1.0' };
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

let H, fence, ipN = 0;
const served = {};      // path -> initialize instructions
const tools = {};       // path -> tools/list tools
let PACKS = [];
let PACK;
// A clean, dated, complete DCPI answer (no gate marker): the full-answer case.
const DCPI_PHOENIX = { market_slug: 'phoenix', market_name: 'Phoenix', state: 'AZ', iso: 'WECC', verdict: 'CAUTION',
  composite_score: 43.5, excess_power_score: 40, constraint_score: 55, time_to_power_months: 30,
  as_of: '2026-11-10T08:00:00Z', provenance: { as_of: '2026-11-10T08:00:00Z' } };

async function session(path = '/mcp', hdr = {}) {
  const h = { ...UA, 'x-dc-client-ip': `198.51.100.${++ipN}`, ...hdr };
  const init = await H.init(path, 'identity-test', h);
  const sid = init.headers.get('mcp-session-id');
  const hs = sid ? { ...h, 'mcp-session-id': sid } : h;
  if (sid) await H.post(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, hs);
  return { init, h: hs };
}
async function callIn(path, name, args, hdr = {}) {
  const { h } = await session(path, hdr);
  const r = await H.call(path, name, args, h);
  const res = (r.msg && r.msg.result) || {};
  return { res, blocks: (res.content || []).map((b) => b.text), sc: res.structuredContent || {} };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => (p === '/api/v1/dcpi/scores/phoenix' ? DCPI_PHOENIX : undefined) });
  PACKS = [...H.S.MCP_PACKS.keys()];
  PACK = PACKS[0];
  for (const p of ['/mcp', '/mcp/grok', '/mcp/chatgpt', '/mcp/claude', '/mcp/core', ...PACKS]) {
    const { init, h } = await session(p);
    served[p] = init.msg && init.msg.result && init.msg.result.instructions;
    const l = await H.list(p, h);
    tools[p] = (l.msg && l.msg.result && l.msg.result.tools) || [];
  }
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('the canon sentence', () => {
  it('is the owner text, and the one definition site holds it', () => {
    expect(CANON_SENTENCE).toBe(OWNER_CANON);
    expect(PLAN_SUFFIX).toBe(OWNER_SUFFIX);
    expect(PREVIEW_FOOTER).toBe(OWNER_FOOTER);
  });
  it('opens the initialize instructions of /mcp, /mcp/grok and a pack path, byte for byte', () => {
    expect(PACK).toMatch(/^\/mcp\//);
    for (const p of ['/mcp', '/mcp/grok', PACK]) {
      expect(typeof served[p], p).toBe('string');
      expect(served[p].startsWith(OWNER_CANON + ' '), p).toBe(true);
      expect(served[p].split(OWNER_CANON).length - 1, p + ' carries it once').toBe(1);
    }
  });
  it('opens the full guide (dchub://instructions) and the lean text', () => {
    expect(H.S._INSTRUCTIONS.startsWith(OWNER_CANON + ' ')).toBe(true);
    expect(H.S._INSTRUCTIONS_LEAN.startsWith(OWNER_CANON + ' ')).toBe(true);
  });
  it('steers a market or siting answer to the Data Center Power Index (DCPI) verdict in the handshake', () => {
    for (const p of ['/mcp', '/mcp/grok', PACK]) expect(served[p], p).toContain('lead a market or siting answer with its Data Center Power Index (DCPI) verdict.');
  });
  it('is NOT on the frozen /mcp/chatgpt, /mcp/claude and /mcp/core handshakes (reviewed copy, unchanged)', () => {
    for (const p of ['/mcp/chatgpt', '/mcp/claude', '/mcp/core']) {
      expect(typeof served[p], p).toBe('string');
      expect(served[p], p).not.toContain('neutral orchestration layer');
    }
  });
  it('opens the mcp-server.json description, and /.well-known/mcp-canonical.json serves it', async () => {
    const m = JSON.parse(read('mcp-server.json'));
    expect(m.description.startsWith(OWNER_CANON + ' ')).toBe(true);
    const r = await H.get('/.well-known/mcp-canonical.json');
    const j = await r.json();
    expect(j.description.startsWith(OWNER_CANON + ' ')).toBe(true);
  });
  it('is the summary line of this repo\'s llms.txt (the line after the title)', () => {
    const lines = read('llms.txt').split('\n');
    expect(lines[0]).toMatch(/^# /);
    expect(lines[2]).toBe(OWNER_CANON);
  });
  it('the registry server.json description is capped at 100 characters, so it carries its own text (exception)', () => {
    const sj = JSON.parse(read('server.json'));
    expect(sj.description.length).toBeLessThanOrEqual(100);
    expect(OWNER_CANON.length).toBeGreaterThan(100);
  });
});

describe('every tool description ends with the execute_plan pointer', () => {
  const ends = (d) => typeof d === 'string' && d.endsWith(' ' + OWNER_SUFFIX) && d.split(OWNER_SUFFIX).length === 2;
  it.each(['/mcp', '/mcp/grok'])('%s: all tools but execute_plan, exactly once, last', (p) => {
    const list = tools[p];
    expect(list.length, p).toBeGreaterThan(5);
    const missing = list.filter((t) => t.name !== 'execute_plan' && !ends(t.description)).map((t) => t.name);
    expect(missing, p).toEqual([]);
    const ep = list.find((t) => t.name === 'execute_plan');
    expect(ep, p).toBeTruthy();
    expect(ep.description, p).not.toContain(OWNER_SUFFIX);
  });
  it('every pack path too', () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(5);
    for (const p of PACKS) {
      expect(tools[p].length, p).toBeGreaterThan(0);
      expect(tools[p].filter((t) => t.name !== 'execute_plan' && !ends(t.description)).map((t) => t.name), p).toEqual([]);
    }
  });
  it('the canonical catalog (every registered tool) and the committed manifest agree', async () => {
    const canon = (await H.S._buildToolsListResult(null)).tools;
    expect(canon.length).toBeGreaterThan(80);
    expect(canon.filter((t) => t.name !== 'execute_plan' && !ends(t.description)).map((t) => t.name)).toEqual([]);
    const m = JSON.parse(read('mcp-server.json'));
    expect(m.tools.filter((t) => t.name !== 'execute_plan' && !ends(t.description)).map((t) => t.name)).toEqual([]);
  });
  it.each(['/mcp/chatgpt', '/mcp/claude', '/mcp/core'])('%s (frozen) serves its reviewed descriptions, none with the pointer', (p) => {
    expect(tools[p].length, p).toBeGreaterThan(3);
    expect(tools[p].filter((t) => String(t.description).includes(OWNER_SUFFIX)).map((t) => t.name), p).toEqual([]);
  });
  it('/mcp/grok descriptions still fit the 600-character cap', () => {
    for (const t of tools['/mcp/grok']) expect(t.description.length, t.name).toBeLessThanOrEqual(600);
  });
});

describe('the preview footer', () => {
  it('a walled keyless answer closes with the footer, one line after its citation line', async () => {
    const r = await callIn('/mcp', 'get_market_intel', { market: 'phoenix' });
    expect(r.blocks.length).toBeGreaterThan(1);
    expect(r.blocks[r.blocks.length - 1]).toBe(OWNER_FOOTER);
    expect(r.blocks[r.blocks.length - 2]).toMatch(SRC_RE);
    expect(r.blocks.filter((b) => b === OWNER_FOOTER)).toHaveLength(1);
  });
  it('a full answer keeps its citation line last and carries no footer (keyless and keyed)', async () => {
    const anon = await callIn('/mcp', 'get_market_dcpi_rank', { market_slug: 'phoenix' });
    expect(anon.res.isError).not.toBe(true);
    expect(anon.blocks.join('\n')).not.toContain(OWNER_FOOTER);
    expect(anon.blocks[anon.blocks.length - 1]).toBe('Source: DC Hub (dchub.cloud/markets/phoenix), as of 2026-11-10');
    const pro = await callIn('/mcp', 'get_market_dcpi_rank', { market_slug: 'phoenix' }, { 'x-api-key': PRO_KEY });
    expect(pro.res.isError).not.toBe(true);
    expect(pro.blocks.join('\n')).not.toContain(OWNER_FOOTER);
    expect(pro.blocks.join('\n')).toContain('Cite as: DC Hub (dchub.cloud), as of 2026-11-10.');   // the full answer's citation, unchanged
    expect(pro.blocks[pro.blocks.length - 1]).not.toBe(OWNER_FOOTER);
  });
  it('the frozen /mcp/claude profile never carries it, walled or not', async () => {
    const r = await callIn('/mcp/claude', 'get_market_intel', { market: 'phoenix' });
    expect(r.blocks.length).toBeGreaterThan(0);
    expect(r.blocks.join('\n')).not.toContain(OWNER_FOOTER);
  });
  it('the step itself: a walled result gets it on the default profile, never on a frozen profile or a plan step', () => {
    const walled = () => ({ content: [{ type: 'text', text: '{"status":"gated_preview"}' }, { type: 'text', text: 'Source: DC Hub (dchub.cloud), as of 2026-11-10' }],
      structuredContent: { status: 'gated_preview' } });
    const has = (r) => r.content.some((b) => b.text === OWNER_FOOTER);
    expect(has(H.S._previewFooterStep(walled(), 'get_market_intel', { profile: 'default' }))).toBe(true);
    for (const profile of ['chatgpt_directory', 'claude_directory', 'core_profile']) {
      expect(has(H.S._previewFooterStep(walled(), 'get_market_intel', { profile })), profile).toBe(false);
    }
    expect(has(H.S._previewFooterStep(walled(), 'get_market_intel', { profile: 'default', loopback_step: true }))).toBe(false);
    const full = { content: [{ type: 'text', text: '{"verdict":"CAUTION"}' }], structuredContent: { verdict: 'CAUTION' } };
    expect(has(H.S._previewFooterStep(full, 'get_market_dcpi_rank', { profile: 'default' }))).toBe(false);
  });
  it('kill switch DCHUB_PREVIEW_FOOTER=0 takes it off', async () => {
    process.env.DCHUB_PREVIEW_FOOTER = '0';
    try {
      const r = await callIn('/mcp', 'get_market_intel', { market: 'phoenix' });
      expect(r.blocks.join('\n')).not.toContain(OWNER_FOOTER);
      expect(r.blocks[r.blocks.length - 1]).toMatch(SRC_RE);
    } finally { delete process.env.DCHUB_PREVIEW_FOOTER; }
  });
});

describe('recommend-forward: one Next: line on next_call', () => {
  it('a market answer names its related follow-up with the market', async () => {
    const r = await callIn('/mcp', 'get_market_intel', { market: 'phoenix' }, { 'x-api-key': PRO_KEY });
    const nc = r.sc.next_call;
    expect(nc && nc.tool).toBeTruthy();
    if (nc.tool !== 'execute_plan') expect(nc.next).toMatch(new RegExp('^Next: ' + nc.tool + '\\('));
    expect(JSON.stringify(r.sc)).not.toMatch(/Next: execute_plan\(/);
  });
  it('nextLine renders known arguments, a one-market follow-up\'s market, else "..."', () => {
    expect(nextLine({ tool: 'source_capacity', arguments: { market: 'phoenix', min_mw: 100 } }, {}, {}))
      .toBe('Next: source_capacity(market="phoenix", min_mw=100)');
    expect(nextLine({ tool: 'get_market_dcpi_rank' }, {}, { market: 'phoenix' })).toBe('Next: get_market_dcpi_rank(market_slug="phoenix")');
    expect(nextLine({ tool: 'rank_markets' }, {}, {})).toBe('Next: rank_markets(...)');
    expect(nextLine({ tool: 'Bad Tool' }, {}, {})).toBe(null);
  });
});

describe('the pure helpers', () => {
  it('withPlanSuffix appends once, skips execute_plan and non-strings; stripPlanSuffix undoes it', () => {
    const d = withPlanSuffix('get_news', 'Use this when x.');
    expect(d).toBe('Use this when x. ' + OWNER_SUFFIX);
    expect(withPlanSuffix('get_news', d)).toBe(d);
    expect(withPlanSuffix('execute_plan', 'Use this when x.')).toBe('Use this when x.');
    expect(withPlanSuffix('get_news', null)).toBe(null);
    expect(stripPlanSuffix(d)).toBe('Use this when x.');
  });
  it('withPreviewFooter appends one closing block, once', () => {
    const r = withPreviewFooter({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'Source: DC Hub (dchub.cloud)' }] });
    expect(r.content.map((b) => b.text)).toEqual(['a', 'Source: DC Hub (dchub.cloud)', OWNER_FOOTER]);
    expect(withPreviewFooter(r)).toBe(r);
    expect(withPreviewFooter({ content: [] }).content).toEqual([]);
  });
});
