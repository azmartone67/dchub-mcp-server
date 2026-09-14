// automint-trial-rungs.test.mjs — r-trial-sub-bind + r-trial-refused (2026-09-14)
//
// ★THE DEFECT (read on mcp c9bae40 / backend daedf66a5). buildAutoMintBlock set
// upgrade_url = _keyBoundUpgradeUrl(mint.api_key): /go/c pro|k-<sha256(dch_trial_…)>|sid.
// The webhook's k- branch only runs `UPDATE mcp_dev_keys … WHERE sha256(api_key) = <hash>`,
// an unbound dch_trial_ key lives in auto_trial_keys, and Fix E skips k- refs — so a Pro
// subscription bought from that link stamped no tier and unlocked no session. The same
// k- ref came out of _rungsText's Pro rung on every later call of a session whose store
// held a trial key: auto-bound by the mint, or sent as the persist_command header.
//
// ★AND A REFUSED MINT WAS BOUND. /keys/auto-mint answers bind_required:true,
// gate:'bind_email_required' once the identity has spent its unbound calls (validate then
// says 200 valid:false). _autoBindTrialToSession bound it anyway, and the block told the
// agent "Free trial unlocked on THIS session".
//
// ★WHY REAL HTTP (invalid-key-anon.test.mjs pattern). Which key the link binds is decided
// by what the handler put in the request store at the moment the link is built. A unit
// test of the URL helper with a hand-built store passes whether or not the handler ever
// puts a trial key there.
//
// ★WHY THE dch_live_ CONTROL. "No token carries a k- ref" is also what a path that never
// binds ANY key produces. The control proves this handler still emits k- for a key the
// webhook can find, so the trial assertions mean "trial keys bind the session".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';

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
      dataKeys.push({ path: url.pathname, key: req.headers['x-api-key'] || '' });
      res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS, results: ROWS }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });

  // API_BASE is captured once at import: set it BEFORE the import, restore right after.
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
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

const GRID = ['get_grid_intelligence', { region_id: 'PJM' }];
const COMPARE = ['compare_sites', { locations: '33.45,-112.07;39.04,-77.48' }];
async function keyedWall(h) {
  trialUsedTools.add(COMPARE[0]);
  try { return await call(h, ...COMPARE); } finally { trialUsedTools.delete(COMPARE[0]); }
}

describe('r-trial-sub-bind — no subscription link binds to a trial key', () => {
  it('the auto-mint envelope: the Pro link binds the session, never k-<sha256(trial key)>', async () => {
    mintMode = 'accepted';
    const { sid, h } = await session({ 'x-dc-client-ip': '198.51.100.11' });
    const before = mintHits;
    const r = await call(h, ...GRID);
    expect(mintHits - before, 'the anonymous call did not reach the auto-mint cascade').toBe(1);
    expect(r.body).toContain(TRIAL);
    expect(r.text).toContain('Free trial unlocked on THIS session');

    expect(refsIn(r.body)).not.toContain('k-' + sha(TRIAL));
    const pro = goTokens(r.body).filter((t) => t.plan === 'pro');
    expect(pro.length).toBeGreaterThanOrEqual(1);
    for (const t of pro) expect(t.ref).toBe(sid);
  }, 30000);

  it('a later call in that auto-bound session: the store holds the trial key, Pro still binds the session', async () => {
    mintMode = 'accepted';
    const { sid, h } = await session({ 'x-dc-client-ip': '198.51.100.12' });
    await call(h, ...GRID);                          // mint + auto-bind
    const mintsAfterBind = mintHits;
    const seen = dataKeys.length;
    await call(h, ...GRID);
    expect(mintHits, 'the bound session re-entered the anonymous cascade').toBe(mintsAfterBind);
    expect(dataKeys.slice(seen).map((d) => d.key), 'the bound session did not send the trial key')
      .toContain(TRIAL);

    const r = await call(h, ...COMPARE);
    expect(refsIn(r.body)).not.toContain('k-' + sha(TRIAL));
    const pro = goTokens(r.body).filter((t) => t.plan === 'pro');
    expect(pro.length).toBeGreaterThanOrEqual(1);
    for (const t of pro) expect([t.ref, t.sid]).not.toContain('k-' + sha(TRIAL));
    expect(pro.some((t) => t.ref === sid)).toBe(true);
  }, 30000);

  it('a trial key sent as X-API-Key (the persist_command cohort): Pro binds the session', async () => {
    mintMode = 'accepted';
    const { sid, h } = await session({ 'x-dc-client-ip': '198.51.100.13', 'x-api-key': TRIAL });
    const r = await call(h, ...COMPARE);
    const wall = await keyedWall(h);
    expect(wall.text).toContain('this session unlocks');
    expect(wall.text).not.toContain('this key unlocks');
    expect(refsIn(wall.body)).not.toContain('k-' + sha(TRIAL));
    expect(refsIn(r.body)).not.toContain('k-' + sha(TRIAL));
    const pro = goTokens(r.body).filter((t) => t.plan === 'pro');
    expect(pro.length).toBeGreaterThanOrEqual(1);
    expect(pro.some((t) => t.ref === sid)).toBe(true);
  }, 30000);

  it('CONTROL: a dch_live_ key the webhook can find still gets pro|k-<sha256(key)>|sid', async () => {
    const { sid, h } = await session({ 'x-dc-client-ip': '198.51.100.14', 'x-api-key': LIVE });
    const r = await call(h, ...COMPARE);
    expect(goTokens(r.body)).toContainEqual({ plan: 'pro', ref: 'k-' + sha(LIVE), sid });
    const wall = await keyedWall(h);
    expect(wall.text).toContain('this key unlocks');
    expect(goTokens(wall.body)).toContainEqual({ plan: 'pro', ref: 'k-' + sha(LIVE), sid });
  }, 30000);
});

describe('r-trial-refused — a mint the backend refuses is neither bound nor advertised', () => {
  it('no "unlocked on THIS session" copy, the bind ask instead, and the session stays anonymous', async () => {
    mintMode = 'refused';
    try {
      const { h } = await session({ 'x-dc-client-ip': '198.51.100.21' });
      const before = mintHits;
      const seen = dataKeys.length;
      const r = await call(h, ...GRID);
      expect(mintHits - before).toBe(1);
      expect(r.text).not.toContain('Free trial unlocked on THIS session');
      expect(r.text).not.toContain('works instantly');
      expect(r.text).toContain('`bind_email`');
      expect(r.text).toContain('This free trial key is not active yet');

      await call(h, ...GRID);
      expect(mintHits - before, 'a refused key was bound: the second call skipped the cascade').toBe(2);
      expect(dataKeys.slice(seen).map((d) => d.key)).not.toContain(TRIAL);
    } finally {
      mintMode = 'accepted';
    }
  }, 30000);
});
