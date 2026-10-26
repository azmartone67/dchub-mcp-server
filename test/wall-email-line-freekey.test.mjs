// wall-email-line-freekey.test.mjs (2026-10-26) — option A's one human line on a keyless FREE-KEY wall
// (relay token w-freekey) of a tool outside grid / queue. That page leads with the free email unlock
// (dchub-backend handoff_email_capture.unlock_eligible; measured live 2026-10-26 on a get_grid_data
// link: "Get the full answer: enter your email"). Harness copied from
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
const minted = [];   // bodies of /relay/short mints: the long relay URL the /u/ code stands for
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
      if (p === '/api/v1/grid/intelligence/MISO' || p === '/api/v1/grid/intelligence/miso') { res.end(GRID_MISO); return; }
      if (p === '/api/v1/interconnection-queue/by-iso' && url.searchParams.get('iso') === 'MISO') { res.end(QUEUE_MISO); return; }
      if (p === '/api/v1/relay/short') {
        minted.push(JSON.stringify(await readBody(req)));
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


// The w-freekey marker rides in the long relay token (base64url field 5/6) the /u/ code was minted from.
const freekeyMinted = () => minted.some((m) => {
  const t = /\/upgrade\/h\/([A-Za-z0-9_-]+)\./.exec(m);
  return !!t && Buffer.from(t[1], 'base64url').toString().split('|').includes('w-freekey');
});
const withEnv = async (k, v, fn) => {
  const was = process.env[k];
  process.env[k] = v;
  try { return await fn(); } finally { if (was === undefined) delete process.env[k]; else process.env[k] = was; }
};
const lastKind = () => {
  const t = /\/upgrade\/h\/([A-Za-z0-9_-]+)\./.exec(minted.at(-1) || '');
  return t ? Buffer.from(t[1], 'base64url').toString().split('|').slice(4).filter((x) => x.startsWith('w-')).join(',') : null;
};

describe('option A line on a keyless free-key wall, production transport', () => {
  it('get_grid_data keyless: one human line, the free email unlock on the /u/ link of a w-freekey token; block 0 is JSON', async () => {
    minted.length = 0;
    const r = await wallCall('get_grid_data');
    expect(r.sid).toBeTruthy();
    expect(r.result.isError).toBeFalsy();
    const b0 = r.result.content[0].text;
    expect(() => JSON.parse(b0)).not.toThrow();
    const url = r.sc.human_url;
    expect(url).toMatch(/^https:\/\/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}$/);
    expect(JSON.parse(b0).human_url).toBe(url);
    expect(freekeyMinted()).toBe(true);                       // the page this line points at leads with the email
    expect(humanLines(r.text)).toEqual([HUMAN + ' ' + R.wallEmailLineText(url)]);
    expect(R.countTellLines(r.text)).toBe(0);
    expect(r.sc.human_message).toBe(R.wallEmailLineText(url));
    expect(r.text).not.toMatch(/lowest plan that returns them|paid DC Hub plan|plans that include|\$\d/);
  });

  it('DCHUB_WALL_EMAIL_TELL_FREEKEY=0: the free-key wall keeps its earlier line; grid / queue keep the email line', async () => {
    await withEnv('DCHUB_WALL_EMAIL_TELL_FREEKEY', '0', async () => {
      const r = await wallCall('get_grid_data');
      const lines = humanLines(r.text);
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatch(/free DC Hub key/);
      expect(r.text).not.toMatch(/held back part of this answer/);
      const g = await wallCall('get_grid_intelligence');
      expect(humanLines(g.text)).toEqual([HUMAN + ' ' + R.wallEmailLineText(g.sc.human_url)]);
    });
  });

  it('DCHUB_WALL_EMAIL_TELL=0 (the parent switch) turns the free-key line off too', async () => {
    await withEnv('DCHUB_WALL_EMAIL_TELL', '0', async () => {
      const r = await wallCall('get_grid_data');
      expect(humanLines(r.text).length).toBe(1);
      expect(r.text).not.toMatch(/held back part of this answer/);
    });
  });

  it('a free key with no email gets get_grid_data in full: no wall, no line', async () => {
    const r = await wallCall('get_grid_data', FREE_KEY);
    expect(r.text).not.toMatch(/held back part of this answer/);
    expect(humanLines(r.text)).toEqual([]);
  });

  // A keyless DEPTH wall (no marker) on another tool: its page sells a plan, so its line stays. These two
  // ride the stub's default empty payload (no production capture for them); the wall shape comes from
  // the gates, which is what the kind gate reads.
  it('a keyless depth wall of another tool (no w-freekey marker) keeps its own line', async () => {
    for (const tool of ['ai_capacity_index', 'grid_transition_radar']) {
      minted.length = 0;
      const r = await wallCall(tool);
      expect(r.sc.human_url, tool).toMatch(/^https:\/\/dchub\.cloud\/u\//);
      expect(lastKind(), tool).toBe('');
      expect(humanLines(r.text).length, tool).toBe(1);
      expect(r.text, tool).not.toMatch(/held back part of this answer/);
    }
  });

  it('get_market_intel (preview-only on every free tier, its page sells a plan) gets no email line', async () => {
    const r = await wallCall('get_market_intel');
    expect(r.text).not.toMatch(/held back part of this answer/);
  });
});

describe('wallEmailTellFreekeyOn', () => {
  it('on by default; its own switch or the parent switch turns it off', () => {
    expect(R.wallEmailTellFreekeyOn({})).toBe(true);
    for (const v of ['0', 'off', 'false', 'no', ' OFF ']) {
      expect(R.wallEmailTellFreekeyOn({ DCHUB_WALL_EMAIL_TELL_FREEKEY: v }), v).toBe(false);
      expect(R.wallEmailTellFreekeyOn({ DCHUB_WALL_EMAIL_TELL: v }), 'parent ' + v).toBe(false);
    }
    expect(R.wallEmailTellFreekeyOn({ DCHUB_WALL_EMAIL_TELL_FREEKEY: '1' })).toBe(true);
  });
});
