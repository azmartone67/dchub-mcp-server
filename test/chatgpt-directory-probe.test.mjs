// chatgpt-directory-probe.test.mjs — r-chatgpt-directory (2026-09-24)
//
// The no-key probe of /mcp/chatgpt, the ChatGPT app-directory profile. Every
// tool the profile lists is called anonymously, twice (no arguments, then
// plausible arguments), and every response body must carry none of:
//   /go/c, /upgrade/h, a "$<digit>" amount, a dch_ key, a session-id string,
//   for_your_human, a planted checkout/price field.
// tools/list must carry only the five standard annotation keys, and the
// removed tools must be neither listed nor callable.
//
// The fake backend PLANTS the commerce the real backend returns (an `_upgrade`
// block with a checkout link and a claim_free_key pitch, a relay URL, an
// oai- session id, a dch_ key, a price line) and answers /keys/auto-mint with a
// real-looking trial key. So the profile has to remove commerce the backend
// sends AND commerce this server adds, and a regression that re-enabled
// minting on the profile would leak the planted key.
//
// CONTROL: the same calls on /mcp DO carry the commerce. Without it an empty
// offender list could mean the harness never reached the upsell paths.
//
// Live twin: scripts/probe-chatgpt-directory.mjs runs the same scan against
// https://dchub.cloud/mcp/chatgpt after a deploy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import {
  DIRECTORY_TOOLS, DIRECTORY_REMOVED, DIRECTORY_INSTRUCTIONS, PLANS_NOTICE, scrubStructured,
  STANDARD_ANNOTATION_KEYS, EMAIL_OR_WEBHOOK_TOOLS,
} from '../lib/chatgpt-directory.mjs';
import { PROBE_PATTERNS, probeHits, annotationViolations, GUESS_ARGS, CHATGPT_HEADERS, CHATGPT_META, classifyResponse } from '../scripts/probe-chatgpt-directory.mjs';

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

