// wall-short-link.test.mjs — wall-to-paid P1 + P2 + P4 (owner 2026-10-23, ~/dchub-progress/wall-to-paid-1023.md).
//
// Measured 30d: data-tool walls handed out a 200-330 character /upgrade/h/ link (keyless: ?buy=1, which
// skips the relay page the copy describes) behind a next_ask naming a different tool; 0 human checkout
// clicks. Pinned:
//   P1  a data-tool wall's human_url is the /u/ short link, it is the FIRST key of block 0's JSON (block 0
//       still parses), no long relay link is left anywhere in the reply, and block 0 names no plan or price;
//   P4  the minted target carries no buy=1, and on a mint failure the long link is kept minus buy=1;
//   P2  on a wall next_ask names the same tool again after the relay, in structuredContent and block 0;
//   /mcp/chatgpt (frozen for OpenAI's review) is identical with the step on and off, and gets no /u/ link.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { splitLeadingJson } from '../lib/facility-location.mjs';
import { dropBuyParam, shortWallLinkStep, withWallNextAsk, WALL_NEXT_ASK_QUESTION } from '../lib/short-wall-link.mjs';

// Same as test/agent-output-names-no-plan.test.mjs PLAN_PROSE (importing that file would re-run its suite here).
const PLAN_PROSE = /\b(Pro|Developer|Starter|Founder|Enterprise)\s+(plan|tier|seat|subscription|key|rung|users?|callers?|only)\b|\bDC Hub (Pro|Developer|Starter|Founder|Enterprise)\b|\b(in|with|on|needs|requires|upgrade to) (Pro|Developer|Starter|Enterprise)\b|\$\s?\d+(\.\d+)?\s*(\/|per)\s*mo(nth)?\b/;
const LONG = 'https://dchub.cloud/upgrade/h/QUJDfGdldF9ncmlk.0123456789abcdef0123456789abcdef';
const ALPH = '23456789abcdefghjkmnpqrstuvwxyz';
let H, fence, mintTargets = [], n = 0;

const code = (i) => Array.from({ length: 6 }, (_, k) => ALPH[(i * 7 + k * 3) % ALPH.length]).join('');

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p !== '/api/v1/relay/short') return undefined;
      mintTargets.push(body && body.relay_url);
      return { status: 200, body: { ok: true, url: 'https://dchub.cloud/u/' + code(++n) } };
    },
  });
}, 60_000);
afterAll(async () => { delete process.env.DCHUB_WALL_SHORT_ALL; if (H) await H.stop(); if (fence) fence.restore(); });

async function call(path, tool, args) {
  let hdr = { 'user-agent': 'Claude-User' };
  const init = await H.init(path, 'probe-client', hdr);
  const sid = init.headers.get('mcp-session-id');
  if (sid) hdr = { ...hdr, 'mcp-session-id': sid };
  const r = await H.call(path, tool, args, hdr);
  return r.msg && r.msg.result;
}

describe('lib/short-wall-link', () => {
  it('dropBuyParam drops buy (any value) and keeps the rest', () => {
    expect(dropBuyParam(LONG + '?buy=1')).toBe(LONG);
    expect(dropBuyParam(LONG + '?a=1&buy=1&b=2')).toBe(LONG + '?a=1&b=2');
    expect(dropBuyParam(LONG)).toBe(LONG);
  });
  const wall = () => ({
    content: [
      { type: 'text', text: JSON.stringify({ iso: 'ERCOT', preview_is_partial: true, next_ask: { tool: 'rank_markets' } }) },
      { type: 'text', text: 'get_grid_intelligence returned a free preview. Show your user the next line unchanged.' },
      { type: 'text', text: '→ **For your human:** the full brief is on this page: ' + LONG + '?buy=1' },
    ],
    structuredContent: { iso: 'ERCOT', preview_is_partial: true, human_url: LONG + '?buy=1',
      for_your_human: { url: LONG + '?buy=1', markdown: '[Open](' + LONG + '?buy=1)' }, human_message: 'open ' + LONG + '?buy=1' },
  });
  it('mints for the buy-less target, swaps every copy, human_url first in sc and block 0', async () => {
    const seen = [];
    const r = await shortWallLinkStep(wall(), { mint: async (u) => { seen.push(u); return 'https://dchub.cloud/u/abc234'; } });
    expect(seen).toEqual([LONG]);
    expect(JSON.stringify(r)).not.toContain('/upgrade/h/');
    expect(Object.keys(r.structuredContent)[0]).toBe('human_url');
    expect(r.structuredContent.for_your_human.url).toBe('https://dchub.cloud/u/abc234');
    const b0 = JSON.parse(r.content[0].text);
    expect(Object.keys(b0)[0]).toBe('human_url');
    expect(b0.human_url).toBe('https://dchub.cloud/u/abc234');
    expect(r.content[2].text).toBe('→ **For your human:** the full brief is on this page: https://dchub.cloud/u/abc234');
    expect(r.content[1]).toEqual(wall().content[1]);
  });
  it('a failed mint keeps the long link, minus buy=1', async () => {
    const r = await shortWallLinkStep(wall(), { mint: async () => { throw new Error('down'); } });
    expect(JSON.stringify(r)).not.toContain('buy=1');
    expect(r.structuredContent.human_url).toBe(LONG);
    const r2 = await shortWallLinkStep(wall(), { mint: async () => 'https://evil.example/x' });
    expect(r2.structuredContent.human_url).toBe(LONG);
  });
  it('left alone: already short, no relay link, kill switch', async () => {
    const short = { content: [{ type: 'text', text: '{}' }], structuredContent: { human_url: 'https://dchub.cloud/u/abc234' } };
    expect(await shortWallLinkStep(short, { mint: async () => 'x' })).toBe(short);
    const none = { content: [{ type: 'text', text: '{}' }], structuredContent: { ok: true } };
    expect(await shortWallLinkStep(none, { mint: async () => 'x' })).toBe(none);
    const w = wall();
    expect(await shortWallLinkStep(w, { mint: async () => 'x', env: { DCHUB_WALL_SHORT_ALL: '0' } })).toBe(w);
  });
  it('withWallNextAsk: next_ask names the same tool after the relay, in sc and block 0', () => {
    const r = withWallNextAsk(wall(), 'get_grid_intelligence');
    const want = { tool: 'get_grid_intelligence', question: WALL_NEXT_ASK_QUESTION, after: 'human_url' };
    expect(r.structuredContent.next_ask).toEqual(want);
    expect(JSON.parse(r.content[0].text).next_ask).toEqual(want);
  });
});

