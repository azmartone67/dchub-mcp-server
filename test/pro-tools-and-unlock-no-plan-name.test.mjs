// The gated answers of every paid-plan tool, and unlock_more_data, name no plan and no price
// (owner 2026-10-10, WALL_COPY_VERSION v14; follows mcp#887 and mcp#890).
//
// Grok rule: no plan names (Pro, Developer, Starter, Enterprise) and no prices in tool-facing
// text. #887 fixed analyze_site's wall and the instructions; #890 took the amount out of
// unlock_more_data's pack. What was left: the shared ladder ("**Pro** (2,000 calls/day, Pro-only
// tools)") on get_dchub_recommendation, export_dataset's "Pro — everything", "is a DC Hub Pro
// decision tool", the upgrade-missed rung, unlock_more_data's general plans list ("Developer
// subscription", "Pro subscription", "Pro tools not included") and the MPP "$0.50/call" prose.
//
// This drives the five paid-plan tools and unlock_more_data through the real HTTP server (stub
// backend on loopback, same harness as analyze-site-wall-no-plan-name), keyless and with a free
// key, on /mcp and /mcp/grok, with the paywall contract off and on and MPP off and on, and reads
// content text, user_message, agent_message, human_message, for_your_human, the plans/options
// labels and every other structuredContent string. URLs are dropped (a plan id in a link is not
// copy); machine fields such as machine_pay.price_usd are not prose and carry no "$".
//
// Non-vacuity: every response must be the gated one (a wall/preview marker plus a dchub.cloud
// link the agent is told to relay), or "no plan name" would pass on an empty or error answer.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const SHORT = 'https://dchub.cloud/u/abcdef';
const SITE_SCORE = {
  success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' }, capacity_requested_mw: 100,
  overall_score: 83.7, verdict: 'BUILD',
  scores: { power_infrastructure: 88.1, gas_pipeline_access: 71.3, fiber_connectivity: 95.4,
            market_conditions: 60.6, risk_resilience: 72.2 },
  nearby: { facilities_100km: 685, total_capacity_mw: 8336.4, substations_50km: 212,
            gas_pipelines_50km: 14, power_plants_80km: 37, fiber_carriers_in_state: 44 },
  interpretation: 'Excellent site', source: 'DC Hub Site Intelligence',
};
const RECOMMEND = {
  success: true, matched_category: 'investment', context_understood: true,
  recommendation: { short: 'DC Hub is a live data-center intelligence layer.', medium: 'Live, cited data.',
                    detailed: 'Live, cited data for siting, power and fiber.' },
  top_pocket: { market: 'Columbus, OH', dcpi: 81.2, verdict: 'BUILD' },
  available_categories: ['general', 'investment', 'site-selection', 'technical'],
};
const SURVEY = {
  success: true, survey: { verdict: 'BUILD', power: { substations_50km: 12 }, market: 'Phoenix' },
  pdf_report_url: 'https://dchub.cloud/api/v1/reports/abc.pdf',
};
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_PAYWALL_CONTRACT', 'MPP_ENABLED', 'MPP_SIDECAR_URL',
  'DCHUB_WALL_ONE_LINK'];
const prevEnv = {};
let httpServer, stub, PORT;
let exportMode = '402';
let mintOn = false;
// A keyless call to a paid-plan tool can auto-mint a trial key (the "is a DC Hub Pro decision tool"
// block rode that path); shape from test/automint-trial-rungs.test.mjs.
const MINT = { ok: true, api_key: 'dch_trial_noplanname_fixture', tier: 'IDENTIFIED', expires_at: null, daily_calls: 15,
  daily_calls_when_email_bound: 50, trial_days: 7, days_remaining: 7, reused: false };

