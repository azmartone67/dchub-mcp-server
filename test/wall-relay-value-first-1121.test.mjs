// wall-relay-value-first-1121.test.mjs — wall items 1, 2 and 4 (owner 2026-11-21; DRAFT, every flag OFF until the owner
// flips it):
//   item 1  DCHUB_WALL_RELAY_EVERYWHERE  lib/wall-relay-everywhere.mjs, server.mjs _relayEverywhereStep
//   item 2  DCHUB_WALL_VALUE_FIRST       lib/wall-value-first.mjs,      server.mjs _valueFirstStep
//   item 4  DCHUB_LICENCE_BLOCK          lib/licence-block.mjs,         server.mjs _licenceBlockStep
//   shared  lib/withheld-copy.mjs (the ONE withheld list and wording)
//
// Asserted through the real handler (backend stubbed, network fenced, an outside peer address, the git-ref sandbox of
// origin/main for byte identity):
//   * all three flags OFF: every answer on /mcp, /mcp/claude and /mcp/chatgpt is origin/main's, byte for byte, with the
//     production wall flags (DCHUB_WALL_IDENTITY_V2 + DCHUB_WALL_COPY_V2) on and with COPY_V2 off;
//   * all three ON: /mcp/claude and /mcp/chatgpt are still origin/main's byte for byte;
//   * all three ON, /mcp, keyless: each acceptance tool gets the /u/ human_url; the token it shortens carries a- / c- /
//     u- and the landing query; content[0] is at most three value-first lines and the JSON moved to content[1];
//     `licence` replaced `_upgrade` and names no price, plan, credit or calls-per-day;
//   * the promise test: every promise a gated answer's human_message makes ("email opens the full answer",
//     "licence", "this session") matches the unlock the relay page will show (the token's u- field);
//   * DCHUB_WALL_PAID_LINE on with item 1: one copy path, no paid line;
//   * mintedOnly keeps a /u/ line only while item 1 is on.
import { unsealPayload } from '../lib/token-seal.mjs';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import * as WC from '../lib/withheld-copy.mjs';
import * as RE from '../lib/wall-relay-everywhere.mjs';
import * as VF from '../lib/wall-value-first.mjs';
import * as LB from '../lib/licence-block.mjs';
import { mintedOnly } from '../lib/wall-offers.mjs';
import * as WPL from '../lib/wall-paid-line.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHORT = 'https://dchub.cloud/u/abcdef';

let H, O, SB, S, fence, why = '';
const shorts = [];
const teasers = [];
const routes = () => (p, _req, body) => {
  if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
  if (p === '/api/v1/relay/short') { if (body) shorts.push(body); return { ok: true, url: SHORT }; }
  if (p === '/api/v1/relay/teaser') { if (body) teasers.push(body); return { ok: true }; }
  return undefined;   // the harness's own stubs: the walled shapes each tool's backend serves a keyless caller
};
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
const FLAGS = ['DCHUB_WALL_RELAY_EVERYWHERE', 'DCHUB_WALL_VALUE_FIRST', 'DCHUB_LICENCE_BLOCK', 'DCHUB_WALL_PAID_LINE',
  'DCHUB_WALL_COPY_V2', 'DCHUB_WALL_IDENTITY_V2'];
const setEnv = (o) => { for (const k of FLAGS) { if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k]; } };
const PROD = { DCHUB_WALL_IDENTITY_V2: '1', DCHUB_WALL_COPY_V2: '1' };          // production wall flags since 2026-11-21
const PROD_COPY_OFF = { DCHUB_WALL_IDENTITY_V2: '1', DCHUB_WALL_COPY_V2: '0' };
const ALL_ON = { DCHUB_WALL_RELAY_EVERYWHERE: '1', DCHUB_WALL_VALUE_FIRST: '1', DCHUB_LICENCE_BLOCK: '1' };

beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.31' };
    return p;
  };
  fence = fenceNetwork();
  const env = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_KEYLESS_FIRST_FULL: '0', DCHUB_ANON_DAILY_CAP: '20',
    DCHUB_WORKOS_OAUTH_ENABLED: '1' };
  setEnv({});
  H = await startHarness({ env, extraRoutes: routes() });
  SERVER_PORTS.add(H.PORT);
  S = await import('../server.mjs');
  SB = createGitRefSandbox(REPO, 'origin/main', 'wall-relay-value-first-origin-main');
  if (!SB) why = 'origin/main is not available in this clone';
  else {
    O = await startHarness({ env, extraRoutes: routes(), serverUrl: pathToFileURL(path.join(SB.root, 'server.mjs')).href });
    SERVER_PORTS.add(O.PORT);
  }
}, 180_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (O) await O.stop();
  if (H) await H.stop();
  if (SB) SB.cleanup();
  if (fence) fence.restore();
  setEnv({});
});
afterEach(() => setEnv({}));

