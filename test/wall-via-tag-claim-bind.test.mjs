// Owner 2026-11-05 ("ship ... MCP-side via tag"): a session that was handed a wall link (?via=mcp-wall&wall=<type>,
// lib/wall-tag.mjs) credits its LATER claim_free_key / bind_email to mcp-wall, by sending X-DCHub-Via: mcp-wall
// on POST /api/v1/keys/claim and POST /api/v1/keys/identify (dchub-backend routes/via_funnel.py counts the key /
// unlock stage from that header on both paths). Explicit connector via wins; no wall, a QA caller or the kill
// switch DCHUB_WALL_VIA_TAG=0: nothing is sent. Drives the REAL /mcp handler against a loopback stub backend.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { wallViaHeaderFor, wallViaTagOn, wallLinkIssued, createWallViaMemo, usableSessionId } from '../lib/wall-via-tag.mjs';

let S, stub, srv, PORT;
const hits = [];   // { path, headers } for the two attributed paths
const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      req.on('data', () => {});
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (p === '/api/v1/keys/claim' || p === '/api/v1/keys/identify') { hits.push({ path: p, headers: req.headers }); return res.end('{}'); }
        if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; return res.end('{}'); }
        // bind_email's api_key arrives as an inline credential, validated before the handler runs
        if (p === '/api/v1/keys/validate') return res.end(JSON.stringify({ valid: true, tier: 'free', developer_id: 'dev_wallvia', email: null }));
        if (p === '/api/v1/mcp/trial-check') return res.end(JSON.stringify({ trial_used: true, prior_calls: 1 }));
        res.end(JSON.stringify({ success: true, data: [{ id: 1, name: 'a', score: 5 }], results: [] }));
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_WALL_VIA_TAG']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  delete process.env.DCHUB_WALL_VIA_TAG;
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
});
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
afterEach(() => { delete process.env.DCHUB_WALL_VIA_TAG; });

