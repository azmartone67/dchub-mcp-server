// noteN-save-key-first-answer.test.mjs — Grok note N item 5 (2026-11-16).
//
// Install-page keys are called once and rarely come back. The
// backend's /keys/validate answers save_notice_due=true on exactly one validate per new dch_live_
// key (it stamps metadata.save_notice_at, only while the key has made no MCP call) and names the
// key's metadata.client_name. Pinned here on the real /mcp path against a stub backend that
// answers the way that stamp does (due on the first validate of a key, never again):
//   1. the first answer for the key carries "Save this key in your client config to keep your
//      history and alerts" exactly once, with that client's config (install-claude-desktop ->
//      the claude_desktop_config.json launcher entry, key filled in);
//   2. the second answer does not;
//   3. a URL-box client (install-claude = Claude.ai web) gets the connector URL that carries the key;
//   4. an error answer does not spend it: the next successful answer carries it;
//   5. DCHUB_SAVE_KEY_NOTICE=0 shows nothing.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';

let S, stub, srv, PORT;
let stamped = new Set();          // keys the stub backend already answered due for
let clientName = 'install-claude-desktop';
const prev = {};
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_SAVE_KEY_NOTICE'];
let keyN = 0;
const newKey = () => 'dch_live_' + ('s4ve' + String(++keyN).padStart(4, '0')).repeat(4);

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      let buf = '';
      req.on('data', (d) => { buf += d; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (p === '/api/v1/keys/validate') {
          let body = {};
          try { body = JSON.parse(buf); } catch (_) {}
          const due = !stamped.has(body.api_key);
          stamped.add(body.api_key);
          res.end(JSON.stringify({ valid: true, tier: 'free', email: null, save_notice_due: due,
            ...(due ? { client_name: clientName } : {}) }));
          return;
        }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
});
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});
beforeEach(() => {
  clientName = 'install-claude-desktop';
  delete process.env.DCHUB_SAVE_KEY_NOTICE;
  S._dropKeyCache();
  S._saveKeyPending.clear();
});

async function post(h, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...h }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json };
}
let ipN = 0;
async function session(key, clientInfo = 'claude-ai') {
  const h0 = { 'x-dc-client-ip': `192.0.2.${++ipN}`, 'x-api-key': key };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientInfo, version: '1' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 10;
  return async (name, args = {}) => {
    const out = await post(h, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const r = JSON.parse(out.json).result;
    return { text: (r.content || []).map((c) => c.text).join('\n'), sc: r.structuredContent || {}, isError: r.isError === true };
  };
}
const times = (text, s) => text.split(s).length - 1;

describe('save-key line on a new key\'s first answer (Grok note N item 5)', () => {
  it('first answer: the line once, with the install client\'s config; second answer: nothing', async () => {
    const key = newKey();
    const call = await session(key);
    const first = await call('dchub_services', {});
    expect(first.isError).toBe(false);
    expect(times(first.text, S.SAVE_KEY_LINE)).toBe(1);
    expect(first.text).toContain('Claude Desktop');
    expect(first.text).toContain('"DCHUB_API_KEY":"' + key + '"');
    expect(first.sc.save_key_line).toBe(S.SAVE_KEY_LINE);
    const second = await call('dchub_services', {});
    expect(times(second.text, S.SAVE_KEY_LINE)).toBe(0);
    expect(second.sc.save_key_line).toBeUndefined();
  });

  it('a URL-box client (install-claude, Claude.ai web) gets the connector URL carrying the key', async () => {
    clientName = 'install-claude';
    const key = newKey();
    const call = await session(key);
    const first = await call('dchub_services', {});
    expect(times(first.text, S.SAVE_KEY_LINE)).toBe(1);
    expect(first.text).toContain('https://dchub.cloud/mcp?apiKey=' + key);
  });

  it('a new key in another session gets its own line once (once per key, not once per server)', async () => {
    const k1 = newKey(); const k2 = newKey();
    const c1 = await session(k1); const c2 = await session(k2);
    expect(times((await c1('dchub_services', {})).text, S.SAVE_KEY_LINE)).toBe(1);
    expect(times((await c2('dchub_services', {})).text, S.SAVE_KEY_LINE)).toBe(1);
    expect(times((await c1('dchub_services', {})).text, S.SAVE_KEY_LINE)).toBe(0);
  });

  it('DCHUB_SAVE_KEY_NOTICE=0 shows nothing', async () => {
    process.env.DCHUB_SAVE_KEY_NOTICE = '0';
    const call = await session(newKey());
    expect(times((await call('dchub_services', {})).text, S.SAVE_KEY_LINE)).toBe(0);
  });
});

describe('_saveKeyOnceStep (unit)', () => {
  const KEY = 'dch_live_' + 'u0n1tt35'.repeat(4);
  const res = (extra = {}) => ({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true }, ...extra });
  const run = (r, name = 'get_news', ctx = {}) =>
    S._ctxALS.run({ api_key: KEY, tier: 'free', profile: '', platform: 'cursor', ...ctx }, () => S._saveKeyOnceStep(r, name));
  beforeEach(() => { S._saveKeyPending.clear(); S._keysHandedWithSnippet.delete(KEY); });

  it('an error answer and the key\'s own claim reply do not spend the line', () => {
    expect(S._armSaveKeyNotice(KEY, { valid: true, save_notice_due: true, client_name: 'install-cursor' })).toBe(true);
    const err = res({ isError: true });
    expect(run(err)).toBe(err);
    const own = res();
    expect(run(own, 'claim_free_key')).toBe(own);
    const out = run(res());
    expect(out.content).toHaveLength(2);
    expect(out.content[1].text).toContain(S.SAVE_KEY_LINE);
    expect(out.content[1].text).toContain('~/.cursor/mcp.json');
    expect(run(res()).content).toHaveLength(1);
  });
  it('a key this replica just handed back with its snippet (claim / bind) is not told again', () => {
    S._armSaveKeyNotice(KEY, { valid: true, save_notice_due: true });
    S._noteKeyHanded(KEY);
    expect(run(res()).content).toHaveLength(1);
  });
  it('only a due, valid dch_live_ key arms', () => {
    expect(S._armSaveKeyNotice(KEY, { valid: true, save_notice_due: false })).toBe(false);
    expect(S._armSaveKeyNotice(KEY, { valid: false, save_notice_due: true })).toBe(false);
    expect(S._armSaveKeyNotice('dch_trial_x', { valid: true, save_notice_due: true })).toBe(false);
  });
  it('the line names no plan, price, pricing link, paid, upgrade or trial', () => {
    expect(S.SAVE_KEY_LINE).toBe('Save this key in your client config to keep your history and alerts');
    expect(S.SAVE_KEY_LINE).not.toMatch(/\$|plan|price|pricing|paid|upgrade|trial|https?:/i);
  });
});
