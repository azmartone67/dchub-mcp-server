// interconnection-queue-neso.test.mjs — (2026-11-18, be#8980)
//
// get_interconnection_queue takes iso=NESO (Great Britain). The backend's
// /api/v1/interconnection-queue/by-iso already answers NESO with the NESO
// aggregate row, and be#8980 attaches the NESO TEC Register project rows plus
// their licence block (projects_source). The MCP strict US-ISO check refused
// NESO before the call left this server. What must hold:
//
//   * NESO, and NGESO / GB folded to NESO, pass the validator for this tool
//     only; get_iso_context stays US-only, and UK is not folded (NESO's
//     register is Great Britain, not Northern Ireland);
//   * the backend sees iso=NESO, whatever spelling the caller used;
//   * the TEC rows and their NESO licence attribution reach the caller;
//   * an invalid iso on this tool names NESO as a valid choice.
//
// A stub backend counts its hits so a guard that never reached it fails.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub;
const seen = [];

const NESO_ROW = {
  iso: 'NESO', as_of: '2026-10-02', queued_generation_gw: null, queued_load_total_gw: 700,
  queued_load_total_gw_basis: 'mixed_connection_queue',
  source_name: 'NESO TEC Register', source_url: 'https://www.neso.energy/data-portal/transmission-entry-capacity-tec-register',
  project_count: 2,
  projects: [
    { iso: 'NESO', project_name: 'Example Wind Farm', capacity_mw: 1500, queue_status: 'Consents Approved',
      is_demand: false, connection_date: '2030-10-31' },
    { iso: 'NESO', project_name: 'Example Data Centre', capacity_mw: 300, queue_status: 'Scoping',
      is_demand: true, connection_date: '2031-04-01' },
  ],
  projects_source: {
    source: 'NESO TEC Register', url: 'https://www.neso.energy/data-portal/transmission-entry-capacity-tec-register',
    license: 'NESO Open Data Licence', license_url: 'https://www.neso.energy/data-portal/ngeso-open-licence',
    attribution: 'Supported by National Energy SO Open Data',
  },
};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      const u = new URL(req.url, 'http://_');
      if (u.pathname === '/api/v1/keys/validate') {
        res.end(JSON.stringify({ valid: true, tier: 'pro', developer_id: 'dev_neso_pro', email: 'pro@example.com' }));
        return;
      }
      if (u.pathname.startsWith('/api/v1/mcp/')) { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      if (u.pathname === '/api/v1/interconnection-queue/by-iso') {
        seen.push(u.searchParams);
        if (u.searchParams.get('iso') === 'NESO') { res.end(JSON.stringify(NESO_ROW)); return; }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'iso_not_found', iso: u.searchParams.get('iso') }));
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
const call = (args, key) => rpc('tools/call', { name: 'get_interconnection_queue', arguments: args }, key);
const sc = (r) => r.structuredContent
  || (() => { try { return JSON.parse((r.content || [])[0].text); } catch { return {}; } })();

describe('get_interconnection_queue: iso=NESO validation', () => {
  it('NESO and its folded spellings pass for the queue tool', () => {
    for (const v of ['NESO', 'neso', ' NESO ', 'NGESO', 'ngeso', 'GB'])
      expect(S._validateToolArgs('get_interconnection_queue', { iso: v }), v).toBeNull();
  });
  it('the US ISOs still pass and an unknown code is still refused', () => {
    for (const v of ['ERCOT', 'PJM', 'ISO-NE', 'NEISO'])
      expect(S._validateToolArgs('get_interconnection_queue', { iso: v }), v).toBeNull();
    const r = S._validateToolArgs('get_interconnection_queue', { iso: 'ZZZ' });
    expect(r && r.isError).toBe(true);
    const body = JSON.parse(r.content[0].text);
    expect(body.error).toBe('invalid_iso');
    expect(body.valid_isos).toContain('NESO');
    expect(body.detail).toMatch(/iso=NESO \(the NESO TEC Register\)/);
  });
  it('UK is not folded: NESO covers Great Britain, not Northern Ireland', () => {
    expect(S._validateToolArgs('get_interconnection_queue', { iso: 'UK' })?.isError).toBe(true);
  });
  it('get_iso_context stays US-only', () => {
    for (const v of ['NESO', 'NGESO', 'GB']) {
      const r = S._validateToolArgs('get_iso_context', { iso: v });
      expect(r && r.isError, v).toBe(true);
      expect(JSON.parse(r.content[0].text).valid_isos).not.toContain('NESO');
    }
  });
  it('_foldQueueIsoArg sends the backend NESO and leaves US codes to _foldIsoArg', () => {
    expect(S._foldQueueIsoArg({ iso: 'NGESO' })).toEqual({ iso: 'NESO' });
    expect(S._foldQueueIsoArg({ iso: 'gb' })).toEqual({ iso: 'NESO' });
    expect(S._foldQueueIsoArg({ iso: 'NEISO' })).toEqual({ iso: 'ISONE' });
    const a = { iso: 'PJM' };
    expect(S._foldQueueIsoArg(a)).toBe(a);
  });
});

describe('get_interconnection_queue: iso=NESO end to end', () => {
  it('reaches /by-iso as iso=NESO and returns the TEC rows with the NESO licence', async () => {
    const n = seen.length;
    const r = await call({ iso: 'NGESO' }, 'dch_live_neso_pro_seat');
    expect(seen.length, 'the stub never saw the call — this guard ran nothing').toBe(n + 1);
    expect(seen[n].get('iso')).toBe('NESO');
    expect(r.isError).not.toBe(true);
    const out = sc(r);
    expect(out.iso).toBe('NESO');
    expect(out.queue_kind).toBe('mixed_connection_queue');
    expect(out.queued_connections_gw).toBe(700);
    expect(out).not.toHaveProperty('queued_load_total_gw');
    expect(Array.isArray(out.projects)).toBe(true);
    expect(out.projects.map((p) => p.project_name)).toContain('Example Data Centre');
    expect(out.projects_source.attribution).toBe('Supported by National Energy SO Open Data');
    expect(out.projects_source.license).toBe('NESO Open Data Licence');
  });
  it('a refused iso never reaches the backend', async () => {
    const n = seen.length;
    const r = await call({ iso: 'UK' }, 'dch_live_neso_pro_seat');
    expect(r.isError).toBe(true);
    expect(seen.length).toBe(n);
  });
});

describe('get_interconnection_queue: tools/list text', () => {
  it('/mcp names NESO honestly as the TEC Register, not a generation queue', async () => {
    const tools = (await rpc('tools/list', {})).tools || [];
    const t = tools.find((x) => x.name === 'get_interconnection_queue');
    expect(t, 'get_interconnection_queue missing from /mcp tools/list').toBeDefined();
    expect(t.inputSchema.properties.iso.description).toMatch(/NESO for Great Britain \(the NESO TEC Register/);
    expect(t.description).toMatch(/iso=NESO returns Great Britain's NESO TEC Register/);
    expect(t.description).toMatch(/not a generation queue/);
  });
});