let ip = 10;
async function session(query = '', headers = {}) {
  const url = `http://127.0.0.1:${PORT}/mcp${query}`;
  const h0 = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'x-dc-client-ip': `198.51.100.${ip++}`, ...headers };
  const init = await fetch(url, { method: 'POST', headers: h0, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wall-via-test', version: '1' } } }) });
  const sid = init.headers.get('mcp-session-id'); await init.text();
  expect(sid, 'initialize minted no session id').toBeTruthy();
  const h = { ...h0, 'mcp-session-id': sid };
  await (await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).text();
  let id = 10;
  const call = async (name, args) => (await fetch(url, { method: 'POST', headers: h,
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }) })).text();
  return { sid, call };
}
// A wall: an anonymous rank_markets past its trial hands out the tagged relay link (asserted, so the path is live).
async function hitWall(s) {
  const body = await s.call('rank_markets', { limit: 5 });
  expect(body, 'the wall did not hand out a tagged relay link').toMatch(/human_url\\?":\\?"https:\/\/dchub\.cloud\/(?:u|upgrade\/h)\/[^"\\]*/);
  expect(body).toContain('via=mcp-wall&wall=');
}
async function viaOn(s, name, args, path) {
  hits.length = 0;
  await s.call(name, args);
  const hit = hits.find((x) => x.path === path);
  expect(hit, `${name} never reached ${path}`).toBeTruthy();
  return hit.headers['x-dchub-via'];
}
const CLAIM = ['claim_free_key', { client_name: 'wall-via-check' }, '/api/v1/keys/claim'];
const BIND_KEYED = ['bind_email', { email: 'jane.doe@acme-industrial.com', api_key: 'dch_live_wallviatest000000000001' }, '/api/v1/keys/identify'];
const BIND_KEYLESS = ['bind_email', { email: 'jane.doe@acme-industrial.com' }, '/api/v1/keys/claim'];

describe('a session handed a wall link credits its later claim / bind to mcp-wall', () => {
  it('wall, then claim_free_key -> X-DCHub-Via: mcp-wall', async () => {
    const s = await session();
    await hitWall(s);
    expect(S._wallViaSeenFor(s.sid)).toMatchObject({ wall: 'trial_used' });
    expect(await viaOn(s, ...CLAIM)).toBe('mcp-wall');
  });
  it('wall, then bind_email (key given, /keys/identify) -> X-DCHub-Via: mcp-wall', async () => {
    const s = await session();
    await hitWall(s);
    expect(await viaOn(s, ...BIND_KEYED)).toBe('mcp-wall');
  });
  it('wall, then keyless bind_email (mints through /keys/claim) -> X-DCHub-Via: mcp-wall', async () => {
    const s = await session();
    await hitWall(s);
    expect(await viaOn(s, ...BIND_KEYLESS)).toBe('mcp-wall');
  });
  it('no wall in the session -> no header on claim or bind', async () => {
    const s = await session();
    expect(S._wallViaSeenFor(s.sid)).toBeNull();
    expect(await viaOn(s, ...CLAIM)).toBeUndefined();
    expect(await viaOn(s, ...BIND_KEYED)).toBeUndefined();
  });
  it('a wall in ANOTHER session does not leak into this one', async () => {
    const a = await session(); await hitWall(a);
    const b = await session();
    expect(await viaOn(b, ...CLAIM)).toBeUndefined();
  });
  it('explicit connector via wins: ?via=reddit stays reddit after a wall', async () => {
    const s = await session('?via=reddit');
    await hitWall(s);
    expect(await viaOn(s, ...CLAIM)).toBe('reddit');
    expect(await viaOn(s, ...BIND_KEYED)).toBe('reddit');
  });
  it('explicit gateway via (not a funnel channel) is not overridden with mcp-wall', async () => {
    const s = await session('?via=pipeworx');
    await hitWall(s);
    expect(await viaOn(s, ...CLAIM)).toBeUndefined();
  });
  it('kill switch DCHUB_WALL_VIA_TAG=0 at claim time -> absent', async () => {
    const s = await session();
    await hitWall(s);
    process.env.DCHUB_WALL_VIA_TAG = '0';
    expect(await viaOn(s, ...CLAIM)).toBeUndefined();
    expect(await viaOn(s, ...BIND_KEYED)).toBeUndefined();
  });
  it('kill switch at wall time -> the session is never noted', async () => {
    process.env.DCHUB_WALL_VIA_TAG = '0';
    const s = await session();
    await hitWall(s);
    expect(S._wallViaSeenFor(s.sid)).toBeNull();
    delete process.env.DCHUB_WALL_VIA_TAG;
    expect(await viaOn(s, ...CLAIM)).toBeUndefined();
  });
  it('a QA caller (dchub-qa-readonly) is never noted and never tagged', async () => {
    const s = await session('', { 'user-agent': 'dchub-qa-readonly/1.0' });
    await hitWall(s);
    expect(S._wallViaSeenFor(s.sid)).toBeNull();
    expect(await viaOn(s, ...CLAIM)).toBeUndefined();
  });
});

describe('lib/wall-via-tag.mjs (pure)', () => {
  it('wallViaHeaderFor: only on + saw wall + no explicit via + not QA', () => {
    expect(wallViaHeaderFor({ on: true, sawWall: true })).toBe('mcp-wall');
    expect(wallViaHeaderFor({ on: true, sawWall: false })).toBeNull();
    expect(wallViaHeaderFor({ on: false, sawWall: true })).toBeNull();
    expect(wallViaHeaderFor({ on: true, sawWall: true, qa: true })).toBeNull();
    expect(wallViaHeaderFor({ on: true, sawWall: true, explicitVia: 'x' })).toBeNull();
  });
  it('kill switch values', () => {
    for (const v of ['0', 'false', 'off', 'NO']) expect(wallViaTagOn({ DCHUB_WALL_VIA_TAG: v })).toBe(false);
    for (const v of [undefined, '', '1']) expect(wallViaTagOn({ DCHUB_WALL_VIA_TAG: v })).toBe(true);
  });
  it('wallLinkIssued reads structuredContent.human_url', () => {
    expect(wallLinkIssued({ structuredContent: { human_url: 'https://dchub.cloud/u/abc234' } })).toBe(true);
    expect(wallLinkIssued({ structuredContent: { human_url: 'https://dchub.cloud/upgrade/h/x.0123' } })).toBe(true);
    expect(wallLinkIssued({ structuredContent: { human_url: 'https://dchub.cloud/pricing' } })).toBe(false);
    expect(wallLinkIssued({ structuredContent: {} })).toBe(false);
    expect(wallLinkIssued(null)).toBe(false);
  });
  it('memo: no session id is never stored; TTL expires; cap clears', () => {
    let t = 0;
    const m = createWallViaMemo({ cap: 2, ttlMs: 100, now: () => t });
    expect(usableSessionId('no-session')).toBe('');
    expect(m.note('no-session', 'trial_used')).toBe(false);
    expect(m.note('', 'trial_used')).toBe(false);
    expect(m.note(null, 'trial_used')).toBe(false);
    expect(m.size()).toBe(0);
    m.note('a', 'trial_used');
    expect(m.get('a')).toMatchObject({ wall: 'trial_used' });
    t = 101;
    expect(m.get('a')).toBeNull();
    m.note('a', 'w'); m.note('b', 'w'); m.note('c', 'w');
    expect(m.size()).toBe(1);
    expect(m.get('c')).toBeTruthy();
  });
});
