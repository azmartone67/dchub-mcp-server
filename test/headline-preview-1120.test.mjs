// Headline before the wall (owner-approved relay 2026-11-20; lib/headline-preview.mjs, DCHUB_WALL_IDENTITY_V2).
//
// Measured on main before the change, through this harness and on live keyless /mcp: the grid wall already carries
// its headline (demand MW at its EIA hour, fuel-mix share at its hour, source, dated cite_as); the queue wall for a
// live-feed ISO carries the GW figure with as_of null and no collection time; the all-ISO queue wall nulls the US
// total; execute_plan's facts carry each step's headline, the live-feed queue fact undated.
//
// Pins, over the real server.mjs app on loopback with a stub backend (no network), every call read as an outside peer:
//   * flag ON, keyless / trial key / over the soft cap: the live-feed queue headline carries collected_at (the
//     backend's own last_refreshed), as_of stays null, cite_as says "collected"; the all-ISO wall carries a taste with
//     the backend's US total and date, totals.queued_generation_gw restored; detail rows stay withheld;
//     execute_plan's queue fact says "collected <date>";
//   * flag ON leaves alone what already had its headline: the grid wall and a report-dated queue (ERCOT);
//   * flag ON changes nothing on /mcp/chatgpt, a ChatGPT-identified client or /mcp/core, nor for a paid key;
//   * the keyless key-path entry (#1594) still rides once per session;
//   * flag OFF is origin/main byte for byte on all four walls (git-ref sandbox);
//   * every response stays under the answer budget; no price, plan name or allowance number in the new strings.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import * as HP from '../lib/headline-preview.mjs';
import { ANSWER_BUDGET_DEFAULT_BYTES } from '../lib/answer-shape.mjs';
import { CORE_PROFILE } from '../lib/core-profile.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';

// The wall a caller meets after its first full answer of the day (lib/keyless-first-full.mjs).
process.env.DCHUB_KEYLESS_FIRST_FULL = '0';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FLAG = HP.HEADLINE_PREVIEW_FLAG;
const TRIAL = 'dch_trial_headlinePREVIEWkey0000001';
const FREE = 'dch_live_headlinePREVIEWfree000001';   // a free key, no email, not a trial: not this change's seat
const FORBIDDEN = /\b(paid|upgrade|trial|plans?|pricing|price|\$\s?\d|per month|subscription|credits?|calls? a day|per day|Pro|Developer|Enterprise|allowance)\b/i;

// ── backend fixtures: live shapes (2026-11-20 keyless reads), every figure present ──
const GI = {
  demand_mw: 95021, demand_period: '2026-10-07T23', generation_mix_period: '2026-10-07T03',
  generation_mix: { COL: { mw: 13136 }, NG: { mw: 33582 }, NUC: { mw: 27692 }, WAT: { mw: 1517 }, WND: { mw: 5943 } },
  peak_mw: 95021, min_mw: 74723, load_factor: 0.786,
  demand_24h: Array.from({ length: 22 }, (_, i) => ({ period: `2026-10-07T${String(i + 1).padStart(2, '0')}`, mw: 80000 + i * 500 })),
};
const CMP = { isos: [{ iso: 'PJM', iso_name: 'PJM Interconnection', avg_constraint: 49.2, avg_excess: 28.8,
  avg_time_to_power_months: 30.3, avg_queue_wait_months: 30.4, market_count: 64, build_count: 0, latest_computed_at: '2026-10-07T18:34:37Z' }] };
