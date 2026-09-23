// infra-projects-tool.test.mjs — (2026-09-23)
//
// get_infra_projects reads dchub-backend GET /api/v1/infra-projects: gas
// pipeline projects (EIA, public domain, US-wide) and transmission projects
// (ERCOT TPIT, terms §5, Texas only). It is a free citation hook in the SAME
// tier class as get_power_pipeline, so what must hold:
//
//   * the arguments reach the backend as the endpoint names them
//     (include_delisted true -> 1, false -> absent; limit defaults to 25);
//   * an ANONYMOUS caller gets every row the backend returned — the anon trim
//     (trimForTrial) that masks $-aggregates must not touch public facts;
//   * a PAID seat is never shown an upsell;
//   * tools/list advertises it with exactly get_power_pipeline's access tag;
//   * a backend error comes back as data, not a crash.
//
// A stub backend, because a test against an unreachable API_BASE never enters
// the success branch. The stub counts its hits so a guard that did not run fails.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub;
const seen = [];

const LICENSE_TX = 'ERCOT website terms §5: public raw data may be used, reproduced and redistributed in compilations — https://www.ercot.com/help/terms';
const txRows = Array.from({ length: 30 }, (_, i) => ({
  project_number: `26TPIT${String(i).padStart(4, '0')}`, title: `Line ${i}`, status: 'Planned',
  kv: 345, miles_new: 10 + i, projected_isd: '2028-06-01', first_seen_at: '2026-09-23T00:00:00+00:00',
  in_initial_load: true, in_latest_release: true,
  source_url: 'https://www.ercot.com/gridinfo/planning', license: LICENSE_TX,
}));
function body(q) {
  if (q.get('state') === 'ZZ') return null;
  return {
    ok: true, type: q.get('type') || 'all', types_queried: ['transmission'],
    filters: { min_kv: Number(q.get('min_kv')) || null }, ignored: [],
    summary: { matching: 30, returned: 30, truncated: false,
               as_of: { gas_pipeline: null, transmission: '2026-07-13' },
               by_type: { gas_pipeline: null, transmission: { matching: 30, returned: 30,
                          by_status: { Planned: 30 }, by_state: { TX: 30 },
                          total_miles_new: 735, total_miles_rebuilt: 0 } } },
    gas_pipeline_projects: null, transmission_projects: txRows,
    sources: { gas_pipeline: null, transmission: { name: 'ERCOT TPIT', license: LICENSE_TX,
               source_url: 'https://www.ercot.com/gridinfo/planning', as_of: '2026-07-13',
               coverage: 'ERCOT (Texas) only — no other ISO or utility yet' } },
    coverage_note: 'Transmission projects are ERCOT (Texas) only so far.',
  };
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      const u = new URL(req.url, 'http://_');
      if (u.pathname === '/api/v1/keys/validate') {
        const k = req.headers['x-api-key'] || u.searchParams.get('key') || '';
        const pro = String(k).includes('pro');
        res.end(JSON.stringify({ valid: true, tier: pro ? 'pro' : 'free',
          developer_id: pro ? 'dev_infra_pro' : 'dev_infra_free',
          email: pro ? 'pro@example.com' : null }));
        return;
      }
      if (u.pathname.startsWith('/api/v1/mcp/')) { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      if (u.pathname === '/api/v1/infra-projects') {
        seen.push(u.searchParams);
        const b = body(u.searchParams);
        if (!b) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: 'db down' })); return; }
        res.end(JSON.stringify(b));
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

const call = (args, key) => rpc('tools/call', { name: 'get_infra_projects', arguments: args }, key);
const rowsOf = (r) => {
  const sc = r.structuredContent
    || (() => { try { return JSON.parse((r.content || [])[0].text); } catch { return {}; } })();
  return sc;
};

describe('get_infra_projects', () => {
  it('sends the endpoint its own argument names', async () => {
    const n = seen.length;
    await call({ type: 'transmission', min_kv: 345, include_delisted: true, new_since: '2026-09-01' });
    expect(seen.length, 'the stub never saw the call — this guard ran nothing').toBe(n + 1);
    const q = seen[n];
    expect(q.get('type')).toBe('transmission');
    expect(q.get('min_kv')).toBe('345');
    expect(q.get('include_delisted')).toBe('1');
    expect(q.get('new_since')).toBe('2026-09-01');
    expect(q.get('limit')).toBe('25');
    await call({ type: 'gas_pipeline', include_delisted: false, limit: 400 });
    expect(seen[n + 1].get('include_delisted')).toBe(null);
    expect(seen[n + 1].get('limit')).toBe('200');
  });

  it('an anonymous caller gets every row, with source and license', async () => {
    const r = await call({ type: 'transmission' });
    const sc = rowsOf(r);
    expect(sc.transmission_projects).toHaveLength(30);
    expect(sc.transmission_projects.every((x) => x.license === LICENSE_TX)).toBe(true);
    expect(sc.sources.transmission.license).toBe(LICENSE_TX);
    expect(sc.summary.by_type.transmission.total_miles_new).toBe(735);
    expect(JSON.stringify(r)).not.toContain('sign up to unlock');
    expect(sc.see_also.generation_projects).toBe('get_power_pipeline');
  });

  it('a paid seat gets the same rows and no upsell', async () => {
    const r = await call({ type: 'transmission' }, 'dch_live_infra_pro_seat');
    const sc = rowsOf(r);
    expect(sc.transmission_projects).toHaveLength(30);
    expect(JSON.stringify(r)).not.toMatch(/upgrade|sign up to unlock|claim_free_key|\/pricing/i);
  });

  it('is advertised with exactly get_power_pipeline\'s access tag', async () => {
    const r = await rpc('tools/list', {});
    const byName = Object.fromEntries((r.tools || []).map((t) => [t.name, t]));
    expect(byName.get_infra_projects, 'get_infra_projects is not in tools/list').toBeTruthy();
    const tag = (n) => JSON.stringify(byName[n]._meta['cloud.dchub/access'])
      .replaceAll(n, '<tool>');
    expect(tag('get_infra_projects')).toBe(tag('get_power_pipeline'));
    expect(byName.get_infra_projects._meta['cloud.dchub/access'].access).toBe('free');
  });

  it('a backend failure comes back as data, not a crash', async () => {
    const r = await call({ state: 'ZZ' });
    const sc = rowsOf(r);
    expect(sc.error).toMatch(/API 500/);
    expect(sc.transmission_projects).toBeUndefined();
  });
});