let rid = 1;
function rpc(h, p, body, headers = {}) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: h.PORT, path: p, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'cursor/1.0',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, msg, headers: res.headers });
      });
    });
    req.on('socket', (s) => {
      const note = () => { const lp = s.localPort; CLIENT_PORTS.add(lp); s.once('close', () => CLIENT_PORTS.delete(lp)); };
      if (s.localPort) note(); else s.once('connect', note);
    });
    req.on('error', reject);
    req.end(data);
  });
}
let ipSeq = 1;
const anyIp = () => `198.51.${100 + Math.floor(ipSeq / 250) % 100}.${ipSeq++ % 250 + 1}`;
async function call(h, p, name, args, { ua = 'cursor/1.0', headers = {}, ip = '' } = {}) {
  const s0 = shorts.length, t0 = teasers.length;
  const r = await rpc(h, p, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } },
    { 'x-dc-client-ip': ip || anyIp(), 'user-agent': ua, ...headers });
  await new Promise((res) => setTimeout(res, 120));
  return { result: r.msg && r.msg.result, msg: r.msg, shorts: shorts.slice(s0), teasers: teasers.slice(t0) };
}
// What differs between two runs of the same call by design (same normaliser as test/wall-paid-line-1121).
const RERUN_TOK = /pr1\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;
const rerunBody = (m, b) => {
  try {
    const { t, ...rest } = JSON.parse(unsealPayload(b));
    // each step's result hashes ([3], [7]) cover the step's served timestamps, so they differ run to run
    if (Array.isArray(rest.s)) rest.s = rest.s.map((x) => (Array.isArray(x) ? x.map((v, i) => (i === 3 || i === 7 ? 'H' : v)) : x));
    return 'RERUN.' + Buffer.from(JSON.stringify(rest)).toString('base64url');
  } catch { return m; }
};
const norm = (r) => JSON.stringify(r && r.id !== undefined ? { ...r, id: 0 } : r)
  .replace(RERUN_TOK, rerunBody)
  .replace(/(\\*"planner_version\\*":\\*")\d+\.\d+/g, '$1V')
  .replace(/https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[^"\s\\]*)?/g, 'RELAY')
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'TS')
  .replace(/(\\?")(ms|elapsed_ms|duration_ms|took_ms|latency_ms)(\\?"):\d+/g, '$1$2$3:0')
  .replace(/(plan|req|sess|run|rp)[-_][A-Za-z0-9]{6,}/g, '$1-ID')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID');
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a === b ? '' : `\n  here: ${a.slice(Math.max(0, i - 80), i + 160)}\n  main: ${b.slice(Math.max(0, i - 80), i + 160)}`; };
const texts = (r) => ((r && r.content) || []).filter((b) => b && b.type === 'text').map((b) => b.text);
const isJson = (t) => /^\s*\{/.test(String(t || ''));
// The raw token of a long relay URL: sid|tool|tier|ts[|pk-][|w-][|m-][|a-|c-|u-] and its query.
function decodeRelay(url) {
  const m = /\/upgrade\/h\/([A-Za-z0-9_-]+)\.[0-9a-f]{32}(?:\?(.*))?$/.exec(String(url || ''));
  if (!m) return null;
  const parts = unsealPayload(m[1]).split('|');
  const field = (p) => (parts.slice(4).find((x) => x.startsWith(p)) || '').slice(p.length);
  return { parts, tool: parts[1], a: field('a-'), c: field('c-'), u: field('u-'), s: field('s-'), query: m[2] || '' };
}

// The acceptance tools (owner's list) plus the DCPI wall that carried contradiction (a).
const ACCEPT = [
  ['execute_plan', { intent: 'how soon can a 100 MW load get power in ERCOT' }],
  ['get_grid_intelligence', { iso: 'ERCOT' }],
  ['get_interconnection_queue', { iso: 'PJM' }],
  ['get_energy_prices', { state: 'TX' }],
  ['analyze_site', { lat: 32.9, lon: -96.9 }],
  ['search_facilities', { city: 'Dallas' }],
  ['get_market_dcpi_rank', { market_slug: 'dallas' }],
];
// The price / plan / credit / calls-per-day ban (the brief's list; "free" too: the 2026-11-21 no-free sweep).
const NO_PRICE = /[$€£¥]|\bper month\b|\/mo\b|\b(?:free|developer|pro|enterprise|starter)\b|\bcredits?\b|\b\d[\d,]*\s+(?:MCP\s+)?(?:calls?|full answers?|answers?)\b|\/day\b|\bper day\b|\ba day\b/i;

// ── lib units ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('lib/withheld-copy.mjs: one list, never empty on a preview', () => {
  // Shapes measured live on keyless /mcp 2026-11-21 (session 722bdb3a, server 2.12.60).
  const ENERGY_TX = { _gated: true, preview_is_partial: true,
    preview_scope: { shown: 0, total: 2, withheld_fields: ['min cents kwh', 'max cents kwh', 'retail rate kwh', 'states covered'] },
    taste: { headline: { name: 'retail_rate_cents_kwh', value: 7.68, unit: 'cents/kWh', as_of: '2026-08-31' } },
    withheld: [{ section: 'rate_range', count: 2 }, { section: 'other_sectors', count: 2 }, { section: 'iso_footprint', count: 1 }],
    completeness: { status: 'partial', kind: 'taste', withheld: ['rate_range', 'other_sectors', 'iso_footprint'] } };
  const QUEUE_PJM = { _gated: true, preview_is_partial: true, preview_scope: { shown: 0, total: 25, withheld_fields: [] },
    taste: { headline: { name: 'queued_generation_gw', value: 373.2, unit: 'GW', as_of: null, collected_at: '2026-11-21T06:04:30.392048+00:00' } },
    withheld: [{ section: 'projects', count: 25 }], completeness: { status: 'partial', kind: 'taste', withheld: ['projects'] } };
  it('(c) energy TX: the headline states the retail rate, so "retail rate kwh" leaves the list', () => {
    const f = WC.withheldFields(ENERGY_TX);
    expect(f).toEqual(['min cents kwh', 'max cents kwh', 'states covered']);
    expect(f.join(' ')).not.toMatch(/retail/);
    expect(WC.reconcilePreviewScope(ENERGY_TX).preview_scope.withheld_fields).toEqual(f);
  });
  it('(d) queue PJM: a preview with withheld_fields [] names the withheld projects\' row fields', () => {
    const f = WC.withheldFields(QUEUE_PJM);
    expect(f).toEqual([...WC.SECTION_FIELDS.projects]);
    expect(WC.reconcilePreviewScope(QUEUE_PJM).preview_scope.withheld_fields.length).toBeGreaterThan(0);
  });
  it('analyze_site\'s wall names what it says is missing', () => {
    expect(WC.withheldFields({ _gated: true, _wall: true, missing: ['overall score', 'fiber connectivity'] })).toEqual(['overall score', 'fiber connectivity']);
  });
  it('never [] on a preview; [] on a full answer; already-noun fields with hyphens survive', () => {
    expect(WC.withheldFields({ _gated: true })).toEqual(['the detail rows of this answer']);
    expect(WC.withheldFields({ ok: true, data: [] })).toEqual([]);
    expect(WC.withheldFields({ _gated: true, preview_scope: { withheld_fields: ['DCPI sub-scores', 'queue_wait_months'] } }))
      .toEqual(['DCPI sub-scores', 'queue wait months']);
  });
  it('the shared wording', () => {
    expect(WC.withheldLine(['a_b', 'c', 'd'])).toBe('Withheld here: a b, c and d.');
    expect(WC.withheldLine(['a'], WC.WITHHELD_PAGE_LABEL)).toBe('Withheld from this answer: a.');
    expect(WC.withheldLine([])).toBe('');
    expect(WC.WITHHELD_VALUE).toBe('withheld');
  });
});

describe('lib/wall-relay-everywhere.mjs', () => {
  it('switch: off unless 1 / true / yes / on', () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'no']) expect(RE.wallRelayEverywhereOn({ DCHUB_WALL_RELAY_EVERYWHERE: v })).toBe(false);
    for (const v of ['1', 'true', 'yes', 'on', ' ON ']) expect(RE.wallRelayEverywhereOn({ DCHUB_WALL_RELAY_EVERYWHERE: v })).toBe(true);
  });
  it('client slug, fresh-session clients, canonical args hash, bind fields, landing query', () => {
    expect(RE.relayClient({ platform: 'cursor' })).toBe('cursor');
    expect(RE.relayClient({ platform: 'unknown', userAgent: 'grok-connectors-manager/1.2' })).toBe('grok');
    expect(RE.relayClient({ platform: 'ChatGPT' })).toBe('chatgpt');
    expect(RE.relayClient({})).toBe('unknown');
    expect(RE.freshSessionClient('grok')).toBe(true);
    expect(RE.freshSessionClient('chatgpt')).toBe(true);
    expect(RE.freshSessionClient('cursor')).toBe(false);
    expect(RE.argsHash({ b: 1, a: { d: 2, c: 3 } })).toBe(RE.argsHash({ a: { c: 3, d: 2 }, b: 1 }));
    expect(RE.argsHash({ iso: 'PJM' })).not.toBe(RE.argsHash({ iso: 'ERCOT' }));
    expect(RE.argsHash({ iso: 'PJM' })).toMatch(/^[0-9a-f]{16}$/);
    expect(RE.relayBindFields({ args: {}, client: 'cursor', unlock: 'email', sessionBound: true })).toEqual(['a-' + RE.argsHash({}), 'c-cursor', 'u-email', 's-1']);
    expect(RE.relayBindFields({ client: 'BAD SLUG', unlock: 'nope' }).slice(1)).toEqual(['c-unknown', 'u-licence', 's-0']);
    expect(RE.relayLandingQuery({ tool: 'analyze_site', client: 'cursor' })).toBe('via=mcp-wall&tool=analyze_site&client=cursor');
  });
  it('human message: each variant states only what its page keeps; no price, plan or "free"', () => {
    const e = RE.relayHumanMessage({ tool: 'analyze_site', link: SHORT, unlock: 'email', sessionBound: true });
    const eu = RE.relayHumanMessage({ tool: 'analyze_site', link: SHORT, unlock: 'email', sessionBound: false });
    const l = RE.relayHumanMessage({ tool: 'get_market_dcpi_rank', link: SHORT, unlock: 'licence', sessionBound: true });
    expect(RE.promisesIn(e)).toEqual(['email', 'session']);
    expect(RE.promisesIn(eu)).toEqual(['email']);
    expect(RE.promisesIn(l)).toEqual(['licence']);
    for (const m of [e, eu, l]) { expect(m).toContain(SHORT); expect(m).not.toMatch(NO_PRICE); expect(m).not.toContain('/mcp/oauth'); }
  });
  it('constants: one licence URL, one sign-in page', () => {
    expect(RE.LICENCE_URL).toBe('https://dchub.cloud/connect');
    expect(RE.SIGNIN_PAGE_URL).toBe('https://dchub.cloud/mcp/connect');
  });
});

