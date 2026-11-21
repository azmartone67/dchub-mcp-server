// /mcp/connect (owner 2026-11-20, wall_identity_v2): the human sign-in page. Behind
// DCHUB_WALL_IDENTITY_V2 and only for a browser GET; flag off, a POST, or a JSON / event-stream GET
// must be answered exactly as before (no other route: Express's 404). The page posts the email to the
// backend's existing /api/v1/dev-signup door, names the /mcp/oauth sign-in, leads with the ?client=
// snippet from claim_free_key's own _persistConfig, and names no price, plan or tier.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  CONNECT_PATH, SIGNUP_API, OAUTH_URL, KEY_PLACEHOLDER, CONNECT_SCRIPT, CONNECT_CSP,
  connectPageWanted, resolveClient, clientBlocks, renderConnectPage,
} from '../lib/mcp-connect-page.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
// No price and no plan / tier name anywhere in the page, script and style included.
export const FORBIDDEN = /\$|\b(pro|developer|enterprise|starter|founding|business|team|trial|free|paid|premium|tier|tiers|plan|plans|pricing|price|prices|upgrade|subscribe|subscription)\b|\/mo\b|per month|calls?\s*(per|\/)\s*day/i;
const EMOJI = /[\p{Extended_Pictographic}]/u;
const CLIENTS = ['', 'claude', 'cursor', 'chatgpt', 'windsurf', 'vscode', 'claude-code', 'codex', 'gemini',
  'copilot-cli', 'cline', 'antigravity', 'grok', 'perplexity', 'claude-desktop', 'nonsense'];

