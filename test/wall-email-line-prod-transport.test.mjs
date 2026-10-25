// wall-email-line-prod-transport.test.mjs — option A, the agent half (owner 2026-10-25), on the
// PRODUCTION transport: DCHUB_WALL_ISERROR=0 and DCHUB_PREVIEW_ISERROR=0 (both read before the import;
// the preview flag is read once at load). A free, email-less caller on a real get_grid_intelligence /
// get_interconnection_queue wall gets ONE human line, the free email unlock on the /u/ link, and
// block 0 still parses as JSON (test/block0-is-json-everywhere).
//
// Real /mcp handler over HTTP against a stub backend that serves production payloads captured
// read-only 2026-10-25 (test/fixtures/grid-intelligence-miso.json,
// interconnection-queue-by-iso-miso.json) and answers the /u/ mint as production does. mcp#1143's
// line passed a hand-built wall and never fired on a real one. The code-default transport is
// covered in test/retention-email-ask.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import * as R from '../lib/retention.mjs';

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

const SECRET = 'test-internal-key-not-a-real-secret';
const FREE_KEY = 'dch_live_wall_line_prod_free_0001';
const EMAIL_KEY = 'dch_live_wall_line_prod_mail_0001';
const FIXTURE = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const GRID_MISO = FIXTURE('grid-intelligence-miso.json');
const QUEUE_MISO = FIXTURE('interconnection-queue-by-iso-miso.json');
const SHORT_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
const HUMAN = '→ **For your human:**';
const ENV = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_INTERNAL_KEY: SECRET };

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

let S, PORT, httpServer, stub, shortN = 0;
// The backend's high-intent claim answer (should_mint=true), served while `claim` is set. Production's
// human_url is the claim's durable view, https://dchub.cloud/relay/<token> (dchub-backend
// routes/mcp_high_intent_claim.py), never an /upgrade/h link.
const CLAIM = { should_mint: true, claim_url: 'https://dchub.cloud/claim/abc', claim_token: 't', count: 3,
                threshold: 2, human_url: 'https://dchub.cloud/c/abc' };
let claim = null;
const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const p = url.pathname;
      if (p === '/api/v1/grid/intelligence/MISO') { res.end(GRID_MISO); return; }
      if (p === '/api/v1/interconnection-queue/by-iso' && url.searchParams.get('iso') === 'MISO') { res.end(QUEUE_MISO); return; }
      if (p === '/api/v1/relay/short') {
        await readBody(req);
        let n = ++shortN, code = '';
        for (let i = 0; i < 6; i++) { code += SHORT_ALPHA[n % SHORT_ALPHA.length]; n = Math.floor(n / SHORT_ALPHA.length); }
        res.end(JSON.stringify({ ok: true, url: 'https://dchub.cloud/u/' + code }));
        return;
      }
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        const known = key === FREE_KEY || key === EMAIL_KEY;
        res.end(JSON.stringify(known ? { valid: true, tier: 'free', email: key === EMAIL_KEY ? 'jane@firm.com' : null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/mcp/should-mint-claim' && claim) { res.end(JSON.stringify(claim)); return; }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [], items: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of [...Object.keys(ENV), 'DCHUB_API_BASE']) prev[k] = process.env[k];
  Object.assign(process.env, ENV, { DCHUB_API_BASE: `http://127.0.0.1:${stub.address().port}` });
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}
let ipN = 20, rpcId = 10;
// The live check's shape: initialize, then tools/call, UA Claude-User, X-DCHub-QA: 1.
async function wallSession(key) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, 'user-agent': 'Claude-User', 'x-dchub-qa': '1',
               ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return async (tool) => {
    const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: tool, arguments: { iso: 'MISO' } } });
    const result = JSON.parse(body).result || {};
    const text = (result.content || []).map((c) => c.text || '').join('\n');
    return { sid, result, text, sc: result.structuredContent || {} };
  };
}
const wallCall = async (tool, key) => (await wallSession(key))(tool);
const humanLines = (t) => t.split('\n').filter((l) => l.includes(HUMAN) || /^\s*(\*\*)?Tell the user:/.test(l));

