// intent_answer end to end: real server.mjs on loopback, stub backend (no network).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const UA = { 'user-agent': 'Claude-User' };
const VERDICT = { 'columbus-oh': ['BUILD', 71.2], columbus: ['BUILD', 71.2], akron: ['CAUTION', 40], canton: ['CAUTION', 38] };

let H, fence; const out = {};
async function run(path, name, intent, platform = 'claude-ai', ua = UA, extra = {}) {
  const init = await H.init(path, platform, ua);
  const res = await H.call(path, 'execute_plan', { intent, ...extra }, { ...ua, 'mcp-session-id': init.headers.get('mcp-session-id') });
  const line = res.raw.split('\n').find((l) => l.startsWith('data:')) || res.raw;
  out[name] = { raw: res.raw, sc: JSON.parse(line.replace(/^data:\s*/, '')).result.structuredContent };
}
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => {
    // The real canvas answers a Columbus ask with OTHER Ohio metros; those slugs get minted into the plan
    // and used to outrank the market the user named (Grok 2026-10-18).
    if (p === '/api/v1/site-selection/canvas') {
      return { ok: true, markets: [{ market_slug: 'akron', score: 60 }, { market_slug: 'canton', score: 58 }] };
    }
    const m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p);
    if (m && VERDICT[m[1]]) return { ok: true, market_slug: m[1], verdict: VERDICT[m[1]][0], composite_score: VERDICT[m[1]][1] };
    return undefined;
  } });
  await run('/mcp', 'timing', 'how soon can I get 100 MW of power in ERCOT');
  await run('/mcp', 'siting', 'find a site for a 150 MW data center in Ohio');
  await run('/mcp', 'market', 'is Columbus a good market for a data center');
  // Grok QA 2026-11-06: a typed size beats the figure in the text (the queue step runs at it).
  await run('/mcp', 'sized', 'find a site for a 100 MW data center in Ohio', 'claude-ai', UA, { context: { min_mw: 150 } });
  await run('/mcp/chatgpt', 'chatgpt', 'how soon can I get 100 MW of power in ERCOT', 'chatgpt', { 'user-agent': 'openai-mcp' });
}, 180_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('execute_plan intent_answer', () => {
  it('controls: each plan ran and was classified', () => {
    for (const k of ['timing', 'siting', 'market']) expect(out[k].sc._entity).toBe('plan_execution');
  });
  it('power timing carries a block, ends with a Source line, and never invents time-to-power', () => {
    const a = out.timing.sc.intent_answer;
    expect(a, JSON.stringify(Object.keys(out.timing.sc))).toBeTruthy();
    expect(a.kind).toBe('power_timing');
    expect(Object.keys(a).pop()).toBe('source');
    expect(a.source).toMatch(/^Source: DC Hub \(dchub\.cloud/);
  });
  it('siting carries a block with the relay copied from the response link', () => {
    const a = out.siting.sc.intent_answer;
    expect(a && a.kind).toBe('siting');
    if (out.siting.sc.human_url) expect(a.relay.url).toBe(out.siting.sc.human_url);
  });
  it('market check never reports a verdict for a market the plan did not check', () => {
    const a = out.market.sc.intent_answer;
    expect(a && a.kind).toBe('market_check');
    const checked = out.market.sc.executed.filter((e) => e.tool === 'get_market_dcpi_rank' && e.status === 'executed').map((e) => e.args.market_slug);
    if (a.verdict) expect(a.verdict.subject).toMatch(/columbus/);
    else expect(a.headline).toMatch(/not DCPI-checked/);
    for (const s of checked) if (!/columbus/.test(s)) expect(a.headline).not.toMatch(new RegExp(`${s}.*BUILD`));
  });
  it('market check actually checks the market the user named (Grok 2026-10-18: it checked akron + canton)', () => {
    const a = out.market.sc.intent_answer;
    const checked = out.market.sc.executed.filter((e) => e.tool === 'get_market_dcpi_rank' && e.status === 'executed').map((e) => e.args.market_slug);
    expect(checked.some((s) => /^columbus/.test(s))).toBe(true);
    expect(a.verdict).toMatchObject({ value: 'BUILD', scope: 'market' });
    expect(a.verdict.subject).toMatch(/columbus/);
    expect(a.headline).toMatch(/^Columbus/);
  });
});

describe('a typed size (Grok QA 2026-11-06)', () => {
  it('context min_mw=150 runs the queue step at 150 and the answer speaks of 150 MW, not the 100 in the text', () => {
    const q = out.sized.sc.executed.find((e) => e.tool === 'get_refined_queue');
    expect(q, 'the plan ran no queue step').toBeTruthy();
    expect(q.args.min_mw).toBe(150);
    const a = out.sized.sc.intent_answer;
    expect(a && a.kind).toBe('siting');
    expect(a.requested_mw).toBe(150);
  });
});

describe('/mcp/chatgpt is frozen', () => {
  it('control: the same call there ran a plan', () => { expect(out.chatgpt.raw).toMatch(/plan_execution/); });
  it('carries no intent_answer', () => { expect(out.chatgpt.raw).not.toMatch(/intent_answer/); });
});
