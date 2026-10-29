// evidence-content-block.test.mjs: partner program 2026-10-27, section 6, coverage of content[0].
//
// MEASURED live 2026-10-28 06:10Z (raw tools/call, keyless, QA header): provenance.evidence was in
// structuredContent on every tool but ABSENT from content[0].text on get_grid_data, get_energy_prices,
// get_interconnection_queue, get_fiber_intel and list_transactions. Cause: the stamp rewrote block 0
// only when the whole text parsed as JSON, and on these gated tools block 0 is a JSON object FOLLOWED
// BY prose until a later step splits them (_splitHumanBlock), so the text kept the backend's raw
// provenance. A client that reads content[0].text (nearly every agent) saw no evidence block.
//
// Fixtures: test/fixtures/evidence-live-shapes.json, the raw backend provenance of those five tools
// captured live (data reduced to scalars, relay links and agent text removed).
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { stampEnvelopeAttribution } from '../lib/attribution.mjs';
import { EVIDENCE_ENV } from '../lib/evidence-contract.mjs';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/evidence-live-shapes.json', import.meta.url), 'utf8')).tools;
const NOW = Date.parse('2026-10-28T06:10:00Z');
const TAIL = '\n\n---\n\n→ **For your human:** example line.\n\nSource: DC Hub (dchub.cloud), as of 2026-10-28';
afterEach(() => { delete process.env[EVIDENCE_ENV]; });

// The shape the stamp sees on a gated tool: ONE block, JSON then prose; optionally structuredContent.
const oneBlock = (tool, { withSc = false } = {}) => {
  const payload = structuredClone(FIX[tool].payload);
  const res = { content: [{ type: 'text', text: JSON.stringify(payload) + TAIL }] };
  if (withSc) res.structuredContent = structuredClone(payload);
  return stampEnvelopeAttribution(res, { toolName: tool, tier: 'free', now: NOW });
};
const head = (out) => {
  const t = out.content[0].text; const i = t.indexOf('\n\n---\n\n');
  return { obj: JSON.parse(t.slice(0, i)), rest: t.slice(i) };
};

const EXPECT = {
  get_grid_data:             { as_of: '2026-10-28T04:00:00Z', basis: null, owner: null, lics: ['public-domain', 'unstated'], lic_id: 'composite', byField: { demand_mw: 'measured', load_factor: 'inferred' } },
  get_energy_prices:         { as_of: '2026-08-31', basis: 'measured', owner: 'U.S. Energy Information Administration (EIA), retail sales of electricity',
                               url: 'https://www.eia.gov/opendata/browser/electricity/retail-sales', lic: 'public-domain' },
  get_interconnection_queue: { as_of: '2026-09-30', basis: 'reported', owner: null },
  get_fiber_intel:           { as_of: null, loaded_on: '2026-05-20', basis: 'inferred', owner: null, limitation: 'as_of_is_load_date' },
  list_transactions:         { as_of: null, basis: 'reported', owner: null, limitation: 'evidence_as_of_unmeasured' },
};

