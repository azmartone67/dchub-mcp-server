// plan-neutral-cta.test.mjs — Grok note L1 + L2 acceptance (coordinator, 2026-11-15; lib/neutral-cta.mjs).
//
// Keyless and free-key (gateway-tier) execute_plan "compare ERCOT vs PJM vs MISO for 100 MW by 2028", through the
// real /mcp handler with its steps looping back over real HTTP (backend stubbed, network fenced):
//   * JSON.stringify of the text blocks + structuredContent matches none of the banned wording (BANNED below, the
//     coordinator's regex verbatim);
//   * every call-to-action URL in the answer is https://dchub.cloud/connect;
//   * gated fields are described neutrally, and an offer line states only canon's two free offers;
//   * CONTROL: with DCHUB_PLAN_NEUTRAL_CTA=0 the same plan breaks the rule, so the check can fail.
// The backend fixture plants the wording Grok saw ("paid data tier", "paid upgrade", a /pricing and a checkout link)
// in the step's CTA fields, where the server puts wall copy.
// DATA IS NEVER REWRITTEN (coordinator, blocking on mcp#1465): an energy-price / gas-index plan's step data
// ($/MWh, $/MMBtu, a deal value, an incentive amount) is byte-identical with the switch on and off. The bare
// "$<digit>" of the banned pattern is therefore a check for the compare plan, whose data carries no dollar figure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { neutralString, neutralCtaStep, NEUTRAL_GATED, CONNECT_URL, CTA_KEYS, COMMERCE_KEY } from '../lib/neutral-cta.mjs';
import { leanObject } from '../lib/lean-response.mjs';
import { splitLeadingJson } from '../lib/facility-location.mjs';

// This file reads execute_plan step bodies and envelope keys, so it runs the full answer (what detail:"full" returns).
// The compact default is covered by test/plan-compact-1117 and, through the real handler, test/plan-fact-header.
const _compactWas = process.env.DCHUB_PLAN_COMPACT;
beforeAll(() => { process.env.DCHUB_PLAN_COMPACT = '0'; });
afterAll(() => { if (_compactWas === undefined) delete process.env.DCHUB_PLAN_COMPACT; else process.env.DCHUB_PLAN_COMPACT = _compactWas; });

process.env.DCHUB_KEYLESS_FIRST_FULL = '0';

