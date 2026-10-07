// paywall-contract.test.mjs — growth audit item (c) + Grok G3 (2026-09-28)
//
// 7 days to 2026-09-27: 147 relay links minted, 0 humans acted. The /upgrade/h/
// link lived only in structuredContent, which hosted clients never show the model;
// walls said isError:true; one response carried up to 13 CTA URLs. The contract
// (lib/paywall-contract.mjs) puts ONE plain "Tell the user" sentence with ONE
// /upgrade/h/ link first in content[0].text, tells the truth about completeness,
// and never errors on a paywall. Land & Power sells Pro, never the $10 pack.
//
// Real /mcp handler over HTTP, fake local backend, no network (harness from
// grok-relay-label / automint-trial-rungs).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import * as PC from '../lib/paywall-contract.mjs';

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
const TRIAL = 'dch_trial_paywallcontracttest01';
const MINT = { ok: true, api_key: TRIAL, tier: 'IDENTIFIED', expires_at: null, daily_calls: 15,
  trial_days: 7, days_remaining: 7 };
const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: 100 + i, name: `STACK Portland ${i}`, provider: 'STACK', city: 'Hillsboro', state: 'OR',
  country: 'US', status: 'operational', capacity_mw: 30 + i, lat: 45.5 + i / 100, lon: -122.9,
}));
const SITE = { success: true, overall_score: 62.4, interpretation: 'Good site',
  scores: { power_infrastructure: 71.2, gas_pipeline_access: 40.5, fiber_connectivity: 80.1,
            market_conditions: 66.3, risk_resilience: 58.9 },
  nearby: { substations_50km: 12, generation_capacity_mw: 4312.7 },
  power_cost: { industrial_cents_kwh: 7.91 }, location: { lat: 33.45, lon: -112.07 } };

