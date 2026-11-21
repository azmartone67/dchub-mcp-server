// wall-copy-v2.test.mjs — the rest of a keyless / trial-key wall reads the v2 copy (lib/wall-copy-v2.mjs,
// server.mjs _wallCopyV2Step; owner 2026-11-21 "fix above" after the wall_identity_v2 outside test).
//
// Rules asserted, through the real /mcp handler (backend stubbed, network fenced, an outside peer address):
//   * flag ON: every walled answer of get_grid_intelligence, get_interconnection_queue and execute_plan, keyless and
//     trial-key, names no price, plan, "free", allowance figure or payment in its prose or its JSON (citation and
//     licence text aside); human links are https://dchub.cloud/mcp/connect, never /upgrade/h/, /u/ or /connect;
//     next_ask carries no `free`; a keyless ask names get_api_key, not bind_email;
//   * the headline line (with its date and Source) comes BEFORE the sign-in line;
//   * Grok (grokbot UA): the same copy, its /mcp/grok/oauth line plus /mcp/connect, and execute_plan carries the
//     get_api_key ask; no "After they pay", no "free preview";
//   * DCHUB_WALL_COPY_V2=0 turns this step off (the v2 sign-in line stays);
//   * POST /mcp/connect answers like POST /mcp (keyless initialize 200, never 401 or 404);
//   * a browser navigation with Accept: */* gets the /mcp/connect page; an agent GET does not.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { SIGNIN_LINE, emailAskLine } from '../lib/wall-identity-v2.mjs';
import { rewriteText, rewriteJson, wallCopyV2, wallCopyV2On, looksPreview, HUMAN_CONNECT_LINE } from '../lib/wall-copy-v2.mjs';
import { connectPageWanted, browserUa } from '../lib/mcp-connect-page.mjs';