const PLANTED_KEY = 'dch_trial_PLANTEDkey0123456789abcdef';
const PLANTED_SID = 'oai-' + 'a1b2c3d4'.repeat(8);
let S, PORT, httpServer, stub, prevBase, prevSecret;
let mintHits = 0;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
      if (p === '/api/v1/mcp/trial-check') return send(200, { trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send(404, { error: 'not found' });
      if (p === '/api/v1/keys/auto-mint') {
        mintHits += 1;
        return send(200, { ok: true, api_key: PLANTED_KEY, tier: 'IDENTIFIED', daily_calls: 10,
                           trial_days: 30, days_remaining: 30, expires_at: '2026-10-24T00:00:00Z' });
      }
      if (p === '/api/v1/keys/validate') return send(200, { valid: false, tier: 'free' });
      // Data routes: real-looking rows plus the commerce the backend itself sends.
      return send(200, {
        success: true, count: 3, total: 12,
        data: [
          { id: 1, name: 'Ashburn Campus A', market: 'northern-virginia', capacity_mw: 120,
            headline: 'Operator raises $5B for Virginia campus', value_usd: 5000000000 },
          { id: 2, name: 'Dallas Campus B', market: 'dallas', capacity_mw: 80 },
          { id: 3, name: 'Phoenix Campus C', market: 'phoenix', capacity_mw: 60,
            source_note: 'Full list: https://dchub.cloud/upgrade/h/PLANTEDnote.99aa' },
        ],
        demand_mw: 18000, generation_mix: { NG: { mw: 9000 } },
        score: null, _score_in_pro: true,
        note: 'Rows 4-12 come with the $10 pack or Pro at $99/mo. Upgrade to Pro now.',
        session_id: PLANTED_SID,
        mcp_session_id: '3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b',
        api_key: 'dch_live_PLANTEDlivekey0123456789',
        _upgrade: {
          message: 'Anonymous tier. Call the claim_free_key tool (no email), then SAVE the X-API-Key.',
          upgrade_url: 'https://dchub.cloud/go/c/cHJvfPLANTED.abc123',
          credits_url: 'https://dchub.cloud/go/c/Y3JlZGl0PLANTED.def456',
        },
        for_your_human: { url: 'https://dchub.cloud/upgrade/h/PLANTEDrelay.0123abcd',
                          message: 'Open this link to unlock the full result.' },
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
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

async function post(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { status: res.status, headers: res.headers, raw, body: b };
}

let rpcId = 100;
const call = (path, name, args) => post(path, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
                                               params: { name, arguments: { ...args } } });
const DIR = '/mcp/chatgpt';

describe('/mcp/chatgpt — handshake and catalog', () => {
  it('initialize is stateless, plain, and advertises tools only', async () => {
    const r = await post(DIR, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'openai-mcp', version: '1.0' } } });
    expect(r.status).toBe(200);
    expect(r.headers.get('mcp-session-id')).toBeNull();
    const res = JSON.parse(r.body).result;
    expect(res.instructions).toBe(DIRECTORY_INSTRUCTIONS);
    expect(Object.keys(res.capabilities)).toEqual(['tools']);
    expect(probeHits(r.raw)).toEqual([]);
    // The canonical handshake is unchanged and still carries its own instructions.
    const c = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'openai-mcp', version: '1.0' } } });
    expect(c.headers.get('mcp-session-id')).toBeTruthy();
    expect(JSON.parse(c.body).result.instructions).not.toBe(DIRECTORY_INSTRUCTIONS);
  });

  it('notifications are accepted without a session', async () => {
    const r = await post(DIR, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(r.status).toBe(202);
  });

  it('tools/list: exactly the allowlist, five standard annotation keys, no payment params, no _meta', async () => {
    const r = await post(DIR, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const result = JSON.parse(r.body).result;
    const names = result.tools.map((t) => t.name);
    expect(names.sort()).toEqual(Object.keys(DIRECTORY_TOOLS).sort());
    for (const gone of DIRECTORY_REMOVED) expect(names).not.toContain(gone);
    expect(result._meta).toBeUndefined();
    expect(annotationViolations(result.tools)).toEqual([]);
    for (const t of result.tools) {
      expect(Object.keys(t.annotations).sort()).toEqual([...STANDARD_ANNOTATION_KEYS].sort());
      expect(t._meta, t.name).toBeUndefined();
      expect(t.outputSchema, t.name).toBeUndefined();
      expect(Object.keys(t.inputSchema.properties || {}).filter((k) => /^mpp_|payment|credential/.test(k)), t.name).toEqual([]);
      expect(t.description).toBe(DIRECTORY_TOOLS[t.name]);
    }
    const digest = result.tools.find((t) => t.name === 'subscribe_digest');
    expect(digest.annotations.readOnlyHint).toBe(false);
    expect(digest.annotations.openWorldHint).toBe(true);
    for (const t of result.tools) {
      if (!EMAIL_OR_WEBHOOK_TOOLS.has(t.name)) expect(t.annotations.readOnlyHint, t.name).toBe(true);
    }
    expect(probeHits(r.raw)).toEqual([]);
  });

  it('tools/list: the canonical /mcp catalog is unchanged (removed tools still listed there)', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = JSON.parse(r.body).result.tools.map((t) => t.name);
    for (const gone of ['claim_free_key', 'unlock_more_data', 'why_dchub']) expect(names).toContain(gone);
  });

  it('removed tools are not callable on the profile', async () => {
    for (const name of DIRECTORY_REMOVED) {
      const r = await call(DIR, name, {});
      const msg = JSON.parse(r.body);
      expect(msg.result, name).toBeUndefined();
      expect(msg.error.code, name).toBe(-32602);
      expect(msg.error.message, name).toMatch(/^Unknown tool/);
      expect(probeHits(r.raw), name).toEqual([]);
    }
  });

  it('prompts and resources list empty', async () => {
    expect(JSON.parse((await post(DIR, { jsonrpc: '2.0', id: 3, method: 'prompts/list' })).body).result).toEqual({ prompts: [] });
    expect(JSON.parse((await post(DIR, { jsonrpc: '2.0', id: 4, method: 'resources/list' })).body).result).toEqual({ resources: [] });
  });
});