describe.each(Object.keys(EXPECT))('%s: content[0] carries the evidence block', (tool) => {
  const want = EXPECT[tool];
  it('the leading JSON is stamped and the prose after it is byte-identical', () => {
    const out = oneBlock(tool);
    const { obj, rest } = head(out);
    expect(obj.provenance.evidence, 'content[0] provenance.evidence').toBeTruthy();
    expect(rest).toBe(TAIL);
    expect(out.content).toHaveLength(1);
  });
  it('evidence_as_of is the backend-stated data date, never a load or retrieval time', () => {
    const ev = head(oneBlock(tool)).obj.provenance.evidence;
    expect(ev.evidence_as_of).toBe(want.as_of);
    expect(ev.evidence_as_of).not.toBe(ev.retrieved_at);
    if (want.loaded_on) {
      expect(ev.loaded_on).toBe(want.loaded_on);
      expect(ev.evidence_as_of_kind).toBe('dchub_ingest_date');
    }
    if (want.limitation) expect(ev.limitations.map((l) => l.code)).toContain(want.limitation);
  });
  it('data_basis is read only from a class the backend states', () => {
    const ev = head(oneBlock(tool)).obj.provenance.evidence;
    expect(ev.data_basis).toBe(want.basis);
  });
  it('no licence is claimed for the whole; per-layer ids only from what the payload declares', () => {
    const ev = head(oneBlock(tool)).obj.provenance.evidence;
    expect(ev.license_id === 'CC-BY-4.0').toBe(false);
    expect(ev.license_layers.map((l) => l.id)).toEqual(want.lics || (want.lic ? [want.lic] : []));
    expect(ev.license_id).toBe(want.lic_id || (want.lic || null));
    expect(ev.partner_credit).toBeNull();
  });
  it('source_owner / source_url only when one external upstream is stated', () => {
    const ev = head(oneBlock(tool)).obj.provenance.evidence;
    expect(ev.source_owner).toBe(want.owner);
    expect(ev.source_url).toBe(want.url || null);
  });
  if (want.byField) {
    it('a per-field class the backend states is carried per field, not hoisted to the whole', () => {
      const ev = head(oneBlock(tool)).obj.provenance.evidence;
      for (const [k, v] of Object.entries(want.byField)) expect(ev.data_basis_by_field[k]).toBe(v);
      expect(ev.data_basis).toBeNull();
    });
  }
  it('with structuredContent present the two surfaces carry the same evidence block', () => {
    const out = oneBlock(tool, { withSc: true });
    expect(head(out).obj.provenance.evidence).toEqual(out.structuredContent.provenance.evidence);
  });
  it('the kill switch removes it from the text too, and the prose is still intact', () => {
    process.env[EVIDENCE_ENV] = '0';
    const out = oneBlock(tool);
    const { obj, rest } = head(out);
    expect(obj.provenance.evidence).toBeUndefined();
    expect(rest).toBe(TAIL);
  });
});

describe('the text block is built from the payload it describes, not an empty one', () => {
  it('per-layer entries and third-party credits reach content[0] exactly as they reach structuredContent', () => {
    const payload = {
      siting: { dcpi: { as_of: '2026-10-27' }, utilities: { as_of: '2026-09-30', source_url: 'https://county.example.gov/u' } },
      attribution: [{ source: 'Example Dashboard', url: 'https://dash.example.org', license: 'CC-BY-4.0', citation: 'Example, A. (2026).' }],
      provenance: { source: 'DC Hub', license: 'CC-BY-4.0', as_of: '2026-09-30' },
    };
    const out = stampEnvelopeAttribution({ content: [{ type: 'text', text: JSON.stringify(payload) + TAIL }],
      structuredContent: structuredClone(payload) }, { toolName: 'get_market_intel', tier: 'free', now: NOW });
    const t = head(out).obj.provenance.evidence;
    expect(t.layers.map((l) => l.layer)).toEqual(['siting.dcpi', 'siting.utilities']);
    expect(t.license_layers.map((l) => l.name)).toEqual(['Example Dashboard']);
    expect(t.attribution_text).toContain('Example, A. (2026).');
    expect(t).toEqual(out.structuredContent.provenance.evidence);
  });
  it('a named source with no stated licence is its own layer, id unstated, so the answer is not read as fully licensed', () => {
    const payload = { provenance: { source: 'DC Hub', license: 'CC-BY-4.0', as_of: '2026-10-01', sources: [
      { id: 'a', name: 'Licensed Feed', license: 'public domain (US government)' }, { id: 'b', name: 'Unlicensed Feed' }] } };
    const ev = head(stampEnvelopeAttribution({ content: [{ type: 'text', text: JSON.stringify(payload) + TAIL }] },
      { toolName: 'get_grid_data', now: NOW })).obj.provenance.evidence;
    expect(ev.license_layers.map((l) => l.id)).toEqual(['public-domain', 'unstated']);
    expect(ev.license_id).toBe('composite');
  });
  it('a single unlicensed source does not become a licence', () => {
    const payload = { provenance: { source: 'DC Hub', license: 'CC-BY-4.0', as_of: '2026-10-01', sources: [{ id: 'b', name: 'Unlicensed Feed' }] } };
    const ev = head(stampEnvelopeAttribution({ content: [{ type: 'text', text: JSON.stringify(payload) + TAIL }] },
      { toolName: 'get_grid_data', now: NOW })).obj.provenance.evidence;
    expect(ev.license_id).toBeNull();
  });
});

