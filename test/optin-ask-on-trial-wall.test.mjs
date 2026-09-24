// optin-ask-on-trial-wall.test.mjs — the email opt-in ask on trial/paywall responses.
//
// Zero people had ever confirmed a marketing opt-in: the backend's paywall CTA
// lives only in the Python :8888 server, which has no public route. Measured
// live 2026-09-24, an anonymous get_grid_intelligence on dchub.cloud/mcp and a
// trial-key get_fiber_intel preview carried no opt-in link in either channel.
// _withOptinAsk puts one in both channels, once per session, never on paid tiers.
//
// These guards fail if the link is missing, carries a key, uses the dead
// /api/v1/marketing/opt-in/request path, repeats within a session, reaches a
// paid tier, or is unwired from the tool-dispatch chain.
//
// Qualifies for the hard gate: deterministic, no network, mutates nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _withOptinAsk, _optinUrl, OPTIN_SOURCE } from '../server.mjs';

const LIVE_ROUTE = 'https://dchub.cloud/api/v1/opt-in/request?';
const KEY = 'dch_trial_WZuPC0WDAWSLhrxLeGJ1xlaDop8UlxHG';
let _n = 0;
const sid = () => 'optin-test-' + (++_n) + '-' + Date.now();

// Shaped like the live anonymous response: data as JSON text, the auto-trial
// block in prose, the trial key and human relay in structuredContent.
const anonWall = () => ({
  content: [{ type: 'text', text: '{"iso":"ERCOT"}\n\n---\n✅ **Free trial key** `X-API-Key: ' + KEY + '`' }],
  structuredContent: {
    iso: 'ERCOT', auto_trial_key: KEY, retry_with_header: { 'X-API-Key': KEY },
    for_your_human: { url: 'https://dchub.cloud/upgrade/h/abc.def' },
  },
});
// Shaped like the live keyed-free preview: trial_taste + a /go/c pointer in prose.
const trialPreview = () => ({
  content: [
    { type: 'text', text: '[{"route":"a"}]' },
    { type: 'text', text: '📦 **Depth-limited preview** → https://dchub.cloud/go/c/abc.def' },
  ],
  structuredContent: { trial_taste: true, identity: { tier: 'free', credential_source: 'header' } },
});
const allText = (r) => r.content.map((c) => c.text || '').join('\n');
const urlsIn = (s) => s.match(/https:\/\/dchub\.cloud\/api\/v1\/[^\s)"']+/g) || [];

describe('opt-in ask on the anonymous trial wall', () => {
  const r = _withOptinAsk(anonWall(), 'get_grid_intelligence', { tier: 'anonymous', session_id: sid() });

  it('puts the live route in the prose a text-only relay keeps', () => {
    const hits = urlsIn(allText(r)).filter((u) => u.startsWith(LIVE_ROUTE));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe(_optinUrl('get_grid_intelligence'));
  });

  it('puts the same link in structuredContent.optin', () => {
    expect(r.structuredContent.optin.url).toBe(_optinUrl('get_grid_intelligence'));
    expect(r.structuredContent.auto_trial_key).toBe(KEY);   // nothing else dropped
  });

  it('carries source and tool, and the source passes the page\'s [a-z0-9_-]{1,64} rule', () => {
    const u = new URL(r.structuredContent.optin.url);
    expect(u.origin + u.pathname).toBe('https://dchub.cloud/api/v1/opt-in/request');
    expect(u.searchParams.get('source')).toBe(OPTIN_SOURCE);
    expect(OPTIN_SOURCE).toMatch(/^[a-z0-9_-]{1,64}$/);
    expect(u.searchParams.get('tool')).toBe('get_grid_intelligence');
  });

  it('never carries a key, even though this response holds one', () => {
    for (const u of [r.structuredContent.optin.url, ...urlsIn(allText(r)).filter((x) => x.includes('opt-in'))]) {
      expect(u).not.toMatch(/key=|apikey|api_key|dch_|pk-|k-[0-9a-f]/i);
      expect(u).not.toContain(KEY);
    }
  });

  it('never uses the dead /api/v1/marketing/opt-in path', () => {
    expect(JSON.stringify(r)).not.toContain('/marketing/opt-in');
  });
});

describe('opt-in ask on the keyed free preview', () => {
  it('appends to the LAST text block', () => {
    const r = _withOptinAsk(trialPreview(), 'get_fiber_intel', { tier: 'free', session_id: sid() });
    expect(r.content).toHaveLength(2);
    expect(r.content[0].text).toBe('[{"route":"a"}]');
    expect(r.content[1].text).toContain(_optinUrl('get_fiber_intel'));
    expect(r.structuredContent.optin.url).toBe(_optinUrl('get_fiber_intel'));
  });
});

describe('does not spam', () => {
  it('once per session', () => {
    const s = sid();
    const first = _withOptinAsk(anonWall(), 'get_grid_intelligence', { tier: 'anonymous', session_id: s });
    const second = _withOptinAsk(trialPreview(), 'get_fiber_intel', { tier: 'free', session_id: s });
    expect(first.structuredContent.optin).toBeTruthy();
    expect(second.structuredContent.optin).toBeUndefined();
    expect(allText(second)).not.toContain(LIVE_ROUTE);
    // a different session still gets its one line
    const other = _withOptinAsk(trialPreview(), 'get_fiber_intel', { tier: 'free', session_id: sid() });
    expect(other.structuredContent.optin).toBeTruthy();
  });

  it.each(['developer', 'pro', 'enterprise', 'starter', 'founding', 'paid'])('never on paid tier %s', (tier) => {
    const r = _withOptinAsk(trialPreview(), 'get_fiber_intel', { tier, session_id: sid() });
    expect(r.structuredContent.optin).toBeUndefined();
    expect(allText(r)).not.toContain(LIVE_ROUTE);
  });

  it('never when the response itself reports a paid identity', () => {
    const w = trialPreview(); w.structuredContent.identity.tier = 'pro';
    const r = _withOptinAsk(w, 'get_fiber_intel', { tier: 'free', session_id: sid() });
    expect(r.structuredContent.optin).toBeUndefined();
  });

  it('never on a clean, ungated response', () => {
    const r = _withOptinAsk({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } },
      'get_grid_scoreboard', { tier: 'free', session_id: sid() });
    expect(r.structuredContent.optin).toBeUndefined();
    expect(allText(r)).not.toContain(LIVE_ROUTE);
  });

  it('never on the opt-in or identity tools themselves', () => {
    for (const t of ['subscribe_digest', 'claim_free_key', 'bind_email']) {
      const r = _withOptinAsk(anonWall(), t, { tier: 'anonymous', session_id: sid() });
      expect(r.structuredContent.optin).toBeUndefined();
    }
  });
});

describe('wiring', () => {
  it('runs at the tool-dispatch chokepoint every return path merges into', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/_scrubCommerce\(_withOptinAsk\(_honestCallerTier\(_ensureStructured\(await _stamped\(args, extra\)\), getCtx\(\)\), name, getCtx\(\)\)\)/);
  });
});
