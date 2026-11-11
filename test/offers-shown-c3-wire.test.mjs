// offers-shown-c3-wire.test.mjs (harness copied from depth-wall-digest-ask.test.mjs): C3 (owner go 2026-11-09).
// The quota_wall_hit row's offers_shown and its G8 ask mark are read off the result the agent RECEIVES,
// after the lean step, not inside _wallOuterStep. Found building C3: on the keyless list_transactions wall
// the claim hand-off line ("ask your human for their email first ... claim_free_key") is added inside the
// chain and cut by leanResponseStep, so a row read before the lean step named an email ask and a free_key
// offer that never reached the agent.
//
// Real /mcp handler over HTTP (production transport: DCHUB_WALL_ISERROR=0, DCHUB_PREVIEW_ISERROR=0, lean
// on) against a stub backend; the row is read from the quota_wall_hit event the server posts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { offersShown } from '../lib/offers-shown.mjs';

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
const AICAP = JSON.parse(readFileSync(new URL('./fixtures/ai-capacity-index-90.json', import.meta.url), 'utf8'));
const SHORT_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
const HUMAN = '→ **For your human:**';
const CAP = 10;   // IDENTIFIED_DAILY_FULL_CAP's default (DCHUB_IDENTIFIED_TOOL_DAILY_FULL is cleared below)
const ENV = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_INTERNAL_KEY: SECRET };
const CLEAR = ['DCHUB_WALL_OFFER_FLOOR', 'DCHUB_OFFERS_SHOWN_EVENT', 'DCHUB_WALL_TAG_ALL', 'DCHUB_DEPTH_DIGEST_ASK', 'DCHUB_AICAP_EMAIL_ASK', 'DCHUB_LEAN_RESPONSES', 'DCHUB_IDENTIFIED_TOOL_DAILY_FULL', 'DCHUB_TRIAL_TOOL_DAILY_FULL'];

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

let S, PORT, httpServer, stub, shortN = 0;
const events = [];   // quota_wall_hit bodies the server posted
const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const p = url.pathname;
      if (p === '/api/v1/deals') {
        const deals = Array.from({ length: 12 }, (_, i) => ({ buyer: 'Buyer ' + i, seller: 'Seller ' + i,
          value_usd_m: 100 + i, date: '2026-10-' + String(10 + i).padStart(2, '0'), market: 'dallas' }));
        res.end(JSON.stringify({ success: true, count: 12, total_count: 12, total_value: 1266, total_value_unit: 'usd_m', transactions: deals }));
        return;
      }
      if (p === '/api/v1/ai-capacity-index') {
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        const markets = AICAP.markets.slice(0, limit);
        res.end(JSON.stringify({ ...AICAP, markets, result_count: markets.length }));
        return;
      }
      if (p === '/api/v1/relay/short') {
        await readBody(req);
        let n = ++shortN, code = '';
        for (let i = 0; i < 6; i++) { code += SHORT_ALPHA[n % SHORT_ALPHA.length]; n = Math.floor(n / SHORT_ALPHA.length); }
        res.end(JSON.stringify({ ok: true, url: 'https://dchub.cloud/u/' + code }));
        return;
      }
      if (p === '/api/v1/mcp/funnel-event') {
        const b = await readBody(req);
        if (b && b.event === 'quota_wall_hit') events.push(b);
        res.end('{"ok":true}');
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [], items: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of [...Object.keys(ENV), ...CLEAR, 'DCHUB_API_BASE']) prev[k] = process.env[k];
  for (const k of CLEAR) delete process.env[k];
  Object.assign(process.env, ENV, { DCHUB_API_BASE: `http://127.0.0.1:${stub.address().port}` });
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

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
let ipN = 140, rpcId = 10;
// The after-merge QA call's shape: initialize, then tools/call, UA dchub-qa-readonly, X-DCHub-QA: 1.
async function session(clientName = 'Claude Code', tool = 'list_transactions') {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, 'user-agent': 'dchub-qa-readonly', 'x-dchub-qa': '1' };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return async (args = {}) => {
    const before = events.length;
    const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: tool, arguments: args } });
    const result = JSON.parse(body).result || {};
    // The wall-hit event leaves from _wallOuterStep (fire and forget): wait for this call's.
    for (let i = 0; i < 50 && events.length === before; i++) await new Promise((r) => setTimeout(r, 20));
    const ev = events.slice(before).find((e) => e.tool === tool) || null;
    const texts = (result.content || []).map((c) => c.text || '');
    return { sid, result, texts, text: texts.join('\n'), sc: result.structuredContent || {}, ev };
  };
}
const withEnv = async (k, v, fn) => {
  const was = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { if (was === undefined) delete process.env[k]; else process.env[k] = was; }
};

describe('C3 on the wire: the wall row names what the agent received', () => {
  it('offers_shown equals the offers in the result on the wire (digest wall)', async () => {
    const r = await (await session())();
    expect(r.ev).toBeTruthy();
    expect(Array.isArray(r.ev.offers_shown)).toBe(true);
    expect(r.ev.offers_shown).toEqual(offersShown(r.result, r.ev.email_ask));
    expect(r.ev.offers_shown).toContain('digest');
    expect(r.ev.offers_shown).toContain('pro');          // the /u/ relay link
  });

  it('an ask the lean step cut is neither marked nor offered (the claim hand-off line)', async () => {
    // The offer floor (item 2) is off: this reads what the lean step cut, not the line added after it.
    const r = await withEnv('DCHUB_WALL_OFFER_FLOOR', '0', () => withEnv('DCHUB_DEPTH_DIGEST_ASK', '0', async () => (await session())()));
    expect(r.text).not.toMatch(/ask your human for (their|an) email/i);
    expect(r.text).not.toContain('claim_free_key');
    expect(r.ev && r.ev.email_ask).toBeUndefined();
    expect(r.ev.offers_shown).not.toContain('free_key');
    expect(r.ev.offers_shown).not.toContain('email_unlock');
    expect(r.ev.offers_shown).toEqual(offersShown(r.result, r.ev.email_ask));
  });

  it('a marked email ask that reached the agent is an email_unlock offer (ai_capacity_index rows ask)', async () => {
    const r = await (await session('Claude Code', 'ai_capacity_index'))();
    expect(r.ev.email_ask).toBe('line');
    expect(r.ev.offers_shown).toContain('email_unlock');
  });

  it('DCHUB_OFFERS_SHOWN_EVENT=0: the row carries no offers_shown (unknown, stored NULL)', async () => {
    const r = await withEnv('DCHUB_OFFERS_SHOWN_EVENT', '0', async () => (await session())());
    expect(r.ev).toBeTruthy();
    expect('offers_shown' in r.ev).toBe(false);
  });
});
