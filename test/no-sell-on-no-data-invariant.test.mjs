// no-sell-on-no-data-invariant.test.mjs — r-nodata-no-sell, suite-wide (2026-09-24)
//
// INVARIANT: a response whose own answer carries NO data sells nothing. The
// answer is a failure envelope (_error_mitigation / "API <status>") or a
// top-level source_unavailable marker. mcp#539 enforced this at the wrapper
// (_noDataGuard) after a live probe showed "region not covered" wrapped in
// "Free trial unlocked — call it again", $10, Pro and for_your_human. That
// test pinned one tool. This one walks EVERY tool in tools/list, so a new tool
// or a new upsell branch cannot bring the class back unnoticed.
//
// How: the fake backend answers 503 on every data route (callAPI turns that
// into a failure envelope). Every tool is called in a FRESH anonymous session
// (the trial path, where the live defect was) twice: once with no arguments
// (local validation refusals) and once with plausible arguments (to reach
// the backend). Every response whose first block is a no-data answer is
// scanned for commerce.
//
// Scope: anonymous (free/trial) path. The paid paths (credits, MPP, x402) are
// deliberately unguarded — see _NoDataAnswer in server.mjs.
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
let backend = 'down';           // 'down' -> 503 on data routes, 'up' -> real-looking data
const SECRET = 'test-internal-key-not-a-real-secret';

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
      if (p === '/api/v1/mcp/trial-check') return send(200, { trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send(404, { error: 'not found' });
      if (p === '/api/v1/keys/auto-mint') return send(200, { ok: false });
      if (p === '/api/v1/keys/validate') return send(200, { valid: false, tier: 'free' });
      if (backend === 'up') {
        return send(200, { success: true, count: 1, data: [{ id: 1, name: 'x' }],
                           demand_mw: 18000, generation_mix: { NG: { mw: 9000 } } });
      }
      return send(503, { error: 'upstream unavailable (test)' });
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
async function freshSession() {
  const init = await post({}, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {},
              clientInfo: { name: 'no-sell-invariant-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return h;
}
async function callFresh(name, args) {
  const h = await freshSession();
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
                                   params: { name, arguments: args } });
  let msg; try { msg = JSON.parse(body); } catch { return null; }
  return msg.result ? { result: msg.result, body } : null;   // protocol errors carry no result
}

// Every piece of commerce the live 2026-09-24 ZZQX response carried.
const COMMERCE = [/\/go\/c\//, /\/upgrade\/h\//, /\$\d/, /Free trial unlocked/i,
                  /For your human/i, /Tell your human/i, /"for_your_human"/, /buy\.stripe\.com/];
const sold = (s) => COMMERCE.filter((re) => re.test(s)).map(String);

// The handler's own answer is the FIRST content block; decorations follow it.
function firstBlockIsNoData(result) {
  const t = result && result.content && result.content[0] && result.content[0].text;
  if (typeof t !== 'string') return false;
  let p; try { p = JSON.parse(t); } catch { return false; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  return !!p._error_mitigation || (typeof p.error === 'string' && /^API \d{3}$/.test(p.error))
    || p.source_unavailable === true;
}

// Plausible arguments so most tools get past local validation and reach the
// (failing) backend. Tools strip what they do not declare.
const GUESS = {
  region_id: 'PJM', region: 'TX', iso: 'PJM', market: 'ashburn', state: 'VA',
  lat: 39.04, lon: -77.48, location: 'ashburn', locations: '39.04,-77.48;33.45,-112.07',
  query: 'data center', q: 'data center', facility_id: 'test-facility', slug: 'test-facility',
  intent: 'rank markets for a 200 MW AI campus', capacity_mw: 100, country: 'US', metro: 'ashburn',
};

describe('no data, nothing to buy — every tool, anonymous trial path', () => {
  it('CONTROL: with the backend UP, the same harness DOES see commerce on a real answer', async () => {
    backend = 'up';
    try {
      const r = await callFresh('get_grid_intelligence', { region_id: 'PJM' });
      expect(r, 'no result').toBeTruthy();
      expect(firstBlockIsNoData(r.result)).toBe(false);
      expect(sold(r.body).length, 'the harness no longer reaches the upsell path').toBeGreaterThan(0);
    } finally { backend = 'down'; }
  });

  it('no tool sells on a no-data answer', async () => {
    const list = JSON.parse((await post(await freshSession(),
      { jsonrpc: '2.0', id: 2, method: 'tools/list' })).body).result.tools;
    expect(list.length).toBeGreaterThan(50);
    const offenders = [];
    let noData = 0;
    for (const t of list) {
      for (const args of [{}, GUESS]) {
        const r = await callFresh(t.name, args);
        if (!r || !firstBlockIsNoData(r.result)) continue;
        noData += 1;
        const hits = sold(r.body);
        if (hits.length) offenders.push(`${t.name} ${args === GUESS ? '(args)' : '(no args)'}: ${hits.join(' ')}`);
      }
    }
    // Vacuity floor: if the harness stops producing no-data answers, the
    // offender list is empty for the wrong reason.
    expect(noData, 'too few no-data answers reached — the invariant was barely exercised').toBeGreaterThan(40);
    expect(offenders).toEqual([]);
  }, 180_000);
});
