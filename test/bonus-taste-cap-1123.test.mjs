// bonus-taste-cap-1123.test.mjs — free-key bonus tools spend the per-key taste budget (2026-11-23).
//
// Measured live 11-23: one claim_free_key key (no email) took 25 full get_water_risk answers in a row. KEYED_FREE_BONUS
// relied on a "10/day at the worker layer" cap that never bound /mcp. Every door says "Free key: previews plus 2 full
// answers per tool per day", so a bonus full answer now spends that budget (server.mjs applyTierGate, the bonus line).
//   A) free key: answers 1-2 full, answer 3 the trimmed preview with the over-cap _upgrade (status trial_cap_exceeded)
//   B) email-bound key: 10 full, answer 11 the preview
//   CONTROL: DCHUB_BONUS_TASTE_CAP=0 restores the uncapped bonus (3 full answers on a free key)
// Real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend, off-loopback connects refused.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
process.env.DCHUB_LEAN_RESPONSES = '0';

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
// Fixture keys — test values only. Fresh per case so each per-key counter starts at 0.
let n = 0;
const freeKey = () => 'dch_live_bonuscapfree' + String(++n).padStart(8, '0');
const boundKey = () => 'dch_live_bonuscapbound' + String(++n).padStart(7, '0');
const WATER = {
  ok: true, current_drought_pct: 64.2, dominant_severity: 'Severe (D2)', water_stress_score: 71,
  weekly_history: Array.from({ length: 8 }, (_, i) => ({ week: `2026-10-${String(i + 1).padStart(2, '0')}`, d2_pct: 60 + i })),
  counties: Array.from({ length: 12 }, (_, i) => ({ county: `County ${i}`, drought: 'D2' })),
};

let S, PORT, httpServer, stub, prevBase, prevSecret;
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') {
        const k = (await readBody(req)).api_key || '';
        if (k.startsWith('dch_live_bonuscapbound')) return send({ valid: true, tier: 'identified', developer_id: 'd_' + k.slice(-6), email: 'bound+' + k.slice(-6) + '@example.com' });
        if (k.startsWith('dch_live_bonuscapfree')) return send({ valid: true, tier: 'free', developer_id: 'd_' + k.slice(-6), email: null });
        return send({ valid: false, tier: 'free' });
      }
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/mcp/monthly-usage') return send({ error: 'not found' }, 404);
      if (p.startsWith('/api/v1/water')) return send(WATER);
      return send({});
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
  delete process.env.DCHUB_BONUS_TASTE_CAP;
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function call(key) {
  const r = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': key,
      'user-agent': 'bonus-cap-test/1' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_water_risk', arguments: { lat: 32.8, lon: -96.8 } } }),
  });
  const t = await r.text();
  const m = t.match(/^data: (.*)$/m);
  const body = JSON.parse(m ? m[1] : t);
  const res = body.result || {};
  return { res, sc: res.structuredContent || {}, text: (res.content || []).map((c) => c.text || '').join('\n') };
}
const overCap = (a) => /full `get_water_risk` answers today/.test(String((a.sc._upgrade || {}).message || ''));

describe('free-key bonus tools spend the per-key taste budget', () => {
  it('A) a free key gets 2 full get_water_risk answers, then the preview with the over-cap offer', async () => {
    const k = freeKey();
    const got = [];
    for (let i = 0; i < 3; i++) got.push(await call(k));
    expect(overCap(got[0])).toBe(false);
    expect(overCap(got[1])).toBe(false);
    expect(got[0].sc.counties && got[0].sc.counties.length).toBe(12);
    expect(overCap(got[2])).toBe(true);
    // A key with no bound email is told the free step: bind_email lifts the per-tool daily limit.
    expect(got[2].text).toMatch(/`bind_email`[^\n]*email[^\n]*full answers/);
  });

  it('B) an email-bound key gets 10, then the preview', async () => {
    const k = boundKey();
    const got = [];
    for (let i = 0; i < 11; i++) got.push(await call(k));
    expect(got.slice(0, 10).some(overCap)).toBe(false);
    expect(overCap(got[10])).toBe(true);
    expect(got[10].text).not.toMatch(/call `bind_email` with your human/);   // already bound: no bind step
  });

  it('CONTROL) DCHUB_BONUS_TASTE_CAP=0 restores the uncapped bonus', async () => {
    process.env.DCHUB_BONUS_TASTE_CAP = '0';
    try {
      const k = freeKey();
      const got = [];
      for (let i = 0; i < 3; i++) got.push(await call(k));
      expect(got.some(overCap)).toBe(false);
    } finally { delete process.env.DCHUB_BONUS_TASTE_CAP; }
  });
});