// Agent-facing copy: no price, plan name, "free", credits, calls-per-day or payment.
export const NO_PRICE_V2 = /\$\d|\bper month\b|\/mo\b|\b(?:pro|developer|starter|enterprise|credit pack|credit-pack)\b|\b\d[\d,]*\s+(?:MCP\s+)?(?:calls?|full answers?|answers?|credits?)(?:\s*(?:\/|a|per)\s*day)?\b|answers\/day|\bfree\b|\bpay\b|\bpaid\b|\bpayment\b|no card/i;
const OLD_LINKS = /dchub\.cloud\/(?:upgrade\/h\/|u\/[A-Za-z0-9]|connect(?![A-Za-z0-9_-]))/;
const SKIP = new Set(['licences', 'licenses', 'license', 'citation', 'cite_as', 'provenance', 'methodology', 'sources']);
// Every string the agent reads as copy: prose blocks, and the JSON's strings outside citation / licence text.
function copyStrings(result, withKeys = false) {
  const out = [];
  const walk = (v, k = '') => {
    if (SKIP.has(k)) return;
    // a one-token value (tier: "free", status: "trial_used") is a machine enum, not copy
    if (typeof v === 'string') { if (!/^[a-z0-9_.-]+$/.test(v)) out.push(withKeys ? [v, k] : v); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) walk(x, kk);
  };
  for (const b of (result && result.content) || []) {
    if (!b || b.type !== 'text') continue;
    if (/^\s*[{[]/.test(b.text)) { try { walk(JSON.parse(b.text)); continue; } catch (_) { /* cut JSON: as text */ } }
    out.push(withKeys ? [b.text, 'text'] : b.text);
  }
  if (result && result.structuredContent) walk(result.structuredContent);
  return out;
}

describe('lib/wall-copy-v2.mjs', () => {
  it('the older wall sentences become neutral ones', () => {
    const cases = [
      'get_grid_intelligence returned a free preview of ERCOT: 16 fields are withheld (see x). Your user can unlock the full brief free with their email (the step above). After that, call get_grid_intelligence again in this session for the full brief.',
      'get_grid_intelligence returned a free preview of ERCOT: 16 fields are withheld (see x). Show your user the next line unchanged, including its link. After they pay, call get_grid_intelligence again in this session for the full brief.',
      '→ **For your human:** This free DC Hub preview of ERCOT hides queue depth. The full ERCOT brief is not in this preview; see what your agent found: https://dchub.cloud/upgrade/h/YS1abc.0123456789abcdef0123456789abcdef?via=mcp-wall&wall=trial_used&src=x',
      '→ **For your human:** this answer hid a, b and 15 other fields; those fields are withheld from this answer, and the page shows how to get them. Free: reply with your email and your assistant can unlock the full answer here, no card needed. Or open https://dchub.cloud/upgrade/h/YS1x.0123456789abcdef0123456789abcdef?via=mcp-wall to see what your agent found.',
      'WITHHELD at this access level: x. Grid/queue/market-intel tools: previews on free; an email adds 10 full answers/day each.',
      'Grid/queue/market-intel tools: previews on free; full needs a paid DC Hub plan.',
      'This answer is partial; the full answer is behind the link in human_url',
      'x returned a free preview. Your user was sent the full ask earlier in this session. After they pay, call x again in this session for the full answer. If they missed it, the one-click credit-pack link is: https://dchub.cloud/go/c/abc',
      'DC Hub: the orchestration layer for data center and energy intelligence — dchub.cloud/connect',
      'A key with a bound email gets 10 full `get_grid_intelligence` answers a day.',
    ];
    for (const c of cases) {
      const t = rewriteText(c, { keyless: true });
      expect(t, c).not.toMatch(NO_PRICE_V2);
      expect(t, c).not.toMatch(OLD_LINKS);
    }
    expect(rewriteText('then call `bind_email` with it', { keyless: true })).toBe('then call `get_api_key` with it');
    expect(rewriteText('then call `bind_email` with it', { keyless: false })).toBe('then call `bind_email` with it');
    // /mcp/connect and /mcp/oauth are left as they are
    expect(rewriteText('https://dchub.cloud/mcp/connect and https://dchub.cloud/mcp/oauth')).toBe('https://dchub.cloud/mcp/connect and https://dchub.cloud/mcp/oauth');
  });
  it('JSON: next_ask.free dropped, ask tools name get_api_key for a keyless caller, licence text untouched', () => {
    const o = rewriteJson({ next_ask: { tool: 'bind_email', question: 'Call bind_email only with an address they gave you.', free: true },
      next_call: { tool: 'bind_email', next: 'Next: bind_email(...)' }, _upgrade: { next_tool: 'bind_email' },
      provenance: { preview: { unlock_tool: 'bind_email' }, license: 'free to read' },
      licences: [{ license: 'current values: free to read and quote' }],
      human_url: 'https://dchub.cloud/upgrade/h/YS1x.0123456789abcdef0123456789abcdef?via=mcp-wall' }, { keyless: true });
    expect(o.next_ask).toEqual({ tool: 'get_api_key', question: 'Call get_api_key only with an address they gave you.' });
    expect(o.next_call.tool).toBe('get_api_key');
    expect(o._upgrade.next_tool).toBe('get_api_key');
    expect(o.provenance.preview.unlock_tool).toBe('get_api_key');
    expect(o.provenance.license).toBe('free to read');
    expect(o.licences[0].license).toContain('free to read');
    expect(o.human_url).toBe('https://dchub.cloud/mcp/connect');
  });
  it('the headline (with its Source) moves ahead of the sign-in line', () => {
    const r = { content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: SIGNIN_LINE }, { type: 'text', text: '0 of 3 shown.' },
      { type: 'text', text: 'Give your user this answer first: ERCOT demand 50,042 MW (as of 2026-11-21).\n\nIf your user would like the full answer, call `bind_email`.' },
      { type: 'text', text: 'Source: DC Hub (dchub.cloud/grid/ercot), as of 2026-11-21T05:00Z' }] };
    const t = wallCopyV2(r, { keyless: true }).content.map((b) => b.text);
    expect(t[1]).toBe('Give your user this answer first: ERCOT demand 50,042 MW (as of 2026-11-21). Source: DC Hub (dchub.cloud/grid/ercot), as of 2026-11-21T05:00Z.');
    expect(t[2]).toBe(SIGNIN_LINE);
    expect(t[4]).toBe('If your user would like the full answer, call `get_api_key`.');
  });
  it('Grok: the G3 sign-in block gains the /mcp/connect line once; execute_plan gets the get_api_key ask', () => {
    const r = { content: [{ type: 'text', text: 'One-click sign-in for your user: connect with https://dchub.cloud/mcp/grok/oauth instead.' },
      { type: 'text', text: 'DC Hub: x' }], structuredContent: {} };
    const o = wallCopyV2(r, { grok: true, planAsk: { line: emailAskLine('dallas'), call: { tool: 'get_api_key', arguments: { market: 'dallas' } } } });
    expect(o.content[0].text.endsWith(HUMAN_CONNECT_LINE)).toBe(true);
    expect(o.content[1].text).toBe(emailAskLine('dallas'));
    expect(o.structuredContent.email_ask.tool).toBe('get_api_key');
    expect(wallCopyV2(o, { grok: true }).content[0].text.split('/mcp/connect').length - 1).toBe(1);
  });
  it('switch and preview read', () => {
    expect(wallCopyV2On({})).toBe(true);
    for (const v of ['0', 'false', 'off', 'no']) expect(wallCopyV2On({ DCHUB_WALL_COPY_V2: v })).toBe(false);
    expect(looksPreview({ content: [], structuredContent: { free_preview_only: true } })).toBe(true);
    expect(looksPreview({ content: [{ type: 'text', text: 'all good' }], structuredContent: { ok: true } })).toBe(false);
  });
  it('the guard bites', () => {
    for (const bad of ['a free preview', '10 full answers/day', 'After they pay,', 'no card needed', 'the Pro plan', '$49/mo', 'credit-pack link']) expect(bad).toMatch(NO_PRICE_V2);
  });
});

