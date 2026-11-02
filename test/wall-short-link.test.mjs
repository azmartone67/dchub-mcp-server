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
import { dropBuyParam, shortWallLinkStep, withWallNextAsk, wallFreeNext, withFreeNextAgentLine, freeNextAgentTail, withEmailNextAsk, emailNextAsk, EMAIL_NEXT_QUESTION, WALL_NEXT_ASK_QUESTION, WALL_FREE_NEXT_LEAD } from '../lib/short-wall-link.mjs';
import { paidAgentLine } from '../lib/paid-sell-line.mjs';
import { fiberAgentLine, gridAgentLine } from '../lib/grid-sell-line.mjs';

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
  // Guided first query (owner 2026-11-02, "free tool next"): with opts the wall's next_ask names another
  // tool whose answer is free; without opts, or with DCHUB_WALL_FREE_NEXT=0, it is P2's same-tool ask.
  it('wallFreeNext: never the walled tool, always a free-answer tool', () => {
    const FREE = new Set(['get_market_dcpi_rank', 'rank_markets', 'analyze_site']);
    const tools = ['get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel', 'get_market_dcpi_rank',
      'rank_markets', 'get_fiber_intel', 'get_fiber_readiness', 'analyze_site', 'list_transactions', 'get_dchub_recommendation'];
    for (const t of tools) for (const market of ['', 'midland-tx']) for (const siteFree of [false, true]) {
      const a = wallFreeNext(t, { market, siteFree });
      expect(a.tool, t).not.toBe(t);
      expect(FREE.has(a.tool), t + ' -> ' + a.tool).toBe(true);
      expect(a.question.startsWith(WALL_FREE_NEXT_LEAD)).toBe(true);
      expect(a.question).toContain(a.tool);
      expect(a.after).toBe('human_url');
      expect(a.free, t + ' marks the ask free for next_call').toBe(true);
      expect(a.question).not.toMatch(/https?:\/\/|\$\s?\d|\b(Developer|Pro|Starter|Enterprise)\b/);
    }
    expect(wallFreeNext('get_grid_intelligence', { market: 'midland-tx' }).tool).toBe('get_market_dcpi_rank');
    expect(wallFreeNext('get_grid_intelligence', { market: 'midland-tx' }).question).toContain('for midland-tx');
    expect(wallFreeNext('get_grid_intelligence', {}).tool).toBe('rank_markets');
    expect(wallFreeNext('get_fiber_intel', { siteFree: true }).tool).toBe('analyze_site');
    expect(wallFreeNext('get_fiber_intel', { siteFree: false, market: 'columbus' }).tool).toBe('get_market_dcpi_rank');
  });
  it('withWallNextAsk with opts: the free next ask in sc and block 0; DCHUB_WALL_FREE_NEXT=0 restores P2', () => {
    const r = withWallNextAsk(wall(), 'get_grid_intelligence', { market: 'dallas' });
    expect(r.structuredContent.next_ask.tool).toBe('get_market_dcpi_rank');
    expect(JSON.parse(r.content[0].text).next_ask).toEqual(r.structuredContent.next_ask);
    const off = withWallNextAsk(wall(), 'get_grid_intelligence', { market: 'dallas', env: { DCHUB_WALL_FREE_NEXT: '0' } });
    expect(off.structuredContent.next_ask).toEqual({ tool: 'get_grid_intelligence', question: WALL_NEXT_ASK_QUESTION, after: 'human_url' });
  });
  // Muse check 2026-11-02: every cut-short answer's agent line ended "After they pay, call <tool> again",
  // naming the walled tool while next_ask / next_call named the free one.
  it('withFreeNextAgentLine: the pay tail names the free tool; grid\'s brief tail and other text are left alone', () => {
    const lines = [paidAgentLine('rank_markets', 3), paidAgentLine('rank_markets', 0, true, 'https://dchub.cloud/u/abc234'),
      fiberAgentLine('Columbus'), fiberAgentLine('Columbus', true, 'https://dchub.cloud/u/abc234')];
    for (const line of lines) {
      const name = line.split(' ')[0];
      expect(line, 'the real line carries the old tail').toContain('After they pay, call ' + name + ' again');
      const [b] = withFreeNextAgentLine([{ type: 'text', text: line }], name, 'get_market_dcpi_rank');
      expect(b.text).not.toMatch(/\bpay\b/i);
      expect(b.text).toContain(freeNextAgentTail(name, 'get_market_dcpi_rank'));
      expect(b.text.indexOf('get_market_dcpi_rank')).toBeLessThan(b.text.lastIndexOf(name + ' again'));
      expect(b.text).not.toMatch(PLAN_PROSE);
    }
    const grid = gridAgentLine('PJM', 22);
    expect(withFreeNextAgentLine([{ type: 'text', text: grid }], 'get_grid_intelligence', 'rank_markets')[0].text).toBe(grid);
    const same = [{ type: 'text', text: lines[0] }];
    expect(withFreeNextAgentLine(same, 'rank_markets', 'rank_markets')).toBe(same);
    expect(withFreeNextAgentLine(same, 'get_fiber_intel', 'analyze_site')[0].text, 'another tool\'s line is not touched').toBe(lines[0]);
  });
  it('withWallNextAsk rewrites the pay tail only with the free next answer on', () => {
    const r0 = { content: [{ type: 'text', text: JSON.stringify({ human_url: 'https://dchub.cloud/u/abc234', next_ask: null }) },
      { type: 'text', text: paidAgentLine('rank_markets', 3) }], structuredContent: { human_url: 'https://dchub.cloud/u/abc234' } };
    const on = withWallNextAsk(r0, 'rank_markets', { market: '' });
    expect(on.content[1].text).toContain(freeNextAgentTail('rank_markets', 'get_market_dcpi_rank'));
    expect(on.content[1].text).not.toContain('After they pay');
    const off = withWallNextAsk(r0, 'rank_markets', { market: '', env: { DCHUB_WALL_FREE_NEXT: '0' } });
    expect(off.content[1].text).toContain('After they pay, call rank_markets again');
    expect(withWallNextAsk(r0, 'rank_markets').content[1].text).toContain('After they pay, call rank_markets again');
  });
  it('withEmailNextAsk: bind_email after the answer in sc and block 0, block 0 alone when sc is absent, off with DCHUB_WALL_FREE_NEXT=0', () => {
    const want = emailNextAsk();
    expect(want).toMatchObject({ tool: 'bind_email', after: 'answer', free: true });
    expect(EMAIL_NEXT_QUESTION).toContain('you can skip this and keep the answer either way');
    expect(EMAIL_NEXT_QUESTION).not.toMatch(PLAN_PROSE);
    expect(EMAIL_NEXT_QUESTION).not.toMatch(/https?:\/\/|\u2014/);
    const r = withEmailNextAsk(wall(), {});
    expect(r.structuredContent.next_ask).toEqual(want);
    expect(JSON.parse(r.content[0].text).next_ask).toEqual(want);
    const bare = { content: [{ type: 'text', text: JSON.stringify({ x: 1 }) + '\n\n---\n\nprose' }] };
    const rb = withEmailNextAsk(bare, {});
    expect(rb.structuredContent, 'no structuredContent is invented').toBeUndefined();
    expect(rb.content[0].text.endsWith('\n\n---\n\nprose')).toBe(true);
    expect(JSON.parse(rb.content[0].text.split('\n\n---')[0]).next_ask).toEqual(want);
    const w = wall();
    expect(withEmailNextAsk(w, { DCHUB_WALL_FREE_NEXT: '0' })).toBe(w);
  });
  it('withWallNextAsk without opts: next_ask names the same tool after the relay, in sc and block 0', () => {
    const r = withWallNextAsk(wall(), 'get_grid_intelligence');
    const want = { tool: 'get_grid_intelligence', question: WALL_NEXT_ASK_QUESTION, after: 'human_url' };
    expect(r.structuredContent.next_ask).toEqual(want);
    expect(JSON.parse(r.content[0].text).next_ask).toEqual(want);
  });
});