describe('/mcp/chatgpt — no-key probe across every tool', () => {
  it('CONTROL: the same calls on /mcp carry the commerce this probe looks for', async () => {
    const hits = new Set();
    for (const name of ['get_grid_intelligence', 'get_market_dcpi_rank', 'search_facilities', 'get_news']) {
      const r = await call('/mcp', name, GUESS_ARGS);
      for (const h of probeHits(r.raw)) hits.add(h);
    }
    expect([...hits]).toEqual(expect.arrayContaining(['/go/c', '/upgrade/h', '$<digit>', 'dch_ key', 'session id']));
  }, 60_000);

  it('no tool response carries commerce, keys or session ids, and gated results end with the plans line', async () => {
    const before = mintHits;
    const offenders = [];
    let gated = 0;
    let answered = 0;
    for (const name of Object.keys(DIRECTORY_TOOLS)) {
      if (name === 'subscribe_digest') continue;   // sends mail; covered by its own case below
      for (const args of [{}, GUESS_ARGS]) {
        const r = await call(DIR, name, args);
        const hits = probeHits(r.raw);
        if (hits.length) offenders.push(`${name} ${args === GUESS_ARGS ? '(args)' : '(no args)'}: ${hits.join(', ')}`);
        const named = DIRECTORY_REMOVED.filter((t) => new RegExp(`\\b${t}\\b`).test(r.raw));
        if (named.length) offenders.push(`${name} ${args === GUESS_ARGS ? '(args)' : '(no args)'}: names removed ${named.join(', ')}`);
        const msg = JSON.parse(r.body);
        if (!msg.result) continue;
        answered += 1;
        const texts = msg.result.content.filter((c) => c.type === 'text').map((c) => c.text);
        const notices = texts.filter((t) => t.includes('dchub.cloud/plans'));
        if (notices.length) {
          gated += 1;
          expect(notices, name).toEqual([PLANS_NOTICE]);
          expect(texts[texts.length - 1], name).toBe(PLANS_NOTICE);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(mintHits - before, 'the profile minted a key').toBe(0);
    // Vacuity floors: the probe must actually reach answers and gated answers.
    expect(answered).toBeGreaterThan(100);
    expect(gated).toBeGreaterThan(10);
  }, 240_000);

  // What ChatGPT itself sends: its UA, the chatgpt platform header and an
  // openai/session _meta. On /mcp that session becomes an oai-<sha256> sid in
  // relay links (mcp#534); on the profile none of it may surface.
  it('ChatGPT-shaped calls (openai/session _meta) carry nothing either', async () => {
    const before = mintHits;
    const offenders = [];
    let answered = 0;
    for (const name of Object.keys(DIRECTORY_TOOLS)) {
      if (name === 'subscribe_digest') continue;
      const r = await post(DIR, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
        params: { name, arguments: { ...GUESS_ARGS }, _meta: { ...CHATGPT_META } } }, CHATGPT_HEADERS);
      const hits = probeHits(r.raw);
      if (hits.length) offenders.push(`${name}: ${hits.join(', ')}`);
      if (/"isError":true/.test(r.raw) === false) answered += 1;
    }
    expect(offenders).toEqual([]);
    expect(mintHits - before, 'the profile minted a key').toBe(0);
    // One openai/session calling every tool is what a directory reviewer does,
    // and it crosses the /mcp scraper signature. A blocked call keeps
    // isError:true through the filter, so it does not count as answered: 67 of
    // 72 answer with the profile exempt, 49 when the block fires (measured
    // 2026-09-24). The 'scraper block' probe pattern catches the block too.
    expect(answered).toBeGreaterThanOrEqual(60);
  }, 240_000);

  it('CONTROL: the same one-session sweep on /mcp trips the scraper block', async () => {
    const meta = { 'openai/session': 'v1/control-sweep-session' };
    const sig = ['get_agent_registry', 'get_energy_prices', 'get_facility', 'get_fiber_intel', 'get_grid_data'];
    let last = null;
    for (const name of [...sig, 'get_news']) {
      last = await post('/mcp', { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
        params: { name, arguments: { ...GUESS_ARGS }, _meta: meta } }, CHATGPT_HEADERS);
    }
    expect(last.raw).toContain('scraper_pattern_blocked');
    expect(probeHits(last.raw)).toContain('scraper block');
  }, 60_000);

  it('CONTROL: the ChatGPT-shaped call on /mcp does surface commerce', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
      params: { name: 'get_grid_intelligence', arguments: { ...GUESS_ARGS }, _meta: { ...CHATGPT_META } } }, CHATGPT_HEADERS);
    expect(probeHits(r.raw).length).toBeGreaterThan(0);
  }, 60_000);

  it('subscribe_digest with no email answers without commerce', async () => {
    const r = await call(DIR, 'subscribe_digest', {});
    expect(probeHits(r.raw)).toEqual([]);
  });
});