const FLAG = 'DCHUB_WALL_IDENTITY_V2';
let httpServer, BASE, prevFlag;
beforeAll(async () => {
  prevFlag = process.env[FLAG];
  const S = await import('../server.mjs');
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  BASE = `http://127.0.0.1:${httpServer.address().port}`;
}, 60_000);
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  if (prevFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = prevFlag;
});
const get = (path, accept, extra = {}) => fetch(BASE + path, { headers: { accept, ...extra } });
const post = (path) => fetch(BASE + path, { method: 'POST',
  headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
// What /mcp/connect answered before this page existed: no route, Express's default 404.
const isExpress404 = async (r, verb) => {
  expect(r.status).toBe(404);
  expect(await r.text()).toContain(`Cannot ${verb} ${CONNECT_PATH}`);
};

describe('flag off: /mcp/connect is unchanged', () => {
  it.each(['0', '', 'false', 'enabled'])('a browser GET is the old 404 (flag=%j)', async (v) => {
    process.env[FLAG] = v;
    await isExpress404(await get(CONNECT_PATH, 'text/html,application/xhtml+xml'), 'GET');
    await isExpress404(await get(CONNECT_PATH + '?client=cursor', 'text/html'), 'GET');
  });
});

describe('flag on: only a browser GET gets the page', () => {
  beforeAll(() => { process.env[FLAG] = '1'; });

  it('POST is unchanged', async () => {
    await isExpress404(await post(CONNECT_PATH), 'POST');
  });

  it.each(['application/json', '*/*', 'application/json, text/event-stream', 'text/event-stream', 'text/html, text/event-stream'])(
    'a GET accepting %j is unchanged', async (accept) => {
      await isExpress404(await get(CONNECT_PATH, accept), 'GET');
    });

  it.each(['1', 'true', 'YES', 'on'])('flag value %j turns the page on', async (v) => {
    process.env[FLAG] = v;
    const r = await get(CONNECT_PATH, 'text/html');
    expect(r.status).toBe(200);
    process.env[FLAG] = '1';
  });

  it('a browser GET gets the HTML page with its own hashed CSP', async () => {
    const r = await get(CONNECT_PATH, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/html/);
    expect(r.headers.get('content-security-policy')).toBe(CONNECT_CSP());
    expect(r.headers.get('x-robots-tag')).toBe('noindex');
    const html = await r.text();
    // 1. one email field, posting the address in a body to the existing backend door
    expect(html).toMatch(new RegExp(`<form id="signin" method="post" action="${SIGNUP_API}"`));
    expect(html.match(/<input [^>]*>/g)).toHaveLength(1);
    expect(html).toMatch(/<input id="email-input" name="email" type="email"/);
    expect(html).toContain('Email me a sign-in link');
    expect(html).toContain('Check your inbox');
    // 2. the OAuth sign-in and its server URL
    expect(html).toContain('Sign in with your MCP client');
    expect(html).toContain('<code>https://dchub.cloud/mcp/oauth</code>');
    // no client given: no client block
    expect(html).not.toContain('id="your-client"');
  });

  it('a top-level navigation without text/html (Sec-Fetch-Dest: document) also gets the page', async () => {
    const r = await get(CONNECT_PATH + '/', '*/*', { 'sec-fetch-dest': 'document' });
    expect(r.status).toBe(200);
  });

  it('?client=cursor leads with claim_free_key\'s Cursor snippet, key left as a placeholder', async () => {
    const html = await (await get(CONNECT_PATH + '?client=cursor', 'text/html')).text();
    const snip = JSON.stringify({ mcpServers: { dchub: { url: 'https://dchub.cloud/mcp', headers: { 'X-API-Key': KEY_PLACEHOLDER } } } })
      .replace(/"/g, '&quot;');
    expect(html).toContain(snip);
    expect(html.indexOf(snip)).toBeLessThan(html.indexOf('id="signin"'));
    expect(html).toContain('data-client="cursor"');
    expect(html).not.toMatch(/dch_live_[0-9a-f]/);
  });

  it('?client=claude leads with the connector sign-in URL and the Claude Code line', async () => {
    const html = await (await get(CONNECT_PATH + '?client=claude', 'text/html')).text();
    const lead = html.slice(html.indexOf('id="your-client"'), html.indexOf('id="signin"'));
    expect(lead).toContain(OAUTH_URL);
    expect(lead).toContain('claude mcp add dchub --transport http --header &quot;X-API-Key: YOUR_API_KEY&quot; https://dchub.cloud/mcp');
  });

  it('an unknown or hostile ?client= is never echoed and shows no client block', async () => {
    for (const c of ['%3Cscript%3Ealert(1)%3C%2Fscript%3E', 'nonsense', '"onmouseover=x']) {
      const html = await (await get(CONNECT_PATH + '?client=' + c, 'text/html')).text();
      expect(html).not.toContain('id="your-client"');
      expect(html).not.toMatch(/<script>alert|onmouseover=x|nonsense/);
    }
  });

  it.each(CLIENTS)('names no price, plan or tier and no emoji (client=%j)', async (c) => {
    const html = await (await get(CONNECT_PATH + (c ? '?client=' + c : ''), 'text/html')).text();
    expect(html).not.toMatch(FORBIDDEN);
    expect(html).not.toMatch(EMOJI);
  });

  it('never puts an email into a URL', async () => {
    const html = await (await get(CONNECT_PATH, 'text/html')).text();
    expect(html).not.toMatch(/[?&]email=/i);
    expect(html).not.toMatch(/method="get"/i);
    expect(CONNECT_SCRIPT).toContain("method:'POST'");
    expect(CONNECT_SCRIPT).toContain('body:JSON.stringify(body)');
  });
});

describe('renderConnectPage and its helpers', () => {
  const persist = (key) => ({ connect_url: 'https://dchub.cloud/mcp?apiKey=' + key,
    byo_mcp: { label: 'URL box clients' },
    clients: { cursor: { label: 'Cursor', file: '~/.cursor/mcp.json', snippet: '{"k":"' + key + '"}' },
      claude_code: { label: 'Claude Code', snippet: 'claude mcp add ' + key } } });
  const keyFrom = (s) => (/cursor/.test(s) ? 'cursor' : null);

  it('connectPageWanted: browser GET/HEAD only, never an event stream', () => {
    const w = (method, accept, dest) => connectPageWanted({ method, headers: { accept, ...(dest ? { 'sec-fetch-dest': dest } : {}) } });
    expect(w('GET', 'text/html')).toBe(true);
    expect(w('HEAD', 'text/html')).toBe(true);
    expect(w('GET', '*/*', 'document')).toBe(true);
    expect(w('POST', 'text/html')).toBe(false);
    expect(w('GET', 'application/json')).toBe(false);
    expect(w('GET', '*/*')).toBe(false);
    expect(w('GET', 'text/html, text/event-stream')).toBe(false);
    expect(w('GET', undefined)).toBe(false);
  });

  it('resolveClient maps names and rejects anything else', () => {
    expect(resolveClient('claude', keyFrom)).toEqual({ kind: 'claude' });
    expect(resolveClient('ChatGPT', keyFrom)).toEqual({ kind: 'url_box' });
    expect(resolveClient('cursor', keyFrom)).toEqual({ kind: 'snippet', keys: ['cursor'] });
    expect(resolveClient('<x>', keyFrom)).toBeNull();
    expect(resolveClient('', keyFrom)).toBeNull();
    expect(resolveClient('cursor', null)).toBeNull();
  });

  it('clientBlocks calls persist with the placeholder only', () => {
    const seen = [];
    clientBlocks({ kind: 'snippet', keys: ['cursor'] }, (k) => { seen.push(k); return persist(k); });
    expect(seen).toEqual([KEY_PLACEHOLDER]);
    expect(clientBlocks({ kind: 'url_box' }, persist).map((b) => b.text))
      .toEqual([OAUTH_URL, 'https://dchub.cloud/mcp?apiKey=YOUR_API_KEY']);
  });

  it('the CSP allows exactly the embedded script, by hash', () => {
    const html = renderConnectPage({ client: 'cursor', persist, clientKeyFrom: keyFrom });
    const m = html.match(/<script>([\s\S]*?)<\/script>/g);
    expect(m).toHaveLength(1);
    expect(m[0].slice(8, -9)).toBe(CONNECT_SCRIPT);
    const hash = createHash('sha256').update(CONNECT_SCRIPT).digest('base64');
    const csp = CONNECT_CSP();
    expect(csp).toContain(`script-src 'sha256-${hash}' https://static.cloudflareinsights.com;`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self' https://cloudflareinsights.com");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(html).not.toMatch(/<script src=/);
  });
});

describe('wiring', () => {
  it('server.mjs gates the route on the flag and the browser test, falling through with next()', () => {
    expect(CONNECT_PATH).toBe('/mcp/connect');
    expect(SRC).toContain("app.get([CONNECT_PATH, CONNECT_PATH + '/'], (req, res, next) => {");
    expect(SRC).toContain('if (!_wallIdV2On() || !_connectPageWanted(req)) return next();');
    expect(SRC).toContain('persist: _persistConfig, clientKeyFrom: _clientKeyFromNames');
  });
});
