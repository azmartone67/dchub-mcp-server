// m12-wall-relay-url.test.mjs — Grok free-to-paid note, M1.2 (owner 2026-11-18 "lets do 1 and 2"): an MCP wall sends
// the human to the priced relay page (/upgrade/h), tagged ?via=mcp-wall&wall=<type>&src=<tool>.
//
// Through the real /mcp handler (backend stubbed, network fenced), keyless, with an outside peer address:
//   * a direct walled get_interconnection_queue: the long relay its /u/ link is minted from carries
//     via=mcp-wall&wall=<type>&src=get_interconnection_queue; its text blocks are byte-identical to the switch-off answer;
//   * a keyless execute_plan: human_url / for_your_human.url are the tagged relay page (src = the step that walled);
//     with those URL fields put back to /connect, the answer is byte-identical to the switch-off answer, and the text
//     carries no new price / plan / "free" / "per day" wording;
//   * /mcp/chatgpt and /mcp/claude: the same calls are byte-identical with the switch on and off;
//   * DCHUB_WALL_RELAY_URL=0: every one of these answers is byte-identical to origin/main's (git-ref sandbox).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import { splitLeadingJson } from '../lib/facility-location.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHORT = 'https://dchub.cloud/u/abcdef';
const TOK = /https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/g;
const TAGGED = (src) => new RegExp('^https://dchub\\.cloud/upgrade/h/[A-Za-z0-9_-]+\\.[0-9a-f]{32}\\?via=mcp-wall&wall=[a-z_]+&src=' + src + '$');
const WALL_RELAY = /https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}\?via=mcp-wall&wall=[a-z_]+&src=[a-z_]+/g;
// Grok's acceptance grep: no new price / plan / free / allowance wording in the text.
const WORDING = /\$\d|Pro\b|free|per day/gi;
const QUEUE = { iso: 'PJM', total_projects: 5469, total_gw: 300, as_of: '2026-11-14',
  projects: Array.from({ length: 8 }, (_, i) => ({ name: `Q${i}`, capacity_mw: 100 + i, fuel: 'solar', status: 'active', state: 'VA' })) };
const routes = (hits) => (p, _req, body) => {
  if (p === '/api/v1/relay/short') { hits.push(body); return { ok: true, url: SHORT }; }
  if (p.includes('queue')) return structuredClone(QUEUE);
  return undefined;
};

// Calls from this file's sockets read as an outside peer; a plan's own loopback steps stay 127.0.0.1.
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
let H, O, SB, fence, why = '';
const hitsH = [], hitsO = [];
beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.9' };
    return p;
  };
  fence = fenceNetwork();
  const env = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_KEYLESS_FIRST_FULL: '0' };
  H = await startHarness({ env, extraRoutes: routes(hitsH) });
  SERVER_PORTS.add(H.PORT);
  SB = createGitRefSandbox(REPO, 'origin/main', 'm12-origin-main');
  if (!SB) why = 'origin/main is not available in this clone';
  else {
    O = await startHarness({ env, extraRoutes: routes(hitsO), serverUrl: pathToFileURL(path.join(SB.root, 'server.mjs')).href });
    SERVER_PORTS.add(O.PORT);
  }
}, 180_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (O) await O.stop();
  if (H) await H.stop();
  if (SB) SB.cleanup();
  if (fence) fence.restore();
});