let S, PORT, httpServer, stub, prevBase, prevSecret, prevMode;
let mintHits = 0;

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/auto-mint') { mintHits += 1; res.end(JSON.stringify({ ...MINT, reused: false })); return; }
      if (url.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(key === TRIAL
          ? { valid: true, tier: 'free', developer_id: null, email: null, source: 'auto_trial' }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (url.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      if (url.pathname === '/api/site-score') { res.end(JSON.stringify(SITE)); return; }
      res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS, results: ROWS,
                               demand_mw: 18000, generation_mix: { NG: { mw: 9000 } } }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  prevMode = process.env.DCHUB_PAYWALL_CONTRACT;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterEach(() => {
  if (prevMode === undefined) delete process.env.DCHUB_PAYWALL_CONTRACT;
  else process.env.DCHUB_PAYWALL_CONTRACT = prevMode;
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

let ipN = 10;
let rpcId = 10;
// One fresh caller (own IP, own session) per call, so per-IP counters never carry
// from one assertion into the next.
async function callAs(clientName, name, args) {
  const ip = `203.0.113.${ipN++}`;
  const h0 = { 'x-forwarded-for': ip };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  const h = { ...h0, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  const text = (result.content || []).map((c) => c.text || '').join('\n');
  return { body, result, text, sc: result.structuredContent || {} };
}

const CTA = /https:\/\/(?:dchub\.cloud\/(?:go\/[cp]\/|upgrade|pricing|redeem|api\/v1\/redeem|api\/v1\/go\/map|signup)|api\.dchub\.cloud\/pricing|buy\.stripe\.com|checkout\.stripe\.com)[^\s"'\\)\]}>]*/g;
const ctaUrls = (s) => [...new Set((s.match(CTA) || []).map((u) => u.replace(/[.,;:]+$/, '')))];
const tellLine = (text) => {
  const first = text.split('\n')[0];
  const m = /^Tell the user: "(.*)"$/.exec(first);
  if (m) return m[1];
  // copy v11 (2026-09-30): a Land & Power wall leads with the person's own line
  // (lib/wall-user-line.mjs), which replaces the contract's "Tell the user" ask.
  return /Start a 7-day Pro trial: https:\/\//.test(first) ? first : null;
};

describe('the contract over the real /mcp handler (DCHUB_PAYWALL_CONTRACT=on)', () => {
  it('search_facilities: one plain sentence first, one /upgrade/h/ link, the rest of the rows named, no key ask', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    const r = await callAs('claude-ai', 'search_facilities', { provider: 'STACK', city: 'Portland' });
    const said = tellLine(r.text);
    expect(said, r.text.slice(0, 400)).toBeTruthy();
    // r-missed-upgrade (2026-09-29): the sentence names what this keyless answer
    // hid, and the offer is the lowest rung that returns it — the pack, because
    // a free key still gets the facility-field mask on this tool.
    expect(said).toMatch(/^This answer hid .+, and \d+ more facilities\. The full answer is \$10 one-time/);
    expect(said).toContain('$10 one-time');
    const urls = ctaUrls(r.body);
    expect(urls, JSON.stringify(urls)).toHaveLength(1);
    expect(urls[0]).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}\?pc=v2$/);
    expect(said.endsWith(urls[0])).toBe(true);
    expect(said.slice(0, said.indexOf('https://')).length).toBeLessThanOrEqual(PC.HUMAN_TEXT_MAX + 2);
    expect(r.result.isError).toBe(false);
    // Instructions to the agent are gone from the text. (Data notes such as
    // provenance's "Do not cite it as a data date" are data, and stay.)
    expect(r.text).not.toMatch(/claim_free_key|X-API-Key|reconnect|VERBATIM|your human|DO NOT/);
    expect(r.sc.for_your_human.url).toBe(urls[0]);
    expect(r.sc.completeness.status).toBe('partial');
    expect(JSON.stringify(r.sc.agent_hints).length).toBeLessThanOrEqual(PC.AGENT_HINTS_MAX);
    expect(r.sc.agent_hints.free_key_tool).toBeUndefined();   // hosted client
  });

  it('a header-capable client may see claim_free_key, but only in agent_hints', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    const r = await callAs('cursor', 'search_facilities', { provider: 'STACK', city: 'Portland' });
    expect(tellLine(r.text)).toBeTruthy();
    expect(r.sc.agent_hints.free_key_tool).toBe('claim_free_key');
    expect(r.text).not.toMatch(/claim_free_key/);
  });

  it('get_grid_intelligence, full answer with allowance left: no pitch, never "partial"', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    const r = await callAs('claude-ai', 'get_grid_intelligence', { region_id: 'PJM' });
    expect(r.result.isError).toBe(false);
    if (r.sc.completeness.status === 'full' && r.sc.remaining_full_today !== 0) {
      expect(tellLine(r.text)).toBeNull();
      expect(r.sc.for_your_human).toBeUndefined();
      // The prose around the data never calls a complete answer partial. (Field
      // names such as headroom_preview inside the data are not claims.)
      const lines = r.text.split('\n');
      expect(lines[0] + '\n' + lines[lines.length - 1]).not.toMatch(/partial|preview|for the complete|used up/i);
      expect(lines[0]).toMatch(/^Complete answer/);
    } else {
      expect(tellLine(r.text)).toBeTruthy();
    }
    expect(ctaUrls(r.text).length).toBeLessThanOrEqual(1);
  });

  it('analyze_site anonymous: the free headline (band + weakest factor, no figures), Pro not the pack, not an error', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    const r = await callAs('claude-ai', 'analyze_site', { lat: 33.45, lon: -112.07, capacity_mw: 100, state: 'AZ' });
    expect(r.result.isError).toBe(false);
    const said = tellLine(r.text);
    expect(said, r.text.slice(0, 400)).toBeTruthy();
    // copy v11: the band (owner 2026-09-30) plus ONE measured count (MCP-1: nearby.substations_50km, a
    // count the free preview keeps) — never a score. The weakest factor stays in
    // structuredContent.limiting_factor below, not in the line a person reads.
    expect(said).toMatch(/^DC Hub names gas pipeline access as the weakest factor on this site; 12 substations within 50 km\. DC Hub Pro has the full site analysis for this location: power, gas, fiber, market and risk scores, nearby substations and power cost\. Start a 7-day Pro trial: https:\/\/\S+$/);
    expect(said).not.toMatch(/\$\d+\s*\/\s*mo/);
    expect(said).not.toMatch(/\$10|credits/);
    expect(ctaUrls(r.body)).toHaveLength(1);
    // Whole-number needles match inside tokens and timestamps (memory: whole-
    // number needles), so strip URLs and ISO times and match on number bounds.
    const scrubbed = r.body.replace(/https?:\/\/[^\s"\\]+/g, '')
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '');
    for (const n of ['62.4', '62', '40.5', '71.2', '4312.7', '7.91']) {
      expect(scrubbed).not.toMatch(new RegExp('(?<![\\d.])' + n.replace('.', '\\.') + '(?![\\d])'));
    }
    expect(r.sc.verdict).toBeUndefined();   // a site score is not a DCPI verdict
    expect(r.sc.limiting_factor.factor).toBe('gas pipeline access');
    expect(r.sc.error).toBeUndefined();
    expect(r.sc.agent_hints.error).toBe('pro_required');
  });

  it('compare_sites anonymous: per-site bands, no winner, Pro', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    const r = await callAs('claude-ai', 'compare_sites', { locations: '33.45,-112.07;39.04,-77.48' });
    expect(r.result.isError).toBe(false);
    const said = tellLine(r.text);
    expect(said).toMatch(/^DC Hub rates site 1 \(weakest: [^)]+\), site 2 \(weakest: [^)]+\)\. DC Hub Pro has the full side-by-side comparison: scores, the pick and why, nearby substations and power cost for each site\. Start a 7-day Pro trial: https:\/\/\S+$/);
    expect(ctaUrls(r.body)).toHaveLength(1);
  });
});