describe('lib/wall-offers.mjs mintedOnly: the /u/ trap', () => {
  const line = { kind: 'x', line: 'Open ' + SHORT + ' to see it.' };
  it('item 1 ON keeps a line naming a server-minted /u/ link; OFF drops it as before; never an arbitrary URL', () => {
    expect(mintedOnly([line], 'https://dchub.cloud/upgrade/h/x.y', { DCHUB_WALL_RELAY_EVERYWHERE: '1' })).toEqual([line]);
    expect(mintedOnly([line], 'https://dchub.cloud/upgrade/h/x.y', {})).toEqual([]);
    for (const bad of ['https://dchub.cloud/u/abc', 'https://dchub.cloud/u/abcdefg', 'https://evil.example/u/abcdef', 'https://dchub.cloud/u/abcde1'])
      expect(mintedOnly([{ line: 'see ' + bad }], '', { DCHUB_WALL_RELAY_EVERYWHERE: '1' }), bad).toEqual([]);
  });
});

describe('lib/wall-value-first.mjs', () => {
  it('at most three lines: dated headline, withheld list, link; an undated figure is never shown', () => {
    const sc = { taste: { headline: { name: 'retail_rate_cents_kwh', value: 7.68, unit: 'cents/kWh', as_of: '2026-08-31' } } };
    const lines = VF.valueFirstLines({ headline: VF.headlineOf(sc, { iso: 'ercot' }), fields: ['min cents kwh', 'states covered'], link: SHORT });
    expect(lines).toEqual(['ERCOT retail electricity rate 7.68 cents/kWh (DC Hub, as of 2026-08-31).',
      'Withheld here: min cents kwh and states covered.', 'See the full answer: ' + SHORT]);
    expect(VF.headlineOf({ taste: { headline: { name: 'x', value: 1, as_of: null } } })).toBe(null);
    expect(VF.headlineOf({ taste: { headline: { name: 'queued_generation_gw', value: 373.2, unit: 'GW', collected_at: '2026-11-21T06:04:30Z' } } }).when)
      .toBe('collected 2026-11-21');
    expect(VF.headlineOf({ verdict: 'CAUTION', market_name: 'Dallas', composite_score: 61, computed_at: '2026-11-20T00:00:00Z' }).text)
      .toBe('Dallas Data Center Power Index (DCPI) verdict CAUTION, composite 61');
    expect(VF.valueFirstLines({ fields: ['a'], link: 'https://evil.example/x' })).toEqual(['Withheld here: a.']);
  });
  it('JSON block 0 moves to content[1]; a prose lead (execute_plan) keeps its JSON in block 1; never twice', () => {
    const r = { content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: 'Source: DC Hub' }], structuredContent: { a: 1 } };
    const out = VF.withValueFirst(r, ['L1', 'L2']);
    expect(texts(out)).toEqual(['L1\nL2', '{"a":1}', 'Source: DC Hub']);
    expect(out.structuredContent).toBe(r.structuredContent);
    expect(VF.withValueFirst(out, ['L1', 'L2'])).toBe(out);
    const p = { content: [{ type: 'text', text: 'Plan lead' }, { type: 'text', text: '{"b":2}' }] };
    expect(texts(VF.withValueFirst(p, ['L1']))).toEqual(['L1\n\nPlan lead', '{"b":2}']);
  });
  it('(a) / (b): the email and session promises are rewritten only where the link cannot keep them', () => {
    const mk = (t) => ({ content: [{ type: 'text', text: JSON.stringify({ human_message: t }) }, { type: 'text', text: t }], structuredContent: { human_message: t } });
    const a = 'Your AI assistant got a preview of get_market_dcpi_rank from DC Hub; with an email it gets the full answer. Open X.';
    const outA = VF.withHonestPromises(mk(a), { emailOpens: false });
    expect(outA.structuredContent.human_message).toBe('Your AI assistant got a preview of get_market_dcpi_rank from DC Hub' + VF.LICENCE_CLAUSE + '. Open X.');
    expect(JSON.stringify(outA)).not.toMatch(/with an email it gets the full answer/);
    expect(VF.withHonestPromises(mk(a), { emailOpens: true }).structuredContent.human_message).toBe(a);
    const b = 'Give an email on that page and this session’s next `analyze_site` call returns the full report.';
    expect(VF.withHonestPromises(mk(b), { sessionBound: false }).structuredContent.human_message)
      .toBe('Give an email on that page and the next `analyze_site` call made with that key returns the full report.');
    expect(VF.withHonestPromises(mk(b), { sessionBound: true }).structuredContent.human_message).toBe(b);
  });
});