beforeAll(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const p = req.url.split('?')[0];
        if (p === '/api/site-score') return res.end(JSON.stringify(SITE_SCORE));
        if (p.startsWith('/api/agents/recommend')) return res.end(JSON.stringify(RECOMMEND));
        if (p.includes('site-analysis') || p.includes('survey')) return res.end(JSON.stringify(SURVEY));
        // export_dataset: the backend's REST wall (routes/tier_gate _gate_response) answers 402, which
        // reached agents as {"error":"API 402","detail":"upgrade_required"} (measured live 2026-10-03).
        // exportMode '200' serves an empty body instead, which takes the anonymous field-mask path
        // (its _upgrade carried pro_hint "Pro — everything").
        if (p.startsWith('/api/v1/lp/export')) {
          if (exportMode === '200') return res.end('{}');
          res.statusCode = 402; return res.end(JSON.stringify({ error: 'upgrade_required' }));
        }
        if (p === '/api/v1/keys/auto-mint') return res.end(JSON.stringify(mintOn ? MINT : {}));
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
  // MPP is on only with MPP_ENABLED=1 AND a sidecar URL (mpp-hook mppEnabled); the stub stands in.
  process.env.MPP_SIDECAR_URL = `http://127.0.0.1:${stub.address().port}`;
  // The short link and the relay are minted only with an internal key (production has one).
  process.env.DCHUB_INTERNAL_KEY = 'pro-tools-and-unlock-no-plan-name-test';
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
async function call(path, name, args, { key, ua }) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
                    'user-agent': ua, 'x-forwarded-for': '198.51.100.' + (10 + (ipN++ % 200)) };
  if (key) headers['x-api-key'] = key;
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return JSON.parse(body).result;
}