describe('over the real app (stub backend, no network)', () => {
  it('P1/P4/P2 /mcp keyless data-tool wall: /u/ link first in block 0, nothing long left, no plan or price', async () => {
    mintTargets = [];
    const res = await call('/mcp', 'get_grid_intelligence', { iso: 'ERCOT' });
    const sc = res.structuredContent;
    expect(sc.human_url).toMatch(/^https:\/\/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}$/);
    expect(mintTargets.length).toBeGreaterThan(0);
    for (const t of mintTargets) expect(t).not.toMatch(/[?&]buy=/);
    const b0 = JSON.parse(splitLeadingJson(res.content[0].text) ? JSON.stringify(splitLeadingJson(res.content[0].text).json) : res.content[0].text);
    expect(Object.keys(b0)[0]).toBe('human_url');
    expect(b0.human_url).toBe(sc.human_url);
    expect(res.content[0].text).not.toMatch(PLAN_PROSE);
    expect(b0.next_ask && b0.next_ask.tool, 'block 0 next_ask names the same tool').toBe('get_grid_intelligence');
    expect(JSON.stringify(res)).not.toMatch(/\/upgrade\/h\/|buy=1/);
    expect(res.content.some((b) => b.type === 'text' && b.text.includes('For your human') && b.text.includes(sc.human_url))).toBe(true);
    expect(sc.next_ask && sc.next_ask.tool).toBe('get_grid_intelligence');
    // every copy agrees: one distinct relay link in the whole reply
    if (sc.for_your_human && sc.for_your_human.url) expect(sc.for_your_human.url).toBe(sc.human_url);
    if (typeof sc.user_message === 'string') expect(sc.user_message).toContain(sc.human_url);
    const all = JSON.stringify(res).match(/https:\/\/dchub\.cloud\/(?:upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}|u\/[2-9a-hj-km-np-z]{6})/g) || [];
    expect([...new Set(all)]).toEqual([sc.human_url]);
  });
  it('/mcp/chatgpt: no /u/ link, and identical with the step on and off', async () => {
    const norm = (r) => JSON.stringify(r)
      .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z?/g, 'T')
      .replace(/\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/g, '/upgrade/h/X')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'SID')
      .replace(/"(duration_ms|elapsed_ms|took_ms)":\d+/g, '"$1":0');
    const on = await call('/mcp/chatgpt', 'get_grid_intelligence', { iso: 'ERCOT' });
    process.env.DCHUB_WALL_SHORT_ALL = '0';
    let off;
    try { off = await call('/mcp/chatgpt', 'get_grid_intelligence', { iso: 'ERCOT' }); } finally { delete process.env.DCHUB_WALL_SHORT_ALL; }
    expect(on, 'control: /mcp/chatgpt answered').toBeTruthy();
    expect(JSON.stringify(on)).not.toMatch(/dchub\.cloud\/u\//);
    // Premise, measured here: the directory profile hands out no relay link and no wall next_ask, so
    // neither step has anything to change on it; the skips below keep it that way if that changes.
    expect(JSON.stringify(on)).not.toMatch(/\/upgrade\/h\//);
    expect(JSON.stringify(on)).not.toContain(WALL_NEXT_ASK_QUESTION);
    expect(norm(on)).toBe(norm(off));
  });
  it('the skips are wired: directory / Claude / core profiles, loopback and paid seats never reach either step', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toContain("if (!c.loopback_step && c.profile !== DIRECTORY_PROFILE && c.profile !== CLAUDE_PROFILE\n"
      + "        && c.profile !== CORE_PROFILE && !_isPaidDepthTier(c.tier)) {\n"
      + "      out = await shortWallLinkStep(out, { mint: (u) => (c._relayShortFailed ? u : _shortRelayPageLink(u, name)) });");
    expect(src).toContain('const walled = !directory && !!(sc0 && typeof sc0 === \'object\' && !Array.isArray(sc0) && _isRelayWall(sc0, c));');
    expect(src).toContain('const directory = c.profile === DIRECTORY_PROFILE || c.profile === CLAUDE_PROFILE;');
  });
});
