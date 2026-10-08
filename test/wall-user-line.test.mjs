// wall-user-line.test.mjs — r-wall-user-line, copy_version v11 (2026-09-30)
//
// MEASURED 2026-09-29/30 (Grok, live keyless analyze_site): 52 relays minted, 0 people acted.
// The wall was an agent instruction with a ~100-char /go/c link, offered claim_free_key as
// the agent's own next step, and read as a failed call. This pins the new shape:
//   * content[0].text FIRST line is a sentence for the person with dchub.cloud/u/<code>;
//     structuredContent.user_message is that line, show_to_user true, copy_version 'v11';
//     claim_free_key follows it, as the "free preview first" alternative;
//   * the offer is TRUTHFUL per tool: Land & Power and Pro-only tools name DC Hub Pro (no
//     price, no $10); the $10 pack is described as API capacity and the line never says unlock;
//   * a keyless caller sees at most the verdict band, never a score or figure;
//   * the mint is fail-open to the long /go/c link, and isError stays owner-controlled
//     (DCHUB_WALL_ISERROR / DCHUB_WALL_SUCCESS_PLATFORMS), never hard-coded false;
//   * should-mint-claim carries cv=v11.
// Real registered handlers under a real caller seat; only the backend is stubbed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'https://backend.wall-user-line.test';
const SHORT = 'https://dchub.cloud/u/abc234';
// F5: the relay-first wall's /upgrade/h link, shortened by the same backend mint ({relay_url}).
const RELAY_SHORT = 'https://dchub.cloud/u/hre234';
const RELAY_SHORT_RE = /^https:\/\/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}$/;
let relayMode = 'ok';           // ok | http500 | junk | throw | slow
const relayPosts = [];          // { headers, body, signal }
// MCP-1: the Land & Power keyless wall's link is the signed /upgrade/h relay page.
const RELAY = /https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/;
let S, TOOLS, realFetch, prevInternal;
let shortMode = 'ok';           // ok | http500 | junk | throw
const shortPosts = [];          // { headers, body }
const claimUrls = [];
const SITE_SCORE = {
  success: true, location: { lat: 39.0412345, lon: -77.4845678, state: 'VA' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, gas_pipeline_access: 71.3, fiber_connectivity: 95.4,
            market_conditions: 60.6, risk_resilience: 72.2 },
  interpretation: 'Excellent site', source: 'DC Hub Site Intelligence',
  nearby: { substations_50km: 212, generation_capacity_mw: 5123.9 },
};
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'wall-user-line-test-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (p === '/api/v1/relay/short' && JSON.parse(init.body).relay_url !== undefined) {
      relayPosts.push({ headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
      if (relayMode === 'throw') throw new Error('boom');
      if (relayMode === 'http500') return json({ ok: false }, 503);
      if (relayMode === 'junk') return json({ ok: true, url: 'https://evil.example/u/hre234' });
      if (relayMode === 'slow') {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(json({ ok: true, code: 'hre234', url: RELAY_SHORT })), 2000);
          init.signal.addEventListener('abort', () => { clearTimeout(t); reject(init.signal.reason); });
        });
      }
      return json({ ok: true, code: 'hre234', url: RELAY_SHORT });
    }
    if (p === '/api/v1/relay/short') {
      shortPosts.push({ headers: init.headers, body: JSON.parse(init.body) });
      if (shortMode === 'throw') throw new Error('boom');
      if (shortMode === 'http500') return json({ ok: false }, 503);
      if (shortMode === 'junk') return json({ ok: true, url: 'https://evil.example/u/abc234' });
      return json({ ok: true, code: 'abc234', url: SHORT });
    }
    if (p === '/api/v1/mcp/should-mint-claim') { claimUrls.push(url); return json({ should_mint: false }); }
    if (p === '/api/site-score') return json(SITE_SCORE);
    return json({});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
  delete process.env.DCHUB_WALL_ISERROR; delete process.env.DCHUB_WALL_SUCCESS_PLATFORMS;
  delete process.env.DCHUB_WALL_SHORT_LINK; delete process.env.DCHUB_RELAY_SHORT_LINK;
});
beforeEach(() => {
  shortMode = 'ok'; shortPosts.length = 0; claimUrls.length = 0; S.keyCache.clear();
  relayMode = 'ok'; relayPosts.length = 0; delete process.env.DCHUB_RELAY_SHORT_LINK;
  delete process.env.DCHUB_WALL_ISERROR; delete process.env.DCHUB_WALL_SUCCESS_PLATFORMS;
  delete process.env.DCHUB_WALL_SHORT_LINK;
});

