// planner-528-e2e.test.mjs — planner 5.28 on a real server.mjs with a stub backend (owner wave 2, 2026-11-14).
//
// B1: Sweetwater, TX (no DC Hub market): the air-permit step runs at the geocoded point, `geocoded` says so.
// B2: Reno on /mcp/chatgpt: the CAISO-only queue read says Reno is on NV Energy's grid (WECC).
// B9: a stateless call with a non-token Mcp-Session-Id never puts that header into a redeem_url.
// D1: a slow get_grid_scoreboard step ends at 5 s inside a plan; provenance is carried once per plan.
// Pure-function tests: test/planner-528-named-towns.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.28' };
const SCOREBOARD_DELAY_MS = 9000;
let H, fence;
const geocodeHits = [];
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
const steps = (o) => JSON.stringify(o.executed.map((e) => [e.tool, e.status, e.args, e.ms]));

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, body, u) => {
    if (p === '/api/v1/geocode') {
      geocodeHits.push(u.searchParams.get('address'));
      if (/^Sweetwater, TX$/.test(u.searchParams.get('address') || '')) {
        return { lat: 32.4706123, lng: -100.4073812, label: 'Sweetwater, Texas', source: 'arcgis' };
      }
      return { status: 404, body: { error: 'not found' } };
    }
    if (p === '/api/v1/interconnection-queue/refined') {
      return { _entity: 'queue_results', count: 1, results: [{ project_name: 'Solar 1', iso: 'CAISO', mw: 250, state: 'NV' }],
        freshness_by_iso: { CAISO: { as_of: '2026-11-13' } } };
    }
    // Every grid feed the scoreboard fans out to answers late.
    if (p.startsWith('/api/v1/iso/') || p.startsWith('/api/v1/grid/extended/')) {
      await new Promise((r) => setTimeout(r, SCOREBOARD_DELAY_MS));
      return undefined;
    }
    return undefined;
  } });
}, 240_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
}, 60_000);

