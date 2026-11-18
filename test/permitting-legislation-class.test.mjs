// permitting-legislation-class.test.mjs — (2026-11-18, owner note feature 5)
//
// Bill status rides get_permitting_intel as class=legislation (dchub-backend
// GET /api/v1/permitting/intel?class=legislation[&topic=]), and status changes
// reach register_standing_intent kind=permitting_change through two optional
// params, scope and topic. What must hold:
//
//   * class=legislation and topic reach the backend; a plain call sends no topic;
//   * an anonymous caller gets every bill with every field (bill status is a
//     public fact: no trim);
//   * permitting_change sends scope/topic in params; another kind never does;
//   * an invalid topic is refused before any backend call.
//
// A stub backend counts its hits so a guard that never reached it fails.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub;
const seen = [];
const posted = [];

const BILL_FIELDS = ['bill_id', 'jurisdiction', 'stage', 'last_action', 'last_action_date',
  'next_action', 'next_action_date', 'effective_date', 'impact_tag', 'official_url', 'as_of'];
// Fictional bills (Testland), shaped like the backend response.
const bills = Array.from({ length: 14 }, (_, i) => ({
  bill_id: `ZZ HB ${9000 + i} (2026)`, jurisdiction: 'Testland', state: 'ZZ',
  title: 'Data center sales and use tax exemption', stage: 'passed_chamber',
  last_action: 'Passed House', last_action_date: '2026-11-05',
  next_action: null, next_action_date: null,
  next_action_basis: 'the source publishes no scheduled next step for this bill',
  effective_date: null, effective_date_basis: 'not stated in the source\'s actions or summary',
  impact_tag: 'tax_incentive', impact_tags: ['tax_incentive'],
  official_url: `https://legislature.example.gov/2026/HB${9000 + i}`,
  as_of: '2026-11-18T06:00:00+00:00',
}));

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      const u = new URL(req.url, 'http://_');
      if (u.pathname === '/api/v1/keys/validate') {
        res.end(JSON.stringify({ valid: true, tier: 'free', developer_id: 'dev_leg', email: 'a@example.com' }));
        return;
      }
      if (u.pathname.startsWith('/api/v1/mcp/')) { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      if (u.pathname === '/api/v1/permitting/intel') {
        seen.push(u.searchParams);
        if (u.searchParams.get('class') === 'legislation') {
          res.end(JSON.stringify({ ok: true, class: 'legislation', loaded: true, count: bills.length,
            bills, as_of: '2026-11-18T06:00:00+00:00',
            _cite: 'Bill status: Open States / Plural Policy; compiled by DC Hub (dchub.cloud)' }));
        } else {
          res.end(JSON.stringify({ ok: true, count: 0, records: [] }));
        }
        return;
      }
      if (u.pathname === '/api/v1/agentic/intents' && req.method === 'POST') {
        let b = '';
        req.on('data', (c) => { b += c; });
        req.on('end', () => {
          posted.push(JSON.parse(b || '{}'));
          res.statusCode = 201;
          res.end(JSON.stringify({ ok: true, intent_id: 'abc', secret: 's' }));
        });
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
});

async function rpc(method, params, key) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               ...(key ? { 'x-api-key': key } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return JSON.parse(json).result || {};
}
const call = (name, args, key) => rpc('tools/call', { name, arguments: args }, key);
const sc = (r) => r.structuredContent
  || (() => { try { return JSON.parse((r.content || [])[0].text); } catch { return {}; } })();

describe('get_permitting_intel class=legislation', () => {
  it('sends class and topic; a plain call sends no topic', async () => {
    const n = seen.length;
    await call('get_permitting_intel', { class: 'legislation', topic: 'water', state: 'VA' });
    expect(seen.length, 'the stub never saw the call — this guard ran nothing').toBe(n + 1);
    expect(seen[n].get('class')).toBe('legislation');
    expect(seen[n].get('topic')).toBe('water');
    expect(seen[n].get('state')).toBe('VA');
    await call('get_permitting_intel', { class: 'zoning' });
    expect(seen[n + 1].get('topic')).toBe(null);
  });

  it('an anonymous caller gets every bill with every field', async () => {
    const out = sc(await call('get_permitting_intel', { class: 'legislation' }));
    expect(out.bills).toHaveLength(14);
    for (const b of out.bills) for (const k of BILL_FIELDS) expect(b, k).toHaveProperty(k);
    expect(out.bills[0].official_url).toMatch(/^https:\/\//);
  });

  it('refuses an unknown topic before reaching the backend', async () => {
    const n = seen.length;
    const r = await call('get_permitting_intel', { class: 'legislation', topic: 'moratorium' });
    expect(r.isError).toBe(true);
    expect(seen.length).toBe(n);
  });

  it('lists the class and topic on /mcp', async () => {
    const r = await rpc('tools/list', {});
    const t = (r.tools || []).find((x) => x.name === 'get_permitting_intel');
    expect(t, 'get_permitting_intel missing from tools/list').toBeTruthy();
    expect(t.inputSchema.properties.class.description).toMatch(/legislation/);
    expect(t.inputSchema.properties.topic.enum).toEqual(
      ['tax_incentive', 'large_load_ratepayer', 'water', 'noise', 'siting']);
  });
});

describe('register_standing_intent kind=permitting_change', () => {
  it('sends scope and topic in params for permitting_change only', async () => {
    const n = posted.length;
    await call('register_standing_intent', { kind: 'permitting_change', webhook_url: 'https://hooks.example.com/x',
      state: 'VA', scope: 'legislation', topic: 'large_load_ratepayer' }, 'dchub_test_key_leg');
    expect(posted.length, 'the stub never saw the POST — this guard ran nothing').toBe(n + 1);
    expect(posted[n].kind).toBe('permitting_change');
    expect(posted[n].params).toEqual({ state: 'VA', scope: 'legislation', topic: 'large_load_ratepayer' });
    await call('register_standing_intent', { kind: 'news_keyword', webhook_url: 'https://hooks.example.com/x',
      q: 'moratorium', scope: 'legislation', topic: 'water' }, 'dchub_test_key_leg');
    expect(posted[n + 1].params).toEqual({ q: 'moratorium' });
  });
});