describe('lib/licence-block.mjs', () => {
  it('the ONE tier mapping: keyless -> anonymous, a free or claimed key -> keyed, any paid tier -> licensed', () => {
    expect(LB.licenceTier({})).toBe('anonymous');
    expect(LB.licenceTier({ tier: 'anonymous' })).toBe('anonymous');
    for (const t of ['free', 'identified', 'trial', 'claimed', '', undefined]) expect(LB.licenceTier({ apiKey: 'dch_x', tier: t }), String(t)).toBe('keyed');
    for (const t of ['starter', 'developer', 'Pro', 'professional', 'team', 'business', 'enterprise', 'paid', 'operator'])
      expect(LB.licenceTier({ apiKey: 'dch_x', tier: t }), t).toBe('licensed');
    expect(LB.LICENCE_TIERS).toEqual(['anonymous', 'keyed', 'licensed']);
  });
  it('the block: licence_url from the one constant, unlocks from the one list, trial passed through (never defaulted true)', () => {
    const b = LB.licenceBlock({ tool: 'get_energy_prices', sc: { _gated: true, preview_scope: { withheld_fields: ['states covered'] } } });
    expect(b).toEqual({ current_tier: 'anonymous', licence_unlocks: ['states covered'],
      licence_url: RE.LICENCE_URL + '?via=mcp&tool=get_energy_prices', trial_available: false,
      checkout_tool: 'unlock_more_data', agent_instruction: LB.AGENT_INSTRUCTION });
    expect(LB.licenceBlock({ tool: 'x_y', sc: { _gated: true }, trialAvailable: 'yes' }).trial_available).toBe(false);
    expect(LB.licenceBlock({ tool: 'x_y', sc: { _gated: true }, trialAvailable: true }).trial_available).toBe(true);
    expect(LB.licenceBlock({ tool: 'x_y', sc: { _gated: true } }).licence_unlocks.length).toBeGreaterThan(0);
  });
  it('MUST-FAIL guard: the block names no price, currency, plan name, credit or calls-per-day (and the guard bites)', () => {
    const b = LB.licenceBlock({ tool: 'get_energy_prices', sc: { _gated: true }, apiKey: 'k', tier: 'free', trialAvailable: true });
    expect(JSON.stringify(b)).not.toMatch(LB.LICENCE_BLOCK_BANNED);
    for (const bad of ['$49', '€10', 'USD 10', '10 per month', '49/mo', 'Pro plan', 'a Developer licence', 'Free tier', 'Enterprise',
      '5 credits', '500 calls', '10 full answers', '50/day', '10 per day', 'ten a day', '49 dollars'])
      expect(bad, 'the guard catches ' + bad).toMatch(LB.LICENCE_BLOCK_BANNED);
  });
  it('replaces `_upgrade` in place (structuredContent and the JSON block, layout kept); appends when absent', () => {
    const r = { content: [{ type: 'text', text: JSON.stringify({ a: 1, _upgrade: { tier: 'anonymous' }, z: 2 }, null, 2) }],
      structuredContent: { a: 1, _upgrade: { tier: 'anonymous' }, z: 2 } };
    const out = LB.withLicenceBlock(r, { current_tier: 'anonymous' });
    expect(Object.keys(out.structuredContent)).toEqual(['a', 'licence', 'z']);
    expect(out.content[0].text).toBe(JSON.stringify({ a: 1, licence: { current_tier: 'anonymous' }, z: 2 }, null, 2));
    expect(Object.keys(LB.withLicenceBlock({ content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 1 } }, { x: 1 }).structuredContent))
      .toEqual(['a', 'licence']);
  });
});

