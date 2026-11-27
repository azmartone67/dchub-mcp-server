// invalid-key-notice-public-link-1127.test.mjs — stability P3 (2026-11-27).
//
// ★THE BUG. With an invalid API key, initialize says "Get a new key at https://dchub.cloud/connect", but a
// gated tool result (site_selection_canvas, search_facilities) said "Get a new key at <the wall's own link>":
// the one-link wall rule (_oneLinkWallStep) rewrote every dchub.cloud page link in the text to the wall's
// human link, the invalid-key notice's link included, so the notice pointed at a personal /u/ (or long
// /upgrade/h/) relay link instead of the public key page.
//
// ★THE CONTRACT PINNED HERE. On a keyless wall served because the key was refused, the notice keeps the same
// public key page initialize names (_keyHelpUrl: /connect, or the platform's install page), and the wall
// itself still converges on its one link (human_url is still the relay link).
//
// Loopback only: a 127.0.0.1 backend stub, and no socket may leave loopback. The internal key is a synthetic
// test value so the relay link is minted at all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

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

const BAD_KEY = 'dch_live_' + 'p3invalid'.padEnd(32, 'q');
const CANVAS = { matched: 3, shortlist: [{ market_slug: 'abilene', market_name: 'Abilene', verdict: 'BUILD' }],
  synthesis: { locked: true, message: 'locked', unlock: { url: 'https://dchub.cloud/upgrade?tool=site_selection_canvas' } } };
const ROWS = Array.from({ length: 5 }, (_, i) => ({ id: 7000 + i, name: `Facility ${i}`, provider: 'Test Provider',
  city: 'Reno', state: 'NV', country: 'US', slug: `p3-facility-${i}`, power_mw: 10 * (i + 1) }));

let PORT, httpServer, stub;
const prev = {};
beforeAll(async () => {
  stub = createServer((req, res) => {
    const p = new URL(req.url, 'http://_').pathname;
    res.setHeader('content-type', 'application/json');
    if (p === '/api/v1/keys/validate') return res.end(JSON.stringify({ valid: false, tier: 'free' }));
    if (p === '/api/v1/relay/short') return res.end(JSON.stringify({ ok: true, url: 'https://dchub.cloud/u/ab23cd' }));
    if (p.startsWith('/api/v1/site-selection/canvas')) return res.end(JSON.stringify(CANVAS));
    if (p === '/api/v1/facilities') return res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS }));
    res.end('{}');
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'synthetic-internal-key-for-tests';
  const S = await import('../server.mjs');
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60000);
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  net.Socket.prototype.connect = realConnect;
});

async function call(name, args, ua = 'p3-test-client/1.0') {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': ua, 'x-api-key': BAD_KEY },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const j = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  const result = JSON.parse(j).result || {};
  const texts = (result.content || []).map((b) => (b && typeof b.text === 'string' ? b.text : ''));
  const notice = texts.find((t) => /isn't valid, so you're getting keyless results/.test(t)) || '';
  return { raw, result, notice };
}

const NOTICE_LINK = /Get a new key at (\S+)/;

describe('invalid-key notice on a gated tool result names the public key page', () => {
  it.each([
    ['site_selection_canvas', { capacity_mw: 100, region: 'TX' }],
    ['search_facilities', { query: 'reno', limit: 5 }],
  ])('%s', async (name, args) => {
    const r = await call(name, args);
    // Non-vacuous: the key was refused (notice present) and this answer is a wall that converged on one relay link.
    expect(r.notice, r.raw.slice(0, 400)).not.toBe('');
    expect(String(r.result.structuredContent.human_url || '')).toMatch(/^https:\/\/dchub\.cloud\/(u|upgrade\/h)\//);
    expect(NOTICE_LINK.exec(r.notice)[1]).toBe('https://dchub.cloud/connect');
    expect(r.notice).not.toMatch(/dchub\.cloud\/(u|upgrade\/h)\//);
    expect(r.raw).not.toContain(BAD_KEY);   // the key value is never echoed
  }, 60000);
  it('a platform keeps its own install page (the same one initialize names)', async () => {
    const r = await call('search_facilities', { query: 'reno', limit: 5 }, 'grok-mcp/1.0');
    expect(r.notice).not.toBe('');
    expect(NOTICE_LINK.exec(r.notice)[1]).toBe('https://dchub.cloud/install/grok');
  }, 60000);
  it('no socket left loopback', () => { expect(foreign).toEqual([]); });
});
