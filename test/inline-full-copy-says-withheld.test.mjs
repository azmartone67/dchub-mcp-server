// The anonymous granted answer for rank_markets arrives with score and total_mw nulled by the
// free-tier mask (Pro / $10-pack fields), yet the unlock copy said "`rank_markets` is FULL on
// this session now … N more full answers today". The copy now names what is withheld; an answer
// with nothing withheld keeps the legacy wording. Real POST /mcp handler, 127.0.0.1 stub, no egress.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { limitedAnswerCopy } from '../lib/metered-note.mjs';

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
const decode = (raw) => (raw.includes('data: ')
  ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw);

let stub, httpServer, PORT, plain = false; const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const u = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const send = (c, o) => { res.statusCode = c; res.end(JSON.stringify(o)); };
        if (u.pathname.includes('auto-mint')) {
          return send(200, { ok: true, api_key: 'dch_trial_TESTONLY00000000000000000000', tier: 'free', days_remaining: 7 });
        }
        if (u.pathname === '/api/v1/mcp/tools/rank_markets') {
          return send(200, { criteria: 'best_overall', region: 'us', result_count: 3,
            results: [1, 2, 3].map((i) => (plain
              ? { rank: i, market: 'm' + i, city: 'City' + i }
              : { rank: i, market: 'm' + i, city: 'City' + i, facility_count: 10 * i, total_mw: 100 * i, score: 50 * i })) });
        }
        send(404, { error: 'not found', path: u.pathname });
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_MINT_SKIP_INTERNAL']) prev[k] = process.env[k];
  process.env.DCHUB_MINT_SKIP_INTERNAL = '0';
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  net.Socket.prototype.connect = realConnect;
});

async function firstCall() {
  const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'x-forwarded-for': '203.0.113.' + (10 + Math.floor(Math.random() * 200)) };
  const post = (headers, body) => fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
  const init = await post(H, { jsonrpc: '2.0', id: 0, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } });
  const sid = init.headers.get('mcp-session-id'); await init.text();
  const H2 = { ...H, 'mcp-session-id': sid };
  await (await post(H2, { jsonrpc: '2.0', method: 'notifications/initialized' })).text();
  const res = await post(H2, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'rank_markets', arguments: {} } });
  const r = JSON.parse(decode(await res.text())).result || {};
  return { sc: r.structuredContent || {}, text: (r.content || []).map((c) => c.text || '').join('\n') };
}

describe('inline-full unlock copy says what the free answer withheld', () => {
  it('masked answer: names score/total_mw, no "is FULL", no "full answer" promise', async () => {
    plain = false;
    const { sc, text } = await firstCall();
    expect(sc.inline_full, 'not the inline-full branch — assertions would be vacuous').toBe(true);
    expect(text).toContain('"score":null');                        // it IS masked
    expect(text).toMatch(/withheld at this tier/);
    expect(text).toMatch(/score/);
    expect(text).toMatch(/total_mw/);
    expect(text).not.toContain('is FULL on this session now');
    expect(text).not.toMatch(/more full answer/);
    expect(sc.retry_instructions).toMatch(/free answer/);
    expect(sc.retry_instructions).toMatch(/withheld at this tier/);
    expect(sc.retry_instructions).not.toMatch(/more full answer/);
  });
  it('control, nothing withheld: the legacy "FULL" copy is unchanged', async () => {
    plain = true;
    const { sc, text } = await firstCall();
    expect(sc.inline_full).toBe(true);
    expect(text).not.toContain('"score":null');
    expect(text).toContain('is FULL on this session now');
    expect(text).toMatch(/more full answer/);
    expect(sc.retry_instructions).toMatch(/more full answer/);
    expect(text).not.toMatch(/withheld at this tier/);
  });
  it('no foreign connection', () => { expect(foreign).toEqual([]); });
});

describe('limitedAnswerCopy (pure)', () => {
  const mk = (extra) => ({
    content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text:
      '✅ **Free trial unlocked on THIS session — call `rank_markets` again — you have 1 more full answer today on the free trial. No header.**\n'
      + '→ `rank_markets` is FULL on this session now (free for 7 days, 1 full answer left today) — just call it again.\n' }],
    structuredContent: { inline_full: true,
      retry_instructions: 'Call rank_markets again (you have 2 more full answers today on the free trial). If it is still gated...',
      provenance: { preview: { withholding_proven: true, withheld_fields: ['score', 'total_mw'] } }, ...extra },
  });
  it('rewrites the three phrasings with the withheld names, pluralising correctly', () => {
    const r = limitedAnswerCopy(mk());
    const t = r.content.map((c) => c.text).join('\n');
    expect(t).toContain('is free on this session now, with score, total_mw withheld at this tier (free for 7 days, 1 free answer left today).');
    expect(t).toContain('you have 1 more free answer today on the free trial (score, total_mw stay withheld at this tier)');
    expect(t).not.toMatch(/FULL|full answer/);
    expect(r.structuredContent.retry_instructions)
      .toContain('(you have 2 more free answers today on the free trial; score, total_mw stay withheld at this tier)');
  });
  it('controls: no proven withholding, no inline_full, or no names leaves the result untouched', () => {
    for (const bad of [
      mk({ provenance: { preview: { withholding_proven: false, withheld_fields: ['score'] } } }),
      mk({ inline_full: false }),
      mk({ provenance: { preview: { withholding_proven: true, withheld_fields: [] } } }),
    ]) expect(limitedAnswerCopy(bad)).toBe(bad);
  });
});