// ── the real handler ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('flags OFF: origin/main byte for byte on /mcp, /mcp/claude, /mcp/chatgpt', () => {
  it.each([['production wall flags', PROD], ['COPY_V2 off', PROD_COPY_OFF], ['no wall flags', {}]])('%s', async (_l, env) => {
    if (!O) { console.warn(`[wall-relay-value-first-1121] origin/main comparison not run: ${why}`); return; }
    for (const p of ['/mcp', '/mcp/claude', '/mcp/chatgpt']) {
      for (const [name, args] of ACCEPT) {
        setEnv(env);
        const here = norm((await call(H, p, name, args)).msg);
        const main = norm((await call(O, p, name, args)).msg);
        expect(here === main, `${p} ${name}${firstDiff(here, main)}`).toBe(true);
      }
    }
  }, 240_000);
});

describe('flags ON: /mcp/claude and /mcp/chatgpt stay origin/main byte for byte', () => {
  it('all three items on (with the production wall flags)', async () => {
    if (!O) { console.warn(`[wall-relay-value-first-1121] origin/main comparison not run: ${why}`); return; }
    for (const p of ['/mcp/claude', '/mcp/chatgpt']) {
      for (const [name, args] of ACCEPT) {
        setEnv({ ...PROD, ...ALL_ON });
        const here = norm((await call(H, p, name, args)).msg);
        setEnv(PROD);
        const main = norm((await call(O, p, name, args)).msg);
        expect(here === main, `${p} ${name}${firstDiff(here, main)}`).toBe(true);
      }
    }
  }, 240_000);
});

