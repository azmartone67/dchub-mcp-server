// planner-532-colocation-e2e.test.mjs — the colocation head-to-head (Brain note 2026-11-16) as a regression
// eval, through the real /mcp handler on a real port (every plan step is a real loopback) against a stub
// backend that answers like production: /api/v1/facilities/<market slug> is a 404, facility slugs resolve.
//
// For each question it asserts: the colocation (or pricing_out_of_scope) class is set; the metro is resolved,
// not widened to the state; no step failed (no 404 step); get_facility never ran on a market slug; the kW size
// was applied or named in dropped_filters; the answer leads with the asked market; and the answer carries no
// price, plan or credit wording.
//
// The note's REPORT.md (the exact six questions) was not reachable from this machine; these are the six
// questions as the note describes them (NoVA 500 kW, Dallas compare, Atlanta available now, Chicago fiber,
// a two-facility compare, and a colocation price ask).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { isMarketSlug } from '../lib/colocation-plan.mjs';

const SECRET = 'planner-532-colo-internal-key-not-real';
const FAC = {
  'Northern Virginia': [{ slug: 'ntt-ashburn-va7-data-center-ashburn-0809b12f', name: 'NTT Ashburn VA7 Data Center', city: 'Ashburn', state: 'VA', as_of: '2026-03-30' },
    { slug: 'cyrusone-sterling-va-nva9-a1e6f66f', name: 'Sterling, VA, NVA9', city: 'Sterling', state: 'VA', as_of: '2026-03-30' }],
  Dallas: [{ slug: 'equinix-equinix-infomart-a9d628bb', name: 'Equinix Infomart', city: 'Dallas', state: 'TX', as_of: '2026-03-30' },
    { slug: 'digital-realty-dfw36-dallas-38386734', name: 'Digital Realty DFW36', city: 'Dallas', state: 'TX', as_of: '2026-03-30' }],
  Atlanta: [{ slug: 'qts-atlanta-metro-1a2b3c4d', name: 'QTS Atlanta Metro', city: 'Atlanta', state: 'GA', as_of: '2026-03-30' }],
  Chicago: [{ slug: 'digital-realty-350-e-cermak-5e6f7a8b', name: '350 E Cermak', city: 'Chicago', state: 'IL', as_of: '2026-03-30' }],
  'Equinix DC2': [{ slug: 'equinix-dc2-ashburn-0a1b2c3d', name: 'Equinix DC2', city: 'Ashburn', state: 'VA', as_of: '2026-03-30' }],
  'CoreSite VA1': [{ slug: 'coresite-va1-reston-4e5f6a7b', name: 'CoreSite VA1', city: 'Reston', state: 'VA', as_of: '2026-03-30' }],
};
const ALL_FAC = new Map(Object.values(FAC).flat().map((f) => [f.slug, f]));
const DCPI = { 'northern-virginia': ['AVOID', 20], dallas: ['CAUTION', 42], atlanta: ['AVOID', 20.7], chicago: ['AVOID', 21.9] };
const seen = [];   // every backend path the plan reached

let stub, httpServer, PORT;
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const u = new URL(req.url, 'http://stub');
      const p = u.pathname;
      seen.push(p + u.search);
      const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      let m;
      if ((m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p))) {
        const v = DCPI[m[1]];
        return v ? send({ market_slug: m[1], verdict: v[0], composite_score: v[1], computed_at: '2026-11-17T00:39:23Z' }) : send({ error: 'not found' }, 404);
      }
      if (p === '/api/v1/facilities') {
        const q = u.searchParams.get('q') || u.searchParams.get('query') || '';
        const rows = FAC[q] || [];
        return send({ success: true, total_matching: rows.length ? 600 + rows.length : 0, data: rows });
      }
      if ((m = /^\/api\/v1\/facilit(?:y|ies)\/([^/]+)$/.exec(p))) {
        const f = ALL_FAC.get(decodeURIComponent(m[1]));
        return f ? send({ data: { ...f, operator: f.name.split(' ')[0], fiber_carrier_count: 12 } }) : send({ error: 'Facility not found' }, 404);
      }
      if (p.startsWith('/api/v1/grid/intelligence/')) return send({ iso: p.split('/').pop().toUpperCase(), avg_time_to_power_months: 44.9, as_of: '2026-11-16T00:00:00Z' });
      if (p === '/api/v1/dcpi/iso-comparison') {
        return send({ isos: ['ERCOT', 'PJM'].map((iso) => ({ iso, market_count: 12, avg_constraint: 41.2, avg_excess: 63.5, avg_time_to_power_months: 44.9,
          avg_queue_wait_months: 52, avg_kwh_cents: 8.1, sum_emergency_30d: 2 })) });
      }
      if (p.startsWith('/api/v1/grid/extended/')) return send({ iso: p.split('/').pop(), demand_mw: 52000, as_of: '2026-11-16T00:00:00Z' });
      if (p.startsWith('/api/v1/mcp/full-cap/')) return send({ ok: false });
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  process.env.PORT = String(await freePort());
  const S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'Mozilla/5.0', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  return raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
}
let ipN = 40;
async function plan(args) {
  const h0 = { 'x-forwarded-for': `198.18.92.${ipN++}` };
  const init = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'Mozilla/5.0', ...h0 },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } }) });
  await init.text();
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const body = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'execute_plan', arguments: args } });
  const r = JSON.parse(body).result;
  return r.structuredContent || JSON.parse(r.content[0].text);
}

