// provenance.verification_counts never reaches tool OUTPUT.
//
// Measured live 2026-09-28, every search_facilities response:
//   "verification_counts": {"tracked": 31198, "verified": 23484}
// beside `facility_count_status: "corroboration_pending"` — and agents quoted
// the pair as DC Hub's facility count, which the owner has withdrawn until a
// corroborated count exists. The key is OMITTED (not nulled): every declared
// outputSchema has `provenance` as z.looseObject({}).optional(), nothing
// required inside it, on /mcp and /mcp/chatgpt alike.
//
// Real handlers over HTTP against a stub backend that stamps the live block on
// EVERY response, so any tool that passes backend provenance through is caught.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { dropVerificationCounts, dropVerificationCountsText } from '../lib/verification-counts.mjs';
import { provenanceFooterLine } from '../lib/result-shaping.mjs';
import { buildProvenance } from '../lib/attribution.mjs';

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

const PRO = 'dch_live_noverifcountstest0001';
const VC = { tracked: 31198, verified: 23484 };
// Any spelling of either number, or the key itself.
const LEAK = /verification_counts|31,?198|23,?484/;
const PROV = {
  source: 'DC Hub facility registry', as_of: '2026-09-28',
  method: 'verified = distinct canonical_slug passing the fleet filter COALESCE(is_duplicate,0)=0; tracked = every row',
  verification_counts: VC, cite_as: 'DC Hub, dchub.cloud', license: 'CC-BY-4.0',
};
const ROWS = Array.from({ length: 3 }, (_, i) => ({
  id: 100 + i, slug: `fac-${i}`, name: `Facility ${i}`, provider: 'Operator', city: 'Ashburn', state: 'VA',
  country: 'US', lat: 39 + i / 100, lon: -77, capacity_mw: 10 + i, v: 'verified',
}));
const BODY = {
  success: true, count: ROWS.length, total: ROWS.length, data: ROWS, results: ROWS, facilities: ROWS,
  facility: ROWS[0], facility_count_status: 'corroboration_pending', provenance: PROV,
  // a nested copy too, as execute_plan / merged payloads carry them
  meta: { provenance: { ...PROV } },
};

let S, PORT, httpServer, stub, prevBase;

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
            ? { valid: true, tier: 'pro', developer_id: 'dev_vc', email: 'vc@example.com' }
            : { valid: false, tier: 'free' }));
          return;
        }
        if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
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
async function call(path, name, args, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: _id++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { raw: data, json: JSON.parse(data) };
}

const CALLS = [
  ['search_facilities', { state: 'VA' }],
  ['get_facility', { slug: 'fac-0' }],
  ['search', { query: 'data centers in Ashburn' }],
  ['fetch', { id: 'facility:fac-0' }],
  ['get_market_intel', { market: 'northern-virginia' }],
  ['execute_plan', { intent: 'which data centers are in Virginia' }],
  ['summarize_for_citation', { subject: 'facility', layer: 'facility' }],
];

describe('provenance.verification_counts is not in tool output', () => {
  it('CONTROL: the stub backend really serves the live block', async () => {
    const r = await fetch(`${process.env.DCHUB_API_BASE}/api/v1/facilities?state=VA`);
    expect(LEAK.test(await r.text())).toBe(true);
  });

  for (const [path, headers, label] of [
    ['/mcp', {}, 'anonymous'],
    ['/mcp', { 'x-api-key': PRO }, 'pro key'],
    ['/mcp/chatgpt', {}, 'chatgpt directory'],
    ['/mcp/grok', {}, 'grok'],
  ]) {
    it(`${path} (${label}): no tool result carries the key or either number`, async () => {
      for (const [name, args] of CALLS) {
        const { raw, json } = await call(path, name, args, headers);
        expect(json.result || json.error, `${name}: no JSON-RPC result`).toBeTruthy();
        const m = LEAK.exec(raw);
        expect(m && raw.slice(Math.max(0, m.index - 120), m.index + 60), `${path} ${name} (${label})`).toBeNull();
      }
    }, 60000);
  }

  it('search_facilities keeps the rest of the provenance block', async () => {
    const { json } = await call('/mcp', 'search_facilities', { state: 'VA' }, { 'x-api-key': PRO });
    const sc = json.result.structuredContent;
    expect(sc.provenance).toBeTruthy();
    expect(sc.provenance.cite_as).toBe('DC Hub, dchub.cloud');
    expect('verification_counts' in sc.provenance).toBe(false);
    expect(json.result.content.map((c) => c.text).join('\n')).toContain('corroboration_pending');
  });
});

describe('lib/verification-counts.mjs', () => {
  it('drops the key from compact, pretty-printed and string-embedded JSON, leaving valid JSON', () => {
    const obj = { a: 1, provenance: { as_of: 'x', verification_counts: VC, cite_as: 'c' } };
    for (const text of [JSON.stringify(obj), JSON.stringify(obj, null, 2),
      JSON.stringify({ step: JSON.stringify(obj) }),
      JSON.stringify({ provenance: { verification_counts: VC } }),
      JSON.stringify({ provenance: { verification_counts: null, as_of: 'x' } })]) {
      const out = dropVerificationCountsText(text);
      expect(out, text).not.toMatch(LEAK);
      expect(() => JSON.parse(out), out).not.toThrow();
    }
  });

  it('drops it from structuredContent at any depth, without mutating the input', () => {
    const sc = { provenance: { verification_counts: VC, as_of: 'x' }, steps: [{ r: { provenance: { verification_counts: VC } } }] };
    const res = { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
    const out = dropVerificationCounts(res);
    expect(JSON.stringify(out)).not.toMatch(LEAK);
    expect(out.structuredContent.provenance.as_of).toBe('x');
    expect(sc.provenance.verification_counts).toBe(VC);   // caller's object untouched
  });

  it('strips counts from a provenance footer line', () => {
    expect(dropVerificationCountsText('📎 provenance: 23,484/31,198 verified · as_of 2026-09-28 · cite DC Hub'))
      .toBe('📎 provenance: as_of 2026-09-28 · cite DC Hub');
    expect(dropVerificationCountsText('x\n📎 provenance: 23,484 verified\ny')).not.toMatch(LEAK);
  });

  it('the footer and the attribution envelope no longer produce counts', () => {
    expect(provenanceFooterLine({ verification_counts: VC, as_of: '2026-09-28' })).toBe('📎 provenance: as_of 2026-09-28');
    expect(provenanceFooterLine({ verification_counts: VC })).toBeNull();
    const p = buildProvenance({ provenance: PROV, as_of: '2026-09-28T00:00:00Z' }, { tier: 'pro' });
    expect('verification_counts' in p).toBe(false);
  });

  it('a result without the key is returned as the same object', () => {
    const r = { content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 1 } };
    expect(dropVerificationCounts(r)).toBe(r);
  });
});