describe('/mcp/connect: who gets the page', () => {
  const req = (h, method = 'GET') => ({ method, headers: h });
  const FF = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0';
  it('a browser navigation with Accept */* gets it; agents and scripts do not', () => {
    expect(connectPageWanted(req({ accept: '*/*', 'user-agent': FF, 'sec-fetch-mode': 'navigate' }))).toBe(true);
    expect(connectPageWanted(req({ accept: 'text/html,application/xhtml+xml' }))).toBe(true);
    expect(connectPageWanted(req({ accept: '*/*', 'sec-fetch-dest': 'document' }))).toBe(true);
    expect(connectPageWanted(req({ accept: '*/*', 'user-agent': FF }))).toBe(false);            // no navigation metadata
    expect(connectPageWanted(req({ accept: '*/*', 'user-agent': 'cursor/1.0', 'sec-fetch-mode': 'navigate' }))).toBe(false);
    expect(connectPageWanted(req({ accept: 'application/json, text/event-stream', 'user-agent': FF, 'sec-fetch-mode': 'navigate' }))).toBe(false);
    expect(connectPageWanted(req({ accept: '*/*', 'user-agent': FF, 'sec-fetch-mode': 'navigate' }, 'POST'))).toBe(false);
    expect(browserUa('Mozilla/5.0 (compatible; Claude-User/1.0; +mcp)')).toBe(false);
    expect(browserUa('curl/8.4.0')).toBe(false);
  });
});

let H, fence;
const events = [];
let anonCount = 999;
const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i, score: 50 + i }));
const routes = (p, _req, body) => {
  if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
  if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
  if (p === '/api/v1/keys/validate' && body && typeof body.api_key === 'string' && body.api_key.startsWith('dch_trial_CP')) return { valid: true, tier: 'trial', email: null, tier_detail: { users_plan: null } };
  if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
  if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
  return { success: true, count: 12, total_count: 12, data: ROWS, results: ROWS, items: ROWS, markets: ROWS, rows: ROWS };
};
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.12' };
    return p;
  };
  fence = fenceNetwork();
  delete process.env.DCHUB_WALL_IDENTITY_V2;
  H = await startHarness({ env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_KEYLESS_FIRST_FULL: '0', DCHUB_ANON_DAILY_CAP: '20',
    DCHUB_WORKOS_OAUTH_ENABLED: '1' }, extraRoutes: routes });
  SERVER_PORTS.add(H.PORT);
}, 180_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop();
  if (fence) fence.restore();
  delete process.env.DCHUB_WALL_IDENTITY_V2;
  delete process.env.DCHUB_WALL_COPY_V2;
});
afterEach(() => { delete process.env.DCHUB_WALL_IDENTITY_V2; delete process.env.DCHUB_WALL_COPY_V2; anonCount = 999; });

let rid = 1, ipN = 1;
function rpc(p, body, headers = {}, method = 'POST') {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: H.PORT, path: p, method, agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'cursor/1.0',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, msg, raw, headers: res.headers });
      });
    });
    r.on('socket', (s) => {
      const note = () => { const lp = s.localPort; CLIENT_PORTS.add(lp); s.once('close', () => CLIENT_PORTS.delete(lp)); };
      if (s.localPort) note(); else s.once('connect', note);
    });
    r.on('error', reject);
    r.end(data);
  });
}
async function call(name, args, { trial = false, ua = 'cursor/1.0' } = {}) {
  const r = await rpc('/mcp', { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } },
    { 'x-dc-client-ip': `198.51.130.${ipN++ % 250}`, 'user-agent': ua, ...(trial ? { 'x-api-key': 'dch_trial_CPtestKEY0123456789abcdef' } : {}) });
  await new Promise((res) => setTimeout(res, 100));
  return r.msg && r.msg.result;
}
const texts = (r) => ((r && r.content) || []).filter((b) => b && b.type === 'text').map((b) => b.text);
const TOOLS = [
  ['get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' }],
  ['get_interconnection_queue', { iso: 'PJM' }],
  ['execute_plan', { intent: 'compare PJM vs ERCOT grid headroom and interconnection queue', market: 'dallas' }],
];

