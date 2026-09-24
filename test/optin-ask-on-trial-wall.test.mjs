// optin-ask-on-trial-wall.test.mjs — the email opt-in ask on trial/paywall responses.
//
// Zero people had ever confirmed a marketing opt-in: the backend's paywall CTA
// lives only in the Python :8888 server, which has no public route. Measured
// live 2026-09-24, an anonymous get_grid_intelligence on dchub.cloud/mcp and a
// trial-key get_fiber_intel preview carried no opt-in link in either channel.
//
// r-optin-parity: _withOptinAsk now mirrors mcp_gatekeeper._optin_cta_block —
// flag-gated (OPTIN_CTA_ENABLED exactly "true", default OFF), the backend's two
// tools only, FREE only, the backend's `optin_cta` card. r-optin-keyed: a keyed
// caller's card comes from the backend's GET /api/v1/opt-in/cta (tier +
// suppression, CAN-SPAM); no answer means no card.
//
// These guards fail if the ask shows with the flag off or "1", on another tool,
// to a paid caller, to a keyed caller the backend did not clear, with a key in
// the link, on the dead /api/v1/marketing/opt-in path, twice in a session, if it mutates the tool data
// or _upgrade, or is unwired from the tool-dispatch chain.
//
// Qualifies for the hard gate: deterministic, no network, mutates nothing.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  _withOptinAsk, _fetchKeyedOptinCard, _optinCtaCard, _optinUrl, OPTIN_SOURCE, OPTIN_CTA_TOOLS, optinCtaEnabled,
} from '../server.mjs';

const ON = { OPTIN_CTA_ENABLED: 'true' };
const LIVE_ROUTE = 'https://dchub.cloud/api/v1/opt-in/request?';
const KEY = 'dch_trial_WZuPC0WDAWSLhrxLeGJ1xlaDop8UlxHG';
let _n = 0;
const sid = () => 'optin-test-' + (++_n) + '-' + Date.now();
const anon = () => ({ tier: 'anonymous', session_id: sid() });

