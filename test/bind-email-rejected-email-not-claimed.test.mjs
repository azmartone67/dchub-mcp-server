// bind_email / claim_free_key never report a bind the backend refused (2026-11-10).
//
// An owner live check called bind_email keylessly with the docs placeholder `you@yourdomain.com`.
// Keyless bind_email mints through claim_free_key -> POST /api/v1/keys/claim {email}; that door now runs
// validate_email (backend, same gate as /keys/identify) and mints the key WITHOUT a rejected address,
// answering email_rejected:true + email_rejected_reason. Before this file, bind_email's lead said
// "minted a free DC Hub key with this email bound" unconditionally, and claim_free_key said nothing.
//
// On the REAL server.mjs /mcp handler, stub backend on loopback, no network:
//   * bind_email (sessionless and with a session) and claim_free_key with a rejected address: the text
//     says the email was NOT bound and asks for a real one; structuredContent carries email_rejected,
//     email_bound:false and next_tool bind_email; the "with this email bound" lead is absent.
//   * CONTROL: a real address keeps the existing "with this email bound" lead, and no NOT-bound line.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) owner-live-run/1.0';
const PLACEHOLDER = 'you@yourdomain.com';
const REAL = 'jane@firm.com';
const MINTED = 'dch_live_REJECTEDemailmint0123456789';   // fixture key, test value only
const BOUND_LEAD = 'No key on this session, so `bind_email` minted a free DC Hub key with this email bound (one call). ';
const NOT_BOUND_LEAD = 'No key on this session, so `bind_email` minted a free DC Hub key, but the email was NOT bound to it (see below). ';
const NOT_BOUND_LINE = '⚠️ **That email was NOT bound to this key**: it looks undeliverable (placeholder).';

let H, fence, ipN = 0, claimBodies = [];

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/claim') {
        claimBodies.push(body);
        if (body && body.email === PLACEHOLDER) {
          // what the backend claim door answers now: key minted, email dropped, reason given
          return { ok: true, api_key: MINTED, tier: 'identified', email: null, email_captured: false,
                   email_rejected: true, email_rejected_reason: 'placeholder', email_error: 'undeliverable_email' };
        }
        return { ok: true, api_key: MINTED, tier: 'identified', email: body && body.email, email_captured: !!(body && body.email) };
      }
      if (p === '/api/v1/keys/validate' && body && body.api_key === MINTED) return { valid: true, tier: 'identified', developer_id: 'd_rej' };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      return undefined;
    },
  });
  H.S._readDeadline.signal = () => AbortSignal.timeout(120_000);
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { claimBodies = []; });

const hdr = (extra = {}) => ({ 'user-agent': UA, 'x-dc-client-ip': `198.51.100.${++ipN}`, ...extra });
async function call(name, args, h) {
  const r = await H.call('/mcp', name, args, h);
  const res = (r.msg && r.msg.result) || {};
  const texts = (res.content || []).filter((b) => b && b.type === 'text').map((b) => b.text);
  return { res, texts, text: texts.join('\n'), sc: res.structuredContent || {} };
}

describe('a rejected email is never reported as bound', () => {
  it('bind_email (sessionless, keyless) with a placeholder: NOT-bound lead and line, no bound claim', async () => {
    const bind = await call('bind_email', { email: PLACEHOLDER }, hdr());
    expect(claimBodies.map((b) => b && b.email)).toEqual([PLACEHOLDER]);   // it went through the claim door
    expect(bind.sc.bind_email_path).toBe('keyless_mint_bind');
    expect(bind.sc.api_key).toBe(MINTED);                                  // the key is still handed over
    expect(bind.texts[0].startsWith(NOT_BOUND_LEAD)).toBe(true);
    expect(bind.text).not.toContain('with this email bound');
    expect(bind.text).toContain(NOT_BOUND_LINE);
    expect(bind.sc.email_rejected).toBe(true);
    expect(bind.sc.email_bound).toBe(false);
    expect(bind.sc.email_rejected_reason).toBe('placeholder');
    expect(bind.sc.next_tool).toBe('bind_email');
  });

  it('bind_email WITH a session and a placeholder: same honest text', async () => {
    const h = hdr();
    const sid = (await H.init('/mcp', 'claude-ai', h)).headers.get('mcp-session-id');
    expect(sid).toBeTruthy();
    const bind = await call('bind_email', { email: PLACEHOLDER }, { ...h, 'mcp-session-id': sid });
    expect(bind.texts[0].startsWith(NOT_BOUND_LEAD)).toBe(true);
    expect(bind.text).not.toContain('with this email bound');
    expect(bind.text).toContain(NOT_BOUND_LINE);
  });

  it('claim_free_key with a placeholder: leads with the NOT-bound line', async () => {
    const c = await call('claim_free_key', { email: PLACEHOLDER, client_name: 'rej-check' }, hdr());
    expect(c.sc.api_key).toBe(MINTED);
    expect(c.texts[0].startsWith(NOT_BOUND_LINE)).toBe(true);
    expect(c.sc.email_rejected).toBe(true);
    expect(c.sc.next_tool).toBe('bind_email');
    expect(c.sc.daily_full_answers_per_tool).not.toBe(undefined);
  });

  it('CONTROL: a real address keeps the bound lead and gets no NOT-bound line', async () => {
    const bind = await call('bind_email', { email: REAL }, hdr());
    expect(claimBodies.map((b) => b && b.email)).toEqual([REAL]);
    expect(bind.texts[0].startsWith(BOUND_LEAD)).toBe(true);
    expect(bind.text).not.toContain('NOT bound');
    expect(bind.sc.email_rejected).toBeUndefined();
    const c = await call('claim_free_key', { email: REAL, client_name: 'real-check' }, hdr());
    expect(c.text).not.toContain('NOT bound');
    expect(c.sc.email_rejected).toBeUndefined();
  });
});
