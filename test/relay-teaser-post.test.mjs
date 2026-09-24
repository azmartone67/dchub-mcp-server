// relay-teaser-post.test.mjs — r-relay-teaser (2026-09-24), MCP half.
//
// The relay page shows ONE value the preview held back, stored server-side
// against the relay token (never in the token or the response: the agent holds
// both). This drives the REAL /mcp handler over HTTP against a fake backend that
// records POST /api/v1/relay/teaser, and pins: one post per gated response, for
// the token this response's for_your_human link carries, with the first value
// the gate nulled; the value itself never reaches the response. No network.
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
const teaserPosts = [];      // r-relay-teaser: what the gateway posted
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
      if (url.pathname.startsWith('/api/v1/dcpi/scores/')) {
        // a DCPI market row: the free-numerics gate (_nullFreeFigures) withholds composite_score
        res.end(JSON.stringify({ market_slug: 'dallas', market_name: 'Dallas', verdict: 'BUILD',
          composite_score: 71.26, constraint_score: 40.5, iso: 'ERCOT' }));
        return;
      }
      if (url.pathname === '/api/v1/relay/teaser') {
        teaserPosts.push({ body: await readBody(req), key: req.headers['x-internal-key'] || '' });
        res.end(JSON.stringify({ ok: true, stored: true }));
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
  // r-relay-teaser: callAPIWrite reads the internal key ONCE at import, so it is
  // set before the import here (the source harness sets it after, for _goUrl).
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  // Production runs the grid headroom gate (live previews carry _headroom_in_pro);
  // read once at import, and each vitest file has its own module instance.
  process.env.DCHUB_GRID_HEADROOM_TIER = '1';
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
const refsIn = (body) => [
  ...goTokens(body).map((t) => t.ref),
  ...[...body.matchAll(/client_reference_id=([^&"\s\\]+)/g)].map((m) => decodeURIComponent(m[1])),
];


const settle = () => new Promise((r) => setTimeout(r, 150));

describe('the gateway posts one withheld number for the relay token it minted', () => {
  let body, sc;
  beforeAll(async () => {
    const init = await post({}, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {},
                clientInfo: { name: 'relay-teaser-test', version: '1.0' } } });
    const h = { 'mcp-session-id': init.headers.get('mcp-session-id') };
    await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
    teaserPosts.length = 0;
    ({ body } = await call(h, 'rank_markets', { limit: 10 }));
    sc = (JSON.parse(body).result || {}).structuredContent || {};
    await settle();
  });

  it('the response is gated and carries a relay link (the path under test is live)', () => {
    expect(sc.for_your_human && sc.for_your_human.url).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\//);
    expect(body).toContain('_score_in_pro');
  });

  it('exactly one post, for THIS response\'s token, with the internal key', () => {
    expect(teaserPosts).toHaveLength(1);
    const tok = sc.for_your_human.url.split('/upgrade/h/')[1];
    expect(teaserPosts[0].body.token).toBe(tok);
    expect(teaserPosts[0].key).toBe(process.env.DCHUB_INTERNAL_KEY || '');
  });

  it('the posted number is a withheld one, formatted for the page', () => {
    const p = teaserPosts[0].body;
    // the FIRST figure the gate nulled: ROWS[0].score in the fake backend
    expect([p.label, p.value]).toEqual(['score', '50']);
    expect(p.label).toMatch(/^[a-z0-9][a-z0-9 ,./()%$&+-]{0,59}$/);
    expect(p.value).toMatch(/^[0-9A-Za-z $%.,/+~-]{1,24}$/);
    // the gate marked this field withheld in the response (escaped inside the text block)
    expect(body).toContain(`_${p.label.replace(/ /g, '_')}_in_pro`);
    // and the value posted is not what the agent was shown for it: the field is null there
    expect(body).toMatch(new RegExp(`\\\\?"${p.label.replace(/ /g, '_')}\\\\?":null`));
  });

  it('the agent never sees the teaser machinery', () => {
    expect(body).not.toContain('withheld_teaser');
    expect(body).not.toContain('/api/v1/relay/teaser');
  });

  it('no socket left loopback', () => { expect(foreign).toEqual([]); });
});

describe('formatting helpers', () => {
  it('labels: key → lower-case words, markers stripped', () => {
    expect(S._teaserLabel('constraint_score')).toBe('constraint score');
    expect(S._teaserLabel('_avg_time_to_power_months_in_pro')).toBe('avg time to power months');
    expect(S._teaserLabel('__')).toBe('');
  });
  it('values: rounded, grouped, never NaN', () => {
    expect(S._teaserValue(62.44)).toBe('62.4');
    expect(S._teaserValue(12345.6)).toBe('12,346');
    expect(S._teaserValue('1,234')).toBe('1,234');
    expect(S._teaserValue('n/a')).toBe('');
  });
  it('no relay link or nothing withheld → no payload', () => {
    const r = { structuredContent: { for_your_human: { url: 'https://dchub.cloud/upgrade/h/abc.0123456789abcdef0123456789abcdef' } } };
    expect(S._relayTeaserPayload(r, {})).toBeNull();
    expect(S._relayTeaserPayload({ structuredContent: {} }, { withheld_teaser: { key: 'score', value: 5 } })).toBeNull();
    expect(S._relayTeaserPayload(r, { withheld_teaser: { key: 'score', value: 5 } }))
      .toEqual({ token: 'abc.0123456789abcdef0123456789abcdef', label: 'score', value: '5' });
  });
});

describe('every preview-trim site records the first withheld figure', () => {
  const inCtx = (payload, tool) => {
    const store = {};
    S._ctxALS.run(store, () => S.trimForTrial(payload, tool));
    return store.withheld_teaser;
  };
  it('the headroom site (grid decision fields)', () => {
    expect(inCtx({ forward_load_mw: 1234 }, 'get_grid_intelligence'))
      .toEqual({ key: 'forward_load_mw', value: 1234 });
  });
  it('the DCPI per-ISO paid-keys site', () => {
    expect(inCtx({ grid_emergencies_30d: 3 }, 'compare_isos'))
      .toEqual({ key: 'grid_emergencies_30d', value: 3 });
  });
  it('the first figure wins, and a non-figure is skipped', () => {
    expect(inCtx({ headroom: { mw: 5 }, grid_emergencies_30d: 3, forward_load_mw: 9 }, 'get_grid_intelligence'))
      .toEqual({ key: 'grid_emergencies_30d', value: 3 });
  });
  it('outside a request it records nothing and never throws', () => {
    expect(() => S.trimForTrial({ grid_emergencies_30d: 3 }, 'compare_isos')).not.toThrow();
  });
});
