// checkout-attrib-1122.test.mjs — checkout-attribution spec 2026-11-22 on the MCP side:
//   T8  platformFamily table (shared fixture with dchub-backend)
//   s1  aref minting is byte-identical to dchub-backend routes/checkout_attribution.mint_aref (fixed vectors)
//   s1  withArefLinks: relay, /licence and /go links gain aref=; other links do not; flag off = same object
//   s6/T10  a ChatGPT-family wall stands 'allowed' under the offer floor and carries the email ask (flag on only)
//   s3/T6  licence_activated is sent once per licensed key, never for a gated answer or with the flag off
//   T11 flag off: every step returns its input
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { platformFamily } from '../lib/platform-family.mjs';
import { mintAref, withArefLinks, addArefToText, checkoutAttribOn, keyRef } from '../lib/checkout-attrib.mjs';
import { FLOOR_EMAIL_LEAD } from '../lib/wall-offer-floor.mjs';

const FLAG = 'DCHUB_CHECKOUT_ATTRIB_V1';
const KREF = 'pk-' + 'a'.repeat(64);

describe('T8 platformFamily (shared fixture)', () => {
  const cases = JSON.parse(readFileSync(new URL('./fixtures/platform_family_cases.json', import.meta.url))).cases;
  it.each(cases.map((c) => [JSON.stringify(c.in), c]))('%s', (_, c) => {
    expect(platformFamily(c.in)).toBe(c.out);
  });
});