let seatN = 0;
const seat = (extra = {}) => ({
  tier: 'anonymous', platform: 'cursor', client_name_raw: 'cursor', ...extra,
  client_ip: '198.51.100.' + (10 + (seatN % 200)), session_id: 'sess-wall-user-line-' + (++seatN),
});
async function call(name, args, s) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const firstLine = (r) => r.content[0].text.split('\n')[0];
const LOC = { lat: 39.0412345, lon: -77.4845678, state: 'VA' };

describe('keyless analyze_site wall (Land & Power)', () => {
  it('leads with the person\'s line: /u short link to the /upgrade/h relay, Pro named, no price, no unlock', async () => {
    const r = await call('analyze_site', LOC, seat());
    const sc = r.structuredContent;
    expect(sc._wall).toBe(true);
    expect(sc.error).toBe('pro_required');
    const line = firstLine(r);
    expect(line).toContain(RELAY_SHORT);
    expect(line).not.toMatch(RELAY);
    expect(line).toContain('DC Hub Pro');
    expect(line).toContain('7-day Pro trial');
    expect(line).not.toMatch(/\$\d|unlock/i);
    expect(sc.user_message).toBe(line);
    expect(sc.show_to_user).toBe(true);
    expect(sc.copy_version).toBe('v12');
    const href = line.match(/https:\/\/\S+/)[0];
    expect(href).toMatch(RELAY_SHORT_RE);                          // Grok F5 test
    expect(sc.upgrade_url || sc.upgrade.upgrade_url).toBe(href);   // a later step nests it under upgrade
    expect(sc.for_your_human.url).toBe(href);                      // one link in both channels
    expect(sc.for_your_human.markdown).toContain(href);
    expect(sc.for_your_human.markdown).not.toMatch(RELAY);
    // nothing a person could see carries a base64 token
    expect(r.content[0].text).not.toContain('/go/c/');
    expect(r.content[0].text).not.toMatch(RELAY);
  });

  it('lists claim_free_key AFTER the user line, as the free-preview-first alternative', async () => {
    const t = (await call('analyze_site', LOC, seat())).content[0].text;
    expect(t.indexOf('claim_free_key')).toBeGreaterThan(t.indexOf(RELAY_SHORT));
    expect(t).toMatch(/prefers a free preview first/);
    expect(t.split('\n')[0]).not.toContain('claim_free_key');
  });

  it('shows no score, figure or factor value to a keyless caller', async () => {
    const r = await call('analyze_site', LOC, seat());
    const all = r.content[0].text + JSON.stringify(r.structuredContent);
    for (const f of ['83.7', '88.1', '71.3', '95.4', '60.6', '72.2', '39.0412345']) expect(all).not.toContain(f);
  });

  it('F5: mints the /u link for the EXACT signed relay URL, with the internal key and an abort signal', async () => {
    const r = await call('analyze_site', LOC, seat());
    expect(shortPosts.length).toBe(0);                  // no checkout short link on the relay path
    expect(relayPosts.length).toBe(1);
    const { headers, body, signal } = relayPosts[0];
    expect(headers['X-Internal-Key']).toBe('wall-user-line-test-internal-key');
    expect(body.relay_url).toMatch(new RegExp('^' + RELAY.source + '$'));
    expect(body).toMatchObject({ tool: 'analyze_site', host: 'cursor', copy_version: 'v12' });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(firstLine(r)).toContain(RELAY_SHORT);
  });

  it('F5: a failed, junk, slow or switched-off mint ships the long relay link exactly as before', async () => {
    const norm = (r) => JSON.stringify(r)
      .replace(new RegExp(RELAY.source, 'g'), 'RELAY')
      .replace(/sess-wall-user-line-\d+/g, 'SID')
      // CM-1: the wall is an isError result and now carries provenance, whose
      // retrieved_at is the serve time of each call, so it differs by design.
      .replace(/"retrieved_at":"[^"]*"/g, '"retrieved_at":"T"');
    process.env.DCHUB_RELAY_SHORT_LINK = '0';            // the pre-F5 path: never asks the backend
    const before = await call('analyze_site', LOC, seat());
    expect(relayPosts.length).toBe(0);
    delete process.env.DCHUB_RELAY_SHORT_LINK;
    expect(firstLine(before)).toMatch(RELAY);
    expect(before.structuredContent.for_your_human.url).toBe(firstLine(before).match(RELAY)[0]);
    for (const mode of ['http500', 'junk', 'throw', 'slow']) {
      relayMode = mode; relayPosts.length = 0;
      const t0 = Date.now();
      const r = await call('analyze_site', LOC, seat());
      expect(Date.now() - t0, mode).toBeLessThan(1500);
      expect(relayPosts.length, mode).toBe(1);
      expect(norm(r), mode).toBe(norm(before));
      const href = firstLine(r).match(RELAY)[0];
      expect(relayPosts[0].body.relay_url, mode).toBe(href);
      expect(r.structuredContent.for_your_human.url, mode).toBe(href);
    }
  });

  it('with no relay minted (DCHUB_HUMAN_RELAY=0) it falls back to the short link, then the long /go/c link', async () => {
    process.env.DCHUB_HUMAN_RELAY = '0';
    try {
      const r0 = await call('analyze_site', LOC, seat());
      expect(firstLine(r0)).toContain(SHORT);
      expect(shortPosts.length).toBe(1);
      const { headers, body } = shortPosts[0];
      expect(headers['X-Internal-Key']).toBe('wall-user-line-test-internal-key');
      expect(body).toMatchObject({ plan: 'pro', tool: 'analyze_site', host: 'cursor', copy_version: 'v12' });
      expect(body.ref).toMatch(/^sess-wall-user-line-/);
      for (const mode of ['http500', 'junk', 'throw']) {
        shortMode = mode;
        const r = await call('analyze_site', LOC, seat());
        const line = firstLine(r);
        expect(line, mode).toMatch(/https:\/\/dchub\.cloud\/go\/c\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/);
        expect(line, mode).not.toContain('/u/');
        expect(r.structuredContent.user_message, mode).toBe(line);
      }
      shortMode = 'ok'; shortPosts.length = 0;
      process.env.DCHUB_WALL_SHORT_LINK = '0';
      const r = await call('analyze_site', LOC, seat());
      expect(firstLine(r)).toContain('/go/c/');
      expect(shortPosts.length).toBe(0);
    } finally { delete process.env.DCHUB_HUMAN_RELAY; }
  });

  it('keeps the transport owner-controlled: isError true by default, false on the env switch', async () => {
    expect((await call('analyze_site', LOC, seat())).isError).toBe(true);
    process.env.DCHUB_WALL_ISERROR = '0';
    const r = await call('analyze_site', LOC, seat());
    expect(r.isError).toBe(false);
    expect(firstLine(r)).toContain(RELAY_SHORT);
    delete process.env.DCHUB_WALL_ISERROR;
    process.env.DCHUB_WALL_SUCCESS_PLATFORMS = 'cursor';
    expect((await call('analyze_site', LOC, seat())).isError).toBe(false);
  });
});

