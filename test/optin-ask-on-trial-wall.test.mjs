// optin-ask-on-trial-wall.test.mjs — the email opt-in ask on trial/paywall responses.
//
// Zero people had ever confirmed a marketing opt-in: the backend's paywall CTA
// lives only in the Python :8888 server, which has no public route. Measured
// live 2026-09-24, an anonymous get_grid_intelligence on dchub.cloud/mcp and a
// trial-key get_fiber_intel preview carried no opt-in link in either channel.
//
// r-optin-parity: _withOptinAsk now mirrors mcp_gatekeeper._optin_cta_block —
// flag-gated (OPTIN_CTA_ENABLED exactly "true", default OFF), the backend's two
// tools only, FREE only, the backend's `optin_cta` card, and every keyed caller
// skipped because this server cannot read the suppression list (CAN-SPAM).
//
// These guards fail if the ask shows with the flag off or "1", on another tool,
// to a keyed or paid caller, with a key in the link, on the dead
// /api/v1/marketing/opt-in path, twice in a session, if it mutates the tool data
// or _upgrade, or is unwired from the tool-dispatch chain.
//
// Qualifies for the hard gate: deterministic, no network, mutates nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  _withOptinAsk, _optinUrl, OPTIN_SOURCE, OPTIN_CTA_TOOLS, optinCtaEnabled,
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

  it.each([[{}], [{ OPTIN_CTA_ENABLED: '1' }]])('no card and no text change with %j', (env) => {
    const w = anonWall();
    const r = _withOptinAsk(w, 'get_grid_intelligence', anon(), env);
    expect(r).toBe(w);
    expect(r.structuredContent.optin_cta).toBeUndefined();
    expect(allText(r)).not.toContain(LIVE_ROUTE);
  });
});

describe('opt-in card on the anonymous FREE wall (flag on)', () => {
  const r = _withOptinAsk(anonWall(), 'get_grid_intelligence', anon(), ON);

  it('is the backend card shape, exactly', () => {
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

  it('appends the one-line note to the text a text-only relay keeps', () => {
    const hits = urlsIn(allText(r)).filter((u) => u.startsWith(LIVE_ROUTE));
    expect(hits).toEqual([_optinUrl('get_grid_intelligence')]);
    expect(allText(r).endsWith(r.structuredContent.optin_cta.optin_note)).toBe(true);
  });

  it('is additive: tool data and _upgrade are untouched', () => {
    const w = anonWall();
    const before = JSON.stringify(w);
    const out = _withOptinAsk(w, 'get_grid_intelligence', anon(), ON);
    expect(JSON.stringify(w)).toBe(before);                 // input not mutated
    expect(out.structuredContent._upgrade).toEqual(UPGRADE);
    expect(out.structuredContent.auto_trial_key).toBe(KEY);
    expect(out.content[0].text.startsWith(w.content[0].text)).toBe(true);
    const { optin_cta, ...rest } = out.structuredContent;
    expect(rest).toEqual(w.structuredContent);
  });

  it('never carries a key, even though this response holds one', () => {
    for (const u of [r.structuredContent.optin_cta.optin_url, ...urlsIn(allText(r))]) {
      expect(u).not.toMatch(/key=|apikey|api_key|dch_|pk-|sid=|session/i);
      expect(u).not.toContain(KEY);
    }
  });

  it('never uses the dead /api/v1/marketing/opt-in path, and the source passes the page\'s rule', () => {
    expect(JSON.stringify(r)).not.toContain('/marketing/opt-in');
    expect(OPTIN_SOURCE).toMatch(/^[a-z0-9_-]{1,64}$/);
  });

  it('get_fiber_intel preview gets it on the LAST text block', () => {
    const p = _withOptinAsk(preview(), 'get_fiber_intel', { tier: 'free', session_id: sid() }, ON);
    expect(p.content).toHaveLength(2);
    expect(p.content[0].text).toBe('[{"route":"a"}]');
    expect(p.content[1].text).toContain(_optinUrl('get_fiber_intel'));
    expect(p.structuredContent.optin_cta.optin_tool).toBe('get_fiber_intel');
  });
});

describe('who never sees it (flag on)', () => {
  it('any keyed caller — suppression cannot be checked here', () => {
    for (const api_key of [KEY, 'dch_live_abc', 'pk-anything']) {
      const r = _withOptinAsk(anonWall(), 'get_grid_intelligence', { tier: 'free', api_key, session_id: sid() }, ON);
      expect(r.structuredContent.optin_cta).toBeUndefined();
      expect(allText(r)).not.toContain(LIVE_ROUTE);
    }
  });

  it.each(['developer', 'pro', 'enterprise', 'starter', 'founding', 'paid'])('paid tier %s', (tier) => {
    const r = _withOptinAsk(preview(), 'get_fiber_intel', { tier, session_id: sid() }, ON);
    expect(r.structuredContent.optin_cta).toBeUndefined();
  });

  it('a response that reports a paid identity', () => {
    const w = preview(); w.structuredContent.identity.tier = 'pro';
    expect(_withOptinAsk(w, 'get_fiber_intel', anon(), ON).structuredContent.optin_cta).toBeUndefined();
  });

  it('tools outside the backend set', () => {
    expect([...OPTIN_CTA_TOOLS].sort()).toEqual(['get_fiber_intel', 'get_grid_intelligence']);
    for (const t of ['rank_markets', 'get_grid_scoreboard', 'subscribe_digest', 'claim_free_key', 'bind_email']) {
      expect(_withOptinAsk(anonWall(), t, anon(), ON).structuredContent.optin_cta).toBeUndefined();
    }
  });

  it('a clean, ungated response', () => {
    const r = _withOptinAsk({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } },
      'get_grid_intelligence', anon(), ON);
    expect(r.structuredContent.optin_cta).toBeUndefined();
  });

  it('a second wall in the same session', () => {
    const s = sid();
    const first = _withOptinAsk(anonWall(), 'get_grid_intelligence', { tier: 'anonymous', session_id: s }, ON);
    const second = _withOptinAsk(preview(), 'get_fiber_intel', { tier: 'free', session_id: s }, ON);
    expect(first.structuredContent.optin_cta).toBeTruthy();
    expect(second.structuredContent.optin_cta).toBeUndefined();
    expect(allText(second)).not.toContain(LIVE_ROUTE);
    expect(_withOptinAsk(preview(), 'get_fiber_intel', anon(), ON).structuredContent.optin_cta).toBeTruthy();
  });
});

describe('wiring', () => {
  it('runs at the tool-dispatch chokepoint every return path merges into', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/_scrubCommerce\(_withOptinAsk\(_honestCallerTier\(_ensureStructured\(await _stamped\(args, extra\)\), getCtx\(\)\), name, getCtx\(\)\)\)/);
  });
});