describe('flags ON, /mcp, keyless: the acceptance tools', () => {
  const runs = new Map();
  // analyze_site serves a keyless caller two full analyses a day before its wall: one caller (IP) calls until walled.
  const run = async (name, args, env = { ...PROD, ...ALL_ON }, opts = {}) => {
    setEnv(env);
    if (name !== 'analyze_site') return call(H, '/mcp', name, args, opts);
    const ip = anyIp();
    let r;
    for (let i = 0; i < 4; i++) {
      r = await call(H, '/mcp', name, args, { ...opts, ip });
      if (S._gatedAnswer(r.result, name, {})) return r;
    }
    return r;
  };
  beforeAll(async () => {
    for (const [name, args] of ACCEPT) runs.set(name, await run(name, args));
  }, 120_000);

  it.each(ACCEPT)('%s: /u/ human_url; the token carries a- / c- / u- and the landing query', (name, args) => {
    const { result, shorts: sh } = runs.get(name);
    const sc = result.structuredContent;
    expect(sc.human_url, name).toBe(SHORT);
    expect(Object.keys(sc)[0]).toBe('human_url');
    expect(sc.for_your_human.url).toBe(SHORT);
    expect(sc.human_message).toContain(SHORT);
    const long = sh.map((b) => b.relay_url).find((u) => decodeRelay(u) && decodeRelay(u).u);
    expect(long, 'the shortened relay URL').toBeTruthy();
    const d = decodeRelay(long);
    expect(d.tool).toBe(name);
    expect(d.a).toBe(RE.argsHash(args));
    expect(d.c).toBe('cursor');
    expect(['email', 'licence']).toContain(d.u);
    expect(['0', '1']).toContain(d.s);
    expect(d.parts.length).toBeLessThanOrEqual(11);
    expect(d.query).toBe(`via=mcp-wall&tool=${name}&client=cursor`);
    // the /u/ line survives into the final response (prose, not only structuredContent)
    expect(texts(result).some((t) => !isJson(t) && t.includes(SHORT)), 'a prose line names the /u/ link').toBe(true);
  });

  it.each(ACCEPT)('%s: content[0] is at most three value-first lines; the JSON follows', (name) => {
    const { result } = runs.get(name);
    const t = texts(result);
    const lead = name === 'execute_plan' ? t[0].split('\n\n')[0] : t[0];
    const lines = lead.split('\n');
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.some((l) => l.startsWith(WC.WITHHELD_HERE_LABEL + ' '))).toBe(true);
    expect(lines[lines.length - 1]).toBe(VF.SEE_FULL_LEAD + SHORT);
    if (name !== 'execute_plan') expect(isJson(t[0])).toBe(false);
    // the answer's JSON, when it has one, is content[1] (analyze_site's wall is prose only: its lead block follows)
    if (t.slice(1).some(isJson)) expect(isJson(t[1]), 'the answer JSON is content[1]').toBe(true);
    const fields = WC.withheldFields(result.structuredContent);
    expect(lines).toContain(WC.withheldLine(fields));
  });

  it.each(ACCEPT)('%s: `licence` replaced `_upgrade`; tier anonymous; unlocks = the one list; no price / plan / credit', (name) => {
    const { result } = runs.get(name);
    const sc = result.structuredContent;
    expect(sc._upgrade).toBeUndefined();
    const L = sc.licence;
    expect(L.current_tier).toBe('anonymous');
    expect(L.licence_unlocks).toEqual(WC.withheldFields(sc));
    expect(L.licence_unlocks.length).toBeGreaterThan(0);
    expect(L.licence_url).toBe(`https://dchub.cloud/connect?via=mcp&tool=${name}`);
    expect(typeof L.trial_available).toBe('boolean');
    expect(L.checkout_tool).toBe('unlock_more_data');
    expect(L.agent_instruction).toBe(LB.AGENT_INSTRUCTION);
    expect(JSON.stringify(L)).not.toMatch(LB.LICENCE_BLOCK_BANNED);
    const jt = texts(result).find(isJson);
    if (jt && name !== 'execute_plan') { const jb = JSON.parse(jt); expect(jb._upgrade).toBeUndefined(); expect(jb.licence).toEqual(L); }
  });

  it.each(ACCEPT)('%s: new copy never points to /mcp/oauth and names no price or plan', (name) => {
    const { result } = runs.get(name);
    const sc = result.structuredContent;
    const t = texts(result);
    const newCopy = [t[0], sc.human_message, sc.for_your_human.message, ...t.filter((x) => x.startsWith(RE.FOR_HUMAN_LEAD))];
    for (const s of newCopy) { expect(s).not.toContain('/mcp/oauth'); expect(s).not.toMatch(NO_PRICE); }
  });

  // The promise test: what human_message promises == what the relay page unlocks for this caller (the token's u- field,
  // which dchub-backend routes/wall_relay_page.py renders; its own test pins the page side).
  it.each(ACCEPT)('%s: every promise in human_message matches the relay page\'s unlock', (name) => {
    const { result, shorts: sh } = runs.get(name);
    const d = decodeRelay(sh.map((b) => b.relay_url).find((u) => decodeRelay(u) && decodeRelay(u).u));
    const msgs = [result.structuredContent.human_message, result.structuredContent.for_your_human.message,
      ...texts(result).filter((x) => x.startsWith(RE.FOR_HUMAN_LEAD))];
    for (const m of msgs) {
      const p = RE.promisesIn(m);
      if (d.u === 'licence') { expect(p, m).not.toContain('email'); expect(p, m).toContain('licence'); }
      if (d.u === 'email') { expect(p, m).toContain('email'); expect(p, m).not.toContain('licence'); }
      // a "this session" promise only beside a session-bound link (s-1: the page binds a key the next call reads)
      if (p.includes('session')) expect(d.s, m).toBe('1');
      if (d.s === '1') expect(RE.freshSessionClient(d.c), 'a fresh-session client is never session-bound keyless').toBe(false);
    }
    // and nothing anywhere in the answer still says an email opens the full answer when the page sells a licence
    if (d.u === 'licence') expect(JSON.stringify(result)).not.toMatch(/with an email it gets the full answer/);
  });

  it('(a) get_market_dcpi_rank: the DCPI sub-scores need a licence, and the copy says so', () => {
    const { shorts: sh } = runs.get('get_market_dcpi_rank');
    expect(decodeRelay(sh.map((b) => b.relay_url).find((u) => decodeRelay(u) && decodeRelay(u).u)).u).toBe('licence');
  });

  it('the page restatement is stored against the token (headline only with its date, withheld = the one list)', () => {
    const { teasers: t, result } = runs.get('get_energy_prices');
    expect(t.length).toBe(1);
    expect(t[0].token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{32}$/);
    expect(t[0].withheld).toBe(WC.withheldList(WC.withheldFields(result.structuredContent)));
    if (t[0].headline) expect(t[0].headline_as_of).toMatch(/^(as of|collected) \d{4}-\d{2}-\d{2}$/);
  });

  it('a Grok client: the token says c-grok and no "this session" promise (fresh session per call)', async () => {
    const { result, shorts: sh } = await run('get_interconnection_queue', { iso: 'PJM' }, { ...PROD, ...ALL_ON },
      { ua: 'grok-connectors-manager/1.0' });
    const long = sh.map((b) => b.relay_url).find((u) => decodeRelay(u) && decodeRelay(u).u);
    expect(long, 'item 1 ran on the Grok wall').toBeTruthy();
    expect(decodeRelay(long).c).toBe('grok');
    expect(decodeRelay(long).s).toBe('0');
    expect(RE.promisesIn(result.structuredContent.human_message)).not.toContain('session');
  });

  it('item 1 + DCHUB_WALL_PAID_LINE: one copy path, the paid line never appears, no arm', async () => {
    for (const [name, args] of ACCEPT) {
      const { result } = await run(name, args, { ...PROD, ...ALL_ON, DCHUB_WALL_PAID_LINE: '1' });
      const s = JSON.stringify(result);
      expect(s, name).not.toContain(WPL.PAID_LINE);
      expect(s, name).not.toContain(WPL.PAID_LINE_SHORT);
      expect(result.structuredContent.human_url).toBe(SHORT);
    }
  }, 120_000);

  it('only items 2 and 4 on (item 1 off): the existing link is kept, (a) and (b) still fixed, no session promise', async () => {
    const { result } = await run('get_market_dcpi_rank', { market_slug: 'dallas' },
      { ...PROD, DCHUB_WALL_VALUE_FIRST: '1', DCHUB_LICENCE_BLOCK: '1' });
    const s = JSON.stringify(result);
    expect(s).not.toMatch(/with an email it gets the full answer/);
    expect(s).not.toMatch(/this session(?:’|')s next/);
    expect(result.structuredContent.licence).toBeTruthy();
    expect(texts(result)[0]).toMatch(/See the full answer: https:\/\/dchub\.cloud\//);
  });
});

describe('the steps skip what must stay frozen', () => {
  const wall = () => ({ content: [{ type: 'text', text: '{"_gated":true,"preview_is_partial":true,"_upgrade":{"tier":"anonymous"}}' }, { type: 'text', text: 'Source: DC Hub' }],
    structuredContent: { _gated: true, preview_is_partial: true, _upgrade: { tier: 'anonymous' } } });
  it.each([
    ['/mcp/chatgpt profile', { profile: 'chatgpt_directory' }],
    ['/mcp/claude profile', { profile: 'claude_directory' }],
    ['core profile', { profile: 'core_profile' }],
    ['a ChatGPT client', { platform: 'chatgpt' }],
    ['an execute_plan step', { loopback_step: true }],
    ['a device-matched caller', { device_match: true }],
  ])('%s: items 2 and 4 return the same object', (_l, o) => {
    setEnv(ALL_ON);
    const c = { session_id: '', platform: 'cursor', tier: 'anonymous', path: '/mcp', ...o };
    const w = wall();
    expect(S._licenceBlockStep(w, 'get_energy_prices', c)).toBe(w);
    expect(S._valueFirstStep(w, 'get_energy_prices', {}, c)).toBe(w);
    expect(S._withheldReconcileStep(w, 'get_energy_prices', c)).toBe(w);
  });
  it('flags off: the same object back from every new step', async () => {
    setEnv({});
    const c = { session_id: '', platform: 'cursor', tier: 'anonymous', path: '/mcp' };
    const w = wall();
    expect(S._licenceBlockStep(w, 'get_energy_prices', c)).toBe(w);
    expect(S._valueFirstStep(w, 'get_energy_prices', {}, c)).toBe(w);
    expect(S._withheldReconcileStep(w, 'get_energy_prices', c)).toBe(w);
    expect(await S._relayEverywhereStep(w, 'get_energy_prices', {}, c)).toBe(w);
  });
  it('trial_available reads the offer logic: a licensed caller is false', () => {
    expect(S._licenceTrialAvailable({ structuredContent: {} }, 'get_energy_prices', { api_key: 'dch_x', tier: 'developer' })).toBe(false);
  });
});
