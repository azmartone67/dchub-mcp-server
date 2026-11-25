// generic-light-list-1125.test.mjs: item 8, the light list for unnamed clients on bare /mcp as a 50/50 test
// (lib/generic-light-list.mjs, flag DCHUB_GENERIC_LIGHT_LIST, default OFF).
//
// Rules asserted, through the real handler (backend stubbed, network fenced, an outside peer address):
//   * the arm is sha256(identity + 'generic_light_list') % 100, 0-49 treatment: deterministic per identity, ~50/50;
//   * flag OFF: an unnamed client gets the full catalog whatever its arm, and no exposure row is posted;
//   * flag ON: treatment gets exactly the ten pinned tools, execute_plan first; holdout gets the full catalog;
//   * a session keeps the arm it got at initialize, even if a later request arrives from another address;
//   * named clients, ?catalog=full, /mcp/claude (69) and /mcp/chatgpt (65) are untouched;
//   * an unlisted tool is still callable by name (200) in the treatment arm;
//   * the handshake's "Tools:" line names only tools in that session's tools/list, in both arms;
//   * one exposure row per initialize in both arms (never for QA traffic), and per-session outcome rows.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import * as MX from '../lib/monetization-experiments.mjs';
import * as GLL from '../lib/generic-light-list.mjs';

// PINNED, not read back from LIGHT_TOOLS: a list taken from the thing it checks cannot fail.
const TEN = [
  'execute_plan', 'discover_tools',
  'get_market_dcpi_rank', 'get_grid_intelligence', 'get_interconnection_queue', 'search_facilities',
  'find_sites', 'analyze_site', 'source_capacity', 'get_changes',
];
const ipId = (ip) => 'ip-' + createHash('sha256').update(ip).digest('hex');
const pickIp = (arm, from = 1) => {
  for (let i = from; i < 250; i++) { const ip = '203.0.113.' + i; if (GLL.genericLightArm(ipId(ip)) === arm) return ip; }
  throw new Error('no ip');
};

describe('assignment', () => {
  it('is sha256(identity + "generic_light_list") % 100 with 0-49 treatment, deterministic, about 50/50', () => {
    expect(MX.GENERIC_LIGHT_LIST).toBe('generic_light_list');
    expect(MX.FLAGS[MX.GENERIC_LIGHT_LIST]).toBe('DCHUB_GENERIC_LIGHT_LIST');
    const ids = Array.from({ length: 20000 }, (_, n) => 'ip-' + n.toString(16).padStart(64, '0'));
    const arms = ids.map((i) => GLL.genericLightArm(i));
    expect(ids.map((i) => GLL.genericLightArm(i))).toEqual(arms);
    for (const id of ids.slice(0, 500)) {
      const h = createHash('sha256').update(id + 'generic_light_list').digest('hex');
      const bucket = Number(BigInt('0x' + h.slice(0, 16)) % 100n);
      expect(GLL.genericLightArm(id)).toBe(bucket < 50 ? 'treatment' : 'holdout');
    }
    const share = arms.filter((a) => a === 'treatment').length / ids.length;
    expect(share).toBeGreaterThan(0.48);
    expect(share).toBeLessThan(0.52);
    expect(GLL.genericLightArm('')).toBe(null);
  });
  it('matches the backend vectors (dchub-backend tests/test_generic_light_list_experiment.py)', () => {
    expect(MX.bucketFor('ip-' + 'd'.repeat(64), MX.GENERIC_LIGHT_LIST)).toBe(7);
    expect(GLL.genericLightArm('ip-' + 'd'.repeat(64))).toBe('treatment');
    expect(MX.bucketFor('pk-' + 'e'.repeat(64), MX.GENERIC_LIGHT_LIST)).toBe(76);
    expect(GLL.genericLightArm('pk-' + 'e'.repeat(64))).toBe('holdout');
    expect(MX.bucketFor('sk-' + 'f'.repeat(32), MX.GENERIC_LIGHT_LIST)).toBe(74);
  });
  it('only the two generic platform labels are in the test', () => {
    expect(GLL.isGenericPlatform('mcp-generic-client')).toBe(true);
    expect(GLL.isGenericPlatform('mcp')).toBe(true);
    for (const p of ['claude', 'cursor', 'codex', 'curl', 'node', 'chatgpt', 'dchub-internal', '']) {
      expect(GLL.isGenericPlatform(p), p).toBe(false);
    }
  });
  it('the flag is OFF unless set to 1/true/yes/on', () => {
    expect(GLL.genericLightOn({})).toBe(false);
    expect(GLL.genericLightOn({ DCHUB_GENERIC_LIGHT_LIST: '0' })).toBe(false);
    expect(GLL.genericLightOn({ DCHUB_GENERIC_LIGHT_LIST: '1' })).toBe(true);
  });
});

