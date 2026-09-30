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
let S, TOOLS, realFetch, prevInternal;
let shortMode = 'ok';           // ok | http500 | junk | throw
const shortPosts = [];          // { headers, body }
const claimUrls = [];
const SITE_SCORE = {
  success: true, location: { lat: 39.0412345, lon: -77.4845678, state: 'VA' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, gas_pipeline_access: 71.3, fiber_connectivity: 95.4,
            market_conditions: 60.6, risk_resilience: 72.2 },
  interpretation: 'Excellent site', source: 'DC Hub Site Intelligence',
};
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'wall-user-line-test-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
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
  delete process.env.DCHUB_WALL_SHORT_LINK;
});
beforeEach(() => {
  shortMode = 'ok'; shortPosts.length = 0; claimUrls.length = 0; S.keyCache.clear();
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
  it('leads with the person\'s line: short link, Pro named, no price, no unlock', async () => {
    const r = await call('analyze_site', LOC, seat());
    const sc = r.structuredContent;
    expect(sc._wall).toBe(true);
    expect(sc.error).toBe('pro_required');
    const line = firstLine(r);
    expect(line).toContain(SHORT);
    expect(line).toContain('DC Hub Pro');
    expect(line).not.toMatch(/\$\d|unlock/i);
    expect(sc.user_message).toBe(line);
    expect(sc.show_to_user).toBe(true);
    expect(sc.copy_version).toBe('v11');
    expect(sc.upgrade_url || sc.upgrade.upgrade_url).toBe(SHORT);   // a later step nests it under upgrade
    // nothing a person could see carries the base64 token
    expect(r.content[0].text).not.toContain('/go/c/');
  });

  it('lists claim_free_key AFTER the user line, as the free-preview-first alternative', async () => {
    const t = (await call('analyze_site', LOC, seat())).content[0].text;
    expect(t.indexOf('claim_free_key')).toBeGreaterThan(t.indexOf(SHORT));
    expect(t).toMatch(/prefers a free preview first/);
    expect(t.split('\n')[0]).not.toContain('claim_free_key');
  });

  it('shows no score, figure or factor value to a keyless caller', async () => {
    const r = await call('analyze_site', LOC, seat());
    const all = r.content[0].text + JSON.stringify(r.structuredContent);
    for (const f of ['83.7', '88.1', '71.3', '95.4', '60.6', '72.2', '39.0412345']) expect(all).not.toContain(f);
  });

  it('mints with the same plan the long link carries, the host and copy_version v11', async () => {
    await call('analyze_site', LOC, seat());
    expect(shortPosts.length).toBe(1);
    const { headers, body } = shortPosts[0];
    expect(headers['X-Internal-Key']).toBe('wall-user-line-test-internal-key');
    expect(body).toMatchObject({ plan: 'pro', tool: 'analyze_site', host: 'cursor', copy_version: 'v11' });
    // keyless: the ref IS the session (the token drops a sid equal to the ref)
    expect(body.ref).toMatch(/^sess-wall-user-line-/);
  });

  it('fails open to the long /go/c link, still first line, on 503, junk, a throw or the kill switch', async () => {
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
  });

  it('keeps the transport owner-controlled: isError true by default, false on the env switch', async () => {
    expect((await call('analyze_site', LOC, seat())).isError).toBe(true);
    process.env.DCHUB_WALL_ISERROR = '0';
    const r = await call('analyze_site', LOC, seat());
    expect(r.isError).toBe(false);
    expect(firstLine(r)).toContain(SHORT);
    delete process.env.DCHUB_WALL_ISERROR;
    process.env.DCHUB_WALL_SUCCESS_PLATFORMS = 'cursor';
    expect((await call('analyze_site', LOC, seat())).isError).toBe(false);
  });
});

describe('a contract-arm caller (Grok) keeps the same first line', () => {
  it('the paywall contract does not replace the v11 line, and does not stack a second ask', async () => {
    const r = await call('analyze_site', LOC, seat({ platform: 'grok', client_name_raw: 'grok' }));
    const line = firstLine(r);
    expect(line).toContain(SHORT);
    expect(line).toContain('DC Hub Pro');
    expect(line).toMatch(/rates this site \w+ overall/);      // the verdict band, no figure
    expect(r.structuredContent.user_message).toBe(line);
    expect(r.structuredContent.show_to_user).toBe(true);
    expect(r.structuredContent.copy_version).toBe('v11');
    expect(r.structuredContent.paywall_contract).toBe('grok');
    expect(r.content[0].text).not.toContain('Tell the user:');
    expect(r.content[0].text).not.toContain('/upgrade/h/');
    for (const f of ['83.7', '88.1', '71.3', '95.4']) expect(JSON.stringify(r)).not.toContain(f);
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
      expect(shortPosts[0].body.plan, name).toBe('pro');
    }
  });

  it('a pack-class tool describes the $10 pack as API capacity, never as an unlock', async () => {
    const r = await S._ctxALS.run(seat(), () => wall('get_market_intel'));
    const line = firstLine(r);
    expect(line).toContain('$10 one-time');
    expect(line).toContain('1,000 API credits');
    expect(line).toMatch(/usage capacity/);
    expect(line).not.toMatch(/unlock/i);
    expect(line).not.toContain('DC Hub Pro');
    expect(shortPosts[0].body.plan).toBe('metered');
  });

  it('Grok\'s "unlock ... $10 for 1,000 credits" sentence is nowhere in the shipped copy', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../lib/wall-user-line.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/unlock it here/i);
    expect(src).not.toMatch(/\$10 one-time for 1,000 credits/);
  });
});

describe('should-mint-claim carries the copy version', () => {
  it('sends cv=v11 beside the session and tool', async () => {
    await S._ctxALS.run(seat(), async () => S.shouldMintClaim(getSid(), 'analyze_site'));
    expect(claimUrls.length).toBe(1);
    expect(new URL(claimUrls[0]).searchParams.get('cv')).toBe('v11');
  });
  function getSid() { return 'sess-wall-user-line-claim-' + (++seatN); }
});