export const BANNED = /paid upgrade|paid data tier|paid (plan|tier|key)|upgrade page|\/pricing|\/upgrade|checkout|stripe|\$\d|\b(Pro|Developer|Enterprise|Starter) plan/i;
// A URL that asks the person to do something: sign up, claim, pay, unlock, sign in, upgrade.
const CTA_LIKE = /\/(?:u|go|upgrade|pricing|checkout|signup|claim|redeem|unlock|connect)\b|\/mcp\/(?:grok\/)?oauth|\/keys\/claim|stripe\.com/i;
const OPTION_A = [/\d[\d,]*\s+(?:API\s+)?credits?\b/i, /calls?\/day/i, /free key/i, /free Land & Power/i, /fee only on close/i];
const URL_RE = /https?:\/\/[^\s"'<>)\]`\\]+/g;
const INTENT = 'compare ERCOT vs PJM vs MISO for 100 MW by 2028';
const FREE_KEY = 'dch_live_FREEgatewaykey0123456789abcd';
const PLANTED = 'Full rows are behind a paid data tier (paid upgrade): https://dchub.cloud/pricing or https://checkout.stripe.com/c/pay/x.';

// The wall / offer copy rides the step's CTA fields (where the server puts it); data fields carry real figures.
const WALL = { human_message: PLANTED, for_your_human: { text: PLANTED, url: 'https://dchub.cloud/pricing' } };
// Data that must come out byte-identical (coordinator, blocking on mcp#1465): cited prices are never rewritten.
const PRICES = { price_note: 'Real-time LMP averaged $45/MWh; Henry Hub gas $3.12/MMBtu.', deal_value: '$1.2B',
  incentive: '$25,000,000 sales-tax exemption over 10 years', lmp_usd_mwh: 45.2,
  rows: [{ hub: 'HB_NORTH', price: '$45.20/MWh' }, { hub: 'Henry Hub', price: '$3.12/MMBtu' }] };
const GI = (iso) => ({ iso, demand_mw: 93825, demand_period: '2026-11-14T14', peak_mw: 102346, min_mw: 85900, load_factor: 0.839,
  queue_depth_gw: 373.6, market_count: 64, generation_mix: { NG: { mw: 40289 } }, as_of: '2026-11-14T14:00:00Z', ...WALL,
  demand_24h: Array.from({ length: 8 }, (_, i) => ({ period: `2026-11-14T0${i}`, mw: 90000 + i })) });
const QUEUE = (iso) => ({ iso, total_projects: 1174, total_gw: 373.6, as_of: '2026-11-14', ...WALL,
  projects: Array.from({ length: 6 }, (_, i) => ({ name: `Q${i}`, mw: 100 + i, fuel: 'solar', status: 'active', state: 'TX' })) });

let H, fence;
// The third seat lets every data route and the relay shortener fall through to the harness's own backend, which
// plants the live commerce shapes (a /upgrade/h relay, /go/c checkout + credits links, "$10 pack or Pro at $99/mo",
// "Upgrade to Pro now"): the shapes the compare_isos builder (mcp#1460) found on this intent.
let PLANTED_BACKEND = false;
let ANON_COUNT = 0;      // 999: the keyless caller is past its free calls, so the plan answer is a wall
const CLIENT_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
beforeAll(async () => {
  // The server tells a plan's own loopback steps from an outside caller by the peer address: this file's client
  // sockets read as 203.0.113.7, the plan's step sockets stay 127.0.0.1 (test/every-wall-carries-an-offer).
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (H && this.server && this.localPort === H.PORT && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.7' };
    return p;
  };
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_ANON_DAILY_CAP: '500' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate') {
        return (body && body.api_key === FREE_KEY) ? { valid: true, tier: 'free', developer_id: 'dev_gateway', email: null, tier_detail: { users_plan: 'free' } } : undefined;
      }
      if (p === '/api/v1/mcp/anon-usage') return { count: ANON_COUNT };
      if (PLANTED_BACKEND) return undefined;
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      const iso = ((p.match(/\/(ERCOT|PJM|MISO)\b/i) || [])[1] || 'ERCOT').toUpperCase();
      if (/energy|gas|price|dcgi|lmp/i.test(p)) return { success: true, iso, as_of: '2026-11-14', ...PRICES, ...WALL };
      if (p.startsWith('/api/v1/grid/')) return GI(iso);
      if (p.includes('queue')) return QUEUE(iso);
      return { success: true, count: 3, as_of: '2026-11-14', ...WALL, data: [{ iso: 'ERCOT', mw: 1 }, { iso: 'PJM', mw: 2 }] };
    },
  });
}, 120_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop();
  if (fence) fence.restore();
});

