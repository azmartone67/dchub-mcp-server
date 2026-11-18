// directory-partial-unlock-link-1117.test.mjs — Grok QA 2026-11-17 (g_canvas_pa, g_plan_pa, c_canvas_pa).
//
// A keyless partial result on /mcp/chatgpt and /mcp/claude ended with the neutral partial notice and
// carried NO link, while the same call on /mcp handed out a https://dchub.cloud/u/<code> link. Now every
// keyless partial on all three endpoints carries human_url = a dchub.cloud/u/ link, and the two
// directory profiles add one plain line pointing at it, just before the notice (which stays last). The
// line names no plan, price, key tool or relay wording.
//
// The real server.mjs over HTTP against the claude-directory stub backend (no network). The stub answers
// the /u/ mint (POST /api/v1/relay/short) the way production does. The test's own connections are shown
// to the server as an outside address (203.0.113.9), as production sees a caller: from 127.0.0.1 every
// request is an execute_plan loopback step (server.mjs _isLoopbackPeer), which /mcp never gives a wall
// link. execute_plan's own step calls keep their real 127.0.0.1 peer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { startHarness, fenceNetwork, claudeProbePatterns, hitsOf } from './helpers/claude-directory-harness.mjs';
import { CHATGPT_NOTICE, PARTIAL_LINK_LINE, PARTIAL_LINK_META_KEY, withPartialLink, scrubToolResult as scrubChatgpt }
  from '../lib/chatgpt-directory.mjs';
import { CLAUDE_PLANS_NOTICE, CLAUDE_REMOVED, scrubClaudeToolResult } from '../lib/claude-directory.mjs';
import { probeHits } from '../scripts/probe-chatgpt-directory.mjs';

const U_LINK = /^https:\/\/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}$/;
const CODES = ['abcdef', 'bcdefg', 'cdefgh', 'defghj', 'efghjk', 'fghjkm', 'ghjkmn', 'hjkmnp', 'jkmnpq', 'kmnpqr'];
let mintN = 0;
const routes = (p, _req, body) => {
  if (p !== '/api/v1/relay/short') return undefined;
  if (!body || !/^https:\/\/dchub\.cloud\/upgrade\/h\//.test(String(body.relay_url || ''))) return { status: 400, body: { ok: false } };
  return { status: 200, body: { ok: true, url: 'https://dchub.cloud/u/' + CODES[mintN++ % CODES.length] } };
};

// The test's own client sockets, by local port -> the outside address the server is shown for it.
// Each case calls from its own address, so per-IP state (the keyless first full answer of the day,
// anonymous quotas) does not depend on test order.
const OURS = new Map();
let ipN = 0;
const _peer = net.Socket.prototype._getpeername;
net.Socket.prototype._getpeername = function _getpeername() {
  const p = _peer.call(this);
  return H && this.server && this.localPort === H.PORT && p && OURS.has(p.port) ? { ...p, address: OURS.get(p.port) } : p;
};

let H, fence, rpcId = 5000;
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: routes });
}, 240_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop();
  if (fence) fence.restore();
});

function call(path, name, args, ip = '203.0.113.' + (10 + (++ipN % 200))) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: H.PORT, path, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
                 'content-length': Buffer.byteLength(payload) } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null;
        try { msg = JSON.parse(b); } catch (_) { msg = null; }
        resolve({ status: res.statusCode, raw, msg });
      });
    });
    req.on('socket', (s) => s.once('connect', () => OURS.set(s.localPort, ip)));
    req.on('error', reject);
    req.end(payload);
  });
}

// The two repro calls from the QA run, plus a plain data tool.
const CASES = [
  ['site_selection_canvas', { capacity_mw: 100, region: 'PA', state: 'PA' }],
  ['execute_plan', { intent: 'how soon can a 100 MW load get power in Pennsylvania PJM', iso: 'PJM', state: 'PA' }],
  ['get_market_intel', { market: 'northern-virginia' }],
];
const PROFILES = [['/mcp/chatgpt', CHATGPT_NOTICE], ['/mcp/claude', CLAUDE_PLANS_NOTICE]];
const texts = (res) => (res.content || []).map((c) => c.text || '');

// One keyless call as a fresh caller. If it is that caller's first full answer of the day
// (lib/keyless-first-full.mjs; /mcp/claude serves it for execute_plan), that answer is full: no notice
// and no link, asserted here. The caller's next call is the partial, and that one is returned.
async function partialCall(path, tool, args, notice) {
  const ip = '198.51.100.' + (10 + (++ipN % 200));
  let r = await call(path, tool, args, ip);
  let res = r.msg && r.msg.result;
  expect(res, r.raw.slice(0, 300)).toBeTruthy();
  if (res.structuredContent && res.structuredContent.first_full_answer) {
    expect(texts(res).at(-1)).not.toBe(notice);
    expect(res.structuredContent.human_url).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain(PARTIAL_LINK_LINE);
    r = await call(path, tool, args, ip);
    res = r.msg && r.msg.result;
    expect(res, r.raw.slice(0, 300)).toBeTruthy();
  }
  return res;
}