describe('over the real app (stub backend, no network)', () => {
  it('guided first query: a walled answer\'s next_call is a free tool, not itself; DCHUB_WALL_FREE_NEXT=0 is the control', async () => {
    for (const [t, a, want] of [['rank_markets', { criteria: 'ai_ready', limit: 10 }, 'get_market_dcpi_rank'],
      ['list_transactions', { since: '2026-01-01', limit: 3 }, 'rank_markets']]) {
      const sc = (await call('/mcp', t, a)).structuredContent || {};
      expect(sc.human_url, t + ' is walled in the stub').toBeTruthy();
      expect(sc.next_ask && sc.next_ask.tool, t).toBe(want);
      expect(sc.next_call && sc.next_call.tool, t + ' next_call').toBe(want);
      process.env.DCHUB_WALL_FREE_NEXT = '0';
      let off;
      try { off = (await call('/mcp', t, a)).structuredContent || {}; } finally { delete process.env.DCHUB_WALL_FREE_NEXT; }
      expect(off.next_call && off.next_call.tool, t + ' control: P2 loops to itself').toBe(t);
    }
  });
  it('grid with answer first off: no email next step, the free tool stays next (control for the email next step)', async () => {
    process.env.DCHUB_ANSWER_FIRST = '0';
    let sc;
    try { sc = (await call('/mcp', 'get_grid_intelligence', { iso: 'ERCOT' })).structuredContent || {}; } finally { delete process.env.DCHUB_ANSWER_FIRST; }
    expect(sc.human_url, 'grid is walled in the stub').toBeTruthy();
    expect(sc.next_ask && sc.next_ask.tool).toBe('rank_markets');
    expect(sc.next_call && sc.next_call.tool).toBe('rank_markets');
  });
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
    // Owner 2026-11-02 (Muse's check): grid gives the free figure, then asks for the email; its next step is that ask.
    expect(b0.next_ask && b0.next_ask.tool, 'block 0 next_ask is the email ask, not the walled tool').toBe('bind_email');
    expect(JSON.stringify(res)).not.toMatch(/\/upgrade\/h\/|buy=1/);
    expect(res.content.some((b) => b.type === 'text' && b.text.includes('For your human') && b.text.includes(sc.human_url))).toBe(true);
    expect(sc.next_ask && sc.next_ask.tool).toBe('bind_email');
    expect(sc.next_ask.question).toBe(EMAIL_NEXT_QUESTION);
    expect(sc.next_call && sc.next_call.tool, 'next_call is set').toBeTruthy();
    expect(sc.next_call.tool, 'next_call does not loop to the walled tool').not.toBe('get_grid_intelligence');
    expect(sc.next_call.tool, 'next_call is the email ask, not the wall\'s unlock tool').toBe('bind_email');
    const prose = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    expect(prose.indexOf('Give your user this free answer first: '), 'the free figure comes first in the prose').toBeGreaterThan(-1);
    expect(prose.indexOf('Give your user this free answer first: ')).toBeLessThan(prose.indexOf('`bind_email`'));
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
    // the call sits inside the skip condition; 2026-10-28 it also carries the wall tag (lib/wall-tag.mjs)
    const head = "if (!c.loopback_step && c.profile !== DIRECTORY_PROFILE && c.profile !== CLAUDE_PROFILE\n"
      + "        && c.profile !== CORE_PROFILE && !_isPaidDepthTier(c.tier)) {\n";
    const call = "out = await shortWallLinkStep(out, { mint: (u) => (c._relayShortFailed ? u : _shortRelayPageLink(u, name)), wall: _wallType });";
    expect(src).toContain(head);
    expect(src.split(head).length - 1, 'one skip block').toBe(1);
    expect(src.indexOf(call) - src.indexOf(head), 'the step is the first call inside the skip block').toBeGreaterThan(0);
    expect(src.indexOf(call) - src.indexOf(head)).toBeLessThan(1400);
    expect(src).toContain('const walled = !directory && !!(sc0 && typeof sc0 === \'object\' && !Array.isArray(sc0) && _isRelayWall(sc0, c));');
    expect(src).toContain('const directory = c.profile === DIRECTORY_PROFILE || c.profile === CLAUDE_PROFILE;');
  });
});