function rpc(headers, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: H.PORT, path: '/mcp', method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (ch) => { raw += ch; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve(msg);
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
let ip = 1, rid = 7000;
async function plan(extraHeaders = {}, { planted = false, walled = false, intent = INTENT } = {}) {
  PLANTED_BACKEND = planted; ANON_COUNT = walled ? 999 : 0;
  const msg = await rpc({ 'user-agent': 'cursor/1.0', 'x-dc-client-ip': `198.51.120.${ip++}`, ...extraHeaders },
    { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name: 'execute_plan', arguments: { intent } } });
  PLANTED_BACKEND = false; ANON_COUNT = 0;
  return msg && msg.result;
}
// M1.2 (owner 2026-11-18, lib/neutral-cta.mjs RELAY_URL_FIELDS): the URL fields (human_url, for_your_human.url,
// _upgrade.url, and a copy of the same link) send the human to the tagged relay page, or to the tagged /connect when no
// relay was minted. That link is the one exception to "every CTA URL is /connect"; prose never carries it.
// DCHUB_WALL_RELAY_URL=0 restores /connect there (the CONTROL below).
const WALL_RELAY = /https:\/\/dchub\.cloud\/(?:upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}\?via=mcp-wall&wall=[a-z_]+&src=[a-z_]+|connect\?via=mcp-wall&wall=connect&src=[a-z_]+)/g;
const isWallRelay = (u) => typeof u === 'string' && new RegExp('^' + WALL_RELAY.source + '$').test(u);
const surface = (r) => (JSON.stringify((r.content || []).map((b) => b && b.text)) + JSON.stringify(r.structuredContent || {})).replace(WALL_RELAY, 'WALL_RELAY');
function violations(r) {
  const s = surface(r);
  const bad = [];
  const m = s.match(BANNED);
  if (m) bad.push('banned: …' + s.slice(Math.max(0, m.index - 60), m.index + 60) + '…');
  for (const u of new Set(s.match(URL_RE) || [])) {
    const url = u.replace(/[.,;:]+$/, '');
    if (CTA_LIKE.test(url) && url !== CONNECT_URL) bad.push('cta url: ' + url);
  }
  const sc = r.structuredContent || {};
  if (sc.human_url !== undefined && sc.human_url !== CONNECT_URL && !isWallRelay(sc.human_url)) bad.push('human_url: ' + sc.human_url);
  if (sc.for_your_human && sc.for_your_human.url !== undefined && sc.for_your_human.url !== CONNECT_URL
    && !isWallRelay(sc.for_your_human.url)) bad.push('for_your_human.url');
  // the relay link rides only in URL fields: no prose (a block's text outside its leading JSON) carries it
  for (const b of (r.content || [])) {
    if (!b || typeof b.text !== 'string') continue;
    const sp = splitLeadingJson(b.text);
    const prose = sp && sp.json && typeof sp.json === 'object' ? sp.head + ' ' + sp.rest : b.text;
    WALL_RELAY.lastIndex = 0;
    if (WALL_RELAY.test(prose)) bad.push('relay in prose');
  }
  WALL_RELAY.lastIndex = 0;
  // An offer line states only canon's free offers: any call allowance is canon's "50 MCP calls/day with an email".
  for (const x of s.matchAll(/\d[\d,]*\s+(?:MCP\s+)?calls?\b[^."\\]{0,24}/gi)) if (!x[0].startsWith('50 MCP calls/day with an email')) bad.push('offer: ' + x[0]);
  return bad;
}

describe('execute_plan below a paid plan: neutral copy, one route to /connect (note L1 + L2)', () => {
  const seats = [['keyless', {}, false], ['free key (gateway tier)', { 'x-api-key': FREE_KEY }, false],
    ['keyless, planted commerce backend', {}, true, false], ['keyless at the hard wall, planted backend', {}, true, true]];

  it.each(seats)('%s: no banned wording, every CTA URL is /connect, gated fields said neutrally', async (_l, hdr, planted, walled) => {
    const r = await plan(hdr, { planted, walled });
    expect(r && r.structuredContent && r.structuredContent._entity).toBe('plan_execution');
    expect(r.structuredContent.executed.length).toBeGreaterThan(1);
    expect(violations(r)).toEqual([]);
    // Option A (owner 2026-11-16, lib/neutral-connect.mjs): no credit, calls-per-day, free-key or listing-fee wording.
    const all = JSON.stringify([r.content, r.structuredContent]);
    expect(OPTION_A.filter((re) => re.test(all)).map(String)).toEqual([]);
  }, 120_000);

  it('M1.2: a keyless plan\'s human_url is the tagged relay page; DCHUB_WALL_RELAY_URL=0 restores /connect', async () => {
    const on = await plan({}, { planted: false, walled: true });
    expect(isWallRelay(on.structuredContent.human_url), on.structuredContent.human_url).toBe(true);
    expect(on.structuredContent.human_url).toMatch(/[?&]via=mcp-wall&wall=[a-z_]+&src=[a-z_]+$|connect\?via=mcp-wall&wall=connect&src=[a-z_]+$/);
    process.env.DCHUB_WALL_RELAY_URL = '0';
    try {
      const off = await plan({}, { planted: false, walled: true });
      expect(off.structuredContent.human_url).toBe(CONNECT_URL);
      expect(JSON.stringify(off)).not.toMatch(/via=mcp-wall/);
    } finally { delete process.env.DCHUB_WALL_RELAY_URL; }
  }, 120_000);

  it('CONTROL: DCHUB_PLAN_NEUTRAL_CTA=0 brings the wording and the relay / pricing links back', async () => {
    process.env.DCHUB_PLAN_NEUTRAL_CTA = '0';
    try {
      const r = await plan({}, { planted: true });
      expect(violations(r).length).toBeGreaterThan(0);
    } finally { delete process.env.DCHUB_PLAN_NEUTRAL_CTA; }
  }, 120_000);

  // DATA IS NEVER REWRITTEN (coordinator, blocking on mcp#1465). A keyless energy-price / gas-index plan whose steps
  // carry $/MWh, $/MMBtu, a deal value and an incentive amount in data fields: every step's data (the result minus
  // the CTA / commerce keys and lean's relay keys) is byte-identical with the switch on and off.
  const dataOf = (v, depth = 0) => {
    if (depth > 60 || !v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => dataOf(x, depth + 1));
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!CTA_KEYS.has(k) && !COMMERCE_KEY.test(k)) o[k] = dataOf(x, depth + 1);
    return o;
  };
  it('energy prices + gas index: step data is byte-identical with the switch on and off; the figures are there', async () => {
    const intent = 'energy prices and the gas index for a 100 MW campus in ERCOT';
    process.env.DCHUB_PLAN_NEUTRAL_CTA = '0';
    let off;
    try { off = await plan({}, { intent }); } finally { delete process.env.DCHUB_PLAN_NEUTRAL_CTA; }
    const on = await plan({}, { intent });
    const steps = on.structuredContent.executed;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((e) => e.step)).toEqual(off.structuredContent.executed.map((e) => e.step));
    const onData = JSON.stringify(steps.map((e) => dataOf(e.result)));
    const offData = JSON.stringify(off.structuredContent.executed.map((e) => dataOf(leanObject(e.result))));
    expect(onData).toBe(offData);
    for (const fig of ['$45/MWh', '$3.12/MMBtu', '$45.20/MWh', '$1.2B', '$25,000,000']) expect(onData, fig).toContain(fig);
    // the same plan's wall copy is still made neutral
    expect(JSON.stringify(on.structuredContent)).not.toMatch(/paid data tier|paid upgrade|\/pricing|checkout/i);
  }, 120_000);

  it('a fixture step: data fields and a data sentence in prose are untouched; only the CTA fields change', () => {
    const data = { iso: 'ERCOT', ...PRICES, source_url: 'https://dchub.cloud/data-sources' };
    const step = { ...data, human_message: PLANTED, for_your_human: { url: 'https://dchub.cloud/u/abc', text: PLANTED } };
    const planObj = { _entity: 'plan_execution', human_url: 'https://dchub.cloud/u/abc', executed: [{ step: 1, tool: 'get_energy_prices', status: 'executed', result: step }] };
    const result = { structuredContent: planObj, content: [{ type: 'text', text: JSON.stringify(planObj) },
      { type: 'text', text: 'ERCOT: real-time LMP averaged $45/MWh and gas $3.12/MMBtu.' }] };
    const out = neutralCtaStep(result, { env: {} });
    const r = out.structuredContent.executed[0].result;
    for (const k of Object.keys(data)) expect(JSON.stringify(r[k]), k).toBe(JSON.stringify(data[k]));
    expect(JSON.parse(out.content[0].text).executed[0].result.price_note).toBe(PRICES.price_note);
    expect(out.content[1].text).toBe('ERCOT: real-time LMP averaged $45/MWh and gas $3.12/MMBtu.');
    expect(r.human_message).toBe(NEUTRAL_GATED);
    expect(r.for_your_human.url).toBe(CONNECT_URL);
    expect(out.structuredContent.human_url).toBe(CONNECT_URL);
  });

  // The shapes the compare_isos builder (mcp#1460) reported on this intent, copied from their builders in server.mjs:
  // _subRungText's rung line (_SUB_RUNG_LABEL "a paid DC Hub plan for agents" -> a /go/c checkout link), the keyed
  // quota wall's _upgrade.upgrade_this_key_* block and its "paid upgrade" message, an upgrade_options plan list with
  // checkout_url, and the /upgrade/h relay the harness mints (/u/ live). neutralCtaStep sees them in a step result,
  // in block 0's JSON and in prose; none survives.
  it('the reported wall / offer shapes: rung line, keyed _upgrade block, checkout plans, /upgrade/h relay', () => {
    const relay = 'https://dchub.cloud/upgrade/h/YS0wOTQ0YWU5.4ee7d5a7?via=mcp-wall&wall=anon_daily_cap';
    const rung = '**a paid DC Hub plan for agents** (full grid intelligence) → https://dchub.cloud/go/c/ZGV2PLANTED.abc123';
    const step = { demand_mw: 93825, iso: 'PJM', price_note: 'Real-time LMP averaged 41.2 per MWh.',
      _upgrade: { message: 'Or bind a paid upgrade to THIS key: 💳 a one-time pack → https://dchub.cloud/upgrade?key=k&pack=5',
        upgrade_this_key_pitch: 'Upgrade THIS key in place — a paid DC Hub plan for agents, no key swap.',
        upgrade_this_key_tiers: { developer: 'https://dchub.cloud/go/c/ZGV2.x' } },
      upgrade_options: [{ id: 'email_unlock', label: 'Free: 50 MCP calls/day with an email.', url: CONNECT_URL },
        { id: 'developer', label: 'A paid DC Hub plan for agents', checkout_url: 'https://dchub.cloud/go/c/ZGV2.y' }],
      human_url: relay, for_your_human: { url: relay, text: 'Your human can unlock the full answer: ' + relay } };
    // a plan-level list too: lean strips a step's upgrade_options, nothing strips the plan's own
    const plan = { _entity: 'plan_execution', human_url: relay, upgrade_options: step.upgrade_options,
      _upgrade: { next_tool: 'bind_email', ...step._upgrade }, executed: [{ step: 1, tool: 'compare_isos', status: 'executed', result: step }] };
    const result = { structuredContent: plan, content: [
      { type: 'text', text: JSON.stringify(plan) },
      { type: 'text', text: 'PJM leads on queue depth. Full depth: ' + rung + '. The checkout page shows the price.' },
      { type: 'text', text: 'Keep going free: show your human this link → ' + relay + '. One email unlocks 50 calls a day.' }] };
    const before = surface(result);
    expect(before).toMatch(BANNED);                         // the fixture carries what Grok / the builder saw
    expect(before).toMatch(/"id\\?":\\?"developer/);
    const out = neutralCtaStep(result, { env: {} });
    expect(violations(out)).toEqual([]);
    const s = surface(out);
    expect(s).toContain('93825');                           // the data stays
    expect(s).toContain('Real-time LMP averaged 41.2 per MWh.');
    expect(s).toContain('PJM leads on queue depth.');
    expect(s).toContain(NEUTRAL_GATED);
    expect(s).not.toMatch(/"id\\?":\\?"developer/);                // no paid-rung option survives, in either copy
    // the plan's own _upgrade block (next_tool, steps_ran_under, walled_steps) stays; its paid-rung links go
    expect(s).not.toMatch(/upgrade_this_key/);
    expect(out.structuredContent._upgrade.next_tool).toBe('bind_email');
    expect(out.structuredContent.upgrade_options).toEqual([step.upgrade_options[0]]);
    // paid callers meet no wall and are left as they are
    expect(neutralCtaStep(result, { paid: true, env: {} })).toBe(result);
  });

  it('neutralString: a banned sentence becomes the neutral one, once; other sentences and data stay', () => {
    expect(neutralString('PJM demand is 93,825 MW. ' + PLANTED + ' Queue is 373.6 GW.'))
      .toBe('PJM demand is 93,825 MW. ' + NEUTRAL_GATED + ' Queue is 373.6 GW.');
    expect(neutralString('Open https://dchub.cloud/u/abc to see what it found and how to unlock it.'))
      .toBe('Open https://dchub.cloud/connect for more detail.');   // option A (owner 2026-11-16): no allowance wording
    expect(neutralString('Grid data: https://dchub.cloud/data-sources')).toBe('Grid data: https://dchub.cloud/data-sources');
    expect(neutralString('available with a paid upgrade')).toBe(NEUTRAL_GATED);
    // an allowance is stated in canon's words
    expect(neutralString('One email unlocks 50 calls a day and the full answer to this question.'))
      .toBe('More detail is available at dchub.cloud/connect and the full answer to this question.');
    expect(neutralString('A keyed caller is not subject to this limit, and an email-bound key gets 50 calls a day, free.'))
      .toBe('A keyed caller is not subject to this limit, and more detail is available at dchub.cloud/connect.');
  });
});