let rid = 1;
function call(h, p, name, args, ip) {
  const data = JSON.stringify({ jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: h.PORT, path: p, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'cursor/1.0',
        'x-dc-client-ip': ip, 'content-length': Buffer.byteLength(data) } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        try { resolve(JSON.parse(b).result); } catch (e) { reject(e); }
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
// A plan's rerun token (lib/plan-rerun.mjs mintToken) signs its issue second "t", so two runs that straddle a second
// differ in "t" and the MAC: compare the token with "t" dropped and no MAC, so a change in what it carries still shows.
const RERUN_TOK = /pr1\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;
const rerunBody = (m, b) => {
  try { const { t, ...rest } = JSON.parse(Buffer.from(b, 'base64url').toString()); return 'RERUN.' + Buffer.from(JSON.stringify(rest)).toString('base64url'); } catch { return m; }
};
// What differs between two runs of the same call by design: relay tokens (session + time), timestamps, ids, timings,
// and the planner version (a planner bump is not a wall change; 5.44 broke "byte for byte origin/main" on it alone).
const norm = (r) => JSON.stringify(r)
  .replace(RERUN_TOK, rerunBody)
  .replace(/(\\*"planner_version\\*":\\*")\d+\.\d+/g, '$1V')
  .replace(new RegExp(TOK.source + '(?:\\?[^"\\s\\\\]*)?', 'g'), 'RELAY')
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'TS')
  .replace(/(\\?")(ms|elapsed_ms|duration_ms|took_ms|latency_ms)(\\?"):\d+/g, '$1$2$3:0')   // also in JSON inside a text block
  .replace(/(plan|req|sess|run|rp)[-_][A-Za-z0-9]{6,}/g, '$1-ID')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID');
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i >= a.length && a.length === b.length ? null : [a.slice(Math.max(0, i - 80), i + 120), b.slice(Math.max(0, i - 80), i + 120)]; };
const same = (a, b) => { const d = firstDiff(a, b); if (d && process.env.PROBE_DUMP) console.log('DIFF\n  A: ' + d[0] + '\n  B: ' + d[1]); return a === b; };
const prose = (r) => (r.content || []).map((b) => {
  if (!b || typeof b.text !== 'string') return '';
  const sp = splitLeadingJson(b.text);
  return sp && sp.json && typeof sp.json === 'object' ? sp.head + '\n' + sp.rest : b.text;
}).join('\n');
const CALLS = [['get_interconnection_queue', { iso: 'PJM' }], ['execute_plan', { intent: 'interconnection queue in PJM' }]];
let ipN = 1;
async function both(h, p, name, args) {
  delete process.env.DCHUB_WALL_RELAY_URL;
  const on = await call(h, p, name, args, `198.51.90.${ipN++}`);
  process.env.DCHUB_WALL_RELAY_URL = '0';
  try { return { on, off: await call(h, p, name, args, `198.51.90.${ipN++}`) }; } finally { delete process.env.DCHUB_WALL_RELAY_URL; }
}

describe('M1.2 on /mcp (keyless)', () => {
  it('direct walled get_interconnection_queue: the /u/ link targets the relay tagged with the wall and src', async () => {
    hitsH.length = 0;
    const { on, off } = await both(H, '/mcp', 'get_interconnection_queue', { iso: 'PJM' });
    expect(on.structuredContent.human_url).toBe(SHORT);
    const minted = hitsH.map((b) => b && b.relay_url).filter(Boolean);
    expect(minted.length).toBe(2);
    expect(minted[0]).toMatch(TAGGED('get_interconnection_queue'));
    expect(minted[1]).not.toMatch(/src=/);   // the switch-off call minted today's URL
    // the agent receives the same text with the switch on and off (the /u/ link is the only link)
    expect(norm(on.content)).toBe(norm(off.content));
    expect(prose(on).match(WORDING) || []).toEqual(prose(off).match(WORDING) || []);
  }, 120_000);

  it('execute_plan: the URL fields are the tagged relay page; with them put back to /connect it is the switch-off answer', async () => {
    const { on, off } = await both(H, '/mcp', 'execute_plan', { intent: 'interconnection queue in PJM' });
    const sc = on.structuredContent;
    expect(sc.human_url).toMatch(TAGGED('get_interconnection_queue'));
    expect(sc.for_your_human.url).toBe(sc.human_url);
    // Switched off, the URL fields are main's tagged /connect (lib/wall-connect-tag.mjs, owner 2026-11-19), not the relay.
    expect(off.structuredContent.human_url).toBe('https://dchub.cloud/connect?via=mcp-wall&wall=connect');
    expect(prose(on)).not.toMatch(TOK);   // prose never carries the relay
    const back = JSON.parse(JSON.stringify(on).replace(WALL_RELAY, 'https://dchub.cloud/connect?via=mcp-wall&wall=connect'));
    expect(same(norm(back), norm(off))).toBe(true);
    expect(prose(on).match(WORDING) || []).toEqual(prose(off).match(WORDING) || []);
  }, 120_000);
});

describe('M1.2 leaves the frozen and reviewed profiles alone', () => {
  for (const p of ['/mcp/chatgpt', '/mcp/claude']) {
    it.each(CALLS)(`${p} %s: byte-identical with the switch on and off`, async (name, args) => {
      const { on, off } = await both(H, p, name, args);
      expect(same(norm(on), norm(off))).toBe(true);
      expect(JSON.stringify(on)).not.toMatch(/via=mcp-wall/);
    }, 120_000);
  }
});

describe('DCHUB_WALL_RELAY_URL=0 is origin/main, byte for byte', () => {
  for (const p of ['/mcp', '/mcp/chatgpt', '/mcp/claude']) {
    it.each(CALLS)(`${p} %s`, async (name, args) => {
      if (!O) { console.warn(`[m12-wall-relay-url] origin/main comparison not run: ${why}`); return; }
      hitsH.length = 0; hitsO.length = 0;
      process.env.DCHUB_WALL_RELAY_URL = '0';
      let here, main;
      try {
        here = await call(H, p, name, args, `198.51.91.${ipN}`);
        main = await call(O, p, name, args, `198.51.91.${ipN++}`);
      } finally { delete process.env.DCHUB_WALL_RELAY_URL; }
      expect(same(norm(here), norm(main))).toBe(true);
      expect(JSON.stringify(hitsH.map((b) => b && b.relay_url)).replace(TOK, 'RELAY'))
        .toBe(JSON.stringify(hitsO.map((b) => b && b.relay_url)).replace(TOK, 'RELAY'));
    }, 120_000);
  }
});
