// chatgpt-openai-session-sid.test.mjs — r-oai-session-sid (2026-09-24)
//
// ChatGPT calls tools/call statelessly (no Mcp-Session-Id), so every signed link
// it was handed carried an EMPTY session id. Measured 2026-09-24 in a ChatGPT
// run: the /upgrade/h token decoded to "|unlock_more_data|paid|…" and the /go/c
// tokens to "metered|pk-…" with no sid, so paid_attributed could not join a
// ChatGPT sale back to its conversation. ChatGPT does send
// params._meta["openai/session"] (an anonymized conversation id). The stateless
// branch now uses its hash as the session id when no Mcp-Session-Id arrived.
//
// Real /mcp handler over HTTP, fake local backend, no network (harness from
// grok-relay-label).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import net from 'node:net';

// ★HARD GATE, NO NETWORK. Installed at module evaluation, before beforeAll imports
// server.mjs, so nothing it starts slips past: every socket connect to a host other
// than loopback is refused and recorded, and the last test fails if one was attempted.
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
let prevBase;
let sessionKeyHits = 0;       // restoreSessionKey's asks for an anonymous session

const SECRET = 'test-internal-key-not-a-real-secret';
const TRIAL = 'dch_trial_automintrungstest0001';
const LIVE = 'dch_live_automintrungstest0001';
const sha = (k) => createHash('sha256').update(k).digest('hex');

let S, PORT, httpServer, stub;
let mintMode = 'accepted';
let mintHits = 0;
const dataKeys = [];          // X-API-Key on every data call the handler makes
// trial-check answers trial_used:true for these tools, so a keyed caller lands on the
// paid_only wall (its "The moment they pay, …" line) instead of the trial preview.
const trialUsedTools = new Set();
let prevSecret;

const MINT = {
  ok: true, api_key: TRIAL, tier: 'IDENTIFIED', expires_at: null, daily_calls: 15,
  daily_calls_when_email_bound: 50, trial_days: 7, days_remaining: 7,
};
const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: 100 + i, name: `Site ${i}`, region_id: 'PJM', iso: 'PJM', score: 50 + i,
  lat: 39 + i / 10, lon: -77 - i / 10, city: 'Ashburn', state: 'VA', country: 'US',
}));

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/auto-mint') {
        mintHits += 1;
        res.end(JSON.stringify(mintMode === 'refused'
          ? { ...MINT, reused: true, bind_required: true, gate: 'bind_email_required' }
          : { ...MINT, reused: false }));
        return;
      }
      if (url.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        let out = { valid: false, tier: 'free' };
        if (key === LIVE) out = { valid: true, tier: 'free', developer_id: 'dev_t', email: 't@example.com' };
        if (key === TRIAL) {
          out = mintMode === 'refused'
            ? { valid: false, tier: 'free', reason: 'bind_email_required' }
            : { valid: true, tier: 'free', developer_id: null, email: null, source: 'auto_trial' };
        }
        res.end(JSON.stringify(out));
        return;
      }
      if (url.pathname === '/api/v1/mcp/trial-check') {
        const used = trialUsedTools.has((await readBody(req)).tool);
        res.end(JSON.stringify({ trial_used: used, prior_calls: used ? 1 : 0 }));
        return;
      }
      if (url.pathname === '/api/v1/mcp/session-key') {
        // restoreSessionKey asks here for an anonymous session; 404 = nothing to
        // restore. Answered before the catch-all so it never counts as a data call.
        sessionKeyHits += 1;
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      dataKeys.push({ path: url.pathname, key: req.headers['x-api-key'] || '' });
      res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS, results: ROWS }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });

  // API_BASE is captured once at import, so set it BEFORE the import. It stays set
  // until afterAll because restoreSessionKey reads DCHUB_API_BASE per call, not at
  // import: restored right after the import, the anonymous restore went to the
  // production default instead of this stub.
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  // _goUrl reads the signing secret per call; without it links stay raw Stripe URLs.
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
  const body2 = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, body: body2 };
}

