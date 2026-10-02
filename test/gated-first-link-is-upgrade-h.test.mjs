// gated-first-link-is-upgrade-h.test.mjs — MCP-1 (2026-10-01)
//
// The keyless wall of analyze_site / compare_sites / get_dchub_recommendation used to dead-end
// on /u/<code> -> /go/c/<pro> -> Stripe with no /upgrade/h page. Pinned here over the real /mcp
// handler and a loopback stub (no network):
//   1. the FIRST human link in content[].text is an /upgrade/h/<token> relay page;
//   2. it is the ONLY human link in the text (one ask);
//   3. the token is signed for that tool and the page answers 200 (the stub serves /upgrade/h
//      only for a correctly signed token, as the backend does; a tampered token is refused);
//   4. structuredContent carries the same relay URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import fs from 'node:fs';

// HARD GATE, NO NETWORK: refuse every non-loopback connect (same guard as
// automint-trial-rungs.test.mjs); the last test fails if one was attempted.
const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'test-internal-key-not-a-real-secret';
const TOOLS = {
  analyze_site: { latitude: 39.04, longitude: -77.49 },
  compare_sites: { locations: '39.04,-77.49;33.45,-112.07' },
  get_dchub_recommendation: { context: 'site-selection' },
};
const LINK = /https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c|u)\/[^\s)>\]"]+/g;

let S, PORT, httpServer, stub, prevBase, prevSecret;

const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: 100 + i, name: `Site ${i}`, region_id: 'PJM', iso: 'PJM', score: 50 + i,
  lat: 39 + i / 10, lon: -77 - i / 10, city: 'Ashburn', state: 'VA', country: 'US',
}));
const SITE = { success: true, overall_score: 62.4, interpretation: 'Moderate site',
  scores: { power_infrastructure: 71.2, gas_pipeline_access: 40.5, fiber_connectivity: 62, market_conditions: 60, risk_resilience: 70 },
  nearby: { substations_50km: 12, generation_capacity_mw: 4312.7 } };

beforeAll(async () => {
  const { createHmac } = await import('node:crypto');
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const url = new URL(req.url, 'http://_');
      req.resume();
      // The relay page: 200 only for a token signed with the internal key (as the backend does).
      const m = /^\/upgrade\/h\/([A-Za-z0-9_-]+)\.([0-9a-f]{32})$/.exec(url.pathname);
      if (m) {
        const sig = createHmac('sha256', SECRET).update(m[1]).digest('hex').slice(0, 32);
        res.statusCode = sig === m[2] ? 200 : 403;
        res.setHeader('content-type', 'text/html');
        res.end('<html>relay</html>');
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      if (url.pathname === '/api/v1/keys/auto-mint') { res.statusCode = 503; res.end('{}'); return; }
      if (url.pathname === '/api/site-score') { res.end(JSON.stringify(SITE)); return; }
      res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS, results: ROWS, sites: [SITE, SITE] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

let id = 1;
async function callTool(name, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'x-dc-client-ip': '198.51.100.78' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const j = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  const r = JSON.parse(j).result || {};
  return { r, text: (r.content || []).map((c) => c.text || '').join('\n'), sc: JSON.stringify(r.structuredContent || null) };
}

describe('keyless wall: the first human link is the /upgrade/h relay page', () => {
  it.each(Object.keys(TOOLS))('%s: first link in text is /upgrade/h/, and it is the only one', async (name) => {
    const { text, sc } = await callTool(name, TOOLS[name]);
    const links = text.match(LINK) || [];
    expect(links.length, `${name}: no human link at all in text:\n${text.slice(0, 600)}`).toBeGreaterThan(0);
    expect(links[0], `${name}: first link is not the relay page`).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\//);
    expect(links, `${name}: more than one human link in text`).toHaveLength(1);
    expect(sc.includes(links[0].replace(/[.,;:]+$/, '')), `${name}: structuredContent carries a different relay`).toBe(true);
  }, 30000);

  it.each(Object.keys(TOOLS))('%s: the relay token is signed for this tool and the page answers 200 on the stub', async (name) => {
    const { text } = await callTool(name, TOOLS[name]);
    const href = (text.match(/https:\/\/dchub\.cloud\/upgrade\/h\/[^\s)>\]"]+/) || [''])[0].replace(/[.,;:]+$/, '');
    expect(href).not.toBe('');
    const path = new URL(href).pathname;
    const payload = Buffer.from(path.split('/').pop().split('.')[0], 'base64url').toString();
    expect(payload.split('|')[1], 'token names the tool').toBe(name);
    const base = `http://127.0.0.1:${stub.address().port}`;
    expect((await fetch(base + path)).status).toBe(200);
    const bad = path.slice(0, -1) + (path.endsWith('0') ? '1' : '0');
    expect((await fetch(base + bad)).status, 'the stub page must reject a tampered token (non-vacuous 200)').toBe(403);
  }, 30000);

  it('no non-loopback connection was attempted', () => {
    expect(foreign).toEqual([]);
  });
});

// keyed-free analyze_site preview: scores are null, so provenance must say partial_preview.
describe('keyed-free Land & Power preview stamps provenance partial_preview', () => {
  it('a preview that nulled a figure is partial_preview; one that withheld nothing is not stamped', async () => {
    const { buildProvenance } = await import('../lib/attribution.mjs');
    const full = { ...SITE, location: { lat: 39.04, lon: -77.49 } };
    const prev = S._lpPreviewResult('analyze_site',
      { content: [{ type: 'text', text: JSON.stringify(full) }] }, false);
    const sc = prev.structuredContent;
    expect(sc.overall_score).toBeNull();                       // the scores really are null
    expect(sc._scores_in_pro).toBe(true);
    const prov = buildProvenance(sc, { tier: 'free', toolName: 'analyze_site' });
    expect(prov.completeness).toBe('partial_preview');
    expect(prov.preview.withholding_proven).toBe(true);
    // nothing to withhold (counts and names only) -> no withholding claim
    const bare = S._lpPreviewResult('analyze_site',
      { content: [{ type: 'text', text: JSON.stringify({ success: true, interpretation: 'Moderate site', nearby: { substations_50km: 12 } }) }] }, false);
    expect(bare.structuredContent._scores_in_pro).toBeUndefined();
  });
});