describe('a contract-arm caller (Grok) keeps the same first line', () => {
  it('the paywall contract does not replace the v11 line, and does not stack a second ask', async () => {
    const r = await call('analyze_site', LOC, seat({ platform: 'grok', client_name_raw: 'grok' }));
    const line = firstLine(r);
    expect(line).toContain(RELAY_SHORT);
    expect(line).toContain('DC Hub Pro');
    expect(line).toMatch(/names .+ as the weakest factor on this site/);      // the weakest factor, no verdict, no figure
    expect(r.structuredContent.user_message).toBe(line);
    expect(r.structuredContent.show_to_user).toBe(true);
    expect(r.structuredContent.copy_version).toBe('v12');
    expect(r.structuredContent.paywall_contract).toBe('grok');
    expect(r.content[0].text).not.toContain('Tell the user:');
    expect(r.structuredContent.for_your_human.url).toBe(RELAY_SHORT);
    // one human link in the text, and it is the relay inside the v11 line
    expect(r.content[0].text.match(/https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c|u)\//g)).toHaveLength(1);
    for (const f of ['83.7', '88.1', '71.3', '95.4']) expect(JSON.stringify(r)).not.toContain(f);
  });
});

describe('the one-number preview (MCP-1)', () => {
  it('a contract-arm wall carries the MEASURED substations_50km count in the person line, never a score or MW', async () => {
    const r = await call('analyze_site', LOC, seat({ platform: 'grok', client_name_raw: 'grok' }));
    const line = firstLine(r);
    expect(line).toMatch(/names market conditions as the weakest factor on this site; 212 substations within 50 km\. DC Hub Pro has the full site analysis/);
    expect(r.structuredContent.user_message).toBe(line);
    for (const f of ['83.7', '5123.9']) expect(JSON.stringify(r)).not.toContain(f);
  });

  it('no measurement, no number: a wall whose gate measured nothing keeps the existing line', async () => {
    // B2 (merge on/after 2026-10-19) runs analyze_site's keyless headline on every arm; its
    // kill switch DCHUB_B2_SITE_HEADLINE=0 is the "handler not run" wall this pins.
    process.env.DCHUB_B2_SITE_HEADLINE = '0';
    try {
      const r = await call('analyze_site', LOC, seat());      // cursor: no contract arm, handler not run
      expect(firstLine(r)).toMatch(/^DC Hub Pro has the full site analysis for this location: power, gas, fiber, market and risk scores, nearby substations and power cost\. Start a 7-day Pro trial: https:\/\/\S+$/);
    } finally { delete process.env.DCHUB_B2_SITE_HEADLINE; }
  });

  it('userLineText ignores a malformed or foreign count (only an integer with the module\'s own label)', async () => {
    const W = await import('../lib/wall-user-line.mjs');
    const mk = (pc) => W.userLineText({ tool: 'analyze_site', offer: 'pro', link: 'L',
      headline: { verdict: 'BUILD', preview_count: pc } });
    expect(mk({ value: 7, label: W.COUNT_LABEL })).toContain('BUILD overall; 7 substations within 50 km.');
    for (const bad of [{ value: 7.5, label: W.COUNT_LABEL }, { value: -1, label: W.COUNT_LABEL },
                       { value: 7, label: 'free text' }, { value: '7', label: W.COUNT_LABEL }, null]) {
      expect(mk(bad), JSON.stringify(bad)).toContain('BUILD overall. DC Hub Pro has');
    }
  });
});

describe('the offer is truthful per tool', () => {
  const wall = (name, opts) => S._withWallUserLine(
    { content: [{ type: 'text', text: 'body' }], structuredContent: { _wall: true } }, name, opts);

  it('every Land & Power and Pro-only tool names Pro and never a price or a pack', async () => {
    const tools = new Set([...S.LP_TOOLS, ...S.PRO_ONLY_TOOLS, 'get_grid_intelligence', 'get_fiber_intel']);
    expect(tools.size).toBeGreaterThan(6);
    for (const name of tools) {
      shortPosts.length = 0;
      const r = await S._ctxALS.run(seat(), () => wall(name));
      const line = firstLine(r);
      if (!S.PRO_ONLY_TOOLS.has(name) && !S.LP_TOOLS.has(name)) continue;   // measured below
      expect(line, name).toContain('DC Hub Pro');
      expect(line, name).not.toMatch(/\$\d|credit|unlock/i);
      if (['analyze_site', 'compare_sites', 'get_dchub_recommendation'].includes(name)) {
        expect(line, name).toContain(RELAY_SHORT);   // MCP-1 relay page, behind its F5 /u link
        expect(shortPosts.length, name).toBe(0);
      } else {
        // Grok audit 2026-10-08 (one link per wall): below Developer the person's line carries the
        // relay page (which sells Pro for these tools), not a /u short of the /go/c Pro checkout.
        expect(line, name).toMatch(/https:\/\/dchub\.cloud\/upgrade\/h\//);
        expect(shortPosts.length, name).toBe(0);
      }
    }
  });

  it('F5: a long relay copy left in the body is written as the same /u link (one link, one spelling)', async () => {
    await S._ctxALS.run(seat(), async () => {
      relayMode = 'http500';                                  // learn this request's relay URL
      const r0 = await wall('analyze_site');
      const long = firstLine(r0).match(RELAY)[0];
      relayMode = 'ok';
      const r = await S._withWallUserLine({ content: [{ type: 'text', text: 'body\nsee ' + long + ' for more' }],
                                            structuredContent: { _wall: true } }, 'analyze_site');
      expect(firstLine(r)).toContain(RELAY_SHORT);
      expect(r.content[0].text).not.toContain(long);
      expect(r.content[0].text).toContain('see ' + RELAY_SHORT + ' for more');
    });
  });

  it('a pack-class tool describes the $10 pack as API capacity, never as an unlock', async () => {
    const r = await S._ctxALS.run(seat(), () => wall('get_market_intel'));
    const line = firstLine(r);
    expect(line).toContain('$10 one-time');
    expect(line).toContain('1,000 API credits');
    expect(line).toMatch(/usage capacity/);
    expect(line).not.toMatch(/unlock/i);
    expect(line).not.toContain('DC Hub Pro');
    // Grok audit 2026-10-08 (one link per wall): the relay page, no /u short of the /go/c pack.
    expect(line).toMatch(/https:\/\/dchub\.cloud\/upgrade\/h\//);
    expect(shortPosts.length).toBe(0);
  });

  it('Grok\'s "unlock ... $10 for 1,000 credits" sentence is nowhere in the shipped copy', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../lib/wall-user-line.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/unlock it here/i);
    expect(src).not.toMatch(/\$10 one-time for 1,000 credits/);
  });
});

describe('should-mint-claim carries the copy version', () => {
  it('sends cv=v12 beside the session and tool', async () => {
    await S._ctxALS.run(seat(), async () => S.shouldMintClaim(getSid(), 'analyze_site'));
    expect(claimUrls.length).toBe(1);
    expect(new URL(claimUrls[0]).searchParams.get('cv')).toBe('v12');
  });
  function getSid() { return 'sess-wall-user-line-claim-' + (++seatN); }
});

describe('the other walls', () => {
  it('paid_only (Pro-only tool, keyless): person\'s line first, same-plan long link folded into it', async () => {
    const r = await call('get_dchub_recommendation', {}, seat());
    expect(r.structuredContent.error).toBe('paid_only');
    const line = firstLine(r);
    expect(line).toContain(RELAY_SHORT);   // MCP-1: the Pro-only wall leads with the /upgrade/h relay (F5: via /u)
    expect(r.structuredContent.for_your_human.url).toBe(RELAY_SHORT);
    expect(line).toContain('DC Hub Pro');
    expect(line).not.toMatch(/\$\d|unlock/i);
    expect(r.structuredContent.user_message).toBe(line);
    expect(r.structuredContent.copy_version).toBe('v12');
    expect(r.content[0].text).not.toMatch(/go\/c\/[A-Za-z0-9._-]*\.[0-9a-f]{32}/);   // no second pro ask
    expect(r.content[0].text.match(/https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c|u)\//g)).toHaveLength(1);
    expect(r.isError).toBe(true);   // default transport unchanged
  });

  it('a tool that needs a bound email, not a payment, keeps its bind_email wall unchanged', async () => {
    const r = await call('list_transactions', {}, seat());
    expect(r.structuredContent.error).toBe('paid_only');
    expect(r.content[0].text).toMatch(/^## .*needs a free key, not a payment/);
    expect(r.structuredContent.user_message).toBeUndefined();
    expect(shortPosts.length).toBe(0);
  });

  it('metered_over_threshold (keyed free, flagged by the backend): line first, pack as API capacity', async () => {
    const r = await call('get_grid_intelligence', {}, seat({
      tier: 'free', api_key: 'dch_live_metered_wall', metered_enforce: true }));
    expect(r.structuredContent.error).toBe('metered_over_threshold');
    const line = firstLine(r);
    // Grok audit 2026-10-08 (one link per wall): the person's line carries the relay page, the
    // same link human_url and for_your_human.url carry (they were the relay while the line was a
    // /u/ short of the /go/c metered checkout: two links). No checkout short link is minted.
    expect(line).toContain(r.structuredContent.human_url);
    expect(r.structuredContent.human_url).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\//);
    expect(r.structuredContent.for_your_human.url).toBe(r.structuredContent.human_url);
    expect(line).toContain('$10 one-time');
    expect(line).toMatch(/usage capacity/);
    expect(line).not.toMatch(/unlock/i);
    expect(r.structuredContent.user_message).toBe(line);
    expect(r.structuredContent.copy_version).toBe('v12');
    expect(shortPosts.length).toBe(0);
    expect(JSON.stringify(r)).not.toMatch(/dchub\.cloud\/(?:go\/c|u)\//);
  });
});