async function session(headers) {
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {},
              clientInfo: { name: 'automint-trial-rungs-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { sid, h };
}

let rpcId = 10;
async function call(h, name, args) {
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
                                   params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  return { body, text: (result.content || []).map((c) => c.text || '').join('') };
}

/** Every signed /go/c token anywhere in the response, split the way the backend verifies it. */
function goTokens(body) {
  const out = [];
  for (const m of body.matchAll(/https:\/\/dchub\.cloud\/go\/c\/([A-Za-z0-9_-]+)\.([0-9a-f]{32})/g)) {
    expect(createHmac('sha256', SECRET).update(m[1]).digest('hex').slice(0, 32)).toBe(m[2]);
    const [plan, ref = '', sid = ''] = Buffer.from(m[1], 'base64url').toString().split('|');
    out.push({ plan, ref, sid });
  }
  return out;
}

const OAI_UA = { 'user-agent': 'openai-mcp/1.0.0' };
const CONV = 'conv_7f3a9c-test-conversation';
const expectedSid = 'oai-' + sha(CONV).slice(0, 32);

async function stateless(headers, meta) {
  const params = { name: 'unlock_more_data', arguments: { reason: 'full PJM depth' } };
  if (meta) params._meta = meta;
  const { body } = await post(headers, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params });
  return body;
}
/** sid field of every signed /upgrade/h token in the response. */
function relaySids(body) {
  return [...body.matchAll(/https:\/\/dchub\.cloud\/upgrade\/h\/([A-Za-z0-9_-]+)\.[0-9a-f]{32}/g)]
    .map((m) => Buffer.from(m[1], 'base64url').toString().split('|')[0]);
}

describe('ChatGPT stateless calls carry the conversation as the session id', () => {
  it('openai/session present → /upgrade/h and every /go/c token carry oai-<hash>', async () => {
    const body = await stateless(OAI_UA, { 'openai/session': CONV, 'openai/subject': 'u_x' });
    const rs = relaySids(body);
    expect(rs.length, 'no /upgrade/h minted on the ChatGPT path').toBeGreaterThan(0);
    for (const s of rs) expect(s).toBe(expectedSid);
    const gt = goTokens(body);
    expect(gt.length).toBeGreaterThan(0);
    for (const t of gt) expect(t.ref).toBe(expectedSid);
    expect(body).not.toContain(CONV);                  // the raw id never ships
    expect(expectedSid).toMatch(/^[A-Za-z0-9_.:-]{1,200}$/);   // backend _REF_OK
  });

  it('same conversation → same sid; different conversation → different sid', () => {
    const a = S._openaiSessionSid({ method: 'tools/call', params: { _meta: { 'openai/session': CONV } } });
    const b = S._openaiSessionSid({ method: 'tools/call', params: { _meta: { 'openai/session': CONV } } });
    const c = S._openaiSessionSid({ method: 'tools/call', params: { _meta: { 'openai/session': CONV + '2' } } });
    expect(a).toBe(expectedSid); expect(b).toBe(a); expect(c).not.toBe(a);
  });

  it('control: no openai/session → the sid stays empty (unchanged behaviour)', async () => {
    const body = await stateless(OAI_UA, { 'openai/subject': 'u_x' });
    for (const s of relaySids(body)) expect(s).toBe('');
    for (const bad of [undefined, null, '', '   ', 42, {}]) {
      expect(S._openaiSessionSid({ params: { _meta: { 'openai/session': bad } } })).toBe('');
    }
    expect(S._openaiSessionSid(null)).toBe('');
  });

  it('a real Mcp-Session-Id always wins over openai/session', async () => {
    const { sid, h } = await session(OAI_UA);
    const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
      params: { name: 'unlock_more_data', arguments: {}, _meta: { 'openai/session': CONV } } });
    const rs = relaySids(body);
    expect(rs.length).toBeGreaterThan(0);
    for (const s of rs) expect(s).toBe(sid);
  });

  it('no socket left loopback', () => { expect(foreign).toEqual([]); });
});