// Shaped like the live anonymous response: data as JSON text, the auto-trial
// block in prose, the trial key, human relay and _upgrade in structuredContent.
const UPGRADE = { url: 'https://api.dchub.cloud/pricing/upgrade?from=mcp', price: '$10' };
const anonWall = () => ({
  content: [{ type: 'text', text: '{"iso":"ERCOT"}\n\n---\n✅ **Free trial key** `X-API-Key: ' + KEY + '`' }],
  structuredContent: {
    iso: 'ERCOT', auto_trial_key: KEY, retry_with_header: { 'X-API-Key': KEY },
    for_your_human: { url: 'https://dchub.cloud/upgrade/h/abc.def' },
    _upgrade: { ...UPGRADE },
  },
});
// A free depth-limited preview: trial_taste + a /go/c pointer in prose.
const preview = () => ({
  content: [
    { type: 'text', text: '[{"route":"a"}]' },
    { type: 'text', text: '📦 **Depth-limited preview** → https://dchub.cloud/go/c/abc.def' },
  ],
  structuredContent: { trial_taste: true, identity: { tier: 'free', credential_source: 'none' } },
});
const allText = (r) => r.content.map((c) => c.text || '').join('\n');
const urlsIn = (s) => s.match(/https:\/\/dchub\.cloud\/api\/v1\/[^\s)"']+/g) || [];

describe('flag: OPTIN_CTA_ENABLED, exactly "true", default OFF', () => {
  it.each([
    [{}, false], [{ OPTIN_CTA_ENABLED: '' }, false], [{ OPTIN_CTA_ENABLED: '1' }, false],
    [{ OPTIN_CTA_ENABLED: 'yes' }, false], [{ OPTIN_CTA_ENABLED: 'false' }, false],
    [{ OPTIN_CTA_ENABLED: 'true' }, true], [{ OPTIN_CTA_ENABLED: ' TRUE ' }, true],
  ])('%j -> %s', (env, on) => { expect(optinCtaEnabled(env)).toBe(on); });

  it.each([[{}], [{ OPTIN_CTA_ENABLED: '1' }]])('no card and no text change with %j', async (env) => {
    const w = anonWall();
    const r = await _withOptinAsk(w, 'get_grid_intelligence', anon(), env);
    expect(r).toBe(w);
    expect(r.structuredContent.optin_cta).toBeUndefined();
    expect(allText(r)).not.toContain(LIVE_ROUTE);
  });
});

describe('opt-in card on the anonymous FREE wall (flag on)', () => {
  let r;
  beforeAll(async () => { r = await _withOptinAsk(anonWall(), 'get_grid_intelligence', anon(), ON); });

  it('is the backend card shape, exactly', async () => {
    const c = r.structuredContent.optin_cta;
    expect(Object.keys(c).sort()).toEqual(
      ['optin_double_opt_in', 'optin_note', 'optin_source', 'optin_tool', 'optin_url', 'optin_value']);
    expect(c.optin_url).toBe(
      'https://dchub.cloud/api/v1/opt-in/request?source=paywall_optin_cta&tool=get_grid_intelligence');
    expect(c.optin_double_opt_in).toBe(true);
    expect(c.optin_source).toBe('paywall_optin_cta');
    expect(c.optin_tool).toBe('get_grid_intelligence');
    expect(c.optin_note.endsWith(c.optin_url)).toBe(true);
  });

  it('appends the one-line note to the text a text-only relay keeps', async () => {
    const hits = urlsIn(allText(r)).filter((u) => u.startsWith(LIVE_ROUTE));
    expect(hits).toEqual([_optinUrl('get_grid_intelligence')]);
    expect(allText(r).endsWith(r.structuredContent.optin_cta.optin_note)).toBe(true);
  });

  it('is additive: tool data and _upgrade are untouched', async () => {
    const w = anonWall();
    const before = JSON.stringify(w);
    const out = await _withOptinAsk(w, 'get_grid_intelligence', anon(), ON);
    expect(JSON.stringify(w)).toBe(before);                 // input not mutated
    expect(out.structuredContent._upgrade).toEqual(UPGRADE);
    expect(out.structuredContent.auto_trial_key).toBe(KEY);
    expect(out.content[0].text.startsWith(w.content[0].text)).toBe(true);
    const { optin_cta, ...rest } = out.structuredContent;
    expect(rest).toEqual(w.structuredContent);
  });

  it('never carries a key, even though this response holds one', async () => {
    for (const u of [r.structuredContent.optin_cta.optin_url, ...urlsIn(allText(r))]) {
      expect(u).not.toMatch(/key=|apikey|api_key|dch_|pk-|sid=|session/i);
      expect(u).not.toContain(KEY);
    }
  });

  it('never uses the dead /api/v1/marketing/opt-in path, and the source passes the page\'s rule', () => {
    expect(JSON.stringify(r)).not.toContain('/marketing/opt-in');
    expect(OPTIN_SOURCE).toMatch(/^[a-z0-9_-]{1,64}$/);
  });

  it('get_fiber_intel preview gets it on the LAST text block', async () => {
    const p = await _withOptinAsk(preview(), 'get_fiber_intel', { tier: 'free', session_id: sid() }, ON);
    expect(p.content).toHaveLength(2);
    expect(p.content[0].text).toBe('[{"route":"a"}]');
    expect(p.content[1].text).toContain(_optinUrl('get_fiber_intel'));
    expect(p.structuredContent.optin_cta.optin_tool).toBe('get_fiber_intel');
  });
});

describe('who never sees it (flag on)', () => {
  it.each(['developer', 'pro', 'enterprise', 'starter', 'founding', 'paid'])('paid tier %s', async (tier) => {
    const r = await _withOptinAsk(preview(), 'get_fiber_intel', { tier, session_id: sid() }, ON);
    expect(r.structuredContent.optin_cta).toBeUndefined();
  });

  it('a response that reports a paid identity', async () => {
    const w = preview(); w.structuredContent.identity.tier = 'pro';
    expect((await _withOptinAsk(w, 'get_fiber_intel', anon(), ON)).structuredContent.optin_cta).toBeUndefined();
  });

  it('tools outside the backend set', async () => {
    expect([...OPTIN_CTA_TOOLS].sort()).toEqual(['get_fiber_intel', 'get_grid_intelligence']);
    for (const t of ['rank_markets', 'get_grid_scoreboard', 'subscribe_digest', 'claim_free_key', 'bind_email']) {
      expect((await _withOptinAsk(anonWall(), t, anon(), ON)).structuredContent.optin_cta).toBeUndefined();
    }
  });

  it('a clean, ungated response', async () => {
    const r = await _withOptinAsk({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } },
      'get_grid_intelligence', anon(), ON);
    expect(r.structuredContent.optin_cta).toBeUndefined();
  });

  it('a second wall in the same session', async () => {
    const s = sid();
    const first = await _withOptinAsk(anonWall(), 'get_grid_intelligence', { tier: 'anonymous', session_id: s }, ON);
    const second = await _withOptinAsk(preview(), 'get_fiber_intel', { tier: 'free', session_id: s }, ON);
    expect(first.structuredContent.optin_cta).toBeTruthy();
    expect(second.structuredContent.optin_cta).toBeUndefined();
    expect(allText(second)).not.toContain(LIVE_ROUTE);
    expect((await _withOptinAsk(preview(), 'get_fiber_intel', anon(), ON)).structuredContent.optin_cta).toBeTruthy();
  });
});

// ── r-optin-keyed: a keyed caller's card is the backend's answer ────────────
const BACKEND_CARD = (t) => _optinCtaCard(t);
const okResp = (body) => ({ ok: true, json: async () => body });
let _k = 0;
const freshKey = () => 'dchub_free_test_' + (++_k) + '_' + Date.now();

