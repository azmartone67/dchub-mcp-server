// grok-ident-log.test.mjs — G4 of the 2026-09-27 Grok audit.
//
// Grok opens a new MCP session per tool call and (reportedly) rotates egress
// IP, so DC Hub's IP-hash agent identity cannot count Grok users. For seven
// days the server logs what a Grok request carries — header NAMES, UA,
// clientInfo, session behaviour — to find a stable identifier. These tests pin
// the three things that make that log safe to ship: it never prints a header
// value, it only fires for Grok, and it turns itself off.
//
// Real /mcp handler over HTTP, backend pointed at a dead port, no network.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

let S, L, PORT, httpServer, prevBase;

beforeAll(async () => {
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  S = await import('../server.mjs');
  L = await import('../lib/grok-ident-log.mjs');
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
});
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

const SECRETS = {
  'x-api-key': 'dch_live_SECRETVALUE_should_never_print',
  authorization: 'Bearer SECRETBEARER_should_never_print',
  'x-grok-connector-id': 'CONNECTORVALUE_should_never_print',
};

async function postCapturing(path, body, headers) {
  const spy = vi.spyOn(console, 'log');
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
    });
    await res.text();
    return spy.mock.calls.map((c) => c.map(String).join(' ')).filter((l) => l.startsWith('[grok-ident] '));
  } finally { spy.mockRestore(); }
}
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok-connectors', version: '0.9.1' } } };
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

describe('G4: a Grok request is logged, names only', () => {
  // Inside the logging window whatever day CI runs this; only Date is faked.
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z')); });
  afterAll(() => { vi.useRealTimers(); });
  it('logs header names, UA and clientInfo — and no header value', async () => {
    const lines = await postCapturing('/mcp', INIT, { 'user-agent': 'grok-connectors-manager', ...SECRETS });
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0].slice('[grok-ident] '.length));
    expect(rec.ua).toBe('grok-connectors-manager');
    expect(rec.client_name).toBe('grok-connectors');
    expect(rec.client_version).toBe('0.9.1');
    expect(rec.method).toBe('initialize');
    expect(rec.header_names).toEqual(expect.arrayContaining(['x-api-key', 'authorization', 'x-grok-connector-id', 'user-agent']));
    expect(rec.signals).toEqual(expect.arrayContaining(['ua', 'client_info']));
    for (const v of Object.values(SECRETS)) {
      expect(lines[0]).not.toContain(v);
      expect(lines[0]).not.toContain(v.replace(/^Bearer /, ''));
    }
  });

  it('records session behaviour: sent, known to this process, and how many earlier requests carried it', async () => {
    const sid = 'grok-test-session-id-0001';
    const a = await postCapturing('/mcp', LIST, { 'user-agent': 'grok-connectors-manager', 'mcp-session-id': sid });
    const b = await postCapturing('/mcp', LIST, { 'user-agent': 'grok-connectors-manager', 'mcp-session-id': sid });
    const ra = JSON.parse(a[0].slice(13));
    const rb = JSON.parse(b[0].slice(13));
    expect(ra.session).toMatchObject({ sent: true, known: false, prior_requests: 0 });
    expect(rb.session.prior_requests).toBe(1);
    expect(ra.session.id_h).toMatch(/^[0-9a-f]{12}$/);
    expect(ra.session.id_h).toBe(rb.session.id_h);
    expect(a[0]).not.toContain(sid);
  });

  it('matches the ?via=grok connector URL and the /mcp/grok path', async () => {
    expect((await postCapturing('/mcp?via=grok', LIST, {})).length).toBe(1);
    const r = L.grokSignals({ path: '/mcp/grok', url: '/mcp/grok', headers: {}, body: {} });
    expect(r).toEqual(['path']);
  });

  it('does not log a non-Grok request', async () => {
    const init = { ...INIT, params: { ...INIT.params, clientInfo: { name: 'claude-code', version: '1.0' } } };
    const lines = await postCapturing('/mcp', init, { 'user-agent': 'claude-code/1.0', ...SECRETS });
    expect(lines).toEqual([]);
  });
});

describe('G4: the log turns itself off', () => {
  it('is on before GROK_IDENT_LOG_UNTIL and off from it, with no deploy', () => {
    const until = Date.parse(L.GROK_IDENT_LOG_UNTIL);
    expect(L.GROK_IDENT_LOG_UNTIL).toBe('2026-10-05T00:00:00Z');
    expect(L.grokIdentLogActive(until - 1, {})).toBe(true);
    expect(L.grokIdentLogActive(until, {})).toBe(false);
    expect(L.grokIdentLogActive(until + 86400000, {})).toBe(false);
  });

  it('the window is at most 8 days from the day it shipped', () => {
    expect(Date.parse(L.GROK_IDENT_LOG_UNTIL) - Date.parse('2026-09-27T00:00:00Z')).toBeLessThanOrEqual(8 * 86400000);
  });

  it('DCHUB_GROK_IDENT_LOG=0 turns it off early', () => {
    expect(L.grokIdentLogActive(Date.parse('2026-09-28T00:00:00Z'), { DCHUB_GROK_IDENT_LOG: '0' })).toBe(false);
  });
});

describe('no network', () => {
  it('nothing tried to leave the box', () => { expect(foreign).toEqual([]); });
});