describe('flag ON: the whole wall reads the v2 copy', () => {
  for (const [label, who] of [['keyless hard wall', { trial: false, cnt: 999 }], ['keyless preview wall', { trial: false, cnt: 0 }], ['keyless cap wall', { trial: false, cnt: 25 }], ['trial key', { trial: true, cnt: 0 }]]) {
    it.each(TOOLS)(`${label}: %s`, async (name, args) => {
      process.env.DCHUB_WALL_IDENTITY_V2 = '1';
      anonCount = who.cnt;
      const result = await call(name, args, { trial: who.trial });
      expect(result, 'an answer').toBeTruthy();
      for (const [s, k] of copyStrings(result, true)) {
        expect(s, 'no price / plan / free / allowance / payment at ' + k).not.toMatch(NO_PRICE_V2);
        expect(s, 'no older human link').not.toMatch(OLD_LINKS);
        if (!who.trial) expect(s, 'keyless asks name get_api_key').not.toMatch(/\bbind_email\b/);
      }
      const sc = result.structuredContent || {};
      if (sc.next_ask) expect(sc.next_ask).not.toHaveProperty('free');
      const t = texts(result);
      const si = t.findIndex((x) => x.includes(SIGNIN_LINE));
      const hi = t.findIndex((x) => x.startsWith('Give your user this answer first: '));
      if (si >= 0 && hi >= 0) expect(hi, 'headline before the sign-in line').toBeLessThan(si);
    }, 120_000);
  }

  it.each(TOOLS)('Grok (grokbot UA): %s carries the v2 copy, /mcp/connect, and execute_plan the get_api_key ask', async (name, args) => {
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    anonCount = 999;
    const result = await call(name, args, { ua: 'grokbot-walltest/1.0' });
    const all = texts(result).join('\n');
    for (const s of copyStrings(result)) { expect(s).not.toMatch(NO_PRICE_V2); expect(s).not.toMatch(OLD_LINKS); }
    expect(all).not.toMatch(/After they pay|free preview/i);
    if (/\/mcp\/grok\/oauth/.test(all)) expect(all).toContain('https://dchub.cloud/mcp/connect');
    if (name === 'execute_plan') {
      expect(all).toContain(emailAskLine('dallas'));
      expect(result.structuredContent.email_ask).toMatchObject({ tool: 'get_api_key' });
    }
  }, 120_000);

  it('DCHUB_WALL_COPY_V2=0 turns the copy step off; the sign-in line stays', async () => {
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    process.env.DCHUB_WALL_COPY_V2 = '0';
    anonCount = 999;
    const result = await call('get_grid_intelligence', { iso: 'ERCOT', market: 'dallas' });
    const all = JSON.stringify(result);
    expect(all).toContain(SIGNIN_LINE.slice(0, 40));
    expect(all).toMatch(/\bfree\b/i);   // the older copy, unchanged
  }, 120_000);
});

describe('POST /mcp/connect answers like POST /mcp', () => {
  it('keyless initialize: 200, never 401 or 404 (flag on and off)', async () => {
    for (const flag of ['1', undefined]) {
      if (flag) process.env.DCHUB_WALL_IDENTITY_V2 = flag; else delete process.env.DCHUB_WALL_IDENTITY_V2;
      const r = await rpc('/mcp/connect', { jsonrpc: '2.0', id: rid++, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } }, { 'x-dc-client-ip': '198.51.131.1' });
      expect(r.status, String(flag)).toBe(200);
      expect(r.msg && r.msg.result && r.msg.result.serverInfo, String(flag)).toBeTruthy();
    }
  }, 60_000);
  it('tools/list on /mcp/connect is the /mcp list', async () => {
    const a = await rpc('/mcp/connect', { jsonrpc: '2.0', id: rid++, method: 'tools/list', params: {} }, { 'x-dc-client-ip': '198.51.131.2' });
    const b = await rpc('/mcp', { jsonrpc: '2.0', id: rid++, method: 'tools/list', params: {} }, { 'x-dc-client-ip': '198.51.131.3' });
    expect(a.status).toBe(200);
    expect((a.msg.result.tools || []).map((t) => t.name)).toEqual((b.msg.result.tools || []).map((t) => t.name));
  }, 60_000);
  it('a browser navigation GET with Accept */* gets the page (flag on)', async () => {
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    const r = await rpc('/mcp/connect', {}, { accept: '*/*', 'sec-fetch-mode': 'navigate',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' }, 'GET');
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toMatch(/text\/html/);
  }, 60_000);
});
