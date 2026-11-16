// Grok note N addendum (2026-11-16): a listing link names its directory or partner,
// https://dchub.cloud/mcp?via=directory&src=glama. The slug is a CLOSED set (canonical/directories.json ids plus the
// registered via tags), carried on the session_init event and onto the claim / bind calls (X-DCHub-Via + X-DCHub-Src),
// from the request or the session memo. An unknown src is dropped and never forwarded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  LISTING_SRCS, listingSrcSet, loadListingSrcs, normalizeListingSrc, listingSrcFromRequest, listingAttribution,
  rememberListingSrc, recallListingSrc, applyListingSrcHeaders, _resetListingSrcMemo,
} from '../lib/via-src.mjs';
import { DIRECTORY_VIA_TAGS } from '../lib/via-tags.mjs';

describe('the slug set (pure)', () => {
  it('is every directories.json id plus the registered tags, aliases folded', () => {
    const doc = JSON.parse(readFileSync(new URL('../canonical/directories.json', import.meta.url), 'utf8'));
    for (const r of doc.directories) {
      const id = String(r.id).toLowerCase();
      expect(normalizeListingSrc(id), id).toBeTruthy();
    }
    for (const t of DIRECTORY_VIA_TAGS) expect(LISTING_SRCS.has(t)).toBe(true);
    expect(normalizeListingSrc('mcp-so')).toBe('mcpso');
    expect(normalizeListingSrc(' Glama ')).toBe('glama');
    expect(normalizeListingSrc('lobehub')).toBe('lobehub');
  });
  it('drops anything else', () => {
    for (const bad of ['evil', '', null, undefined, 'glama; drop', 'https://glama.ai', ['glama'], { a: 1 }, 'x'.repeat(80)]) {
      expect(normalizeListingSrc(bad), String(bad)).toBeNull();
    }
  });
  it('an unreadable or empty file leaves the registered tags only', () => {
    expect([...loadListingSrcs(new URL('file:///nonexistent/directories.json'))].sort()).toEqual([...DIRECTORY_VIA_TAGS].sort());
    expect(loadListingSrcs().has('lobehub')).toBe(true);
    expect([...listingSrcSet(null)].sort()).toEqual([...DIRECTORY_VIA_TAGS].sort());
    expect(listingSrcSet({ directories: [{ id: 'Bad Id!' }, { id: 'newdir' }] }).has('newdir')).toBe(true);
    expect(listingSrcSet({ directories: [{ id: 'Bad Id!' }] }).has('bad id!')).toBe(false);
  });
  it('src counts only beside via=directory|partner, header before query', () => {
    expect(listingSrcFromRequest({ query: { src: 'glama' } }, 'directory')).toEqual({ via: 'directory', src: 'glama' });
    expect(listingSrcFromRequest({ query: { src: 'pipeworx' } }, 'partner')).toEqual({ via: 'partner', src: 'pipeworx' });
    expect(listingSrcFromRequest({ headers: { 'x-dchub-src': 'smithery' }, query: { src: 'glama' } }, 'directory'))
      .toEqual({ via: 'directory', src: 'smithery' });
    expect(listingSrcFromRequest({ query: { src: 'glama' } }, 'x')).toBeNull();
    expect(listingSrcFromRequest({ query: { src: 'glama' } }, null)).toBeNull();
    expect(listingSrcFromRequest({ query: { src: 'evil' } }, 'directory')).toBeNull();
    expect(listingSrcFromRequest({ query: {} }, 'directory')).toBeNull();
  });
  it('the session memo fills a later request, never against a different declared via', () => {
    _resetListingSrcMemo();
    rememberListingSrc('s1', { via: 'directory', src: 'glama' });
    expect(recallListingSrc('s1')).toEqual({ via: 'directory', src: 'glama' });
    expect(listingAttribution({ sessionId: 's1' })).toEqual({ via: 'directory', src: 'glama' });
    expect(listingAttribution({ sessionId: 's1', requestVia: 'directory' })).toEqual({ via: 'directory', src: 'glama' });
    expect(listingAttribution({ sessionId: 's1', requestVia: 'reddit' })).toBeNull();
    expect(listingAttribution({ sessionId: 's2' })).toBeNull();
    expect(listingAttribution({ requestPair: { via: 'partner', src: 'pipeworx' }, sessionId: 's1' }))
      .toEqual({ via: 'partner', src: 'pipeworx' });
    expect(applyListingSrcHeaders({}, null)).toEqual({});
    expect(applyListingSrcHeaders({ 'X-DCHub-Via': 'other' }, { via: 'directory', src: 'glama' }))
      .toEqual({ 'X-DCHub-Via': 'directory', 'X-DCHub-Src': 'glama' });
  });
});

let S, stub, srv, PORT, claimHeaders = [], events = [];
const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (p === '/api/v1/keys/claim') claimHeaders.push(req.headers);
        if (p === '/api/v1/mcp/track') { try { const b = JSON.parse(raw); if (b.event === 'session_init') events.push(b); } catch (_) {} }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
});
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const H0 = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
async function session(query) {
  const init = await fetch(`http://127.0.0.1:${PORT}/mcp${query}`, { method: 'POST', headers: H0, body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'via-src-test', version: '1' } } }) });
  const sid = init.headers.get('mcp-session-id'); await init.text();
  const h = { ...H0, 'mcp-session-id': sid };
  await (await fetch(`http://127.0.0.1:${PORT}/mcp${query}`, { method: 'POST', headers: h,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).text();
  return h;
}
async function claim(query, h) {
  claimHeaders = [];
  await (await fetch(`http://127.0.0.1:${PORT}/mcp${query}`, { method: 'POST', headers: h, body: JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'claim_free_key', arguments: { client_name: 'via-src-check' } } }) })).text();
  return claimHeaders[0];
}
const waitFor = async (fn) => { for (let i = 0; i < 50 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 20)); };

describe('/mcp?via=directory&src=<slug> end to end', () => {
  it('the session_init event and the claim carry the slug', async () => {
    events = [];
    const h = await session('?via=directory&src=glama');
    await waitFor(() => events.length > 0);
    expect(events.find((e) => e.via === 'directory')?.src).toBe('glama');
    const c = await claim('?via=directory&src=glama', h);
    expect(c, 'claim never reached the stub').toBeTruthy();
    expect([c['x-dchub-via'], c['x-dchub-src']]).toEqual(['directory', 'glama']);
  });
  it('a later call in the same session that lost the query still carries the slug (session memo)', async () => {
    const h = await session('?via=partner&src=pipeworx');
    const c = await claim('', h);
    expect([c['x-dchub-via'], c['x-dchub-src']]).toEqual(['partner', 'pipeworx']);
  });
  it('an unknown src is dropped: the channel still travels, no src header, no src on the event', async () => {
    events = [];
    const h = await session('?via=directory&src=evil');
    await waitFor(() => events.length > 0);
    expect(events.find((e) => e.via === 'directory')?.src).toBeNull();
    const c = await claim('?via=directory&src=evil', h);
    expect(c['x-dchub-via']).toBe('directory');
    expect(c['x-dchub-src']).toBeUndefined();
  });
  it('src on any other via is never forwarded', async () => {
    const h = await session('?via=reddit&src=glama');
    const c = await claim('?via=reddit&src=glama', h);
    expect([c['x-dchub-via'], c['x-dchub-src']]).toEqual(['reddit', undefined]);
  });
});