const PJM_COLLECTED = '2026-10-07T09:30:57.890678+00:00';
const QUEUE = {
  PJM: { iso: 'PJM', as_of: null, queued_generation_gw: 373.4, queue_kind: 'generation_queue', last_refreshed: PJM_COLLECTED,
    refresh_cadence: 'daily', source_as_of: '2026-10-07', source_as_of_basis: 'live_feed_fetch_date',
    source_url: 'https://www.pjm.com/planning/m/cycle-service-request-status', source_name: 'PJM cycle + serial service request status',
    v: 'published', project_count: 1239, queued_load_data_center_gw: 40.2, historical_completion_pct: 18.5,
    projects: Array.from({ length: 25 }, (_, i) => ({ queue_id: `AG1-${100 + i}`, project_name: `Project ${i}`, capacity_mw: 100 + i, state: 'VA' })) },
  ERCOT: { iso: 'ERCOT', as_of: '2026-10-07', queued_generation_gw: 461.4, queued_generation_gw_as_of: '2026-09-30',
    refresh_cadence: 'monthly', last_refreshed: '2026-10-07T09:30:48Z', source_as_of: '2026-09-30',
    source_url: 'https://www.ercot.com/gis', source_name: 'ERCOT GIS Report', v: 'published', project_count: 1766,
    projects: Array.from({ length: 25 }, (_, i) => ({ queue_id: `E-${i}`, project_name: `ERCOT ${i}`, capacity_mw: 50 + i, state: 'TX' })) },
};
const US_TOTAL = 2290.7;
const QSNAP = {
  as_of: '2026-10-07', iso_count: 2,
  totals: { queued_generation_gw: US_TOTAL, queued_generation_gw_scope: 'US ISOs only, 7 ISOs, active only: generation requests' },
  freshness: { latest_as_of: '2026-10-07', fresh_iso_count: 6, stale_iso_count: 1 },
  by_iso: [{ iso: 'PJM', queued_generation_gw: 373.4, as_of: null, last_refreshed: PJM_COLLECTED },
    { iso: 'ERCOT', queued_generation_gw: 461.4, queued_generation_gw_as_of: '2026-09-30', as_of: '2026-10-07' }],
  projects: { tracked: true, total: 6061, by_iso_count: { PJM: 1239, ERCOT: 1766 },
    top: [{ iso: 'PJM', project_name: 'Secret Solar', queue_id: 'AG1-1', capacity_mw: 300, state: 'PA' }] },
  provenance: { source: 'US ISO public interconnection queues (ERCOT GIS / PJM NSQ / MISO GI / SPP / CAISO / NYISO / ISO-NE)' },
  source: 'https://dchub.cloud/interconnection-queues',
};

// ── the server sees this file's own sockets as an outside peer (not an execute_plan loopback step) ──
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
net.Socket.prototype._getpeername = function _getpeername() {
  const p = _peer.call(this);
  if (this.server && SERVER_PORTS.has(this.localPort) && p && p.address && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.9' };
  return p;
};
function rpc(port, pathName, headers, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathName, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (ch) => { raw += ch; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ msg, bytes: Buffer.byteLength(b) });
      });
    });
    req.on('socket', (sock) => {
      const note = () => { const lp = sock.localPort; CLIENT_PORTS.add(lp); sock.once('close', () => CLIENT_PORTS.delete(lp)); };
      if (sock.localPort) note(); else sock.once('connect', note);
    });
    req.on('error', reject);
    req.end(data);
  });
}

const anonCounts = {};
const routes = (p, req, body, u) => {
  if (p === '/api/v1/mcp/anon-usage') return { count: anonCounts[u.searchParams.get('ip')] || 0 };
  if (p === '/api/v1/keys/validate' && body && body.api_key === FREE) return { valid: true, tier: 'free', developer_id: 'd_free_hp', email: null };
  if (p === '/api/v1/keys/validate' && body && body.api_key === TRIAL) return { valid: true, tier: 'free', developer_id: null, email: null, source: 'auto_trial' };
  if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
  if (p.startsWith('/api/v1/grid/intelligence/')) return GI;
  if (p === '/api/v1/dcpi/iso-comparison') return CMP;
  if (p === '/api/v1/interconnection-queue/snapshot') return QSNAP;
  if (p === '/api/v1/interconnection-queue/by-iso') return QUEUE[String(u.searchParams.get('iso') || 'PJM').toUpperCase()] || QUEUE.PJM;
  if (p.startsWith('/api/v1/grid/extended/')) return { available: false };
  return undefined;
};

