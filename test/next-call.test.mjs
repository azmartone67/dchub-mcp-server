// Brain block 2026-10-28, item 4: every data answer names the next call.
//   next_call { tool, arguments?, why, connect } in block 0's JSON and structuredContent, never a new text block;
//   the follow-up a wall/preview already names wins over execute_plan; the same fields keyed and keyless;
//   nothing on the frozen /mcp/chatgpt profile, execute_plan itself or an error.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import * as N from '../lib/next-call.mjs';

const mk = (sc, text) => ({
  content: [{ type: 'text', text: text ?? JSON.stringify(sc) }, { type: 'text', text: 'Source: DC Hub (dchub.cloud)' }],
  structuredContent: sc,
});

describe('buildNextCall', () => {
  it('defaults to execute_plan with the question as the argument', () => {
    expect(N.buildNextCall('get_market_intel', { a: 1 })).toEqual({
      tool: 'execute_plan', arguments: { intent: "<the user's question, unchanged>" },
      why: 'plans and chains the right tools and returns one dated, cited answer', connect: 'MCP server: dchub.cloud/mcp' });
  });
  it('keeps the follow-up the answer already names (next_tool, _upgrade.next_tool, next_ask.tool)', () => {
    for (const sc of [{ next_tool: 'bind_email' }, { _upgrade: { next_tool: 'bind_email' } }, { next_ask: { tool: 'bind_email' } }]) {
      const nc = N.buildNextCall('x', sc);
      expect(nc.tool).toBe('bind_email');
      expect(nc.arguments, 'execute_plan alone takes an intent').toBeUndefined();
      expect(nc.connect).toBe(N.NEXT_CALL_CONNECT);
    }
  });
  it('ignores a next_tool that is not a tool name', () => {
    for (const bad of ['', 'Has Space', '9tool', 'x', 5, null, {}, 'a'.repeat(80)]) {
      expect(N.buildNextCall('x', { next_tool: bad }).tool, String(bad)).toBe('execute_plan');
    }
  });
  it('carries no https link, so a wall\'s one-link rule holds', () => {
    expect(JSON.stringify(N.buildNextCall('x', {}))).not.toMatch(/https?:\/\//);
  });
  it('the text keeps the copy rules: no price, plan name, count, superlative or emoji', () => {
    const t = JSON.stringify(N.buildNextCall('x', {}));
    expect(t).not.toMatch(/[$€£]|\b(price|pricing|free|developer|starter|enterprise)\b/i);
    expect(t).not.toMatch(/\b(only|first|best|largest|leading|authoritative|de-facto)\b/i);
    expect(t).not.toMatch(/\d/);
    expect(t).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('withNextCall', () => {
  it('adds it to block 0 JSON and structuredContent and adds no block', () => {
    const r = mk({ answer: 42 });
    const out = N.withNextCall(r, 'get_market_intel');
    expect(out.content.length).toBe(r.content.length);
    expect(out.content[1]).toEqual(r.content[1]);   // the closing Source line is untouched, still last
    const j = JSON.parse(out.content[0].text);
    expect(j.answer).toBe(42);
    expect(j.next_call).toEqual(out.structuredContent.next_call);
    expect(out.structuredContent.next_call.tool).toBe('execute_plan');
    expect(r.structuredContent.next_call, 'the input is not mutated').toBeUndefined();
  });
  it('keeps prose that follows block 0 JSON in the same block', () => {
    const out = N.withNextCall(mk({ a: 1 }, JSON.stringify({ a: 1 }) + '\n\nSome prose.'), 'get_news');
    expect(out.content[0].text.endsWith('\n\nSome prose.')).toBe(true);
    expect(JSON.parse(out.content[0].text.split('\n\nSome prose.')[0]).next_call.tool).toBe('execute_plan');
  });
  it('is idempotent and never overwrites', () => {
    const once = N.withNextCall(mk({ a: 1 }), 'get_news');
    expect(N.withNextCall(once, 'get_news')).toBe(once);
    const own = mk({ next_call: { tool: 'mine' } });
    expect(N.withNextCall(own, 'get_news')).toBe(own);
  });
  it('skips the entry itself, the key tools, errors, non-objects and answers with no structuredContent', () => {
    for (const t of ['execute_plan', 'claim_free_key', 'bind_email', 'recover_my_key', 'unlock_more_data']) {
      const r = mk({ a: 1 }); expect(N.withNextCall(r, t), t).toBe(r);
    }
    const err = { ...mk({ error: 'boom', error_code: 'tool_execution_failed' }), isError: true };
    expect(N.withNextCall(err, 'get_news')).toBe(err);
    for (const r of [null, undefined, 'x', { content: [] }, { content: [{ type: 'text', text: 'x' }] }, { content: [{ type: 'text', text: 'x' }], structuredContent: [1] }]) {
      expect(N.withNextCall(r, 'get_news')).toBe(r);
    }
  });
  it('a wall or preview flagged isError is an answer and gets the hint (it keeps the follow-up it names)', () => {
    const wall = { ...mk({ human_url: 'https://dchub.cloud/u/abc234', _upgrade: { next_tool: 'claim_free_key' } }), isError: true };
    expect(N.withNextCall(wall, 'get_pipeline').structuredContent.next_call.tool).toBe('claim_free_key');
  });
  it('leaves block 0 alone when it is not JSON, but still sets the structured field', () => {
    const out = N.withNextCall(mk({ a: 1 }, 'plain prose'), 'get_news');
    expect(out.content[0].text).toBe('plain prose');
    expect(out.structuredContent.next_call.tool).toBe('execute_plan');
  });
  it('DCHUB_NEXT_CALL=0 restores the earlier answer', () => {
    const r = mk({ a: 1 });
    expect(N.withNextCall(r, 'get_news', { env: { DCHUB_NEXT_CALL: '0' } })).toBe(r);
    expect(N.withNextCall(r, 'get_news', { env: { DCHUB_NEXT_CALL: '1' } })).not.toBe(r);
  });
});

// ── end to end ────────────────────────────────────────────────────────────
const FREE_KEY = 'dch_trial_NEXTCALL0123456789abcdefgh';
const ARGS = { lat: 33.45, lon: -112.07 };
const FULL = { success: true, lat: 33.45, lon: -112.07, overall_score: 83.7, verdict: 'BUILD',
  factors: { power: { score: 91, verdict: 'BUILD' } }, nearest_substations: { substations_in_radius: 7, search_radius_km: 50, substations: [] } };
let H, fence, used = 0;

async function settle(quietMs = 300, maxMs = 6000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function callTool(name, args, { key, path = '/mcp', ua = 'Claude-User', client = 'claude-ai' } = {}) {
  const hdr = { 'user-agent': ua, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init(path, client, hdr);
  const sid = init.headers.get('mcp-session-id');
  const r = await H.call(path, name, args, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const res = r.msg && r.msg.result;
  return { res, sc: (res && res.structuredContent) || {}, blocks: ((res && res.content) || []).map((x) => x.text || '') };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        const allowed = used < 3 && body.op === 'consume'; if (allowed) used += 1;
        return { ok: true, allowed, used, limit: 3, remaining: Math.max(0, 3 - used), resets_at: '2026-11-01T00:00:00Z', email_bound: false };
      }
      if (p === '/api/site-score') return { ...FULL };
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { used = 0; delete process.env.DCHUB_NEXT_CALL; });

describe('through the real /mcp handler', () => {
  it('a full keyed answer carries next_call in structuredContent and block 0, and the Source line is still last', async () => {
    const r = await callTool('analyze_site', ARGS, { key: FREE_KEY });
    expect(r.sc.overall_score).toBe(83.7);
    // analyze_site's full answer already names compare_sites as its follow-up; the hint keeps it
    expect(r.sc.next_call).toMatchObject({ tool: r.sc.next_tool || (r.sc._upgrade && r.sc._upgrade.next_tool) || (r.sc.next_ask && r.sc.next_ask.tool) || 'execute_plan', connect: 'MCP server: dchub.cloud/mcp' });
    expect(JSON.parse(r.blocks[0]).next_call).toEqual(r.sc.next_call);
    expect(r.blocks[r.blocks.length - 1]).toMatch(/^Source: DC Hub/);
    expect(r.blocks.filter((b) => /next_call|execute_plan\(/.test(b) && !b.trimStart().startsWith('{')).length, 'no prose block was added for it').toBe(0);
  });
  it('a keyless answer carries the same fields, so a key is never worse than none', async () => {
    const keyed = await callTool('get_pipeline', { country: 'US' }, { key: FREE_KEY });
    const keyless = await callTool('get_pipeline', { country: 'US' });
    expect(keyless.sc.next_call).toBeTruthy();
    expect(Object.keys(keyed.sc.next_call).sort()).toEqual(Object.keys(keyless.sc.next_call).sort());
  });
  it('DCHUB_NEXT_CALL=0 restores the earlier answer', async () => {
    process.env.DCHUB_NEXT_CALL = '0';
    const r = await callTool('analyze_site', ARGS, { key: FREE_KEY });
    expect(r.sc.next_call).toBeUndefined();
    expect(r.blocks[0]).not.toContain('next_call');
  });
  it('the frozen /mcp/chatgpt profile carries none, in either place', async () => {
    const r = await callTool('get_pipeline', { country: 'US' }, { path: '/mcp/chatgpt', ua: 'openai-mcp/1.0', client: 'openai-mcp' });
    expect(r.sc.next_call).toBeUndefined();
    expect(r.blocks.join('\n')).not.toContain('next_call');
  });
});