describe('the leading-JSON stamp is conservative', () => {
  it('text that does not split into an object plus prose is left untouched', () => {
    const bad = { content: [{ type: 'text', text: '{"a": 1, "provenance": {' }] };
    expect(stampEnvelopeAttribution(structuredClone(bad), { toolName: 'get_grid_data', now: NOW })).toEqual(bad);
    const arr = { content: [{ type: 'text', text: '[1,2,3]\n\nprose' }] };
    expect(stampEnvelopeAttribution(structuredClone(arr), { toolName: 'get_grid_data', now: NOW })).toEqual(arr);
  });
  it('a load-date as_of_kind is never promoted to evidence_as_of', () => {
    for (const kind of ['retrieval', 'dchub_ingest_date', 'fetch']) {
      const out = stampEnvelopeAttribution({ structuredContent: { x: 1,
        provenance: { source: 'DC Hub', license: 'CC-BY-4.0', as_of: '2026-05-20', as_of_kind: kind } },
      content: [{ type: 'text', text: '{"x":1}' }] }, { toolName: 'get_fiber_intel', now: NOW });
      const ev = out.structuredContent.provenance.evidence;
      expect(ev.evidence_as_of, kind).toBeNull();
      expect(ev.loaded_on, kind).toBe('2026-05-20');
    }
  });
  it('a collection-date as_of_kind keeps evidence_as_of', () => {
    const out = stampEnvelopeAttribution({ structuredContent: { x: 1,
      provenance: { source: 'DC Hub', license: 'CC-BY-4.0', as_of: '2026-05-20', as_of_kind: 'published_report' } },
    content: [{ type: 'text', text: '{"x":1}' }] }, { toolName: 'get_fiber_intel', now: NOW });
    expect(out.structuredContent.provenance.evidence.evidence_as_of).toBe('2026-05-20');
  });
});

// ── through the real server chain: keyless, loopback, stub backend, no network ─────────────────
const foreign = [];
const realConnect = net.Socket.prototype.connect;
let S, PORT, httpServer, stub, prevBase, prevSecret, prevIsError;
const ROWS = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, name: 'Site ' + i, iso: 'PJM', score: 50 + i, city: 'Ashburn', state: 'VA', country: 'US' }));

beforeAll(async () => {
  net.Socket.prototype.connect = function connect(...args) {
    let o = args[0]; if (Array.isArray(o)) o = o[0];
    if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
    const host = String(o.host || 'localhost');
    if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
      foreign.push(`${host}:${o.port}`);
      process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
      return this;
    }
    return realConnect.apply(this, args);
  };
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') return send({ valid: false, tier: 'free' });
      if (p === '/api/v1/keys/auto-mint' || p === '/api/v1/mcp/session-key' || p === '/api/v1/mcp/monthly-usage') return send({ error: 'no' }, 404);
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/should-mint-claim') return send({ should_mint: false });
      if (p.startsWith('/api/v1/mcp/full-cap')) return send({ ok: false });
      if (p.startsWith('/api/v1/energy/')) return send({ success: true, scope: 'iso_footprint_avg', retail_rates: { avg_cents_kwh: 23.41, latest_period: '2026' } });
      return send({ success: true, count: ROWS.length, data: ROWS, results: ROWS, as_of: '2026-10-08' });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'evidence-content-block-internal-key';
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  if (prevIsError === undefined) delete process.env.DCHUB_PREVIEW_ISERROR; else process.env.DCHUB_PREVIEW_ISERROR = prevIsError;
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body) });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}
let ipN = 40, rpcId = 500;
async function call(name, args) {
  const h0 = { 'x-forwarded-for': `203.0.113.${ipN++}` };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
  return JSON.parse(body).result || {};
}

describe.each([
  ['get_grid_data', { iso: 'PJM' }], ['get_energy_prices', { iso: 'PJM' }],
  ['get_interconnection_queue', { iso: 'PJM' }], ['get_fiber_intel', { metro: 'ashburn' }],
  ['list_transactions', { limit: 2 }],
])('%s through the real chain, keyless', (tool, args) => {
  it('content[0].text is parseable JSON whose provenance.evidence equals structuredContent\'s', async () => {
    const r = await call(tool, args);
    const obj = JSON.parse(r.content[0].text);
    expect(obj.provenance && obj.provenance.evidence, 'content[0] provenance.evidence').toBeTruthy();
    expect(r.structuredContent.provenance.evidence).toBeTruthy();
    expect(obj.provenance.evidence.evidence_as_of).toEqual(r.structuredContent.provenance.evidence.evidence_as_of);
    expect(obj.provenance.evidence.evidence_as_of).not.toBe(obj.provenance.evidence.retrieved_at);
    expect(foreign).toEqual([]);
  });
});
