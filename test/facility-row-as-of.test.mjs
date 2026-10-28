// facility-row-as-of.test.mjs — 2026-10-28
//
// Keyless search_facilities answered provenance.as_of null / UNMEASURED because
// the list rows carried no date. The backend free arm now puts as_of,
// as_of_basis and (PeeringDB rows) verified_at on each row. Two things must
// hold through the real MCP path, keyless AND keyed-free:
//   1. the row keeps those three keys while every paid field is still dropped
//      (the free mask is an allowlist; a label is not a paid field), and the
//      raw dates a row may carry (first_seen, last_updated) stay off the wire;
//   2. the COLLECTION-level provenance.as_of stays null, with the per-record
//      field named in as_of_record_fields. A date promoted out of rows would be
//      an artifact of which rows came back (test/as-of-record-scope.test.mjs).
// A row the backend could not date says so: as_of null with an UNMEASURED
// basis, and that null must survive the mask too.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
process.env.DCHUB_LEAN_RESPONSES = '0';

const K_FREE = 'dch_live_rowasof_freekey001';
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_TRIAL_PREVIEW_ROWS'];
const prevEnv = {};
const BASIS = 'the record was last refreshed from its sources on this date (discovered_facilities.last_updated). It dates the DC Hub record, not the physical facility';
const rows = [
  { id: 1, name: 'Rowasof DC 1', slug: 'rowasof-dc-1', provider: 'Rowasof Provider', city: 'Ashburn', state: 'VA', country: 'US',
    as_of: '2026-09-07', as_of_basis: BASIS, verified_at: '2026-10-21', v: 'verified', verification: 'verified',
    power_mw: 48.5, jv_partners: 'Rowasof JV Partner', first_seen: '2026-03-18T03:29:40', last_updated: '2026-09-07T09:10:34' },
  { id: 2, name: 'Rowasof DC 2', slug: 'rowasof-dc-2', provider: 'Rowasof Provider', city: 'Ashburn', state: 'VA', country: 'US',
    as_of: null, as_of_basis: 'UNMEASURED - this row carries no usable refresh date, so there is no as_of to cite. Do not substitute today\'s date',
    v: 'tracked', verification: 'tracked', power_mw: 12.25, first_seen: '2026-03-18T03:29:40' },
];

let S, PORT, httpServer, stub;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const u = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (u.pathname === '/api/v1/keys/validate') {
        let b = ''; for await (const ch of req) b += ch;
        let key = ''; try { key = JSON.parse(b || '{}').api_key || ''; } catch (_) { /* empty */ }
        res.end(JSON.stringify(key === K_FREE ? { valid: true, tier: 'free', developer_id: 'dev_rowasof', email: null } : { valid: false, tier: 'free' }));
        return;
      }
      if (u.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: true, prior_calls: 1 })); return; }
      if (u.pathname === '/api/v1/mcp/anon-usage') { res.end(JSON.stringify({ count: 0 })); return; }
      if (u.pathname === '/api/v1/mcp/credits/balance') { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      if (u.pathname === '/api/v1/facilities') {
        res.end(JSON.stringify({ success: true, data: rows, pagination: { page: 1, limit: 50, total: rows.length, pages: 1 } }));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  process.env.DCHUB_ANON_DAILY_CAP = '50';
  delete process.env.DCHUB_TRIAL_PREVIEW_ROWS;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json };
}

async function callTool(headers, name, args) {
  const init = await post(headers, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rowasof-test', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { json } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
  const r = JSON.parse(json).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('');
  const s = text.trimStart();
  let depth = 0, inStr = false, esc = false, lead = {};
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { lead = JSON.parse(s.slice(0, i + 1)); break; } }
  }
  return { text, lead };
}

function expectRowsCarryTheirDate(out, label) {
  const [a, b] = out.lead.data || [];
  expect(a && a.name, `${label}: no dated row came back, so the checks below are vacuous`).toBe('Rowasof DC 1');
  expect(a.as_of, `${label}: row as_of dropped by the mask`).toBe('2026-09-07');
  expect(a.as_of_basis, `${label}: row as_of_basis dropped`).toContain('last refreshed from its sources');
  expect(a.verified_at, `${label}: verified_at dropped`).toBe('2026-10-21');
  expect(b && b.name).toBe('Rowasof DC 2');
  expect(b.as_of, `${label}: an undated row must stay null, never gain a date`).toBeNull();
  expect(b.as_of_basis).toMatch(/^UNMEASURED/);
  expect('verified_at' in b, `${label}: verified_at invented on an unverified row`).toBe(false);
  // paid fields and raw load/refresh dates stay off the wire
  for (const needle of ['power_mw', '48.5', 'jv_partners', 'Rowasof JV Partner', 'first_seen', '2026-03-18', 'last_updated']) {
    expect(out.text.includes(needle), `${label}: "${needle}" reached the answer`).toBe(false);
  }
  const prov = out.lead.provenance || {};
  expect(prov.as_of, `${label}: a row date was promoted to the collection`).toBeNull();
  expect(prov.as_of_record_fields || [], `${label}: the per-record field is not named`).toContain('as_of');
  expect(String(prov.as_of_basis)).toContain('PER-RECORD');
}

describe('facility rows carry their own as_of through the free mask', () => {
  it('keyless search_facilities', async () => {
    expectRowsCarryTheirDate(await callTool({}, 'search_facilities', { state: 'VA' }), 'keyless');
  });
  it('keyed free search_facilities', async () => {
    expectRowsCarryTheirDate(await callTool({ 'x-api-key': K_FREE }, 'search_facilities', { state: 'VA' }), 'keyed free');
  });
});