describe('keyed caller (flag on)', () => {
  it('gets the card the backend cleared, relayed as the six card fields', async () => {
    const seen = [];
    const fetchCard = async (k, t) => { seen.push([k, t]); return BACKEND_CARD(t); };
    const key = freshKey();
    const r = await _withOptinAsk(anonWall(), 'get_grid_intelligence', { tier: 'free', api_key: key, session_id: sid() }, ON, fetchCard);
    expect(seen).toEqual([[key, 'get_grid_intelligence']]);
    expect(r.structuredContent.optin_cta).toEqual(BACKEND_CARD('get_grid_intelligence'));
    expect(allText(r).endsWith(r.structuredContent.optin_cta.optin_note)).toBe(true);
  });

  it('gets nothing when the backend says no (tier, suppressed, flag, error)', async () => {
    const r = await _withOptinAsk(anonWall(), 'get_grid_intelligence', { tier: 'free', api_key: freshKey(), session_id: sid() }, ON, async () => null);
    expect(r.structuredContent.optin_cta).toBeUndefined();
    expect(allText(r)).not.toContain(LIVE_ROUTE);
  });

  it('an anonymous caller never triggers a backend lookup', async () => {
    const fetchCard = vi.fn(async () => null);
    const r = await _withOptinAsk(anonWall(), 'get_grid_intelligence', anon(), ON, fetchCard);
    expect(fetchCard).not.toHaveBeenCalled();
    expect(r.structuredContent.optin_cta).toBeTruthy();
  });

  it('no lookup when the local rules already say no (flag, tool, paid, no wall, sent)', async () => {
    const fetchCard = vi.fn(async (k, t) => BACKEND_CARD(t));
    const kc = (extra = {}) => ({ tier: 'free', api_key: freshKey(), session_id: sid(), ...extra });
    await _withOptinAsk(anonWall(), 'get_grid_intelligence', kc(), {}, fetchCard);
    await _withOptinAsk(anonWall(), 'rank_markets', kc(), ON, fetchCard);
    await _withOptinAsk(anonWall(), 'get_grid_intelligence', kc({ tier: 'pro' }), ON, fetchCard);
    await _withOptinAsk({ content: [{ type: 'text', text: '{}' }], structuredContent: { ok: true } }, 'get_grid_intelligence', kc(), ON, fetchCard);
    const s = sid();
    await _withOptinAsk(anonWall(), 'get_grid_intelligence', { tier: 'anonymous', session_id: s }, ON, fetchCard);
    await _withOptinAsk(anonWall(), 'get_grid_intelligence', kc({ session_id: s }), ON, fetchCard);
    expect(fetchCard).not.toHaveBeenCalled();
  });
});

describe('_fetchKeyedOptinCard', () => {
  it('asks our backend with the key in a header, never the URL, and caches per key+tool', async () => {
    const calls = [];
    const f = async (url, init) => { calls.push([url, init]); return okResp({ ok: true, optin_cta: BACKEND_CARD('get_fiber_intel'), reason: 'ok' }); };
    const key = freshKey();
    const a = await _fetchKeyedOptinCard(key, 'get_fiber_intel', f);
    const b = await _fetchKeyedOptinCard(key, 'get_fiber_intel', f);
    expect(a).toEqual(BACKEND_CARD('get_fiber_intel'));
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toMatch(/\/api\/v1\/opt-in\/cta\?tool=get_fiber_intel$/);
    expect(url).not.toContain(key);
    expect(init.headers['X-API-Key']).toBe(key);
    expect('X-Internal-Key' in init.headers).toBe(true);
  });

  it('only the six card fields are kept', async () => {
    const extra = { ...BACKEND_CARD('get_fiber_intel'), api_key: 'leak', email: 'x@example.org' };
    const c = await _fetchKeyedOptinCard(freshKey(), 'get_fiber_intel', async () => okResp({ ok: true, optin_cta: extra }));
    expect(c).toEqual(BACKEND_CARD('get_fiber_intel'));
  });

  const bad = [
    ['404 before the route deploys', async () => ({ ok: false, status: 404, json: async () => ({}) })],
    ['throws / times out', async () => { throw new Error('aborted'); }],
    ['ok:false', async () => okResp({ ok: false, optin_cta: BACKEND_CARD('get_grid_intelligence') })],
    ['null card', async () => okResp({ ok: true, optin_cta: null, reason: 'suppressed' })],
    ['wrong tool', async () => okResp({ ok: true, optin_cta: BACKEND_CARD('get_fiber_intel') })],
    ['a url that is not the opt-in page', async () => okResp({ ok: true, optin_cta: { ...BACKEND_CARD('get_grid_intelligence'), optin_url: 'https://evil.example/x' } })],
    ['a url carrying a key', async () => okResp({ ok: true, optin_cta: { ...BACKEND_CARD('get_grid_intelligence'), optin_url: _optinUrl('get_grid_intelligence') + '&api_key=dch_x' } })],
  ];
  it.each(bad)('no card when %s', async (_label, f) => {
    expect(await _fetchKeyedOptinCard(freshKey(), 'get_grid_intelligence', f)).toBeNull();
  });
});

describe('wiring', () => {
  it('runs at the tool-dispatch chokepoint every return path merges into', async () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/_scrubCommerce\(await _withOptinAsk\(_honestCallerTier\(_ensureStructured\(await _stamped\(args, extra\)\), getCtx\(\)\), name, getCtx\(\)\)\)/);
  });
});
