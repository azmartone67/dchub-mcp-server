// daily-quota-gateway.test.mjs — r-daily-quota (2026-09-27)
//
// The published free-tier rule (canon `free_tier`) meters an email-bound key at
// 50 calls/day and Developer at 500/day. The backend decides (monthly_quota.
// daily_decision, behind DAILY_QUOTA_ENFORCE) and returns it as `daily` on the
// /api/v1/mcp/monthly-usage answer this gateway already reads. These tests pin
// what the gateway DOES with that answer:
//
//   * over the daily limit on /mcp → the call is served at ANONYMOUS depth
//     (previews), with the backend's sentence in content and the facts in
//     structuredContent.identity.daily_quota_reached — never a hard wall;
//   * under it → nothing changes;
//   * on /mcp/chatgpt → nothing changes EITHER WAY (frz-chatgpt-toolset: the
//     directory profile's limits and behaviour are frozen during OpenAI review).
//
// The 50th/51st and 500th/501st boundaries and the UTC day rollover are the
// backend's arithmetic and are pinned there (dchub-backend
// tests/test_free_tier_rule_enforcement.py); here the stub hands the gateway
// the decision the backend serves at each side of the boundary.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub;
const prev = {};
const KEY = 'dch_live_dailyquota_test_key';
const ROWS = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1, slug: `ashburn-${i + 1}`, name: `Ashburn Campus ${i + 1}`,
  city: 'Ashburn', country: 'US', provider: 'Acme', capacity_mw: 100 + i,
}));
let validateTier = 'identified';