let H, fence;
const exposures = [];
const SERVER_PORTS = new Set();
const CLIENT_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
const setFlag = (v) => { if (v === undefined) delete process.env.DCHUB_GENERIC_LIGHT_LIST; else process.env.DCHUB_GENERIC_LIGHT_LIST = v; };
const routes = () => (p, _req, body) => {
  if (p === '/api/v1/mcp/experiments/exposure') { exposures.push(body); return { recorded: true }; }
  return undefined;
};
let rid = 1;
function rpc(p, body, headers = {}) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: H.PORT, path: p, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'node',
        'mcp-protocol-version': '2025-06-18', 'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, msg, sid: res.headers['mcp-session-id'] || null, raw });
      });
    });
    req.on('socket', (s) => {
      const note = () => { const lp = s.localPort; CLIENT_PORTS.add(lp); s.once('close', () => CLIENT_PORTS.delete(lp)); };
      if (s.localPort) note(); else s.once('connect', note);
    });
    req.on('error', reject);
    req.end(data);
  });
}
const LIST = () => ({ jsonrpc: '2.0', id: rid++, method: 'tools/list', params: {} });
const INIT = (name = 'mcp') => ({ jsonrpc: '2.0', id: rid++, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1.0' } } });
const names = (r) => ((r.msg && r.msg.result && r.msg.result.tools) || []).map((t) => t.name);
const toolsLine = (ins) => { const m = /\bTools: ([a-z_]+(?:, [a-z_]+)*)\./.exec(String(ins || '')); return m ? m[1].split(', ') : null; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('through the handler', () => {
  let FULL = 0;
  beforeAll(async () => {
    net.Socket.prototype._getpeername = function _getpeername() {
      const p = _peer.call(this);
      if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.250' };
      return p;
    };
    fence = fenceNetwork();
    setFlag(undefined);
    H = await startHarness({ env: { DCHUB_INTERNAL_KEY: 'test-internal' }, extraRoutes: routes() });
    SERVER_PORTS.add(H.PORT);
    FULL = names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': pickIp('holdout') })).length;
  }, 180_000);
  afterAll(async () => {
    net.Socket.prototype._getpeername = _peer;
    if (H) await H.stop();
    if (fence) fence.restore();
    setFlag(undefined);
  });
  afterEach(() => { setFlag(undefined); exposures.length = 0; MX._resetForTests(); });

  it('the full catalog is the baseline (flag off, holdout address)', () => {
    expect(FULL).toBeGreaterThan(80);
  });

  it('flag OFF: an unnamed client in the treatment bucket still gets the full list, and nothing is posted', async () => {
    const ip = pickIp('treatment');
    expect(names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': ip })).length).toBe(FULL);
    const i = await rpc('/mcp', INIT('mcp'), { 'x-dc-client-ip': ip });
    expect(names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': ip, 'mcp-session-id': i.sid })).length).toBe(FULL);
    await wait(150);
    expect(exposures.length).toBe(0);
  }, 60_000);

  it('flag ON: treatment gets exactly the ten tools, execute_plan first; holdout gets the full list', async () => {
    setFlag('1');
    const t = await rpc('/mcp', LIST(), { 'x-dc-client-ip': pickIp('treatment') });
    expect(t.status).toBe(200);
    expect(names(t)).toEqual(TEN);
    const h = await rpc('/mcp', LIST(), { 'x-dc-client-ip': pickIp('holdout') });
    expect(names(h).length).toBe(FULL);
    // A generic clientInfo name ('mcp-client') with a UA that names nothing is in the test too.
    const ip = pickIp('treatment');
    const s = await rpc('/mcp', INIT('mcp-client'), { 'x-dc-client-ip': ip });
    expect(names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': ip, 'mcp-session-id': s.sid }))).toEqual(TEN);
  }, 60_000);

  it('a session keeps its initialize arm when a later request comes from another address', async () => {
    setFlag('1');
    const t = await rpc('/mcp', INIT('mcp'), { 'x-dc-client-ip': pickIp('treatment') });
    expect(t.sid).toBeTruthy();
    expect(names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': pickIp('holdout'), 'mcp-session-id': t.sid }))).toEqual(TEN);
    const h = await rpc('/mcp', INIT('mcp'), { 'x-dc-client-ip': pickIp('holdout') });
    expect(names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': pickIp('treatment'), 'mcp-session-id': h.sid })).length).toBe(FULL);
  }, 60_000);

  it('named clients, ?catalog=full, /mcp/claude (69) and /mcp/chatgpt (65) are untouched', async () => {
    setFlag('1');
    const ip = pickIp('treatment');
    // A named non-light client keeps the full list; a named coding client keeps its own light list.
    expect(names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': ip, 'user-agent': 'claude-ai/1.0' })).length).toBe(FULL);
    const cli = names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': ip, 'user-agent': 'codex-mcp-client/0.121.0' }));
    setFlag(undefined);
    expect(names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': ip, 'user-agent': 'codex-mcp-client/0.121.0' }))).toEqual(cli);
    setFlag('1');
    expect(names(await rpc('/mcp?catalog=full', LIST(), { 'x-dc-client-ip': ip })).length).toBe(FULL);
    expect(names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': ip, 'x-dchub-catalog': 'full' })).length).toBe(FULL);
    expect(names(await rpc('/mcp/claude', LIST(), { 'x-dc-client-ip': ip })).length).toBe(69);
    expect(names(await rpc('/mcp/chatgpt', LIST(), { 'x-dc-client-ip': ip })).length).toBe(65);
  }, 60_000);

  it('treatment: a tool that is not listed is still callable by name (200, a real answer)', async () => {
    setFlag('1');
    const ip = pickIp('treatment');
    const i = await rpc('/mcp', INIT('mcp'), { 'x-dc-client-ip': ip });
    const r = await rpc('/mcp', { jsonrpc: '2.0', id: rid++, method: 'tools/call',
      params: { name: 'get_grid_scoreboard', arguments: { limit: 1 } } }, { 'x-dc-client-ip': ip, 'mcp-session-id': i.sid });
    expect(r.status).toBe(200);
    expect(TEN).not.toContain('get_grid_scoreboard');
    expect(r.msg && r.msg.result).toBeTruthy();
    expect(JSON.stringify(r.msg)).not.toMatch(/unknown tool|not found|Method not found|-32601|-32602/i);
  }, 60_000);

  it('the handshake "Tools:" line names only tools in that session\'s list, in both arms', async () => {
    setFlag('1');
    for (const arm of ['treatment', 'holdout']) {
      const ip = pickIp(arm);
      const i = await rpc('/mcp', INIT('mcp'), { 'x-dc-client-ip': ip });
      const ins = i.msg.result.instructions;
      const listed = names(await rpc('/mcp', LIST(), { 'x-dc-client-ip': ip, 'mcp-session-id': i.sid }));
      const named = toolsLine(ins);
      expect(named, arm).toBeTruthy();
      expect(named[0], arm).toBe('execute_plan');
      for (const n of named) expect(listed, `${arm}: Tools: names ${n}`).toContain(n);
      if (arm === 'treatment') {
        expect(listed).toEqual(TEN);
        expect(ins).toMatch(/tools\/call accepts any DC Hub tool by name/);
        // The shared text names get_grid_data and get_market_intel, neither of which is in the ten.
        expect(ins).not.toMatch(/Tools: [^.]*\b(get_grid_data|get_market_intel)\b/);
      }
    }
  }, 60_000);

  it('exposure: one row per initialize in both arms, the backend arm, never for QA traffic', async () => {
    setFlag('1');
    const t = pickIp('treatment');
    const h = pickIp('holdout');
    const a = await rpc('/mcp', INIT('mcp'), { 'x-dc-client-ip': t });
    const b = await rpc('/mcp', INIT('mcp'), { 'x-dc-client-ip': h });
    await rpc('/mcp', INIT('mcp'), { 'x-dc-client-ip': pickIp('treatment', 120), 'x-dchub-qa': '1' });
    await rpc('/mcp', INIT('claude-ai'), { 'x-dc-client-ip': t, 'user-agent': 'claude-ai/1.0' });   // named: not in the test
    // Other paths are never in the test, even for an unnamed client in the treatment bucket.
    for (const path of ['/mcp/cursor', '/mcp/light', '/mcp/claude']) await rpc(path, INIT('mcp'), { 'x-dc-client-ip': t });
    await wait(200);
    const rows = exposures.filter((e) => e.test === 'generic_light_list' && e.event === 'exposure');
    expect(rows.map((r) => [r.identity, r.arm, r.session_id]).sort()).toEqual([
      [ipId(t), 'treatment', a.sid], [ipId(h), 'holdout', b.sid]].sort());
  }, 60_000);

  it('outcomes: first_tool_call once per session with its tool, tool_call per call, both arms', async () => {
    setFlag('1');
    for (const arm of ['treatment', 'holdout']) {
      exposures.length = 0;
      const ip = pickIp(arm, arm === 'treatment' ? 40 : 60);
      const i = await rpc('/mcp', INIT('mcp'), { 'x-dc-client-ip': ip });
      for (let k = 0; k < 2; k++) {
        await rpc('/mcp', { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name: 'get_grid_scoreboard', arguments: { limit: 1 } } },
          { 'x-dc-client-ip': ip, 'mcp-session-id': i.sid });
      }
      await wait(200);
      const rows = exposures.filter((e) => e.test === 'generic_light_list' && e.session_id === i.sid);
      const ev = (n) => rows.filter((r) => r.event === n);
      expect(ev('exposure').length, arm).toBe(1);
      expect(ev('first_tool_call').length, arm).toBe(1);
      expect(ev('first_tool_call')[0].tool, arm).toBe('get_grid_scoreboard');
      expect(ev('tool_call').length, arm).toBe(2);
      expect(rows.every((r) => r.arm === arm), arm).toBe(true);
    }
  }, 60_000);
});