describe('every keyless partial carries a dchub.cloud/u/ human_url, on all three endpoints', () => {
  // /mcp execute_plan is not a case here: below a paid plan its one call to action is
  // https://dchub.cloud/connect (lib/neutral-connect.mjs, owner option A 2026-11-16), not a /u/ link, and
  // this change does not touch /mcp. The two directory profiles skip that step and get the /u/ link.
  it.each(CASES.filter(([t]) => t !== 'execute_plan'))('/mcp %s: human_url is a /u/ link', async (tool, args) => {
    const r = await call('/mcp', tool, args);
    const sc = r.msg && r.msg.result && r.msg.result.structuredContent;
    expect(sc, r.raw.slice(0, 300)).toBeTruthy();
    expect(sc.human_url).toMatch(U_LINK);
  }, 60_000);

  for (const [path, notice] of PROFILES) {
    it.each(CASES)(`${path} %s: human_url is a /u/ link, the line points at it, the notice stays last`, async (tool, args) => {
      const res = await partialCall(path, tool, args, notice);
      const t = texts(res);
      expect(t.at(-1)).toBe(notice);                                   // the profile called it partial
      const sc = res.structuredContent;
      expect(sc.human_url).toMatch(U_LINK);
      expect(sc.human_message).toBe(PARTIAL_LINK_LINE + sc.human_url);
      expect(t.at(-2)).toBe(PARTIAL_LINK_LINE + sc.human_url);          // the human-facing line, before the notice
      expect(t.filter((x) => x.includes(sc.human_url))).toHaveLength(1);   // one line carries it
    }, 60_000);
  }

  it('the line adds no plan, price, key tool, relay or sell wording (claude probe patterns, less the link itself)', async () => {
    const PATTERNS = claudeProbePatterns(CLAUDE_REMOVED);
    for (const [path, notice] of PROFILES) {
      for (const [tool, args] of CASES) {
        const res = await partialCall(path, tool, args, notice);
        const line = texts(res).at(-2);
        expect(line.startsWith(PARTIAL_LINK_LINE), `${path} ${tool}: ${line}`).toBe(true);
        expect(hitsOf(PATTERNS, line), `${path} ${tool}`).toEqual([]);
        expect(line).not.toMatch(/claim_free_key|bind_email|X-API-Key|\$\s?\d|\bPro\b|paid plan|free tier|\bplans?\b|\btrial\b|unlock|upgrade/i);
        // The live /mcp/chatgpt directory probe (scripts/probe-chatgpt-directory.mjs, run by
        // .github/workflows/chatgpt-directory-probe.yml) passes the whole reply, link included.
        if (path === '/mcp/chatgpt') expect(probeHits(JSON.stringify(res)), `${path} ${tool}`).toEqual([]);
      }
    }
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});

describe('what does not change', () => {
  it('kill switch DCHUB_DIRECTORY_PARTIAL_LINK=0: both profiles serve the result as before, no link', async () => {
    const prev = process.env.DCHUB_DIRECTORY_PARTIAL_LINK;
    process.env.DCHUB_DIRECTORY_PARTIAL_LINK = '0';
    try {
      for (const [path, notice] of PROFILES) {
        const res = (await call(path, 'site_selection_canvas', CASES[0][1])).msg.result;
        expect(texts(res).at(-1)).toBe(notice);
        expect(JSON.stringify(res)).not.toContain(PARTIAL_LINK_LINE);
        expect(JSON.stringify(res)).not.toMatch(/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}"/);
      }
    } finally {
      if (prev === undefined) delete process.env.DCHUB_DIRECTORY_PARTIAL_LINK; else process.env.DCHUB_DIRECTORY_PARTIAL_LINK = prev;
    }
  }, 60_000);

  it('a keyed call (any credential) gets no minted link on the directory profiles', async () => {
    const S = H.S;
    const r = { content: [{ type: 'text', text: '{"a":1,"_score_in_pro":true}' }], structuredContent: { a: 1, _score_in_pro: true } };
    const keyed = await S._directoryPartialLinkStep(r, 'get_market_intel', { profile: 'chatgpt_directory', api_key: 'k', tier: 'free' });
    expect(keyed).toBe(r);
    const paid = await S._directoryPartialLinkStep(r, 'get_market_intel', { profile: 'claude_directory', tier: 'pro' });
    expect(paid).toBe(r);
    const canonical = await S._directoryPartialLinkStep(r, 'get_market_intel', { profile: 'default', tier: 'free' });
    expect(canonical).toBe(r);
    const full = { content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 1 } };
    expect(await S._directoryPartialLinkStep(full, 'get_market_intel', { profile: 'chatgpt_directory', tier: 'free' })).toBe(full);
  });

  it('kill switch values: unset/1 = both, 0/off = neither, a list = those', () => {
    const f = H.S.directoryPartialLinkProfiles;
    expect([...f({})].sort()).toEqual(['chatgpt', 'claude']);
    expect([...f({ DCHUB_DIRECTORY_PARTIAL_LINK: 'on' })].sort()).toEqual(['chatgpt', 'claude']);
    expect(f({ DCHUB_DIRECTORY_PARTIAL_LINK: 'off' }).size).toBe(0);
    expect([...f({ DCHUB_DIRECTORY_PARTIAL_LINK: 'claude' })]).toEqual(['claude']);
    expect(f({ DCHUB_DIRECTORY_PARTIAL_LINK: 'grok' }).size).toBe(0);
  });
});

describe('withPartialLink (pure)', () => {
  const SHORT = 'https://dchub.cloud/u/hz254h';
  const RELAY = 'https://dchub.cloud/upgrade/h/' + 'A'.repeat(40) + '.' + '0123456789abcdef'.repeat(2);
  const raw = (link, extra = {}) => ({ content: [{ type: 'text', text: '{"rows":[1],"_score_in_pro":true}' }],
    structuredContent: { rows: [1], _score_in_pro: true, ...extra }, _meta: { [PARTIAL_LINK_META_KEY]: link } });

  it('both profiles: the scrub puts the link back on a partial result', () => {
    for (const [scrub, notice] of [[scrubChatgpt, CHATGPT_NOTICE], [scrubClaudeToolResult, CLAUDE_PLANS_NOTICE]]) {
      const r = scrub(raw(SHORT), 'get_market_intel');
      expect(r.structuredContent.human_url).toBe(SHORT);
      expect(r.content.map((c) => c.text).slice(-2)).toEqual([PARTIAL_LINK_LINE + SHORT, notice]);
      expect(r._meta).toBeUndefined();   // the transport key never reaches the client
    }
  });
  it('the long relay page: /mcp/claude carries it (fail-open), /mcp/chatgpt does not (it redacts that page)', () => {
    expect(scrubClaudeToolResult(raw(RELAY), 'get_market_intel').structuredContent.human_url).toBe(RELAY);
    const c = scrubChatgpt(raw(RELAY), 'get_market_intel');
    expect(c.structuredContent.human_url).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain(PARTIAL_LINK_LINE);
  });
  it('only a DC Hub link is carried', () => {
    for (const bad of ['https://evil.example/u/hz254h', 'https://dchub.cloud/pricing', 'https://dchub.cloud/go/c/abc.def',
      'http://dchub.cloud/u/hz254h', 'https://dchub.cloud/u/HZ254H', 'https://buy.stripe.com/abc', 42, null]) {
      const r = scrubClaudeToolResult(raw(bad), 'get_market_intel');
      expect(r.structuredContent.human_url, String(bad)).toBeUndefined();
      expect(JSON.stringify(r), String(bad)).not.toContain(PARTIAL_LINK_LINE);
    }
  });
  it('a full result (no partial notice) gets nothing, even with a link in _meta', () => {
    const full = { content: [{ type: 'text', text: '{"rows":[1]}' }], structuredContent: { rows: [1] },
      _meta: { [PARTIAL_LINK_META_KEY]: SHORT } };
    expect(JSON.stringify(scrubChatgpt(full, 'get_market_intel'))).not.toContain(SHORT);
    expect(JSON.stringify(scrubClaudeToolResult(full, 'get_market_intel'))).not.toContain(SHORT);
  });
  it('/mcp/chatgpt search and fetch keep their one-text-item contract: no link', () => {
    for (const tool of ['search', 'fetch']) {
      const r = scrubChatgpt(raw(SHORT), tool);
      expect(r.content).toHaveLength(1);
      expect(JSON.stringify(r)).not.toContain(SHORT);
    }
  });
  it('a result that already carries the link in a line is left as it is', () => {
    const out = { content: [{ type: 'text', text: 'see ' + SHORT }, { type: 'text', text: CHATGPT_NOTICE }], structuredContent: {} };
    expect(withPartialLink(out, raw(SHORT), { notice: CHATGPT_NOTICE })).toBe(out);
  });
});