// What the backend serves at each side of a daily boundary.
const UNDER = (tier, quota, used) => ({
  allowed: true, blocked: false, reason: 'enforcement_off', used: used, quota: quota * 30,
  remaining: quota * 30 - used, tier, quota_tier: tier,
  daily: { allowed: true, blocked: false, reason: 'under_daily_quota', day: '2026-09-27',
           used, quota, remaining: quota - used, quota_tier: tier },
});
const MSG = (tier, used, quota) => `🤖 Daily quota reached: ${used} of ${quota} DC Hub MCP calls used today on the ${tier} tier. The quota resets at 00:00 UTC.`;
const OVER = (tier, quota) => ({
  allowed: true, blocked: false, reason: 'enforcement_off', used: quota, quota: quota * 30,
  remaining: quota * 29, tier, quota_tier: tier,
  daily: { allowed: false, blocked: true, reason: 'over_daily_quota', day: '2026-09-27',
           used: quota, quota, remaining: 0, quota_tier: tier,
           upgrade_url: 'https://buy.stripe.com/test_upgrade', pricing_url: 'https://dchub.cloud/pricing',
           message: MSG(tier, quota, quota) },
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
      if (p === '/api/v1/keys/validate') {
        return send(200, { valid: true, tier: validateTier, email: 'owner@acme-dc.com', developer_id: 7 });
      }
      if (p === '/api/v1/mcp/anon-usage') return send(200, { ok: true, count: 0 });
      if (p === '/api/v1/mcp/trial-check') return send(200, { trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send(404, { error: 'not found' });
      if (p === '/api/v1/keys/auto-mint') return send(503, { ok: false });
      if (p === '/api/v1/mcp/credits/balance') return send(200, { credits: 0, had_pack: false });
      if (p.startsWith('/api/v1/mcp/full-cap')) return send(200, { ok: true, n: 1, remaining: 1, exceeded: false });
      return send(200, { success: true, count: ROWS.length, total: ROWS.length, data: ROWS, facilities: ROWS });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_ANON_DAILY_CAP']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  delete process.env.DCHUB_ANON_DAILY_CAP;
  S = await import('../server.mjs');
  S._readDeadline.signal = () => AbortSignal.timeout(120_000);
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  S._setQuotaFetchImpl(null);
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

beforeEach(() => { S._dropQuotaCache(KEY); validateTier = 'identified'; });

let rpcId = 1;
async function call(path, name, args, key = KEY) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (key) headers['x-api-key'] = key;
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: { ...args } } }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  const msg = JSON.parse(body);
  const r = msg.result || {};
  const text = (r.content || []).map((c) => c.text || '').join('\n');
  return { r, sc: r.structuredContent || {}, text, raw };
}

// Rows an answer carries, from either channel.
function rowCount(sc, text) {
  for (const src of [sc, (() => { try { return JSON.parse(text.split('\n\n')[0]); } catch { return {}; } })()]) {
    for (const k of ['data', 'facilities', 'results']) if (Array.isArray(src && src[k])) return src[k].length;
  }
  return -1;
}

const Q = { query: 'Ashburn', limit: 25 };

describe('_dailyQuotaOver — pure', () => {
  it('no daily block, or an allowed one, means no action', () => {
    expect(S._dailyQuotaOver(null, {})).toBeNull();
    expect(S._dailyQuotaOver({ allowed: true }, {})).toBeNull();
    expect(S._dailyQuotaOver(UNDER('identified', 50, 49), {})).toBeNull();
  });
  it('FAIL OPEN: only an explicit allowed:false acts — a malformed block does not', () => {
    // An older/degraded backend answer must never become a limit.
    expect(S._dailyQuotaOver({ daily: {} }, {})).toBeNull();
    expect(S._dailyQuotaOver({ daily: { allowed: null, used: 99, quota: 50 } }, {})).toBeNull();
    expect(S._dailyQuotaOver({ daily: { blocked: true } }, {})).toBeNull();
  });
  it('an over-limit daily decision is carried, with the backend message', () => {
    const d = S._dailyQuotaOver(OVER('identified', 50), { profile: undefined });
    expect(d).toMatchObject({ used: 50, quota: 50, tier: 'identified' });
    expect(d.message).toBe(MSG('identified', 50, 50));
  });
  it('/mcp/chatgpt (the directory profile) is exempt even when over', () => {
    expect(S._dailyQuotaOver(OVER('identified', 50), { profile: 'chatgpt_directory' })).toBeNull();
  });
});

describe('_quotaTtlMs — the daily half re-checks on its own clock', () => {
  it('a daily-blocked key re-checks within 30s (UTC rollover lands fast)', () => {
    expect(S._quotaTtlMs(OVER('identified', 50))).toBe(30_000);
  });
  it('the tighter remainder wins: 1 left today beats 1,450 left this month', () => {
    expect(S._quotaTtlMs(UNDER('identified', 50, 49))).toBe(10_000);
  });
  it('without a daily block the monthly TTL is unchanged', () => {
    expect(S._quotaTtlMs({ allowed: true, remaining: 5000 })).toBe(300_000);
    expect(S._quotaTtlMs({ allowed: true, remaining: null })).toBe(300_000);
  });
});

describe('/mcp — over the daily allowance serves previews, not a wall', () => {
  it('CONTROL: the identified 50th call (49 used) is served keyed, in full', async () => {
    S._setQuotaFetchImpl(async () => UNDER('identified', 50, 49));
    const { r, sc, text } = await call('/mcp', 'search_facilities', Q);
    expect(r.isError).not.toBe(true);
    expect((sc.identity || {}).daily_quota_reached).toBeUndefined();
    expect(text).not.toContain('Daily quota reached');
    expect(rowCount(sc, text)).toBeGreaterThan(3);
  }, 60_000);

  it('the identified 51st call (50 used) is served as a preview with the limit named', async () => {
    S._setQuotaFetchImpl(async () => OVER('identified', 50));
    const { r, sc, text } = await call('/mcp', 'search_facilities', Q);
    const dq = (sc.identity || {}).daily_quota_reached;
    expect(dq).toMatchObject({ used: 50, quota: 50, tier: 'identified', served_as: 'anonymous_preview' });
    expect(sc.identity.means).toBe(MSG('identified', 50, 50));
    expect(text).toContain(MSG('identified', 50, 50));
    expect(r.isError).not.toBe(true);                 // a preview, not a wall
    expect(sc.monthly_quota_exhausted).toBeUndefined();
    const n = rowCount(sc, text);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3);                  // anonymous depth
  }, 60_000);

  it('the Developer 501st call (500 used) is previews too; the 500th is full', async () => {
    validateTier = 'developer';
    S._setQuotaFetchImpl(async () => UNDER('developer', 500, 499));
    const under = await call('/mcp', 'search_facilities', Q);
    expect((under.sc.identity || {}).daily_quota_reached).toBeUndefined();
    expect(rowCount(under.sc, under.text)).toBeGreaterThan(3);
    S._dropQuotaCache(KEY);
    S._setQuotaFetchImpl(async () => OVER('developer', 500));
    const over = await call('/mcp', 'search_facilities', Q);
    expect((over.sc.identity || {}).daily_quota_reached).toMatchObject({ quota: 500, tier: 'developer' });
    expect(rowCount(over.sc, over.text)).toBeLessThanOrEqual(3);
  }, 60_000);

  it('an over-limit keyed call is never served LESS than an anonymous one', async () => {
    S._setQuotaFetchImpl(async () => OVER('identified', 50));
    const keyed = await call('/mcp', 'search_facilities', Q);
    const anon = await call('/mcp', 'search_facilities', Q, null);
    const k = rowCount(keyed.sc, keyed.text);
    expect(k).toBeGreaterThan(0);                      // a real preview, not an empty one
    expect(k).toBe(rowCount(anon.sc, anon.text));
  }, 60_000);

  it('the exempt tools (claim/bind/buy) are never touched by the daily limit', async () => {
    let asked = 0;
    S._setQuotaFetchImpl(async () => { asked += 1; return OVER('identified', 50); });
    const { sc } = await call('/mcp', 'why_dchub', {});
    expect((sc.identity || {}).daily_quota_reached).toBeUndefined();
    expect(asked).toBe(0);
  }, 60_000);
});

describe('/mcp/chatgpt — limits and behaviour unchanged (frz-chatgpt-toolset)', () => {
  it('an over-limit daily decision changes nothing on the directory profile', async () => {
    S._setQuotaFetchImpl(async () => UNDER('identified', 50, 49));
    const base = await call('/mcp/chatgpt', 'search', { query: 'Ashburn' });
    S._dropQuotaCache(KEY);
    S._setQuotaFetchImpl(async () => OVER('identified', 50));
    const over = await call('/mcp/chatgpt', 'search', { query: 'Ashburn' });
    expect(over.r.isError).toBe(base.r.isError);
    expect((over.sc.identity || {}).daily_quota_reached).toBeUndefined();
    expect(over.text).not.toContain('Daily quota reached');
    expect(rowCount(base.sc, base.text)).toBeGreaterThan(3);   // the keyed depth really is served there
    expect(rowCount(over.sc, over.text)).toBe(rowCount(base.sc, base.text));
    // Byte-for-byte apart from per-call ids/timestamps.
    const norm = (s) => s.replace(/"(request_id|as_of|retrieved_at|generated_at|served_at|timestamp|ts|call_id|trace_id)":"[^"]*"/g, '"$1":"_"')
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '_T_');
    expect(norm(over.text)).toBe(norm(base.text));
  }, 60_000);
});
