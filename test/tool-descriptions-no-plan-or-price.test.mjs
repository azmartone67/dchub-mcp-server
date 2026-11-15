// tool-descriptions-no-plan-or-price.test.mjs — owner listing rule 2026-11-14.
//
// Public listing surfaces name no plan and state no price: no "free tier" / "paid plan" wording, no
// plan names, no /pricing link. mcp#1436 applied it to the npm README, smithery.yaml, mcp-server.json
// and the dxt manifest. tools/list is a listing surface too: directories (Glama, Smithery, PulseMCP,
// the official registry's mirrors) and every connected agent read the descriptions verbatim. Measured
// live on /mcp?catalog=full 2026-11-15 (2.12.55): "free tier" in search_facilities,
// search_intelligence, set_market_alert, set_site_alert and get_water_risk; "paid plan" in
// export_dataset; "Paid plans" + "FREE tier" in unlock_more_data; "paid DC Hub plan" / "paid key" /
// "the DC Hub plan that includes every tool" in eleven more.
//
// This guard reads the SERVED tools/list (not a grep of server.mjs) on every MCP path that lists
// tools, and checks each tool's description, title and every description string inside its
// inputSchema. Energy, electricity and deal-value prices are data, not plan pricing: the dollar
// phrases a tool legitimately carries are allowlisted by tool, and each allowlist entry must still be
// present (so the allowlist cannot quietly outlive its reason).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

// Plan / price wording. Case-insensitive. "free key" (what claim_free_key issues) and "full-access
// key" are not plan wording; "free tier", "paid plan", "paid key" and a dollar figure are.
export const PLAN_OR_PRICE = new RegExp([
  '\\bfree[- ]tiers?\\b',
  '\\bpaid (?:DC Hub )?(?:plans?|tiers?|keys?)\\b',
  // a DC Hub plan as a noun; "DC Hub plans the lookups" (execute_plan, the verb) is not plan wording
  '\\bDC Hub plan\\b',
  '\\bDC Hub plans\\b(?!\\s+(?:the|a|an|its|each|and)\\b)',
  '\\bpro tier\\b',
  '\\bpricing page\\b',
  '/pricing\\b',
  '\\bfounding\\b',
  '\\bstarter plan\\b',
  '\\bdeveloper plan\\b',
  '\\$\\s?\\d',
].join('|'), 'i');

// Energy / market / deal-value phrases that carry a dollar sign on purpose. tool -> exact phrases.
export const PRICE_ALLOWLIST = {
  hyperscaler_deals: ['($1B+/week typical)', 'the live $1B+ AI-capex feed'],
  list_transactions: ['e.g. 1000000000 for $1B+'],
};

const PATHS = ['/mcp?catalog=full', '/mcp', '/mcp/oauth', '/mcp/claude', '/mcp/chatgpt', '/mcp/core', '/mcp/grok'];
let httpServer, stub, PORT;
const LISTS = {};

async function toolsList(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return (JSON.parse(json).result || {}).tools || [];
}

beforeAll(async () => {
  stub = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
  for (const p of PATHS) LISTS[p] = await toolsList(p);
}, 60000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
});

// Every agent-visible string of one tool: [where, text].
export function toolStrings(t) {
  const out = [['description', t.description || ''], ['title', t.title || (t.annotations || {}).title || '']];
  const walk = (o, at, d = 0) => {
    if (!o || typeof o !== 'object' || d > 12) return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'description' && typeof v === 'string') out.push([`${at}.description`, v]);
      else walk(v, `${at}.${k}`, d + 1);
    }
  };
  walk(t.inputSchema, 'inputSchema');
  return out;
}

export function offenders(tools) {
  const hits = [];
  for (const t of tools) {
    for (const [where, text] of toolStrings(t)) {
      let s = text;
      for (const ok of PRICE_ALLOWLIST[t.name] || []) s = s.split(ok).join('');
      const m = PLAN_OR_PRICE.exec(s);
      if (m) hits.push(`${t.name} ${where}: "…${s.slice(Math.max(0, m.index - 50), m.index + m[0].length + 30)}…"`);
    }
  }
  return hits;
}

describe('tool descriptions name no plan and state no price (owner listing rule 2026-11-14)', () => {
  it('the full catalog is served (non-vacuous)', () => {
    expect(LISTS['/mcp?catalog=full'].length).toBeGreaterThanOrEqual(90);
    for (const p of PATHS) expect(LISTS[p].length, `${p} served no tools`).toBeGreaterThan(0);
  });

  for (const p of PATHS) {
    it(`${p}: no plan or price wording in any description, title or parameter text`, () => {
      expect(offenders(LISTS[p])).toEqual([]);
    });
  }

  it('every allowlisted energy/deal price phrase is still served (the allowlist does not outlive its reason)', () => {
    const full = LISTS['/mcp?catalog=full'];
    for (const [name, phrases] of Object.entries(PRICE_ALLOWLIST)) {
      const t = full.find((x) => x.name === name);
      expect(t, `${name} missing from the full catalog`).toBeTruthy();
      const all = toolStrings(t).map(([, s]) => s).join('\n');
      for (const ph of phrases) expect(all, `${name}: allowlisted "${ph}" no longer served`).toContain(ph);
    }
  });

  it('the pattern catches the measured 2026-11-15 copy (must-fail control)', () => {
    for (const bad of [
      'limit 1-500 (free tier 25); page with offset.',
      'and the free tier is capped per day',
      'On the free tier, email alerts are delivered',
      'or "webhook" (paid plan)',
      'Joined to USGS water-stress + US Drought Monitor. Free tier.',
      'Paid plans: on the page behind the human_url link. Want the FREE tier instead',
      'other scores and figures need a paid DC Hub plan.',
      'numeric sub-scores and the narrative come with the DC Hub plan that includes every tool.',
      'MW and specs need a paid key.',
      ' Full results need a paid DC Hub key.',
      'Paid DC Hub plans include webhooks',
      'see https://dchub.cloud/pricing',
      'Pro $99/mo',
    ]) expect(bad, bad).toMatch(PLAN_OR_PRICE);
    for (const ok of [
      'a free key adds factor bands', 'other scores and figures need a full-access key.',
      'get_energy_prices returns $/MWh', 'a time-of-use price', 'call claim_free_key',
      'DC Hub plans the lookups (markets, grid, fiber)', 'Full results need a full-access DC Hub key.',
    ]) expect(ok, ok).not.toMatch(PLAN_OR_PRICE);
    // an allowlisted phrase passes only on its own tool
    const deal = { name: 'hyperscaler_deals', description: 'the live $1B+ AI-capex feed', inputSchema: {} };
    expect(offenders([deal])).toEqual([]);
    expect(offenders([{ ...deal, name: 'get_news' }]).length).toBe(1);
  });
});