let H, O, SB, fence, why = '';
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ env: { DCHUB_ANON_DAILY_CAP: '20' }, extraRoutes: routes });
  SERVER_PORTS.add(H.PORT);
  SB = createGitRefSandbox(REPO, 'origin/main', 'headline-preview-origin-main');
  if (!SB) why = 'origin/main is not available in this clone';
  else {
    O = await startHarness({ env: { DCHUB_ANON_DAILY_CAP: '20' }, extraRoutes: routes, serverUrl: pathToFileURL(path.join(SB.root, 'server.mjs')).href });
    SERVER_PORTS.add(O.PORT);
  }
}, 180_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (O) await O.stop();
  if (H) await H.stop();
  if (SB) SB.cleanup();
  if (fence) fence.restore();
});
afterEach(() => { delete process.env[FLAG]; });

let n = 0;
async function call(srv, tool, args, { path: p = '/mcp', key, ua = 'Claude-User', anon = 0, sid } = {}) {
  n += 1;
  const ip = `198.51.${100 + Math.floor(n / 250)}.${(n % 250) + 1}`;
  anonCounts[ip] = anon;
  const h = { 'user-agent': ua, 'mcp-session-id': sid || `hp-${Date.now()}-${n}`, 'x-dc-client-ip': ip };
  if (key) h['x-api-key'] = key;
  return rpc(srv.PORT, p, h, { jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: tool, arguments: args } });
}
const res = (r) => (r.msg && r.msg.result) || {};
const json0 = (r) => {
  const c = res(r).content || [];
  for (const b of c) { if (b && typeof b.text === 'string' && /^\s*\{/.test(b.text)) { try { return JSON.parse(b.text); } catch (_) { /* next */ } } }
  return res(r).structuredContent || {};
};
const prose = (r) => (res(r).content || []).map((b) => (b && b.text) || '').join('\n');
// What differs between two runs of one call by design: relay tokens, timestamps, ids, timings.
const norm = (r) => JSON.stringify(r && r.msg)
  .replace(/https:\/\/dchub\.cloud\/(upgrade\/h\/[A-Za-z0-9_.-]+|u\/[A-Za-z0-9]+)(?:\?[^"\s\\]*)?/g, 'RELAY')
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'TS')
  .replace(/pr1\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g, 'RERUN')
  .replace(/(\\?")(ms|elapsed_ms|duration_ms|took_ms|latency_ms|wall_ms)(\\?"):\d+/g, '$1$2$3:0')
  .replace(/(plan|req|sess|run|rp|hp)[-_][A-Za-z0-9-]{6,}/g, '$1-ID')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
  .replace(/("id":)\d+/g, '$1N');
const PLAN = { intent: 'how soon can a 100 MW load get power in PJM' };
const queueFact = (r) => (json0(r).facts || []).find((f) => f && f.tool === 'get_interconnection_queue');

describe('lib/headline-preview.mjs', () => {
  it('the switch reads 1/true/yes/on only, off by default', () => {
    for (const v of ['1', 'true', 'YES', 'on']) expect(HP.headlinePreviewOn({ [FLAG]: v })).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'off', 'no', 'enabled']) expect(HP.headlinePreviewOn({ [FLAG]: v })).toBe(false);
  });
  it('stamps a live-feed queue headline with the backend collection time; a dated one is left alone', () => {
    const env = { taste: { headline: { name: 'queued_generation_gw', value: 373.4, as_of: null }, source: { as_of: null }, cite_as: 'DC Hub (dchub.cloud)' } };
    expect(HP.stampQueueCollected(env, { last_refreshed: PJM_COLLECTED })).toBe(true);
    expect(env.taste.headline).toMatchObject({ as_of: null, collected_at: PJM_COLLECTED, as_of_basis: HP.COLLECTED_BASIS });
    expect(env.taste.source.collected_at).toBe(PJM_COLLECTED);
    expect(env.taste.cite_as).toBe('DC Hub (dchub.cloud), collected 2026-10-07');
    const dated = { taste: { headline: { value: 461.4, as_of: '2026-09-30' }, cite_as: 'x' } };
    expect(HP.stampQueueCollected(dated, { last_refreshed: PJM_COLLECTED })).toBe(false);
    expect(dated.taste).toEqual({ headline: { value: 461.4, as_of: '2026-09-30' }, cite_as: 'x' });
    expect(HP.stampQueueCollected({ taste: { headline: { value: 1, as_of: null } } }, {})).toBe(false);   // nothing to cite: no stamp
  });
  it('the snapshot taste is read from the snapshot only; no total, no taste', () => {
    const t = HP.queueSnapshotTaste(QSNAP);
    expect(t.headline).toMatchObject({ name: 'queued_generation_gw', value: US_TOTAL, unit: 'GW', as_of: '2026-10-07' });
    expect(t.headline.as_of_basis).toMatch(/6 of 7 ISOs/);
    expect(t.project_count.value).toBe(6061);
    expect(t.source.name).toBe(QSNAP.provenance.source);
    expect(t.cite_as).toBe('DC Hub (dchub.cloud), as of 2026-10-07');
    expect(HP.queueSnapshotTaste({ ...QSNAP, totals: { queued_generation_gw: null } })).toBeNull();
    expect(HP.queueSnapshotTaste({ totals: { queued_generation_gw: 5 } })).toBeNull();   // not the snapshot shape
    const out = HP.attachHeadlinePreview('get_interconnection_queue', QSNAP, { totals: { queued_generation_gw: null, _queued_generation_gw_withheld: true } });
    expect(out.totals).toEqual({ queued_generation_gw: US_TOTAL });
    expect(HP.attachHeadlinePreview('get_grid_intelligence', QSNAP, { a: 1 })).toEqual({ a: 1 });
  });
  it('names no price, plan or allowance', () => {
    const t = HP.queueSnapshotTaste(QSNAP);
    for (const s of [HP.COLLECTED_BASIS, HP.SNAPSHOT_WINDOW, t.headline.as_of_basis, t.project_count.basis]) expect(s).not.toMatch(FORBIDDEN);
  });
});

describe('flag on: the headline reaches the wall', () => {
  it('queue, live-feed ISO: collected_at from the backend, as_of null, cite_as and the answer line say "collected"; rows withheld', async () => {
    process.env[FLAG] = '1';
    const r = await call(H, 'get_interconnection_queue', { iso: 'PJM' });
    const b = json0(r);
    expect(b.taste.headline).toMatchObject({ value: 373.4, as_of: null, collected_at: PJM_COLLECTED, as_of_basis: HP.COLLECTED_BASIS });
    expect(b.taste.project_count.value).toBe(1239);
    expect(b.taste.source).toMatchObject({ url: QUEUE.PJM.source_url, collected_at: PJM_COLLECTED });
    expect(b.taste.cite_as).toBe('DC Hub (dchub.cloud), collected 2026-10-07');
    expect(b.projects).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain('Project 0');
    expect(prose(r)).toContain('PJM queued generation 373.4 GW (generation interconnection queue (requested generation; not load), collected 2026-10-07)');
    expect(r.bytes).toBeLessThan(ANSWER_BUDGET_DEFAULT_BYTES);
  });
  for (const [label, opts] of [['keyless', {}], ['trial key', { key: TRIAL }], ['over the soft cap', { anon: 25 }]]) {
    it(`all-ISO queue, ${label}: the backend's US total with its date and source; detail rows still withheld`, async () => {
      process.env[FLAG] = '1';
      const r = await call(H, 'get_interconnection_queue', {}, opts);
      const b = json0(r);
      expect(b.taste.headline).toMatchObject({ name: 'queued_generation_gw', value: US_TOTAL, as_of: '2026-10-07' });
      expect(b.taste.project_count.value).toBe(6061);
      expect(b.taste.cite_as).toBe('DC Hub (dchub.cloud), as of 2026-10-07');
      expect(b.totals.queued_generation_gw).toBe(US_TOTAL);
      expect(JSON.stringify(b)).not.toContain('Secret Solar');
      expect(r.bytes).toBeLessThan(ANSWER_BUDGET_DEFAULT_BYTES);
    });
  }
  it('execute_plan: the live-feed queue fact says "collected <date>"', async () => {
    process.env[FLAG] = '1';
    const f = queueFact(await call(H, 'execute_plan', PLAN));
    expect(f).toMatchObject({ as_of: null, collected_at: '2026-10-07' });
    expect(f.text).toContain('DC Hub, collected 2026-10-07)');
  });
  it('the keyless key-path entry (#1594) still rides the first plan answer of a session only', async () => {
    process.env[FLAG] = '1';
    const sid = `hp-keypath-${Date.now()}`;
    const keys = (r) => (json0(r).next_tools || []).filter((e) => e && (e.tool === 'get_api_key' || e.tool === 'claim_free_key'));
    expect(keys(await call(H, 'execute_plan', PLAN, { sid }))).toHaveLength(1);
    expect(keys(await call(H, 'execute_plan', PLAN, { sid }))).toHaveLength(0);
  });
});

describe('flag on leaves alone what already had its headline, and the surfaces it must not touch', () => {
  const same = async (tool, args, opts) => {
    const off = await call(H, tool, args, opts);
    process.env[FLAG] = '1';
    const on = await call(H, tool, args, opts);
    delete process.env[FLAG];
    return [norm(on), norm(off)];
  };
  it('grid: the taste already carried demand + share with their hours and source', async () => {
    const [on, off] = await same('get_grid_intelligence', { region_id: 'PJM' });
    expect(on).toBe(off);
    expect(on).toContain('"demand_mw"');
  });
  it('queue, report-dated ISO (ERCOT): already dated', async () => {
    const [on, off] = await same('get_interconnection_queue', { iso: 'ERCOT' });
    expect(on).toBe(off);
    expect(on).toContain('2026-09-30');
  });
  for (const [label, opts] of [['/mcp/chatgpt', { path: '/mcp/chatgpt' }], ['a ChatGPT-identified client', { ua: 'openai-mcp/1.0.0' }],
    ['a paid key', { key: PRO_KEY }], ['a free key that is not a trial', { key: FREE }]]) {
    it(`${label}: the all-ISO queue answer is unchanged`, async () => {
      const [on, off] = await same('get_interconnection_queue', {}, opts);
      expect(on).toBe(off);
    });
  }
});

describe('who the server hands it to (server.mjs _headlinePreviewSeat)', () => {
  // /mcp/core lists none of these tools by name (its tools delegate), so its exclusion is pinned on the seat itself.
  it('keyless and trial keys only; never /mcp/core, /mcp/chatgpt or a plan step started there', () => {
    const seat = H.S._headlinePreviewSeat;
    expect(seat({})).toBe(true);
    expect(seat({ api_key: TRIAL })).toBe(true);
    expect(seat({ api_key: 'dch_live_x', is_trial: true })).toBe(true);
    expect(seat({ profile: CORE_PROFILE })).toBe(false);
    expect(seat({ profile: DIRECTORY_PROFILE })).toBe(false);
    expect(seat({ legacy_wall_copy: true })).toBe(false);
    expect(seat({ api_key: FREE })).toBe(false);
    expect(seat({ api_key: PRO_KEY })).toBe(false);
    expect(seat(null)).toBe(false);
  });
});

describe('flag off is origin/main, byte for byte (git-ref sandbox)', () => {
  for (const [label, tool, args] of [['grid', 'get_grid_intelligence', { region_id: 'PJM' }],
    ['queue PJM', 'get_interconnection_queue', { iso: 'PJM' }], ['queue all-ISO', 'get_interconnection_queue', {}],
    ['execute_plan', 'execute_plan', PLAN]]) {
    it(`${label}`, async () => {
      if (!O) { console.warn(`[headline-preview] origin/main comparison not run: ${why}`); return; }
      // The same call number on both sides keeps the ids and IPs aligned.
      const here = await call(H, tool, args, { sid: 'hp-cmp-' + label });
      n -= 1;
      const main = await call(O, tool, args, { sid: 'hp-cmp-' + label });
      expect(norm(here)).toBe(norm(main));
    }, 120_000);
  }
});