describe('execute_plan 5.28 (real server.mjs on loopback)', () => {
  it('B1: Sweetwater TX air permits: get_air_permit_context runs at the geocoded point, and `geocoded` says where it came from', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Behind-the-meter gas generation near Sweetwater TX: what air permits apply?' }, PRO));
    expect(o.planner_version).toBe('5.54');
    const air = o.executed.find((e) => e.tool === 'get_air_permit_context');
    expect(air, steps(o)).toBeTruthy();
    expect(air.status, steps(o)).not.toBe('skipped_unresolved');
    expect(air.args, steps(o)).toMatchObject({ lat: 32.47061, lon: -100.40738 });
    expect(geocodeHits).toContain('Sweetwater, TX');
    expect(H.hits.some((h) => h.path === '/api/v1/air-permit-context')).toBe(true);
    expect(o.geocoded && o.geocoded[0]).toMatchObject({ query: 'Sweetwater, TX', lat: 32.47061, lon: -100.40738, label: 'Sweetwater, Texas' });
    expect(o.executed.find((e) => e.tool === 'get_power_availability_timeline'), steps(o)).toBeTruthy();
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('B2: Reno on /mcp/chatgpt: the CAISO-only queue read names NV Energy\'s grid (WECC)', async () => {
    const r = await H.call('/mcp/chatgpt', 'execute_plan',
      { intent: 'I need 200 MW in Reno within 24 months. Can I get power there in time, and what are faster alternatives?' },
      { 'user-agent': 'openai-mcp/1.0', 'x-dc-client-ip': '203.0.113.29' });
    const o = sc(r);
    const all = JSON.stringify(r.msg.result);
    expect(all, steps(o)).toMatch(/Reno is on NV Energy's grid \(WECC\), not CAISO/);
  }, 120_000);

  it('B9: a non-token Mcp-Session-Id never reaches a redeem_url; a uuid one still works', async () => {
    const REDEEM_OK = /^https:\/\/dchub\.cloud\/api\/v1\/redeem\/[A-Za-z0-9][A-Za-z0-9._~:-]*$/;
    const collect = (node, out) => {
      if (typeof node === 'string') {
        for (const m of node.matchAll(/https?:\/\/[^\s"'<>]*\/api\/v1\/redeem\/[^"'<>\n]*/g)) out.push(m[0]);
        return;
      }
      if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) {
        if (k === 'redeem_url' && typeof v === 'string') out.push(v);
        else collect(v, out);
      }
    };
    let seen = 0;
    for (const sid of ['Content-Type, Mcp-Session-Id, X-API-Key', 'not a token', '3f2b6c1e-8a4d-4f7a-9d2e-0b1c2d3e4f5a']) {
      for (const [tool, args] of [['execute_plan', { intent: 'rank markets for a 200 MW AI campus' }], ['rank_markets', {}]]) {
        const r = await H.call('/mcp', tool, args, { 'user-agent': 'Mozilla/5.0 test', 'x-dc-client-ip': '198.51.100.7', 'mcp-session-id': sid });
        const urls = [];
        collect(r.msg && r.msg.result, urls);
        for (const c of (r.msg && r.msg.result && r.msg.result.content) || []) { try { collect(JSON.parse(c.text), urls); } catch (_) { /* prose */ } }
        for (const u of urls) {
          // redeem_url is a token path, a signed upgrade link, a short link or the signup page; never a header list
          expect(REDEEM_OK.test(u) || /^https:\/\/dchub\.cloud\/(?:upgrade\/h\/[A-Za-z0-9._~-]+|u\/[A-Za-z0-9]+|signup)$/.test(u), `${sid} ${tool}: ${u}`).toBe(true);
          expect(u).not.toMatch(/Content-Type|Mcp-Session-Id|\s/);
        }
        seen += urls.length;
      }
    }
    expect(seen, 'control: the keyless walled answers carry redeem_url').toBeGreaterThan(0);
  }, 180_000);

  it('D1: a slow scoreboard step ends at ~5 s inside a plan, and the plan answers well before the feed does', async () => {
    const t0 = Date.now();
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'which US grid has the most headroom for a 300 MW data center' }, PRO));
    const ms = Date.now() - t0;
    const sb = o.executed.find((e) => e.tool === 'get_grid_scoreboard');
    expect(sb, steps(o)).toBeTruthy();
    expect(sb.status, steps(o)).toBe('timed_out');
    expect(sb.ms, steps(o)).toBeLessThan(6500);
    expect(ms, steps(o)).toBeLessThan(SCOREBOARD_DELAY_MS - 1000);
  }, 120_000);
});

describe('D1: provenance once per plan, on a caller (session) answer', () => {
  let ipN = 60;
  async function callAs(headers, name, args) {
    const h0 = { 'x-forwarded-for': `203.0.113.${ipN++}`, 'user-agent': 'test-client', ...headers };
    const init = await H.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } }, h0);
    const sid = init.headers.get('mcp-session-id');
    expect(sid, 'control: a session').toBeTruthy();
    const h = { ...h0, 'mcp-session-id': sid };
    await H.post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
    return H.post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, h);
  }
  const INTENT = 'water risk and tax incentives for a data center in Phoenix';
  const prev = process.env.DCHUB_PLAN_PROVENANCE_ONCE;
  afterAll(() => { if (prev === undefined) delete process.env.DCHUB_PLAN_PROVENANCE_ONCE; else process.env.DCHUB_PLAN_PROVENANCE_ONCE = prev; });

  it('steps point at the plan\'s provenance layers; the answer is smaller and every step keeps its data', async () => {
    process.env.DCHUB_PLAN_PROVENANCE_ONCE = '0';
    const offR = await callAs({ 'x-api-key': PRO_KEY }, 'execute_plan', { intent: INTENT });
    process.env.DCHUB_PLAN_PROVENANCE_ONCE = '1';
    const onR = await callAs({ 'x-api-key': PRO_KEY }, 'execute_plan', { intent: INTENT });
    const off = sc(offR), on = sc(onR);
    expect(on.executed.map((e) => [e.tool, e.status])).toEqual(off.executed.map((e) => [e.tool, e.status]));
    const layered = on.executed.map((e, i) => [e, i]).filter(([e, i]) => e.result && e.result.provenance
      && on.provenance.evidence.layers.some((l) => l.step_index === i));
    expect(layered.length, steps(on)).toBeGreaterThan(0);
    for (const [e, i] of layered) {
      expect(e.result.provenance.see).toMatch(new RegExp(`step_index=${i}`));
      expect(e.result.provenance.evidence).toBeUndefined();
      // every non-provenance key of the step is still there with the same value (identity/quota/next_session aside)
      const o = off.executed[i].result;
      // per-session signed links differ between the two sessions; everything else is byte-equal
      const norm = (v) => JSON.stringify(v === undefined ? null : v).replace(/\/(?:upgrade\/h|u|api\/v1\/redeem)\/[A-Za-z0-9._~:-]+/g, '/<link>');
      for (const k of Object.keys(o)) {
        if (['provenance', 'identity', 'quota', 'citation', 'next_session'].includes(k)) continue;
        expect(norm(e.result[k]), `${e.tool}.${k}`).toBe(norm(o[k]));
      }
    }
    // Size pins (D1). Measured on this fixture 2026-11-14: wire 59,305 -> 49,452 bytes, structuredContent
    // 28,654 -> 23,793, a step's provenance 2,110 -> 137 bytes.
    const bytes = (r) => Buffer.byteLength(r.raw);
    expect(bytes(onR)).toBeLessThan(bytes(offR) * 0.9);
    expect(Buffer.byteLength(JSON.stringify(on))).toBeLessThan(26_000);
    for (const [e] of layered) expect(Buffer.byteLength(JSON.stringify(e.result.provenance)), e.tool).toBeLessThan(400);
  }, 120_000);
});