describe('arms and the default', () => {
  it('off (the default): no rewrite, no ?pc= tag — the old response', async () => {
    delete process.env.DCHUB_PAYWALL_CONTRACT;
    const r = await callAs('claude-ai', 'search_facilities', { provider: 'STACK', city: 'Portland' });
    expect(tellLine(r.text)).toBeNull();
    expect(r.body).not.toContain('pc=v');
    expect(r.sc.paywall_contract).toBeUndefined();
  });

  it('arm assignment: stable per identity, ~50/50 inside the window, nobody outside it', () => {
    const env = { DCHUB_PAYWALL_CONTRACT: 'ab' };
    const inWin = Date.parse(PC.PAYWALL_CONTRACT_AB_START) + 86400000;
    const ids = Array.from({ length: 2000 }, (_, i) => 'ip:198.51.100.' + i + ':' + i);
    const arms = ids.map((identity) => PC.paywallContractArm({ identity, env, now: inWin }));
    expect(arms).toEqual(ids.map((identity) => PC.paywallContractArm({ identity, env, now: inWin })));
    const share = arms.filter((a) => a === 'v2').length / arms.length;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
    expect(arms.every((a) => a === 'v1' || a === 'v2')).toBe(true);
    const after = Date.parse(PC.PAYWALL_CONTRACT_AB_START) + (PC.PAYWALL_CONTRACT_AB_DAYS + 1) * 86400000;
    expect(PC.paywallContractArm({ identity: 'x', env, now: after })).toBeNull();
    expect(PC.paywallContractArm({ identity: 'x', env: {}, now: inWin })).toBeNull();
    expect(PC.paywallContractArm({ identity: 'x', env: {}, platform: 'connectors-manager' })).toBe('grok');
    expect(PC.paywallContractArm({ identity: 'x', env: { DCHUB_PAYWALL_CONTRACT_GROK: '0' }, platform: 'grok' })).toBeNull();
  });

  it('the window restarted 2026-10-04 for 14 days: the void 09-29 window assigns nobody', () => {
    // 2026-09-29 window VOID (owner 10-03): visible links carried no ?pc, so every arm
    // landed on the control relay page.
    expect(PC.PAYWALL_CONTRACT_AB_START).toBe('2026-10-04T00:00:00Z');
    expect(PC.PAYWALL_CONTRACT_AB_DAYS).toBe(14);
    const w = PC.abWindow({});
    expect(new Date(w.start).toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(new Date(w.end).toISOString()).toBe('2026-10-18T00:00:00.000Z');
    const env = { DCHUB_PAYWALL_CONTRACT: 'ab' };
    const arm = (iso) => PC.paywallContractArm({ identity: 'ip:198.51.100.7', env, now: Date.parse(iso) });
    expect(arm('2026-10-02T12:00:00Z')).toBeNull();               // inside the void window
    expect(arm('2026-10-03T23:59:59Z')).toBeNull();
    expect(['v1', 'v2']).toContain(arm('2026-10-04T00:00:00Z'));   // first second of the restart
    expect(['v1', 'v2']).toContain(arm('2026-10-17T23:59:59Z'));
    expect(arm('2026-10-18T00:00:00Z')).toBeNull();               // end is exclusive
  });

  it('the control arm keeps its bytes but tags its relay links ?pc=v1', () => {
    const url = 'https://dchub.cloud/upgrade/h/abc_DEF-1.' + 'a'.repeat(32);
    const r = { content: [{ type: 'text', text: 'x ' + url }], structuredContent: { for_your_human: { url: url + '?offer=pro_trial_7d' } } };
    const t = PC.tagRelayLinksInResult(r, 'v1');
    expect(t.content[0].text).toBe('x ' + url + '?pc=v1');
    expect(t.structuredContent.for_your_human.url).toBe(url + '?offer=pro_trial_7d&pc=v1');
  });
});

describe('G3: Grok gets no minted key and no session copy', () => {
  it('a Grok call mints nothing, says nothing about THIS session or a header, and carries one /upgrade/h/ link', async () => {
    delete process.env.DCHUB_PAYWALL_CONTRACT;           // Grok is on the contract regardless
    const before = mintHits;
    const r = await callAs('connectors-manager', 'get_grid_intelligence', { region_id: 'PJM' });
    expect(mintHits).toBe(before);
    expect(r.body).not.toContain('dch_trial_');
    expect(r.text).not.toMatch(/THIS session|retry with header|X-API-Key|claude mcp add|call .* again/i);
    expect(r.result.isError).toBe(false);
    const urls = ctaUrls(r.body);
    expect(urls.length).toBeLessThanOrEqual(1);
    if (urls.length) expect(urls[0]).toMatch(/\/upgrade\/h\/.*[?&]pc=grok$/);
    expect(r.sc.paywall_contract).toBe('grok');
  });
});

describe('pure helpers', () => {
  it('completeness is computed, never assumed', () => {
    expect(PC.computeCompleteness({ trial_taste: true, inline_full: true }, { data: [1, 2] }).status).toBe('full');
    const p = PC.computeCompleteness({}, { data: [1, 2, 3], _data_total_in_pro: 5 });
    expect(p).toMatchObject({ status: 'partial', shown: 3, total: 5 });
    expect(PC.computeCompleteness({ _wall: true, error: 'pro_required' }, {}).status).toBe('none');
  });

  it('stripCommerce drops checkout links and agent nudges, keeps data links', () => {
    const out = PC.stripCommerce({
      profile_url: 'https://dchub.cloud/facilities/x', upgrade_url: 'https://dchub.cloud/go/c/abc',
      note: 'Call claim_free_key (no email)', nested: { credits_url: 'https://dchub.cloud/go/c/z', keep: 1,
      pay: 'https://buy.stripe.com/x' }, rows: ['a', 'see https://dchub.cloud/pricing'],
    });
    expect(out).toEqual({ profile_url: 'https://dchub.cloud/facilities/x', nested: { keep: 1 }, rows: ['a'] });
  });

  it('the human sentence stays within budget for every tool and variant', () => {
    const url = 'https://dchub.cloud/upgrade/h/x.' + 'a'.repeat(32) + '?pc=v2';
    const variants = [{ status: 'none' }, { status: 'partial', shown: 3, total: 120 }, { status: 'partial', withheld: ['a'] }, { status: 'full' }];
    for (const tool of ['analyze_site', 'compare_sites', 'get_grid_intelligence', 'get_fiber_intel', 'search_facilities', 'get_dchub_recommendation', 'rank_markets']) {
      for (const completeness of variants) {
        for (const offer of ['pack', 'pro']) {
          const s = PC.humanText({ tool, completeness, offer, url, remaining: 0 });
          expect(s.endsWith(': ' + url)).toBe(true);
          expect(s.length - url.length - 2, s).toBeLessThanOrEqual(PC.HUMAN_TEXT_MAX);
          expect(s).not.toMatch(/unlock|DO NOT|VERBATIM|your human|\*\*/i);
        }
      }
    }
  });

  it('a leading G6 key notice stays first; the Tell-the-user line leads the item after it', () => {
    const notice = { type: 'text', text: "This DC Hub connector URL's API key isn't valid, so you're getting free-tier results. Get a new key at https://dchub.cloud/install/grok" };
    const data = { type: 'text', text: JSON.stringify({ data: [1, 2, 3], _data_total_in_pro: 9, upgrade_url: 'https://dchub.cloud/go/c/x' }) };
    const url = 'https://dchub.cloud/upgrade/h/x.' + 'a'.repeat(32) + '?pc=v2';
    const out = PC.applyPaywallContract({ content: [notice, data], structuredContent: { upgrade_url: 'https://dchub.cloud/go/c/x' } },
      'rank_markets', { arm: 'v2', relayUrl: url, offer: 'pack', hosted: true });
    expect(out.content[0]).toEqual(notice);
    expect(out.content).toHaveLength(2);
    expect(out.content[1].text.split('\n')[0]).toMatch(/^Tell the user: "I got 3 of 9 markets from DC Hub\./);
    expect(out.content[1].text).toContain('"data":[1,2,3]');
    expect(out.content[1].text).not.toContain('/go/c/');
  });

  it('no socket left loopback', () => { expect(foreign).toEqual([]); });
});
