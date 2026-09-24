// grid-region-transient-no-sell.test.mjs — r-region-transient + r-nodata-no-sell (2026-09-24)
//
// Two defects, one live response. Measured 2026-09-24:
//   • get_grid_intelligence region_id=DUK (a covered EIA balancing authority)
//     answered "region not covered … retrying will not help" on a call where
//     its one feed failed, then served live data on the next two calls.
//   • that error, and PJM-DOM's source_unavailable marker, went out wrapped in
//     "Free trial unlocked — call it again", a $10 pack link, a Pro link and a
//     for_your_human "hit DC Hub's paid data boundary" — an unlock sold for
//     data that does not exist.
//
// Real /mcp handler over HTTP, anonymous session (the trial path the live probe
// took), fake local backend, no network (harness from automint-trial-rungs).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];                        // net.connect's normalized form
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};
let prevBase, prevSecret;
let S, PORT, httpServer, stub;
let dukMode = 'down';          // 'down' -> 503, 'empty' -> 200 {}, 'live' -> real telemetry
const SECRET = 'test-internal-key-not-a-real-secret';

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      const p = url.pathname;
      res.setHeader('content-type', 'application/json');
      const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
      if (p === '/api/v1/mcp/trial-check') return send(200, { trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send(404, { error: 'not found' });
      if (p === '/api/v1/keys/auto-mint') return send(200, { ok: false });
      // main.py phase19b_grid_intelligence: an unknown code is a 400.
      if (p === '/api/v1/grid/intelligence/ZZQX') {
        return send(400, { error: 'unknown region', supported: ['PJM', 'DUK'] });
      }
      if (p === '/api/v1/grid/intelligence/DUK') {
        if (dukMode === 'down') return send(503, { error: 'EIA upstream timeout' });
        if (dukMode === 'empty') return send(200, {});
        return send(200, { demand_mw: 18000, generation_mix: { NG: { mw: 9000 }, NUC: { mw: 6000 } } });
      }
      if (p === '/api/v1/grid/intelligence/PJM-DOM') {
        return send(200, { region: 'PJM-DOM', source_unavailable: true, temporary: true,
                           retry_after_utc: '2026-10-01T00:00:00Z',
                           message: 'Temporarily unavailable: monthly allowance used up.' });
      }
      if (p === '/api/v1/dcpi/iso-comparison') return send(200, { isos: [] });
      if (p === '/api/v1/interconnection-queue/snapshot') return send(200, { by_iso: [] });
      if (p.startsWith('/api/v1/grid/extended/')) return send(200, { available: false });
      return send(200, { success: true });
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

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, body: b };
}

let rpcId = 10;
// A FRESH anonymous session per call, so every call is that session's first
// call of the tool — the trial path, which is where the live probe landed.
async function anonCall(name, args) {
  const init = await post({}, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {},
              clientInfo: { name: 'grid-region-transient-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
                                   params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  return { result, text: (result.content || []).map((c) => c.text || '').join('\n'), body };
}

// Every piece of commerce the live ZZQX response carried.
const COMMERCE = [/\/go\/c\//, /\/upgrade\/h\//, /\$10\b/, /Free trial unlocked/i,
                  /For your human/i, /Tell your human/i, /for_your_human/, /Pro \$99/];
const sold = (s) => COMMERCE.filter((re) => re.test(s)).map(String);

describe('pure helpers', () => {
  it('_gridRegionFailureKind: only a backend 4xx is a coverage boundary', () => {
    expect(S._gridRegionFailureKind({ error: 'API 400' })).toBe('not_covered');
    expect(S._gridRegionFailureKind({ error: 'API 404' })).toBe('not_covered');
    expect(S._gridRegionFailureKind({ error: 'API 503' })).toBe('transient');
    expect(S._gridRegionFailureKind({ error: 'timeout' })).toBe('transient');
    expect(S._gridRegionFailureKind({})).toBe('transient');
    expect(S._gridRegionFailureKind(null)).toBe('transient');
  });

  it('_isNoDataAnswer: text-only refusals, failure envelopes and top-level source_unavailable', () => {
    const txt = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
    expect(S._isNoDataAnswer(txt({ error: 'x', _error_mitigation: { severity: 'fatal' } }))).toBe(true);
    expect(S._isNoDataAnswer(txt({ error: 'API 502' }))).toBe(true);
    expect(S._isNoDataAnswer({ content: [], structuredContent: { region: 'PJM-DOM', source_unavailable: true } })).toBe(true);
    // not no-data: a real answer, a nested per-source marker, a preview/wall
    expect(S._isNoDataAnswer(txt({ demand_mw: 1 }))).toBe(false);
    expect(S._isNoDataAnswer(txt({ demand_mw: 1, sources: { a: { source_unavailable: true } } }))).toBe(false);
    expect(S._isNoDataAnswer({ isError: true, content: [{ type: 'text', text: 'Preview: 3 of 12' }] })).toBe(false);
    expect(S._isNoDataAnswer(txt({ error: 'nested', detail: 'no mitigation, not API' }))).toBe(false);
  });
});

describe('get_grid_intelligence through the real wrapper (anonymous, trial path)', () => {
  it('CONTROL: a live answer on the same path DOES carry commerce — so the no-sell checks below can fail', async () => {
    dukMode = 'live';
    const { text, body } = await anonCall('get_grid_intelligence', { region_id: 'DUK' });
    expect(text).toContain('"iso":"DUK"');       // the brief itself (numerics are trimmed on a preview)
    expect(text).not.toMatch(/region (not covered|temporarily unavailable)/);
    expect(sold(body).length, 'the harness no longer reaches the upsell path').toBeGreaterThan(0);
  });

  it('an unknown code (backend 400) stays "region not covered" and sells nothing', async () => {
    const { result, text, body } = await anonCall('get_grid_intelligence', { region_id: 'ZZQX' });
    expect(text).toContain('region not covered');
    expect(text).toContain('region_not_covered');
    expect(sold(body)).toEqual([]);
    expect(result.isError).toBe(true);
  });

  for (const mode of ['down', 'empty']) {
    it(`a covered BA whose feed is ${mode} is TRANSIENT, says retry, and sells nothing`, async () => {
      dukMode = mode;
      const { result, text, body } = await anonCall('get_grid_intelligence', { region_id: 'DUK' });
      expect(text).toContain('region temporarily unavailable');
      expect(text).toContain('transient_backoff');
      expect(text).not.toContain('region not covered');
      expect(text).not.toMatch(/will not help/);
      expect(sold(body)).toEqual([]);
      expect(result.isError).toBe(true);
    });
  }

  it('PJM-DOM source_unavailable keeps its retry_after_utc and sells nothing', async () => {
    const { text, body } = await anonCall('get_grid_intelligence', { region_id: 'PJM-DOM' });
    expect(text).toContain('2026-10-01T00:00:00Z');
    expect(sold(body)).toEqual([]);
  });

  it('no foreign network was attempted', () => {
    expect(foreign).toEqual([]);
  });
});
