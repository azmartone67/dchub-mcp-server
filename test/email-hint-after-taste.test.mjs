// email-hint-after-taste.test.mjs — Grok->Brain revenue plan item 5 (2026-10-08)
//
// Measured: live tastes and walls carry no way to keep what the human saw (Identified rung 0; 0 of 88
// free/identified analyze_site keys in 30d have a reachable external email). DCHUB_EMAIL_HINT_V1
// (default OFF) appends ONE link-free agent line after a taste/wall, once per session: get an
// explicit email, state the purpose, then bind_email -> set_market_alert (or save_site -> set_site_alert).
// Deterministic, no network; process.env restored.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { _emailHintStep, _emailHintCopy, _resetEmailHintState, _ctxALS } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const wall = (over = {}) => {
  const sc = { data: [{ id: 1 }], trial_preview: true, human_url: 'https://dchub.cloud/u/dh7axt', ...over };
  return { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
};
let n = 0;
const run = (res, ctx = {}, name = 'get_market_intel') =>
  _ctxALS.run({ tier: 'free', session_id: 'sid-' + (++n), platform: 'claude', ...ctx }, () => _emailHintStep(res, name));

let saved;
beforeEach(() => { saved = process.env.DCHUB_EMAIL_HINT_V1; process.env.DCHUB_EMAIL_HINT_V1 = '1'; _resetEmailHintState(); });
afterEach(() => { if (saved === undefined) delete process.env.DCHUB_EMAIL_HINT_V1; else process.env.DCHUB_EMAIL_HINT_V1 = saved; });

describe('default OFF', () => {
  it.each([undefined, '', '0', 'off'])('flag %j returns the same object', (v) => {
    if (v === undefined) delete process.env.DCHUB_EMAIL_HINT_V1; else process.env.DCHUB_EMAIL_HINT_V1 = v;
    const w = wall(); expect(run(w)).toBe(w);
  });
  it('ships default OFF', () => {
    expect(SRC).toMatch(/_emailHintOn = \(\) => \/\^\(1\|true\|yes\|on\)\$\/i\.test\(String\(process\.env\.DCHUB_EMAIL_HINT_V1 \|\| ''\)\)/);
  });
});

describe('a taste on a market tool', () => {
  it('appends one link-free agent line and a structured save_offer', () => {
    const out = run(wall());
    expect(out.content).toHaveLength(2);
    const line = out.content[1].text;
    expect(line).not.toMatch(/https?:\/\/|dchub\.cloud/);
    expect(line).toMatch(/bind_email, then set_market_alert/);
    expect(out.structuredContent.save_offer.steps).toEqual(['bind_email', 'set_market_alert']);
  });
  it('states the purpose and forbids guessing an address (consent)', () => {
    const line = run(wall()).content[1].text;
    expect(line).toMatch(/only to recover the key and to send the alerts they set; no marketing unless they opt in/);
    expect(line).toMatch(/Never guess or invent an address/);
    expect(line).toMatch(/explicitly/);
  });
  it('leaves the first block and every existing field untouched', () => {
    const w = wall(); const out = run(w);
    expect(out.content[0]).toBe(w.content[0]);
    expect(out.structuredContent.human_url).toBe('https://dchub.cloud/u/dh7axt');
  });
});

describe('a site tool offers save_site then set_site_alert', () => {
  it.each(['analyze_site', 'find_sites', 'compare_sites'])('%s', (t) => {
    const out = run(wall(), {}, t);
    expect(out.structuredContent.save_offer.steps).toEqual(['bind_email', 'save_site', 'set_site_alert']);
    expect(out.content[1].text).toMatch(/save_site, then set_site_alert/);
  });
  it('copy builder agrees', () => { expect(_emailHintCopy('analyze_site').steps).toContain('save_site'); });
});

describe('once per session, and only where it makes sense', () => {
  it('the second wall of one session carries no second offer', () => {
    const ctx = { session_id: 'same-sid' };
    expect(run(wall(), ctx).content).toHaveLength(2);
    const w2 = wall(); expect(run(w2, ctx)).toBe(w2);
  });
  it.each([
    ['paid developer', { tier: 'developer' }], ['paid pro', { tier: 'pro' }], ['identified', { tier: 'identified' }],
    ['email already bound', { email: 'a@firm.com' }], ['ChatGPT', { platform: 'chatgpt' }],
    ['no session', { session_id: '' }], ['placeholder session', { session_id: 'no-session' }],
  ])('%s is untouched', (_l, ctx) => { const w = wall(); expect(run(w, ctx)).toBe(w); });
  it('not on our own key/email tools', () => {
    for (const t of ['claim_free_key', 'bind_email', 'recover_my_key']) { const w = wall(); expect(run(w, {}, t)).toBe(w); }
  });
  it('not on a full answer that is not a taste or wall', () => {
    const sc = { data: [1, 2, 3] };
    const w = { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
    expect(run(w)).toBe(w);
  });
  it('not on an error result, nor when an offer is already there', () => {
    const e = { ...wall(), isError: true }; expect(run(e)).toBe(e);
    const w = wall({ save_offer: { x: 1 } }); expect(run(w)).toBe(w);
  });
});

describe('wired into the pipeline', () => {
  it('wraps the partner-inbox step just inside _flagUpstreamError', () => {
    expect(SRC).toMatch(/_flagUpstreamError\(_bindNoticeOnceStep\(_emailHintStep\(await _partnerInboxStep\(/);
  });
});
