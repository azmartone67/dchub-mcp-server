// analyze_site's gated answers name no plan (owner 2026-10-10, WALL_COPY_VERSION v13; v14 extends it to the rest of the gated copy).
//
// Grok rule: no price or plan names in tool text. The Pro-only walls said "DC Hub Pro has
// ... Start a 7-day Pro trial", "is a DC Hub Pro tool", "[🔓 Start a 7-day DC Hub Pro
// trial]" and "Scores and figures are Pro". They now say "DC Hub's paid plan" / "a paid DC
// Hub plan" and "a 7-day trial". This drives analyze_site through the real HTTP server
// (stub backend on loopback, same harness as annotation-hints-every-surface) on the keyless
// and free-key gated paths, on /mcp and /mcp/grok, with the paywall contract off and on and
// the B2 keyless headline off and on, and reads every string the response carries.
//
// Non-vacuity: each case must really be the wall: required_plan 'pro', user_message ending in
// the trial short link the stub minted, and content[0] leading with that line. A response
// that lost the wall would otherwise pass "no Pro" trivially.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const SHORT = 'https://dchub.cloud/u/abcdef';
const SITE_SCORE = {
  success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' }, capacity_requested_mw: 100,
  overall_score: 83.7,
  scores: { power_infrastructure: 88.1, gas_pipeline_access: 71.3, fiber_connectivity: 95.4,
            market_conditions: 60.6, risk_resilience: 72.2 },
  nearby: { facilities_100km: 685, total_capacity_mw: 8336.4, substations_50km: 212,
            gas_pipelines_50km: 14, power_plants_80km: 37, fiber_carriers_in_state: 44 },
  interpretation: 'Excellent site', source: 'DC Hub Site Intelligence',
};
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_PAYWALL_CONTRACT', 'DCHUB_B2_SITE_HEADLINE',
  'DCHUB_PAID_SELL_LINE', 'DCHUB_WALL_SHORT_LINK'];
const prevEnv = {};
// A site answer with no figure to withhold: the preview note keeps its base wording (no
// "This answer hid ..." sentence to replace it).
const SITE_SCORE_BARE = { success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' },
  interpretation: 'Excellent site', source: 'DC Hub Site Intelligence' };
let siteScore = SITE_SCORE;
let httpServer, stub, PORT;

beforeAll(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const p = req.url.split('?')[0];
        if (p === '/api/site-score') return res.end(JSON.stringify(siteScore));
        if (p === '/api/v1/relay/short') return res.end(JSON.stringify({ ok: true, url: SHORT }));
        if (p === '/api/v1/keys/validate') {
          return res.end(JSON.stringify({ valid: true, tier: 'free', tier_detail: { effective: 'free' } }));
        }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  // The short link and the relay are minted only with an internal key (production has one).
  process.env.DCHUB_INTERNAL_KEY = 'analyze-site-wall-no-plan-name-test';
  const S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
});

let ipN = 0;
async function analyzeSite(path, { key, ua }) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
                    'user-agent': ua, 'x-forwarded-for': '198.51.100.' + (10 + (ipN++ % 200)) };
  if (key) headers['x-api-key'] = key;
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
                           params: { name: 'analyze_site', arguments: { lat: 33.45, lon: -112.07 } } }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return JSON.parse(body).result;
}