// Every string, by path. URLs are dropped; a JSON text block is read as data too.
function strings(o, path = '', out = []) {
  if (typeof o === 'string') {
    out.push([path, o.replace(/https?:\/\/\S+/g, '<url>')]);
    if (/^\s*[{[]/.test(o)) { try { strings(JSON.parse(o), path + '{json}', out); } catch (_) { /* prose */ } }
  } else if (Array.isArray(o)) o.forEach((v, i) => strings(v, path + '[' + i + ']', out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) strings(v, path + '.' + k, out);
  return out;
}
// A JSON text block also carries the stub's own data, so it is read as prose only where it is
// prose: the leading JSON head is parsed (above) and its strings judged like any other field.
export const PLAN_NAME = /\b(Pro|PRO|Developer|Starter|Enterprise)\b/;
export const PRICE = /\$\s?\d/;
export const offenders = (pairs) => pairs
  .filter(([, s]) => PLAN_NAME.test(s) || PRICE.test(s))
  .map(([p, s]) => {
    const i = Math.max(s.search(PLAN_NAME), 0) || Math.max(s.search(PRICE), 0);
    return p + ': …' + s.slice(Math.max(0, i - 80), i + 50);
  });
const NAMED_FIELDS = ['user_message', 'agent_message', 'human_message', 'for_your_human', 'relay_to_human',
  'plans', 'options', 'upgrade', '_upgrade'];

const TOOLS = [
  ['analyze_site', { lat: 33.45, lon: -112.07 }],
  ['compare_sites', { locations: '33.45,-112.07;39.04,-77.49' }],
  ['get_dchub_recommendation', { context: 'investment' }],
  ['generate_site_analysis', { lat: 37.694, lon: -88.65, capacity_mw: 150 }],
  ['export_dataset', { format: 'csv' }],
  ['unlock_more_data', {}],
  ['unlock_more_data', { reason: 'analyze_site returned a preview' }],
];
const CASES = [];
for (const [tool, args, mode] of [...TOOLS, ['export_dataset', { format: 'csv' }, '200'],
  ...TOOLS.filter(([t]) => t !== 'unlock_more_data').map(([t, a]) => [t, a, 'mint'])]) {
  for (const path of ['/mcp', '/mcp/grok']) {
    for (const keyed of [false, true]) {
      for (const pc of ['off', 'on']) {
        // MPP on: the one-link wall (below a paid plan) drops the MPP block and its prose, so the
        // '1-nolink' arm (DCHUB_WALL_ONE_LINK=0, the switch's other side) is the one that shows them.
        for (const mpp of ['', '1', '1-nolink']) {
          // The backend-200 variant is a wall only for the anonymous field mask on /mcp's plain arm;
          // elsewhere an empty 200 is a served (empty) answer, not a gated one.
          if (mode === '200' && (keyed || path !== '/mcp' || pc !== 'off')) continue;
          // The auto-mint variant: keyless only (a keyed call never mints), MPP off.
          if (mode === 'mint' && (keyed || mpp)) continue;
          // A fresh key per case: a key already shown the ask gets the once-per-key repeat note.
          CASES.push({ tool, args, path, pc, mpp, mode: mode || '402',
                       key: keyed ? 'dch_live_noplanall' + String(CASES.length).padStart(6, '0') : null });
        }
      }
    }
  }
}
const label = (c) => `${c.tool}${c.args.reason ? ' (after a paid-plan wall)' : ''}${c.mode === '200' ? ' (backend 200)' : ''}${c.mode === 'mint' ? ' (auto-mint)' : ''} ${c.path} ${c.key ? 'free key' : 'keyless'} contract=${c.pc} mpp=${c.mpp || 'off'}`;

describe.each(CASES.map((c) => [label(c), c]))('%s', (_name, c) => {
  let r;
  beforeAll(async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = c.pc;
    process.env.MPP_ENABLED = c.mpp ? '1' : '';
    process.env.DCHUB_WALL_ONE_LINK = c.mpp === '1-nolink' ? '0' : '1';
    exportMode = c.mode;
    mintOn = c.mode === 'mint';
    r = await call(c.path, c.tool, c.args, { key: c.key, ua: c.path === '/mcp/grok' ? 'Grok/1.0' : 'claude-user' });
  });

  it('is the gated answer (the scan below is not vacuous)', () => {
    expect(r && Array.isArray(r.content) && r.content.length, JSON.stringify(r).slice(0, 300)).toBeTruthy();
    const sc = r.structuredContent || {};
    const all = JSON.stringify(r);
    if (c.tool === 'unlock_more_data') {
      // Its whole answer is the ask: the plans list, with the pack the copy under test describes.
      const ids = (sc.plans || []).map((p) => p.id);
      expect(ids).toContain('credits');
      expect(ids).toContain(c.args.reason ? 'pro_trial' : 'developer');
      // The person's line and its link, on the arm that writes one (the paywall contract and
      // /mcp/grok serve the plans list as data).
      if (c.path === '/mcp' && c.pc === 'off') {
        expect(sc.human_message).toMatch(/https:\/\/dchub\.cloud\/(u|upgrade\/h|go\/c)\//);
      }
      // The MPP arm is real where it can show: with the one-link wall off, the machine-payable
      // block and its price field ride (its prose has no amount), and the text carries the MPP line.
      // (The paywall-contract arm serves the plans as data without the MPP block.)
      if (c.mpp === '1-nolink' && c.path === '/mcp' && c.pc === 'off') {
        expect(sc.machine_pay && sc.machine_pay.price_usd).toBe('0.50');
        if (!c.args.reason) {
          expect((sc.plans || []).map((p) => p.id)).toContain('mpp');
          expect(r.content[0].text).toContain('per-call Stripe payment challenge');
        }
      }
      if (!c.mpp) expect(sc.machine_pay).toBeUndefined();
    } else {
      // A wall or preview marker, and the link the agent is told to relay.
      expect(all).toMatch(/"required_plan":"pro"|"_gated":true|"_wall":true|"_preview_only":true|"preview_is_partial":true|"_upgrade":\{|"error":"paid_only"/);
      expect(all).toMatch(/https:\/\/dchub\.cloud\/(u|upgrade\/h|go\/c)\//);
    }
  });

  it('names no plan and no price in content, the named fields or the option labels', () => {
    const sc = r.structuredContent || {};
    const hits = offenders([
      ...strings(r.content, 'content'),
      ...NAMED_FIELDS.flatMap((f) => strings(sc[f], 'structuredContent.' + f)),
    ]);
    expect(hits).toEqual([]);
  });

  it('names no plan and no price in any other structuredContent string either', () => {
    expect(offenders(strings(r.structuredContent || {}, 'structuredContent'))).toEqual([]);
  });
});

describe('must-fail controls: the detector catches the strings this guard exists for', () => {
  it.each([
    '**Pro** (2,000 calls/day, Pro-only tools)', 'Pro — everything (the plan most humans choose).',
    'on DC Hub Developer', 'Developer subscription', 'Pro subscription', 'Pro tools not included',
    '`get_dchub_recommendation` is a DC Hub Pro decision tool', '$0.50/call Stripe payment challenge',
    '$10 one-time = 1,000 API credits', 'ingestion into another tool (PRO)', 'a grandfathered Starter key',
  ])('flags %s', (s) => {
    expect(offenders([['x', s]])).toHaveLength(1);
  });
  it('passes the v14 wording, internal ids and a URL with a plan id in it', () => {
    expect(offenders([
      ['a', 'a one-time pack of 1,000 API credits (usage capacity, not a subscription)'],
      ['b', 'the DC Hub plan with every tool'], ['c', 'pro_trial'], ['d', 'a per-call Stripe payment challenge'],
      ...strings('see https://dchub.cloud/go/c/x?plan=Pro', 'e'),
    ])).toEqual([]);
  });
});