describe('option A wall line, production transport', () => {
  it('grid / queue wall, keyless and free key with no email: one human line, the email unlock; block 0 is JSON', async () => {
    for (const tool of R.WALL_EMAIL_TELL_TOOLS) {
      for (const key of [undefined, FREE_KEY]) {
        const at = tool + ' ' + (key ? 'free key' : 'keyless');
        const r = await wallCall(tool, key);
        expect(r.sid, at).toBeTruthy();
        expect(r.result.isError, at).toBeFalsy();
        const b0 = r.result.content[0].text;
        expect(() => JSON.parse(b0), at).not.toThrow();
        const url = r.sc.human_url;
        expect(url, at).toMatch(/^https:\/\/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}$/);
        expect(JSON.parse(b0).human_url, at).toBe(url);
        expect(humanLines(r.text), at).toEqual([HUMAN + ' ' + R.wallEmailLineText(url)]);
        expect(R.countTellLines(r.text), at).toBe(0);
        expect(r.sc.human_message, at).toBe(R.wallEmailLineText(url));
        expect(r.text, at).not.toMatch(/paid DC Hub plan|plans that include/);
      }
    }
  });

  it('a repeat wall in the same session (r-relay-cap) adds no line; its human_message carries the email wording', async () => {
    for (const key of [undefined, FREE_KEY]) {
      const call = await wallSession(key);
      const first = await call('get_interconnection_queue');
      expect(humanLines(first.text).length, String(key)).toBe(1);
      for (const tool of ['get_interconnection_queue', 'get_grid_intelligence']) {
        const at = tool + ' repeat ' + (key ? 'free key' : 'keyless');
        const r = await call(tool);
        expect(humanLines(r.text), at).toEqual([]);                 // the session's one line was already sent
        expect(R.countTellLines(r.text), at).toBe(0);
        expect(() => JSON.parse(r.result.content[0].text), at).not.toThrow();
        const url = r.sc.human_url;
        expect(url, at).toMatch(/^https:\/\/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}$/);
        expect(r.sc.human_message, at).toBe(R.wallEmailLineText(url));
        expect(r.sc.for_your_human && r.sc.for_your_human.text, at).toBe(R.wallEmailLineText(url));
      }
    }
  });

  it('a key with an email bound gets no wall and no line', async () => {
    const r = await wallCall('get_grid_intelligence', EMAIL_KEY);
    expect(r.text).not.toMatch(/held back part of this answer/);
  });
});

// The high-intent claim path (backend should-mint-claim answers should_mint=true). Measured live
// 10-25: ~5 of 12 fresh-session queue walls carried no '→ For your human' line; their one visible
// line was the '🔒 **This answer hid …** … The page shows the options → /u/…' header in the old
// wording. Pre-existing (same with DCHUB_WALL_EMAIL_TELL=0): the person's line carried the claim's
// own link (/relay/<token>), not human_url, so the one-link step wrote human_url into the first
// pointer it met (the header's /go/c) and left the person's line a phrase, which was then dropped.
describe('the high-intent claim path keeps the standard human line', () => {
  // Every prose line that carries the response's human link (block 0's JSON is data, not a line).
  const linkLines = (r, url) => r.result.content.flatMap((b, i) => {
    let t = b.text || '';
    if (i === 0) { try { JSON.parse(t); return []; } catch (_) { /* prose follows */ } }
    return t.split('\n').filter((l) => l.includes(url));
  });
  const CLAIMS = [CLAIM, { ...CLAIM, human_url: 'https://dchub.cloud/relay/c2lkfGdldF9pbnRlcmNvbm5lY3Rpb25fcXVldWU.0a1b2c3d' }];
  const withClaim = async (c, fn) => { claim = c; try { return await fn(); } finally { claim = null; } };

  it('queue / grid wall with a claim, keyless and free key: one human line, the email unlock; block 0 is JSON', async () => {
    for (const c of CLAIMS) {
      for (const tool of R.WALL_EMAIL_TELL_TOOLS) {
        for (const key of [undefined, FREE_KEY]) {
          const at = tool + ' ' + (key ? 'free key' : 'keyless') + ' ' + c.human_url;
          const r = await withClaim(c, () => wallCall(tool, key));
          expect(r.result.isError, at).toBeFalsy();
          const b0 = r.result.content[0].text;
          expect(() => JSON.parse(b0), at).not.toThrow();
          const url = r.sc.human_url;
          expect(url, at).toMatch(/^https:\/\/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}$/);
          expect(humanLines(r.text), at).toEqual([HUMAN + ' ' + R.wallEmailLineText(url)]);
          expect(linkLines(r, url), at).toEqual([HUMAN + ' ' + R.wallEmailLineText(url)]);
          expect(R.countTellLines(r.text), at).toBe(0);
          expect(r.text, at).not.toMatch(/The page shows the options → https:/);
          expect(r.text, at).not.toMatch(/paid DC Hub plan|plans that include/);
          expect(r.sc.human_message, at).toBe(R.wallEmailLineText(url));
        }
      }
    }
  });

  it('with the email line off (DCHUB_WALL_EMAIL_TELL=0) the claim wall still has its one standard line', async () => {
    const was = process.env.DCHUB_WALL_EMAIL_TELL;
    process.env.DCHUB_WALL_EMAIL_TELL = '0';
    try {
      for (const c of CLAIMS) {
        const r = await withClaim(c, () => wallCall('get_interconnection_queue'));
        const url = r.sc.human_url;
        expect(() => JSON.parse(r.result.content[0].text), c.human_url).not.toThrow();
        const lines = humanLines(r.text);
        expect(lines.length, c.human_url).toBe(1);
        expect(lines[0].startsWith(HUMAN + ' '), c.human_url).toBe(true);
        expect(linkLines(r, url), c.human_url).toEqual(lines);
        expect(r.text, c.human_url).not.toMatch(/held back part of this answer/);
        expect(R.countTellLines(r.text), c.human_url).toBe(0);
      }
    } finally { if (was === undefined) delete process.env.DCHUB_WALL_EMAIL_TELL; else process.env.DCHUB_WALL_EMAIL_TELL = was; }
  });
});