// Every string in the response, by path. URLs are dropped (a plan id in a link is not copy).
function strings(o, path = '', out = []) {
  if (typeof o === 'string') {
    out.push([path, o.replace(/https?:\/\/\S+/g, '<url>')]);
    if (/^\s*\{/.test(o)) { try { strings(JSON.parse(o), path + '{json}', out); } catch (_) { /* prose */ } }
  } else if (Array.isArray(o)) o.forEach((v, i) => strings(v, path + '[' + i + ']', out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) strings(v, path + '.' + k, out);
  return out;
}
const PLAN_NAME = /\bPro\b/;
const NAMED_FIELDS = ['user_message', 'agent_message', 'human_message', 'for_your_human'];

const CASES = [];
for (const path of ['/mcp', '/mcp/grok']) {
  for (const keyed of [false, true]) {
    for (const pc of ['off', 'on']) {
      for (const b2 of ['1', '0']) {
        // DCHUB_PAID_SELL_LINE (default off) swaps in lib/paid-sell-line's Pro-wall sentence.
        for (const sell of ['0', '1']) {
          // A fresh key per case: a key that has already been shown the ask gets the
          // once-per-key repeat note instead (r-relay-cap), which is a different response.
          CASES.push({ path, pc, b2, sell, short: '1',
                       key: keyed ? 'dch_live_wallnoplan' + String(CASES.length).padStart(6, '0') : null });
        }
      }
    }
  }
}
// The short-link kill switch (DCHUB_WALL_SHORT_LINK=0) serves the long relay link instead.
for (const path of ['/mcp', '/mcp/grok']) CASES.push({ path, pc: 'off', b2: '0', sell: '0', short: '0', key: null });
// A free key on a site answer with no figure to withhold.
for (const path of ['/mcp', '/mcp/grok']) {
  CASES.push({ path, pc: 'off', b2: '0', sell: '0', short: '1', bare: true,
               key: 'dch_live_wallnoplan' + String(CASES.length).padStart(6, '0') });
}
const label = (c) => `${c.path} ${c.key ? 'free key' : 'keyless'} contract=${c.pc} b2=${c.b2} sell=${c.sell} short=${c.short}${c.bare ? ' bare' : ''}`;

describe.each(CASES.map((c) => [label(c), c]))('analyze_site gated answer, %s', (_name, c) => {
  let r;
  beforeAll(async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = c.pc;
    process.env.DCHUB_B2_SITE_HEADLINE = c.b2;
    process.env.DCHUB_PAID_SELL_LINE = c.sell;
    process.env.DCHUB_WALL_SHORT_LINK = c.short;
    siteScore = c.bare ? SITE_SCORE_BARE : SITE_SCORE;
    r = await analyzeSite(c.path, { key: c.key, ua: c.path === '/mcp/grok' ? 'Grok/1.0' : 'claude-user' });
  });

  it('is the Pro-only wall, carrying the trial link (the check below is not vacuous)', () => {
    const sc = r.structuredContent;
    expect(sc.required_plan).toBe('pro');
    expect(sc._wall).toBe(true);
    // Keyless: the /u/ short link the stub minted. Free key, or the short link switched off: the
    // signed /upgrade/h relay page (one-link wall below Developer, Grok audit 2026-10-08 item 1).
    const link = sc.human_url || (sc.for_your_human && sc.for_your_human.url);
    expect(link).toMatch(c.key || c.short === '0' ? /^https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(\?\S*)?$/
      : /^https:\/\/dchub\.cloud\/u\/abcdef$/);
    // The text an agent reads offers the trial with that link.
    const text = r.content.map((b) => b.text || '').join('\n');
    expect(text).toContain(link);
    expect(text).toMatch(/7-day (free )?trial/);
    expect(sc.agent_message).toMatch(/^analyze_site needs a paid DC Hub plan; this response is a preview\./);
    // The person's line, on the arms that write one (the paywall-contract arm leads with its own
    // "Tell the user:" sentence instead).
    if (sc.user_message !== undefined) {
      expect(sc.user_message).toMatch(/DC Hub's paid plan has the full site analysis for this location: .+\. Start a 7-day trial: https:\/\/\S+$/);
      expect(sc.user_message.endsWith(link)).toBe(true);
    }
    // Keyless: the wall leads with the person's line (r-wall-user-line).
    if (!c.key) {
      expect(r.content[0].text.startsWith(sc.user_message)).toBe(true);
      expect(sc.copy_version).toBe('v14');
    }
  });

  it('names no plan in content text, user_message, agent_message, human_message or for_your_human', () => {
    const sc = r.structuredContent;
    // The fields this wall always carries must be there, or the scan below skips them.
    expect(typeof sc.agent_message).toBe('string');
    expect(sc.for_your_human && typeof sc.for_your_human.text).toBe('string');
    const hits = [
      ...strings(r.content, 'content'),
      ...NAMED_FIELDS.flatMap((f) => strings(sc[f], 'structuredContent.' + f)),
    ].filter(([, s]) => PLAN_NAME.test(s)).map(([p, s]) => p + ': ' + s.slice(0, 200));
    expect(hits).toEqual([]);
  });

  it('names no plan in any other structuredContent string either', () => {
    const hits = strings(r.structuredContent, 'structuredContent')
      .filter(([, s]) => PLAN_NAME.test(s)).map(([p, s]) => p + ': ' + s.slice(0, 200));
    expect(hits).toEqual([]);
  });
});

// The server instructions follow the walls (owner 2026-10-10): the gated-tool line reads
// "PAID: <tools> need a paid DC Hub plan ... the 7-day trial or checkout link." Read from the
// served initialize result of every surface, not from the source constant.
describe('initialize instructions name no plan for the paid tools', () => {
  const SURFACES = ['/mcp', '/mcp/grok', '/mcp/chatgpt', '/mcp/claude', '/mcp/core'];
  const served = {};
  beforeAll(async () => {
    for (const path of SURFACES) {
      const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wall-no-plan-name-test', version: '1' } } }),
      });
      const raw = await res.text();
      const body = raw.includes('data: ')
        ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
      served[path] = JSON.parse(body).result.instructions;
    }
  });

  it('/mcp and /mcp/grok carry the PAID line and the relay rule (the scan below reads real text)', () => {
    for (const path of ['/mcp', '/mcp/grok']) {
      // v14: the human_url description went (RELAY_CONTRACT, which follows, says what to do with it).
      expect(served[path], path).toMatch(/PAID: `analyze_site`, [^.]*`export_dataset` need a paid DC Hub plan\. First line of your answer must be the URL in human_url /);
    }
  });

  it('/mcp carries the FREE TIER clause without a plan name', () => {
    expect(served['/mcp']).toContain('Grid/queue/market-intel tools: previews on free; full needs a paid DC Hub plan.');
  });

  // Owner 2026-10-10: no plan name (Pro, Developer, Starter) in the served instructions; URLs and
  // ids are not copy, so they are dropped before the scan.
  it.each(SURFACES)('%s instructions name no plan (Pro, Developer, Starter)', (path) => {
    expect(typeof served[path], path).toBe('string');
    expect(served[path].length, path).toBeGreaterThan(200);
    const copy = served[path].replace(/https?:\/\/\S+/g, '<url>');
    expect(copy).not.toMatch(/DC Hub Pro|Pro trial|Pro tools/);
    expect(copy.match(/[^.]{0,60}\b(Pro|Developer|Starter)\b[^.]{0,40}/g) || []).toEqual([]);
  });
});
