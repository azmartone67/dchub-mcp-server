/**
 * Grok 2026-10-09 (gate-more plan, item 1) — two keyless prose leaks, measured live.
 *
 * Probed dchub.cloud/mcp 2026-10-09 with a real initialize handshake, no key, from an
 * IP over the anonymous daily cap (`_upgrade.tier` came back 'anon_daily_cap'):
 *
 *   get_market_context market=dallas
 *     tier "full", sections hero/grid/outlook (3 of 8), hero text:
 *     "Dallas (TX, ERCOT) — DCPI verdict: CAUTION. DCPI scores: excess-power 65.8/100,
 *      constraint 54.7/100 …", grid text: "pending/active/study queue 463,402 MW …",
 *     plus the 2.8k-char outlook. The same seat's get_market_dcpi_rank masked
 *     excess_power_score / constraint_score as `_*_in_pro`.
 *     Cause: the over-cap branch ran _capTrim → trimForTrial, which keeps prose. The
 *     under-cap anon path uses the backend's server-built `_free_preview` instead.
 *
 *   get_dchub_recommendation context=site-selection
 *     top_pocket.score null + `_score_in_pro`, time-to-power masked, yet
 *     top_pocket.why = "DCPI verdict: BUILD; strong excess capacity (86); fast TTP (9mo)".
 *
 * Pure-local: a stub backend on 127.0.0.1. No prod, no network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';

let srv, base, usageCount = 0, contextHits = 0;

const HERO_FULL = 'Dallas (TX, ERCOT) — DCPI verdict: CAUTION. DCPI scores: excess-power 65.8/100, constraint 54.7/100. At a glance: 233 tracked facilities; 5,941 MW operational.';
const GRID_FULL = 'Grid: ERCOT. Power & grid: interconnection queue capacity 482,963 MW; pending/active/study queue 463,402 MW; reserve margin 19.5%.';
const OUTLOOK_FULL = '# Dallas Data Center Market Analysis\n\nDallas hosts 392 tracked facilities totaling 7,067 MW …';
const HERO_FREE = 'Dallas (TX, ERCOT) — DCPI verdict: CAUTION. At a glance: 233 tracked facilities.';
const CONTEXT_BODY = {
  ok: true, market: 'dallas', iso: 'ERCOT', name: 'Dallas', tier: 'full', max_tokens: 4000, used_tokens: 3100,
  sections: [
    { id: 'hero', title: 'Headline', text: HERO_FULL, tokens: 60 },
    { id: 'grid', title: 'Power & grid', text: GRID_FULL, tokens: 45 },
    { id: 'outlook', title: '12-month outlook', text: OUTLOOK_FULL, tokens: 700 },
    { id: 'deals', title: 'M&A', text: 'deals …', tokens: 300 },
  ],
  _free_preview: {
    used_tokens: 120,
    sections: [{ id: 'hero', title: 'Headline', text: HERO_FREE, tokens: 30 },
               { id: 'news', title: 'Top news', text: 'One headline.', tokens: 20 }],
    locked_sections: ['grid', 'outlook', 'deals'],
  },
  _cite: 'DC Hub (dchub.cloud)',
};

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const send = (body) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (path === '/api/v1/mcp/anon-usage') return send({ ok: true, count: usageCount });
    if (path.startsWith('/api/v1/context/market/')) { contextHits += 1; return send(CONTEXT_BODY); }
    return send({ ok: true });                  // telemetry / heartbeat
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => srv && srv.close());
beforeEach(() => { usageCount = 0; contextHits = 0; });

async function freshServer({ cap, mult = 10 }) {
  vi.resetModules();
  process.env.DCHUB_API_BASE = base;
  process.env.DCHUB_ANON_DAILY_CAP = String(cap);
  process.env.DCHUB_ANON_HARD_WALL_MULT = String(mult);
  const m = await import('../server.mjs');
  m._anonUsageCounts.clear();
  m._readDeadline.signal = () => AbortSignal.timeout(120_000);   // see cap-trim-spares-capacity-teaser
  return m;
}

const ANON_SEAT = {
  api_key: null, tier: 'free', platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '198.51.100.23', session_id: 'sess-overcap-prose',
};

async function callAnon(m, name, args = {}) {
  const T = m.createServer()._registeredTools[name];
  if (!T) throw new Error(`${name} not registered`);
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  const res = await m._ctxALS.run({ ...ANON_SEAT }, () =>
    T.handler(parsed.data, { signal: new AbortController().signal }));
  const text = (res.content || []).map((c) => c.text || '').join('\n');
  let body = null;
  try { body = JSON.parse(text); } catch { /* prose */ }
  return { res, body: res.structuredContent || body, text };
}

const LEAKS = ['65.8', '54.7', '463,402', '482,963', 'Market Analysis'];

describe('over-cap keyless get_market_context gets the server-built free shape', () => {
  it('fires the cap branch and ships only the _free_preview sections', async () => {
    usageCount = 50;                             // >= cap 30, < the 10x wall
    const m = await freshServer({ cap: 30 });
    const { body, text } = await callAnon(m, 'get_market_context', { market: 'dallas' });

    // ★ the branch under test ran, else every assertion below is vacuous
    expect(body?._upgrade?.tier, 'the anon_daily_cap branch did not fire').toBe('anon_daily_cap');
    expect(contextHits, 'the handler never reached the stub backend').toBeGreaterThan(0);

    expect(body.tier).toBe('free');
    expect(body.sections.map((s) => s.id)).toEqual(['hero', 'news']);
    expect(body.locked_sections).toEqual(['grid', 'outlook', 'deals']);
    expect(body._sections_total_in_developer).toBe(4);
    const wire = JSON.stringify(body) + text;
    for (const leak of LEAKS) expect(wire, `over-cap wire still carries ${leak}`).not.toContain(leak);
  });

  it('control: a payload with no _free_preview still goes through the generic trim', async () => {
    const m = await freshServer({ cap: 30 });
    expect(m._contextPackFreeShape('get_market_context', { sections: [] })).toBeNull();
    expect(m._contextPackFreeShape('get_market_intel', CONTEXT_BODY)).toBeNull();
    const t = m._capTrim({ ok: true, total_mw: 900 }, 'get_market_context');
    expect(t.total_mw).toBeNull();               // the old trim, untouched
  });
});

describe('a trimmed `why` loses its figures, keeps its words', () => {
  it('strips the score and TTP the sibling fields mask', async () => {
    const m = await freshServer({ cap: 0 });
    const out = m.trimForTrial({
      top_pocket: { market: 'Midland–Odessa', score: 86.2, verdict: 'BUILD',
        why: 'DCPI verdict: BUILD; strong excess capacity (86); fast TTP (9mo)' },
    }, 'get_dchub_recommendation');
    expect(out.top_pocket.why).toBe('DCPI verdict: BUILD; strong excess capacity; fast TTP');
    expect(out.top_pocket.verdict).toBe('BUILD');
  });

  it('covers the other figure shapes and leaves instructional whys alone', async () => {
    const m = await freshServer({ cap: 0 });
    expect(m._stripWhyFigures('tight grid (65.8/100); slow TTP (36 mo); queue (1,200 MW); (~12mo)'))
      .toBe('tight grid; slow TTP; queue;');
    const handoff = 'Next session, pull only the delta (DCPI 7-day market movers, new listings)';
    expect(m._stripWhyFigures(handoff)).toBe(handoff);
    const water = 'Standalone water-basin stress for the site';
    expect(m._stripWhyFigures(water)).toBe(water);
  });
});
