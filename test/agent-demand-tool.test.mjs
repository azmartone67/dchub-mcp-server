// get_agent_demand (lib/agent-demand.mjs): hidden until AGENT_DEMAND_PUBLIC, and a
// row under 5 distinct agents never reaches an agent even if the backend sends one.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { agentDemandEnabled, agentDemandPayload, AGENT_DEMAND_DESCRIPTION } from '../lib/agent-demand.mjs';

const BASE = 'http://127.0.0.1:1';
const TOOL = 'get_agent_demand';
const MANIFEST = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8')).tools;

// The backend contract, with a 4-agent row in every section and extra keys it must not pass on.
const SUMMARY = {
  ok: true, week: '2026-W45', week_start: '2026-11-03T00:00:00+00:00',
  week_end: '2026-11-10T00:00:00+00:00', as_of: '2026-11-11T05:55:55+00:00',
  top_markets: [{ rank: 1, market: 'Phoenix', slug: 'phoenix', agents: 8, change: 'new' },
    { rank: 2, market: 'Cheyenne', slug: 'cheyenne', agents: 4, change: 'new' }],
  states: [{ state: 'TX', agents: 11, change: 'up' }, { state: 'WY', agents: 4, change: 'new' }],
  grid_regions: [{ grid: 'PJM', agents: 20, change: 'up' }, { grid: 'SPP', agents: 4, change: 'new' }],
  mw_bands: [{ band: '100+ MW', agents: 14, change: 'up' }, { band: '5-20 MW', agents: 4, change: 'new' }],
  total_agents: 36, min_distinct_agents: 5,
  basis: 'Distinct AI agents ... Rows with fewer than 5 agents are not shown.',
  cite: 'DC Hub (dchub.cloud)', cite_as: 'DC Hub (dchub.cloud), Agent Demand Report, week 2026-W45',
  exclusions: { qa_flag: 1 }, by_tool: { rows: [] },
};
const env = (status, body) => ({ http_status: status, ok: status >= 200 && status < 300, body, text: '' });

describe('agentDemandPayload', () => {
  it('drops every row under 5 agents and keeps only the published keys', () => {
    const p = agentDemandPayload(env(200, SUMMARY));
    expect(p.status).toBe('ok');
    expect(p.top_markets.map((r) => r.slug)).toEqual(['phoenix']);
    expect(p.states.map((r) => r.state)).toEqual(['TX']);
    expect(p.grid_regions.map((r) => r.grid)).toEqual(['PJM']);
    expect(p.mw_bands.map((r) => r.band)).toEqual(['100+ MW']);
    expect(p.total_agents).toBe(36);
    expect(p.exclusions).toBeUndefined();
    expect(p.by_tool).toBeUndefined();
    expect(p.page_url).toBe('https://dchub.cloud/agent-demand');
  });
  it('withholds a total under the floor and never lowers the floor', () => {
    const p = agentDemandPayload(env(200, { ...SUMMARY, total_agents: 4, min_distinct_agents: 3 }));
    expect(p.total_agents).toBeNull();
    expect(p.min_distinct_agents).toBe(5);
    expect(p.top_markets.every((r) => r.agents >= 5)).toBe(true);
  });
  it('reads a 404 as not published and anything else as unavailable', () => {
    expect(agentDemandPayload(env(404, { ok: false, error: 'not_published' })).status).toBe('not_published');
    expect(agentDemandPayload(env(503, { ok: false })).status).toBe('unavailable');
    expect(agentDemandPayload(env(200, { ok: false, error: 'not_built_yet' })).status).toBe('unavailable');
    expect(agentDemandPayload({ http_status: 0, ok: false, body: null }).status).toBe('unavailable');
    expect(JSON.stringify(agentDemandPayload(env(404, {})))).not.toMatch(/agents/);
  });
  it('reads the flag strictly', () => {
    expect(agentDemandEnabled({})).toBe(false);
    expect(agentDemandEnabled({ AGENT_DEMAND_PUBLIC: '0' })).toBe(false);
    expect(agentDemandEnabled({ AGENT_DEMAND_PUBLIC: '1' })).toBe(true);
    expect(agentDemandEnabled({ AGENT_DEMAND_PUBLIC: 'on' })).toBe(true);
  });
  it('description carries no price or plan names', () => {
    const t = AGENT_DEMAND_DESCRIPTION.toLowerCase();
    for (const w of ['$', 'price', 'pricing', 'pro ', 'plan', 'subscribe', 'upgrade', 'trial', 'paid']) {
      expect(t.includes(w), w).toBe(false);
    }
  });
});

describe('registration follows AGENT_DEMAND_PUBLIC', () => {
  let S, realFetch, calls = [], responder = null;
  const prevFlag = process.env.AGENT_DEMAND_PUBLIC;
  beforeAll(async () => {
    realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input && input.url ? input.url : input);
      let pathname = '';
      try { pathname = new URL(url).pathname; } catch { /* not a URL */ }
      if (pathname === '/api/v1/agent-demand/summary') {
        calls.push(url);
        return responder();
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const prev = process.env.DCHUB_API_BASE;
    process.env.DCHUB_API_BASE = BASE;
    S = await import('../server.mjs');
    if (prev === undefined) delete process.env.DCHUB_API_BASE;
    else process.env.DCHUB_API_BASE = prev;
  }, 60_000);
  afterAll(() => {
    globalThis.fetch = realFetch;
    if (prevFlag === undefined) delete process.env.AGENT_DEMAND_PUBLIC;
    else process.env.AGENT_DEMAND_PUBLIC = prevFlag;
  });
  beforeEach(() => { calls = []; responder = null; });

  it('is not registered while the flag is off, so the tool count does not move', () => {
    delete process.env.AGENT_DEMAND_PUBLIC;
    const tools = S.createServer()._registeredTools;
    expect(tools[TOOL]).toBeUndefined();
    expect(MANIFEST.map((t) => (typeof t === 'object' ? t.name : t))).not.toContain(TOOL);
  });

  it('is registered while the flag is on and serves only published rows', async () => {
    process.env.AGENT_DEMAND_PUBLIC = '1';
    const T = S.createServer()._registeredTools[TOOL];
    delete process.env.AGENT_DEMAND_PUBLIC;
    expect(T).toBeDefined();
    responder = () => new Response(JSON.stringify(SUMMARY), { status: 200, headers: { 'content-type': 'application/json' } });
    const r = await T.handler({}, { signal: new AbortController().signal });
    const text = (r.content || []).map((c) => c.text || '').join('\n');
    expect(calls.length).toBe(1);
    expect(text).toContain('Phoenix');
    for (const hidden of ['Cheyenne', '"WY"', '"SPP"', '5-20 MW', 'exclusions']) expect(text).not.toContain(hidden);
  });

  it('says not published when the backend gate is still closed', async () => {
    process.env.AGENT_DEMAND_PUBLIC = '1';
    const T = S.createServer()._registeredTools[TOOL];
    delete process.env.AGENT_DEMAND_PUBLIC;
    responder = () => new Response(JSON.stringify({ ok: false, error: 'not_published' }), { status: 404, headers: { 'content-type': 'application/json' } });
    const r = await T.handler({}, { signal: new AbortController().signal });
    const text = (r.content || []).map((c) => c.text || '').join('\n');
    expect(text).toContain('not_published');
    expect(text).not.toContain('Phoenix');
  });
});
