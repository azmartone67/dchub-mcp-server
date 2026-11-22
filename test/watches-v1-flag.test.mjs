// Power Watch + Market Watch on register_standing_intent (DCHUB_WATCHES_V1, default off), 2026-11-22.
//
// What this pins:
//   1. Flag off: the tool's description, schema and handler are what they were (no watch kinds, no
//      watch params, a watch kind without webhook_url still gets missing_required_argument).
//   2. Flag on: the watch kinds and params are declared, and the call reaches the backend's intents
//      route with the body routes/watches_v1.create reads (no webhook_url for channel=email).
//   3. W10: register_standing_intent is not on /mcp/chatgpt and that list stays 65 tools.
//   4. W11: the new agent-facing copy names no price, plan, credit, call quota, tool count or partner.
// Every backend response is a fixture; nothing leaves the process.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'http://127.0.0.1:1';
let S, realFetch;
let calls = [];
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let pathname = '';
    try { pathname = new URL(url).pathname; } catch { /* not a URL */ }
    let body;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    calls.push({ url, pathname, method: String(init.method || 'GET').toUpperCase(), body });
    if (pathname.startsWith('/api/v1/agentic/intents')) return json(201, { ok: true, intent_id: 'abc' });
    return json(200, {});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prev;
}, 60_000);

afterAll(() => { globalThis.fetch = realFetch; delete process.env.DCHUB_WATCHES_V1; });
beforeEach(() => { calls = []; delete process.env.DCHUB_WATCHES_V1; });

const seat = { api_key: 'dch_live_watch_test', tier: 'free', platform: 'claude', session_id: 'sess-w' };
function tool() { return S.createServer()._registeredTools.register_standing_intent; }
async function call(args) {
  const T = tool();
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const shapeOf = (t) => t.inputSchema.shape || t.inputSchema._def.shape();
const intentCalls = () => calls.filter((c) => c.pathname.startsWith('/api/v1/agentic/intents'));

describe('register_standing_intent watches, flag off', () => {
  it('description, kind text and schema carry nothing new', () => {
    const t = tool();
    expect(t.description).not.toContain(S.WATCH_DESC_ADDENDUM);
    expect(t.description).not.toMatch(/queue_change|market_watch|Power Watch/);
    const shape = shapeOf(t);
    for (const k of Object.keys(S.WATCH_PARAM_SCHEMA)) expect(shape[k], k).toBeUndefined();
    expect(shape.kind.description).toBe('Watch kind: "new_deal_in_market" | "news_keyword" | "permitting_change" | "capacity" (a Capacity Source requirement, emailed, no webhook)');
  });

  it('a watch kind without webhook_url is refused as before and reaches no backend', async () => {
    const r = await call({ kind: 'queue_change' });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).error).toBe('missing_required_argument');
    expect(intentCalls().length).toBe(0);
  });

  it('flag on only appends: the off description is the on description minus the addendum', () => {
    const off = tool().description;
    process.env.DCHUB_WATCHES_V1 = '1';
    const on = tool().description;
    expect(on).toBe(off + S.WATCH_DESC_ADDENDUM);
  });
});

describe('register_standing_intent watches, flag on', () => {
  beforeEach(() => { process.env.DCHUB_WATCHES_V1 = '1'; });

  it('declares the watch params', () => {
    const shape = shapeOf(tool());
    for (const k of ['iso', 'ba', 'min_requests', 'min_gw', 'min_mw', 'channel', 'cadence']) {
      expect(shape[k], k).toBeTruthy();
      expect(shape[k].isOptional()).toBe(true);
    }
    expect(shape.kind.description).toMatch(/queue_change.*new_generation.*infra_project_change.*pipeline_project.*market_watch/);
  });

  it('email queue_change: no webhook_url needed, body is what the backend reads', async () => {
    await call({ kind: 'queue_change', iso: 'PJM', state: 'VA', min_requests: 6, channel: 'email', cadence: 'daily' });
    const sent = intentCalls();
    expect(sent.length).toBe(1);
    expect(sent[0].method).toBe('POST');
    expect(sent[0].body).toEqual({ kind: 'queue_change', params: { iso: 'PJM', state: 'VA', min_requests: 6 },
      channel: 'email', cadence: 'daily' });
  });

  it('webhook market_watch carries the webhook_url', async () => {
    await call({ kind: 'market_watch', market: 'columbus', webhook_url: 'https://hooks.example.com/x' });
    expect(intentCalls()[0].body).toEqual({ kind: 'market_watch', params: { market: 'columbus' },
      webhook_url: 'https://hooks.example.com/x' });
  });

  it('an existing kind with channel email goes to the same route', async () => {
    await call({ kind: 'permitting_change', state: 'OH', channel: 'email' });
    expect(intentCalls()[0].body).toEqual({ kind: 'permitting_change', params: { state: 'OH' }, channel: 'email' });
  });

  it('existing webhook kinds send exactly what they did', async () => {
    await call({ kind: 'news_keyword', q: 'moratorium', webhook_url: 'https://hooks.example.com/x' });
    expect(intentCalls()[0].body).toEqual({ kind: 'news_keyword', params: { q: 'moratorium' },
      webhook_url: 'https://hooks.example.com/x' });
  });
});

describe('W10 + W11', () => {
  it('register_standing_intent is not on /mcp/chatgpt, which stays at 65 tools', async () => {
    const d = await import('../lib/chatgpt-directory.mjs');
    const names = Object.keys(d.CHATGPT_TOOLS);
    expect(names.length).toBe(65);
    expect(names).not.toContain('register_standing_intent');
    expect(d.DIRECTORY_REMOVED).toContain('register_standing_intent');
  });

  it('new copy names no price, plan, credit, quota, tool count or partner', () => {
    const LINT = /\$\d|\bfree\b|\btrial\b|\bcredits?\b|per day|\/day|calls\/day|\bDeveloper\b|\bPro\b|\bEnterprise\b|\b\d+ tools\b|\bpartners?(hip)?\b|\bplan\b/i;
    const texts = [S.WATCH_DESC_ADDENDUM, ...Object.values(S.WATCH_PARAM_SCHEMA).map((z) => z.description)];
    for (const t of texts) expect(t, t).not.toMatch(LINT);
  });
});
