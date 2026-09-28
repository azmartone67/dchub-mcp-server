// No SQL fragments or table/column names in agent-facing OUTPUT (owner request
// via Grok, 2026-09-28).
//
// Measured live 2026-09-28 on search_facilities (/mcp), after #617:
//   provenance.source  "DC Hub facilities registry (discovered_facilities)"
//   provenance.method  "… verified = passes the canonical fleet filter … verified
//                       = distinct canonical_slug passing the fleet filter
//                       COALESCE(is_duplicate,0)=0)"
//   provenance.verification_counts_basis "… COUNT(DISTINCT canonical_slug) WHERE
//                       is_duplicate=0 over discovered_facilities …"
// and semantic_search rows carried "source_table": "discovered_facilities".
// Those strings come from dchub-backend (routes/provenance.py, main.py
// _pv_attach calls, the RAG layer); lib/provenance-plain.mjs strips them in the
// tool-result chain, and this server's own provenance_note / provenance-guide
// text no longer carries them.
//
// Real handlers over HTTP against a stub backend that serves the live block on
// EVERY response, on /mcp, /mcp/chatgpt and /mcp/grok.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { plainProvenance, plainString, PLAIN_METHOD, SQL_TOKEN_RE } from '../lib/provenance-plain.mjs';

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

// The guard's own token list, spelled out independently of the lib's regex so a
// weakened SQL_TOKEN_RE cannot weaken this test.
const LEAK = /COALESCE|is_duplicate|duplicate_of_id|canonical_slug|discovered_facilities|facilities_verified|fleet filter|verification_counts_basis|COUNT\(DISTINCT|WHERE is_duplicate/i;

const PRO = 'dch_live_nosqltokenstest00001';
const PROV = {
  attribution: 'Contains data from OpenStreetMap contributors and PeeringDB, plus DC Hub curation.',
  cite_as: 'DC Hub, dchub.cloud',
  cite_url_template: 'https://dchub.cloud/facilities/{slug}',
  default_v: 'tracked',
  facility_count_status: 'corroboration_pending',
  license: 'Mixed — see https://dchub.cloud/data-sources',
  // verbatim from the live response, 2026-09-28
  method: 'multi-source discovery + dedup verification; per-record v: verified = passes the canonical fleet filter, tracked = discovery pile (not yet verified). verification_counts describe discovered_facilities — the same corpus these rows are drawn from (tracked = every row; verified = distinct canonical_slug passing the fleet filter COALESCE(is_duplicate,0)=0)',
  provenance_version: 1,
  source: 'DC Hub facilities registry (discovered_facilities)',
  as_of: '2026-09-28',
  verification_counts: { tracked: 31200, verified: 23484 },
  verification_counts_basis: 'tracked records, not a corroborated facility count (corroboration pending). verified = COUNT(DISTINCT canonical_slug) WHERE is_duplicate=0 over discovered_facilities — a de-duplication state, not a source verification; tracked = all discovered_facilities records. Differs from /api/v1/stats/canonical facilities_verified, which counts rows WHERE duplicate_of_id IS NULL.',
};
const ROWS = Array.from({ length: 3 }, (_, i) => ({
  id: 100 + i, slug: `fac-${i}`, name: `Facility ${i}`, provider: 'Operator', city: 'Ashburn', state: 'VA',
  country: 'US', lat: 39 + i / 100, lon: -77, capacity_mw: 10 + i, v: 'verified',
  source_table: 'discovered_facilities', source_id: String(100 + i), score: 0.9, text: `Facility ${i} — Ashburn`,
}));
const BODY = {
  success: true, count: ROWS.length, total: ROWS.length, data: ROWS, results: ROWS, facilities: ROWS,
  facility: ROWS[0], facility_count_status: 'corroboration_pending', provenance: PROV,
  corpus: ['news_articles', 'deals', 'discovered_facilities', 'market_narratives'],
  meta: { provenance: { ...PROV } },
};

let S, PORT, httpServer, stub, prevBase;
const seenCorpus = [];

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const url = new URL(req.url, 'http://_');
        res.setHeader('content-type', 'application/json');
        if (url.pathname === '/api/v1/keys/validate') {
          let key = '';
          try { key = JSON.parse(b || '{}').api_key || ''; } catch (_) {}
          res.end(JSON.stringify(key === PRO
            ? { valid: true, tier: 'pro', developer_id: 'dev_sql', email: 'sql@example.com' }
            : { valid: false, tier: 'free' }));
          return;
        }
        if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
        if (url.pathname === '/api/v1/rag/search') seenCorpus.push(url.searchParams.get('corpus'));
        res.end(JSON.stringify(BODY));
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

let _id = 1;
async function rpc(path, method, params, headers = {}, notify = false) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(notify ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', id: _id++, method, params }),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { raw: data, json: data ? JSON.parse(data) : null, headers: res.headers };
}
const call = (path, name, args, headers) => rpc(path, 'tools/call', { name, arguments: args }, headers);

const CALLS = [
  ['search_facilities', { state: 'VA' }],
  ['get_facility', { slug: 'fac-0' }],
  ['search', { query: 'data centers in Ashburn' }],
  ['fetch', { id: 'facility:fac-0' }],
  ['semantic_search', { q: 'ashburn data center' }],
  ['search_intelligence', { query: 'ashburn data center' }],
  ['get_market_intel', { market: 'northern-virginia' }],
  ['execute_plan', { intent: 'which data centers are in Virginia' }],
  ['summarize_for_citation', { subject: 'facility', layer: 'facility' }],
  ['why_dchub', {}],
];

// resources/read needs a session: initialize, then read the guide on it.
async function readGuide(path) {
  const init = await rpc(path, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nosql-test', version: '1.0' },
  });
  const sid = init.headers.get('mcp-session-id');
  const h = sid ? { 'mcp-session-id': sid } : {};
  await rpc(path, 'notifications/initialized', undefined, h, true);
  return rpc(path, 'resources/read', { uri: 'dchub://provenance-guide' }, h);
}