const H2H = [
  { args: { intent: 'Colocation options in Northern Virginia (Ashburn) for about 500 kW', context: { market: 'Northern Virginia', state: 'VA' } },
    cls: 'colocation', lead: 'Northern Virginia', query: 'Northern Virginia', kw: 0.5 },
  { args: { intent: 'Compare colocation in Dallas vs Northern Virginia for 1 MW' }, cls: 'colocation', lead: 'Dallas-Fort Worth', dcpiName: 'Dallas', query: 'Dallas', kw: 1 },
  { args: { intent: 'Colocation space available now in Atlanta for 300 kW' }, cls: 'colocation', lead: 'Atlanta', query: 'Atlanta', kw: 0.3 },
  { args: { intent: 'Carrier-neutral colocation with strong fiber in Chicago' }, cls: 'colocation', lead: 'Chicago', query: 'Chicago' },
  { args: { intent: 'Compare Equinix DC2 vs CoreSite VA1 for colocation in Ashburn' }, cls: 'colocation', lead: 'Northern Virginia', pair: true },
  { args: { intent: 'What does colocation cost per kW in Dallas?' }, cls: 'pricing_out_of_scope', lead: 'Dallas' },
];
const PRICE_PLAN_WORDING = /\$\s?\d|\bcredits?\b|free key|calls?\s*\/\s*day|per day|higher limits|free tier|fee only on close/i;

describe('colocation head-to-head eval (planner 5.32, real server, stub backend)', () => {
  for (const q of H2H) {
    describe(q.args.intent, () => {
      let o;
      beforeAll(async () => { o = await plan(q.args); }, 120_000);

      it(`intent_class is ${q.cls}`, () => { expect(o.intent_class).toBe(q.cls); expect(o.planner_version).toBe('5.35'); });

      it('no step failed (no 404 step) and get_facility never ran on a market slug', () => {
        const bad = o.executed.filter((e) => e.status === 'failed');
        expect(bad.map((e) => `${e.tool} ${JSON.stringify(e.args)}`)).toEqual([]);
        for (const e of o.executed.filter((x) => x.tool === 'get_facility' && x.status === 'executed')) {
          expect(isMarketSlug(e.args.slug || e.args.facility_id || e.args.id), JSON.stringify(e.args)).toBe(false);
        }
        expect(seen.filter((p) => /\/api\/v1\/facilit(?:y|ies)\/(?:northern-virginia|dallas(?:-tx)?|atlanta(?:-ga)?|chicago(?:-il)?)(?:\?|$)/.test(p))).toEqual([]);
      });

      if (q.query) {
        it('the metro is resolved, not widened to the state', () => {
          const sf = o.executed.filter((e) => e.tool === 'search_facilities');
          expect(sf.length).toBeGreaterThan(0);
          expect(sf.map((e) => e.args.query)).toContain(q.query);
          for (const e of sf) expect(e.args.query, 'a facility search with only a state is a widened search').toBeTruthy();
        });
      }

      if (q.pair) {
        it('each named facility is read from its own search row', () => {
          const gf = o.executed.filter((e) => e.tool === 'get_facility' && e.status === 'executed').map((e) => e.args.slug);
          expect(gf).toEqual(['equinix-dc2-ashburn-0a1b2c3d', 'coresite-va1-reston-4e5f6a7b']);
        });
      }

      if (q.kw) {
        it('the kW size is applied or named in dropped_filters', () => {
          const sf = o.executed.filter((e) => e.tool === 'search_facilities');
          const applied = sf.some((e) => e.args.min_capacity_mw === q.kw);
          const dropped = (o.dropped_filters || []).some((d) => d.tool === 'search_facilities' && d.param === 'min_capacity_mw');
          expect(applied || dropped).toBe(true);
          if (!applied) expect(o.answer_guide).toMatch(/min_capacity_mw/);
        });
      }

      it(`the answer leads with ${q.lead}, not another market`, () => {
        const ia = o.intent_answer;
        expect(ia, 'intent_answer').toBeTruthy();
        expect(ia.kind).toBe('colocation');
        if (q.cls === 'pricing_out_of_scope') expect(ia.headline).toMatch(/^DC Hub doesn't publish colocation pricing\./);
        else if (q.pair) {
          // Grok re-run 2026-11-17 (Q-b): a named pair leads side by side, then the market's DCPI.
          expect(ia.headline).toMatch(/^Equinix DC2 \(.*\) vs CoreSite VA1 \(/);
          expect(ia.headline).toContain(`Data Center Power Index (DCPI) for ${q.lead}:`);
          expect(ia.side_by_side.map((x) => x.name)).toEqual(['Equinix DC2', 'CoreSite VA1']);
        } else expect(ia.headline.startsWith(`Data Center Power Index (DCPI) for ${q.lead}:`)).toBe(true);
        expect(ia.headline).not.toMatch(/Culpeper|Aldie|Chester|Fayetteville|Social Circle|Marietta/);
        if (q.cls === 'colocation' && !q.pair) expect(o.dcpi_verdict && o.dcpi_verdict.text).toMatch(new RegExp(`^Data Center Power Index \\(DCPI\\): ${q.dcpiName || q.lead}`));
      });

      it('no price, plan or credit wording in the answer', () => {
        expect(JSON.stringify(o.intent_answer)).not.toMatch(PRICE_PLAN_WORDING);
        expect(JSON.stringify(o.dcpi_verdict || {})).not.toMatch(PRICE_PLAN_WORDING);
      });
    });
  }
});
