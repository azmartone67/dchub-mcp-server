// rank_markets asks for the email on every criterion and region it accepts (2026-11-11).
//
// Funnel no_ask_split since 11-10 10:45Z: rank_markets on platform cursor, first wall in its session,
// no ask (never_asked_in_session). The rows email ask (lib/paid-sell-line.mjs rankEmailClause) rides the
// rank sell line, and rankMarketsSellLine returned null for any criterion or region missing from its
// label maps: most_capacity, most_operators, fastest_growing; canada, apac, americas; and a US state
// (region "TX", which the backend echoes as region_state). The planner itself hints most_capacity.
// Reproduced on main: in session, cursor, keyless, criteria most_capacity -> wall, email_ask none,
// offers ["pro"].
//
// Pure half: every value the tool's own schema quotes has a label (a value added to the schema without
// one fails here). Wire half: the real /mcp handler, keyless, in session, every criterion x region.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { rankMarketsSellLine, RANK_CRITERIA_LABELS, RANK_REGION_LABELS } from '../lib/paid-sell-line.mjs';

const RANK_ROWS = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, market: 'm' + i, name: 'Market ' + i, score: 90 - i,
  total_mw: 1000 - i * 10, facility_count: 50 - i, operator_count: 20 - i }));
const LINE = { total: 10, shown: 5, scoreHidden: true, mwHidden: true, url: 'https://dchub.cloud/u/abcdef' };
const quoted = (s) => [...String(s || '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

// Literal, not Object.keys(the label maps): a label dropped from a map must still be called here.
// The first pure test pins these lists to the schema, so they cannot drift from what the tool accepts.
const CRITERIA = ['best_overall', 'cheapest_power', 'ai_ready', 'most_capacity', 'most_operators', 'fastest_growing'];
const REGIONS = ['us', 'global', 'eu', 'canada', 'apac', 'americas', 'tx'];
let H, fence, schema;
const events = [];
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_PAID_SELL_LINE: '1' },
    extraRoutes: (p, req, body, u) => {
      if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
      if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      if (p.startsWith('/api/v1/mcp/tools/rank_markets')) {
        // The backend's echo (routes/mcp_tier1_tools.py): criteria / region lower-cased, a US state as region_state.
        const a = (body && (body.arguments || body)) || {};
        const criteria = String(u.searchParams.get('criteria') || a.criteria || 'best_overall').toLowerCase();
        const region = String(u.searchParams.get('region') || a.region || 'us').toLowerCase();
        return { criteria, region, ...(region === 'tx' ? { region_state: 'TX' } : {}), results: RANK_ROWS, result_count: RANK_ROWS.length };
      }
      return undefined;
    },
  });
  const list = await H.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'user-agent': 'node' });
  const tools = (list.msg && list.msg.result && list.msg.result.tools) || [];
  schema = ((tools.find((t) => t.name === 'rank_markets') || {}).inputSchema || {}).properties || {};
}, 60_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('rankMarketsSellLine labels (pure)', () => {
  it('every criterion and region the rank_markets schema quotes has a label', () => {
    const crit = quoted(schema.criteria && schema.criteria.description);
    const reg = quoted(schema.region && schema.region.description);
    expect([...crit].sort()).toEqual([...CRITERIA].sort());
    expect([...reg, 'tx'].sort()).toEqual([...REGIONS].sort());
    expect(crit.filter((k) => !Object.prototype.hasOwnProperty.call(RANK_CRITERIA_LABELS, k))).toEqual([]);
    expect(reg.filter((k) => !Object.prototype.hasOwnProperty.call(RANK_REGION_LABELS, k))).toEqual([]);
    for (const criteria of crit) for (const region of reg) {
      expect(rankMarketsSellLine({ criteria, region, ...LINE }), `${criteria}/${region}`).toMatch(/^This free DC Hub .+ ranking of .+ markets shows 5 of 10/);
    }
  });
  it('a US state region takes the code the backend matched', () => {
    expect(rankMarketsSellLine({ criteria: 'most_capacity', region: 'texas', regionState: 'TX', ...LINE }))
      .toMatch(/^This free DC Hub capacity ranking of TX markets shows 5 of 10/);
  });
  it('never guesses a label', () => {
    for (const [criteria, region, regionState] of [['weird', 'us'], ['best_overall', 'mars'], ['constructor', 'us'],
      ['best_overall', '__proto__'], ['best_overall', 'tx', 'tx'], ['best_overall', 'tx', 'TEX'], [undefined, undefined]]) {
      expect(rankMarketsSellLine({ criteria, region, regionState, ...LINE }), `${criteria}/${region}/${regionState}`).toBeNull();
    }
  });
});

let ip = 1;
describe('rank_markets wall, keyless, in session (cursor): the first wall asks on every criterion and region', () => {
  it.each(CRITERIA.flatMap((c) => REGIONS.map((r) => [c, r])))('%s / %s', async (criteria, region) => {
    const hdr0 = { 'user-agent': 'node', 'x-dc-client-ip': `198.51.100.${ip++ % 250 + 1}` };
    const sid = (await H.init('/mcp', 'cursor', hdr0)).headers.get('mcp-session-id');
    const hdr = { ...hdr0, 'mcp-session-id': sid };
    await H.post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, hdr);
    const before = events.length;
    const r = await H.call('/mcp', 'rank_markets', { criteria, region, limit: 10 }, hdr);
    for (let i = 0; i < 100 && events.length === before; i++) await new Promise((res) => setTimeout(res, 20));
    const rows = events.slice(before).filter((e) => e.tool === 'rank_markets');
    const text = ((r.msg && r.msg.result && r.msg.result.content) || []).map((c) => c.text || '').join('\n');
    expect(rows.map((e) => [e.session_id, e.email_ask])).toEqual([[sid, 'line']]);
    expect(text).toMatch(/`bind_email` with it shows all \d+ markets in this ranking/);
  });
});