function leakAt(raw) {
  const m = LEAK.exec(raw);
  return m && raw.slice(Math.max(0, m.index - 120), m.index + 60);
}

describe('no SQL fragments or table/column names in tool output', () => {
  it('CONTROL: the stub backend really serves the tokens', async () => {
    const r = await fetch(`${process.env.DCHUB_API_BASE}/api/v1/facilities?state=VA`);
    expect(LEAK.test(await r.text())).toBe(true);
  });

  for (const [path, headers, label] of [
    ['/mcp', {}, 'anonymous'],
    ['/mcp', { 'x-api-key': PRO }, 'pro key'],
    ['/mcp/chatgpt', {}, 'chatgpt directory'],
    ['/mcp/grok', {}, 'grok'],
  ]) {
    it(`${path} (${label}): no tool result carries a SQL fragment or table/column name`, async () => {
      let answered = 0;
      for (const [name, args] of CALLS) {
        const { raw, json } = await call(path, name, args, headers);
        expect(json.result || json.error, `${name}: no JSON-RPC result`).toBeTruthy();
        if (json.result) answered += 1;
        expect(leakAt(raw), `${path} ${name} (${label})`).toBeNull();
      }
      expect(answered).toBeGreaterThanOrEqual(3);   // not vacuous: real results were scanned
    }, 90000);
  }

  it('/mcp: the dchub://provenance-guide resource carries no SQL fragment or table/column name', async () => {
    const { raw, json } = await readGuide('/mcp');
    const text = ((json.result && json.result.contents) || []).map((c) => c.text).join('\n');
    expect(text).toContain('DE-DUPLICATED');   // not vacuous: the guide was really read
    expect(leakAt(raw)).toBeNull();
  });

  it('/mcp/grok: the provenance guide is served and clean', async () => {
    const { raw, json } = await readGuide('/mcp/grok');
    expect(((json.result && json.result.contents) || []).map((c) => c.text).join('\n')).toContain('DE-DUPLICATED');
    expect(leakAt(raw)).toBeNull();
  });

  it('/mcp/chatgpt: serves no resources (method not found), so nothing to leak', async () => {
    const { raw, json } = await readGuide('/mcp/chatgpt');
    expect(json.error && json.error.code).toBe(-32601);
    expect(leakAt(raw)).toBeNull();
  });

  it('search_facilities keeps source, as_of and the license fields, with the plain method', async () => {
    const { json } = await call('/mcp', 'search_facilities', { state: 'VA' }, { 'x-api-key': PRO });
    for (const p of [json.result.structuredContent.provenance, JSON.parse(json.result.content[0].text).provenance]) {
      expect(p).toBeTruthy();
      expect(p.source).toBe('DC Hub facilities registry');
      expect(p.as_of).toBe('2026-09-28');
      expect(p.license).toBe('Mixed — see https://dchub.cloud/data-sources');
      expect(p.attribution).toBe(PROV.attribution);
      expect(p.cite_as).toBe('DC Hub, dchub.cloud');
      expect(p.method).toBe(PLAIN_METHOD);
      expect('verification_counts_basis' in p).toBe(false);
    }
  });

  it('semantic_search accepts the plain corpus name back', async () => {
    seenCorpus.length = 0;
    await call('/mcp', 'semantic_search', { q: 'ashburn', corpus: 'facilities,deals' }, { 'x-api-key': PRO });
    expect(seenCorpus).toContain('discovered_facilities,deals');
  });
});

describe('lib/provenance-plain.mjs', () => {
  it('rewrites compact, pretty and string-embedded JSON, leaving valid JSON', () => {
    const obj = { a: 1, provenance: { ...PROV } };
    for (const text of [JSON.stringify(obj), JSON.stringify(obj, null, 2), JSON.stringify({ step: JSON.stringify(obj) })]) {
      const out = plainProvenance({ content: [{ type: 'text', text }] }).content[0].text;
      expect(leakAt(out), text.slice(0, 40)).toBeNull();
      expect(() => JSON.parse(out)).not.toThrow();
      expect(out).toContain('2026-09-28');
      expect(out).toContain('Mixed — see https://dchub.cloud/data-sources');
    }
  });

  it('rewrites structuredContent without mutating the input', () => {
    const sc = { provenance: { ...PROV }, steps: [{ r: { provenance: { ...PROV } } }] };
    const out = plainProvenance({ content: [], structuredContent: sc });
    expect(leakAt(JSON.stringify(out))).toBeNull();
    expect(out.structuredContent.steps[0].r.provenance.method).toBe(PLAIN_METHOD);
    expect(sc.provenance.method).toBe(PROV.method);
  });

  it('scrubs free text and leaves clean text alone', () => {
    expect(plainString('It counts buildings that passed the fleet filter (COALESCE(is_duplicate,0)=0), fine.'))
      .toBe('It counts buildings that passed de-duplication, fine.');
    expect(plainString('verified = COUNT(DISTINCT canonical_slug) WHERE is_duplicate=0 over discovered_facilities'))
      .not.toMatch(LEAK);
    expect(plainString('Look where the grid is = tight (per ISO)')).toBe('Look where the grid is = tight (per ISO)');
    const r = { content: [{ type: 'text', text: '{"method":"realtime EIA generation assembly"}' }], structuredContent: { a: 1 } };
    expect(plainProvenance(r)).toBe(r);
    expect(SQL_TOKEN_RE.test('where the grid is')).toBe(false);
  });
});