describe('removed tools are never pointed at', () => {
  // Land & Power (analyze_site, compare_sites, generate_site_analysis,
  // get_composite_site_score) is Pro-only and this profile is No Auth, so it is
  // not listed (owner 2026-09-25). Shapes below are the live ones: discover_tools
  // family arrays, execute_plan's rejected steps, get_grid_scoreboard pointers.
  it('the four Land & Power tools are removed, not listed', () => {
    for (const t of ['analyze_site', 'compare_sites', 'generate_site_analysis', 'get_composite_site_score']) {
      expect(DIRECTORY_REMOVED).toContain(t);
      expect(Object.keys(DIRECTORY_TOOLS)).not.toContain(t);
    }
  });
  it('scrubStructured drops removed names from arrays, pointers and {tool} entries', () => {
    const out = scrubStructured({
      tools: ['find_sites', 'analyze_site', 'rank_sites', 'get_shortlist'],
      rejected: [{ id: 'R5', tool: 'predict_market_trajectory', reason: 'Asked for present state.' },
                 { id: 'R6', tool: 'analyze_site', reason: 'Scored 2 vs 5.' }],
      pointers: { score_a_specific_site: 'analyze_site (lat, lon, capacity_mw)', grid: 'get_grid_intelligence (iso=…)' },
    });
    expect(out).toEqual({
      tools: ['find_sites', 'rank_sites'],
      rejected: [{ id: 'R5', tool: 'predict_market_trajectory', reason: 'Asked for present state.' }],
      pointers: { grid: 'get_grid_intelligence (iso=…)' },
    });
  });
});

describe('probe patterns themselves', () => {
  // A refusal must count as refused, or a run of refusals reads as clean.
  // The hard-wall body is verbatim from /mcp/chatgpt, 2026-09-24 23:06Z.
  it('classifyResponse counts every per-IP and per-session refusal as refused', () => {
    const wrap = (result) => { const msg = { jsonrpc: '2.0', id: 1, result }; return [JSON.stringify(msg), msg]; };
    const hardWall = wrap({ content: [{ type: 'text', text: "You've made more than 300 anonymous calls from this IP today (10x the free anonymous allowance of 30). Anonymous access is paused for this IP until UTC midnight." }],
      structuredContent: { _entity: 'news', error: 'anon_hard_wall', tool: 'get_news', current_tier: 'free', binding_limit: 'anon_ip_daily_hard', limit: 300, soft_cap: 30, retry_after: 'UTC midnight' }, isError: true });
    const rate429 = wrap({ content: [{ type: 'text', text: 'DC Hub API 429: rate_limit_exceeded' }], isError: true });
    const sweep = wrap({ content: [{ type: 'text', text: 'We noticed this session is running the same 5-tool sweep. Anonymous sweep blocked.' }], isError: true });
    const data = wrap({ content: [{ type: 'text', text: '{"articles":[{"id":"9c70"}]}' }] });
    const failed = wrap({ content: [{ type: 'text', text: 'Invalid arguments' }], isError: true });
    expect(classifyResponse(...hardWall)).toBe('refused');
    // The hard wall still counts with the text scrubbed away: the error code alone.
    const codeOnly = wrap({ content: [], structuredContent: { error: 'anon_hard_wall' }, isError: true });
    expect(classifyResponse(...codeOnly)).toBe('refused');
    expect(classifyResponse(...rate429)).toBe('refused');
    expect(classifyResponse(...sweep)).toBe('refused');
    expect(classifyResponse(...data)).toBe('data');
    expect(classifyResponse(...failed)).toBe('other');
  });

  it('each pattern fires on the string it exists for', () => {
    const samples = {
      '/go/c': 'https://dchub.cloud/go/c/abc.def',
      '/upgrade/h': 'https://dchub.cloud/upgrade/h/abc.def',
      '$<digit>': 'costs $10',
      'dch_ key': 'dch_trial_abcDEF123',
      'session id': PLANTED_SID,
    };
    for (const [label, s] of Object.entries(samples)) expect(probeHits(s), label).toContain(label);
    expect(Object.keys(PROBE_PATTERNS)).toEqual(expect.arrayContaining(Object.keys(samples)));
  });
});