describe('aref mint mirrors the backend', () => {
  const env = { DCHUB_INTERNAL_KEY: 'vector-key' };
  const now = 1795000000 * 1000;
  it('fixed vectors computed by dchub-backend mint_aref', () => {
    expect(mintAref({ subject: KREF, family: 'chatgpt', tool: 'execute_plan', now, env }))
      .toBe('a1-o-top2v4-f5d34b60d4243047-execute_plan-' + KREF);
    expect(mintAref({ subject: '0f9c2f7e-1b2a-4c3d-9e8f-123456789abc', family: 'grok', now, env }))
      .toBe('a1-g-top2v4-0adb3bdaba5ef7f5-x-0f9c2f7e-1b2a-4c3d-9e8f-123456789abc');
  });
  it('no secret, an email or junk subject: no aref', () => {
    expect(mintAref({ subject: KREF, env: {} })).toBe('');
    expect(mintAref({ subject: 'a@b.com', env })).toBe('');
    const a = mintAref({ subject: KREF, env });
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,200}$/);
    expect(a).not.toContain('@');
  });
  it('keyRef is pk-<sha256>', () => {
    expect(keyRef('abc')).toBe('pk-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('withArefLinks', () => {
  const A = 'a1-c-1-0000000000000000-x-' + KREF;
  it('tags relay, licence and go links only, once', () => {
    const t = 'Open https://dchub.cloud/u/tok.123 or https://dchub.cloud/licence?via=mcp&tool=find_sites, '
      + 'buy https://dchub.cloud/go/p/pro. Docs: https://dchub.cloud/connect and https://dchub.cloud/u/tok.9?aref=x';
    const out = addArefToText(t, A);
    expect(out).toContain('https://dchub.cloud/u/tok.123?aref=' + A);
    expect(out).toContain('https://dchub.cloud/licence?via=mcp&tool=find_sites&aref=' + A);
    expect(out).toContain('https://dchub.cloud/go/p/pro?aref=' + A + '.');
    expect(out).toContain('https://dchub.cloud/connect and');
    expect(out).toContain('https://dchub.cloud/u/tok.9?aref=x');
  });
  it('punctuation after a link stays outside it', () => {
    expect(addArefToText('see https://dchub.cloud/u/t.1. Or https://dchub.cloud/go/p/pro?x=1, ok', 'A'))
      .toBe('see https://dchub.cloud/u/t.1?aref=A. Or https://dchub.cloud/go/p/pro?x=1&aref=A, ok');
  });
  it('rewrites JSON blocks and structuredContent, keeping JSON valid', () => {
    const sc = { human_url: 'https://dchub.cloud/u/tok', licence: { licence_url: 'https://dchub.cloud/licence?via=mcp' } };
    const r = { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
    const out = withArefLinks(r, A);
    const j = JSON.parse(out.content[0].text);
    expect(j.human_url).toBe('https://dchub.cloud/u/tok?aref=' + A);
    expect(out.structuredContent.licence.licence_url).toBe('https://dchub.cloud/licence?via=mcp&aref=' + A);
    expect(sc.human_url).toBe('https://dchub.cloud/u/tok');   // input not mutated
  });
  it('no aref: the same object', () => {
    const r = { content: [{ type: 'text', text: 'https://dchub.cloud/u/t' }] };
    expect(withArefLinks(r, '')).toBe(r);
  });
});

describe('server steps', () => {
  let S, fence;
  const prev = {};
  beforeAll(async () => {
    fence = fenceNetwork();
    for (const k of [FLAG, 'DCHUB_WALL_OFFER_FLOOR', 'DCHUB_API_BASE', 'DCHUB_WORKOS_OAUTH_ENABLED']) prev[k] = process.env[k];
    delete process.env[FLAG];
    delete process.env.DCHUB_WALL_OFFER_FLOOR;
    delete process.env.DCHUB_WORKOS_OAUTH_ENABLED;
    process.env.DCHUB_API_BASE = 'http://127.0.0.1:9';
    S = await import('../server.mjs');
  }, 60_000);
  afterAll(() => {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (fence) fence.restore();
  });
  const wall = () => ({ content: [{ type: 'text', text: '{"preview":true,"human_url":"https://dchub.cloud/u/tok"}' }] });
  const ctx = (o = {}) => ({ session_id: 's-attrib-1122', platform: 'openai-mcp', auth_source: 'none', tier: 'anonymous',
    _pendingWallHits: [{ name: 'rank_markets', status: 'anon_hard_wall', sent: false }], ...o });
  const textOf = (r) => r.content.map((b) => b.text || '').join('\n');
  const on = (fn) => { process.env[FLAG] = '1'; try { return fn(); } finally { delete process.env[FLAG]; } };

  it('T11 flag off: aref step and ChatGPT standing unchanged', () => {
    expect(checkoutAttribOn()).toBe(false);
    const r = wall();
    expect(S._arefLinksStep(r, 'rank_markets', ctx())).toBe(r);
    for (const o of [{}, { profile: 'chatgpt_directory' }]) {
      const c = ctx(o);
      const input = wall();
      expect(S._wallOfferFloorStep(input, 'rank_markets', c)).toBe(input);
      expect(['profile', 'clean']).toContain(c._offerFloor);
    }
  });
  it('s6/T10 flag on: a ChatGPT-family wall on /mcp is allowed and carries the email ask', () => on(() => {
    for (const o of [{}, { platform: 'chatgpt' }]) {
      const c = ctx(o);
      const out = S._wallOfferFloorStep(wall(), 'rank_markets', c);
      expect(c._offerFloor).toBe('allowed');
      expect(textOf(out)).toContain(FLOOR_EMAIL_LEAD);
      expect(textOf(out)).toContain('bind_email');
    }
    // the /mcp/chatgpt directory profile (frozen copy, in OpenAI review) keeps its exemption
    const d = ctx({ profile: 'chatgpt_directory' });
    const din = wall();
    expect(S._wallOfferFloorStep(din, 'rank_markets', d)).toBe(din);
    expect(d._offerFloor).toBe('profile');
    const g = ctx({ platform: 'grok' });
    S._wallOfferFloorStep(wall(), 'rank_markets', g);
    expect(g._offerFloor).toBe('grok');   // other families keep their standing
    const cl = ctx({ platform: 'claude-code', profile: 'claude_directory' });
    S._wallOfferFloorStep(wall(), 'rank_markets', cl);
    expect(cl._offerFloor).toBe('profile');
  }));
  it('s1 flag on: the aref step tags the relay link with a verifiable aref', () => on(() => {
    process.env.DCHUB_INTERNAL_KEY_SAVED = process.env.DCHUB_INTERNAL_KEY || '';
    const out = S._arefLinksStep(wall(), 'rank_markets', ctx());
    const t = textOf(out);
    if (process.env.DCHUB_INTERNAL_KEY) expect(t).toMatch(/https:\/\/dchub\.cloud\/u\/tok\?aref=a1-o-[0-9a-z]+-[0-9a-f]{16}-rank_markets-s-attrib-1122/);
    else expect(t).toBe(textOf(wall()));   // no shared secret in this process: links untouched
    expect(S._arefLinksStep(wall(), 'rank_markets', ctx({ loopback_step: true })).content[0].text).toBe(wall().content[0].text);
  }));
  it('s3/T6 licence_activated: once per licensed key, never gated, never flag off', async () => {
    const calls = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, o) => { calls.push([String(u), o]); return new Response('{}'); });
    try {
      const full = { content: [{ type: 'text', text: '{"ok":true}' }] };
      const paid = { api_key: 'dch_live_paid_key_1122', tier: 'pro', platform: 'claude-code', session_id: 's-p' };
      expect(S._licenceActivatedStep('find_sites', paid, full)).toBe(false);          // flag off
      on(() => {
        const first = S._licenceActivatedStep('find_sites', paid, full);
        const second = S._licenceActivatedStep('find_sites', paid, full);
        const free = S._licenceActivatedStep('find_sites', { ...paid, api_key: 'dch_free', tier: 'free' }, full);
        expect(second).toBe(false);
        expect(free).toBe(false);
        if (first) {
          const sent = calls.filter(([u]) => u.endsWith('/api/v1/mcp/licence-activated'));
          expect(sent).toHaveLength(1);
          const body = JSON.parse(sent[0][1].body);
          expect(body).toEqual({ key_ref: keyRef(paid.api_key), platform: 'claude-code', tool: 'find_sites' });
          expect(sent[0][1].body).not.toContain(paid.api_key);
        }
      });
    } finally { spy.mockRestore(); }
  });
});
