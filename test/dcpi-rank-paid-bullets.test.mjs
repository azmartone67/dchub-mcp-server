// dcpi-rank-paid-bullets.test.mjs — G-1016-04 (Grok, 2026-10-16).
//
// MEASURED (handler replay of the live houston / santa-clara DCPI rows, read
// 2026-10-16 18:5xZ with the read-only Pro key): a keyless and a free-key
// get_market_dcpi_rank masked every numeric sub-score (`_<k>_in_pro`) but served
// top_opportunities_json / top_risks_json verbatim, and those bullets carry the paid
// figures as prose: houston "578 MW behind-the-meter industrial headroom", "19641 MW
// additions queued <12mo", "36-month interconnection queue"; santa-clara "7564 MW
// additions queued <12mo". The backend lists both fields as paid on every surface
// (routes/dcpi.py _DCPI_MASK_FIELDS) but serves this server whole, and trimForTrial's
// masks are numeric, so string arrays fell through. rank_markets was clean on the same
// replay (total_mw nulled, "N MW" stripped from value).
//
// Owner 2026-10-08: grid / queue / market intel are preview-only on free.
//
// Real /mcp handler over loopback, 127.0.0.1 stub backend, off-loopback refused.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'test-internal-key-not-a-real-secret';
const HOUSTON = {"market_slug": "houston", "market_name": "Houston", "state": "TX", "iso": "ERCOT", "iso_type": "RTO", "verdict": "CAUTION", "composite_score": 49.2, "excess_power_score": 65.8, "constraint_score": 51.9, "time_to_power_months": 36.3, "queue_capacity_mw": 458206.6, "gen_additions_12mo_mw": 19641.1, "stranded_capacity_mw": null, "queue_wait_months": 36.3, "reserve_margin_pct": 19.5, "avg_kwh_cents": "10.309", "signal_tier": "full", "computed_at": "2026-10-16T18:47:00.155404+00:00", "published": true, "top_risks_json": ["36-month interconnection queue"], "top_opportunities_json": ["578 MW behind-the-meter industrial headroom", "19641 MW additions queued <12mo"]};
const SANTA_CLARA = {"market_slug": "santa-clara", "market_name": "Santa Clara", "state": "CA", "iso": "CAISO", "iso_type": "RTO", "verdict": "CAUTION", "composite_score": 47.7, "excess_power_score": 67.8, "constraint_score": 55.3, "time_to_power_months": 48.0, "queue_capacity_mw": 57764.3, "gen_additions_12mo_mw": 7564.6, "stranded_capacity_mw": null, "queue_wait_months": 48.0, "reserve_margin_pct": 18.4, "avg_kwh_cents": "28.283", "signal_tier": "full", "computed_at": "2026-10-16T18:46:48.935941+00:00", "published": true, "top_risks_json": ["48-month interconnection queue"], "top_opportunities_json": ["~9.0% renewable curtailment (modeled regional estimate, not a measurement) \u2014 spilled output a behind-the-meter load could use", "7564 MW additions queued <12mo"]};
// Fixture keys: test values only.
const FREE_KEY = 'dch_live_dcpibullets000000000001';
const PRO_KEY = 'dchub_pro_dcpibullets00000000001';
const VALIDATE = {
  [FREE_KEY]: { valid: true, tier: 'free', developer_id: 'd_free_b', email: null },
  [PRO_KEY]: { valid: true, tier: 'pro', developer_id: 'd_pro_b', email: 'pro@example.com', tier_detail: { users_plan: 'pro' } },
};
// The paid figures, as they appear inside the bullets.
const LEAKS = {
  houston: ['578 MW', '19641 MW', '36-month interconnection queue'],
  'santa-clara': ['7564 MW', '9.0% renewable curtailment', '48-month interconnection queue'],
};

let S, PORT, httpServer, stub, prevBase, prevSecret, prevFlag, prevIsError;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') { let b=''; for await (const c of req) b+=c; const k=(JSON.parse(b||'{}').api_key)||''; return send(VALIDATE[k] || { valid: false, tier: 'free' }); }
      if (p === '/api/v1/keys/auto-mint') return send({ ok: false });
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/dcpi/scores/houston') return send(HOUSTON);
      if (p === '/api/v1/dcpi/scores/santa-clara') return send(SANTA_CLARA);
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevFlag = process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
  delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;   // default ON: the taste path
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY', prevFlag);
  restore('DCHUB_PREVIEW_ISERROR', prevIsError);
  restore('DCHUB_INTERNAL_KEY', prevSecret);
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  restore('DCHUB_API_BASE', prevBase);
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}

let ipN = 120;
async function anonCall(name, args, key) {
  const h0 = { 'x-forwarded-for': `203.0.113.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  return { result, sc: result.structuredContent || {}, text: (result.content || []).map((c) => c.text || '').join('\n') };
}

describe('G-1016-04: get_market_dcpi_rank free previews withhold the paid DCPI bullets', () => {
  for (const [seat, key] of [['anonymous', null], ['free key', FREE_KEY]]) {
    for (const slug of ['houston', 'santa-clara']) {
      it(`${slug} / ${seat}: no paid figure from the bullets anywhere in the result`, async () => {
        const { result, sc, text } = await anonCall('get_market_dcpi_rank', { market_slug: slug }, key);
        const all = JSON.stringify(result);
        for (const frag of LEAKS[slug]) expect(all, `leaked "${frag}"\n${text.slice(0, 400)}`).not.toContain(frag);
        expect(sc.top_opportunities_json).toBeNull();
        expect(sc.top_risks_json).toBeNull();
        expect(sc._top_opportunities_json_in_pro).toBe(true);
        expect(sc._top_risks_json_in_pro).toBe(true);
        // the free surface the owner kept: verdict + composite, unchanged
        expect(sc.verdict).toBe('CAUTION');
        expect(typeof sc.composite_score).toBe('number');
      });
    }
  }

  it('control: a Pro key keeps the bullets (the fixture carries them; the gate is what moved)', async () => {
    const { sc } = await anonCall('get_market_dcpi_rank', { market_slug: 'houston' }, PRO_KEY);
    expect(sc.top_opportunities_json).toEqual(HOUSTON.top_opportunities_json);
    expect(sc.top_risks_json).toEqual(HOUSTON.top_risks_json);
  });

  // The keyless trimmer is the one every OTHER tool's free preview goes through
  // (_gateToolNumerics, the keyed-free mask, covers three tool shapes only), and the
  // backend emits these bullets on more routes than /dcpi/scores (site_brief,
  // dcpi_explain, open_data). So trimForTrial must withhold them on its own.
  it('trimForTrial alone withholds the bullets, on any tool, and leaves an empty list alone', () => {
    const t = S.trimForTrial({ market_slug: 'houston', verdict: 'CAUTION',
      top_opportunities_json: HOUSTON.top_opportunities_json, top_risks_json: [] }, 'get_dchub_recommendation');
    expect(t.top_opportunities_json).toBeNull();
    expect(t._top_opportunities_json_in_pro).toBe(true);
    expect(t.top_risks_json).toEqual([]);
    expect(t._top_risks_json_in_pro).toBeUndefined();
    expect(JSON.stringify(t)).not.toContain('19641 MW');
  });

  it('made no off-loopback connection', () => {
    expect(foreign).toEqual([]);
  });
});
