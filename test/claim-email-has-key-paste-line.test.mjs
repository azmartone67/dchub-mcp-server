// One DC Hub key per email, said plainly, plus the paste-ready line (owner funnel item 4, 2026-11-11).
//
// The backend refuses a second key for an email that already has one (error email_has_key, routes/
// one_key_per_email) and mails that key to the inbox; the refusal never carries the key. Before this
// file claim_free_key printed it as "Could not mint a key right now" with isError, and keyless
// bind_email then announced "minted a free DC Hub key with this email bound" over it.
//
// On the REAL server.mjs /mcp handler, stub backend on loopback, no network:
//   * claim_free_key and bind_email (keyless, and with a key) on an email that has a key: not an error,
//     the backend's message, the paste-ready line with a PLACEHOLDER, never a key, next_tool recover_my_key.
//   * CONTROL: a new email gets its key and the paste-ready line with that key, text and structuredContent.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) owner-live-run/1.0';
const HAS_KEY = 'has-key@firm.com';
const NEW = 'new-person@firm.com';
const MINTED = 'dch_live_ONEKEYperEMAILmint0123456789';   // fixture key, test value only
const EXISTING = 'dch_live_EXISTINGkeyNEVERshown01234567';  // must never appear in a reply
const HELD = 'dch_live_HELDbySESSIONforBIND0123456789';
const PLACEHOLDER_LINE = 'url https://dchub.cloud/mcp, headers {"X-API-Key": "<the key from the DC Hub email>"}';
const MSG = 'This email already has a DC Hub key, so no second key was made. We sent it to that inbox.';
const BIND_MSG = 'This email already has a DC Hub key, so it was not added to this key (one key per email).';

const refusal = (message) => ({ ok: false, error: 'email_has_key', message, key_sent: true,
  recover_tool: 'recover_my_key', one_key_per_email: true, paste_line_template: PLACEHOLDER_LINE });

let H, fence, ipN = 0;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/claim') {
        if (body && body.email === HAS_KEY) return refusal(MSG);
        return { ok: true, api_key: MINTED, tier: 'identified', email: body && body.email,
                 email_captured: !!(body && body.email) };
      }
      if (p === '/api/v1/keys/identify') {
        if (body && body.email === HAS_KEY) return refusal(BIND_MSG);
        return { ok: true, identified: true, email: body && body.email };
      }
      if (p === '/api/v1/keys/validate' && body && [MINTED, HELD].includes(body.api_key)) {
        return { valid: true, tier: 'identified', developer_id: 'd_onekey' };
      }
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      return undefined;
    },
  });
  H.S._readDeadline.signal = () => AbortSignal.timeout(120_000);
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

const hdr = (extra = {}) => ({ 'user-agent': UA, 'x-dc-client-ip': `198.51.100.${++ipN}`, ...extra });
async function call(name, args, h) {
  const r = await H.call('/mcp', name, args, h);
  const res = (r.msg && r.msg.result) || {};
  const texts = (res.content || []).filter((b) => b && b.type === 'text').map((b) => b.text);
  return { res, texts, text: texts.join('\n'), sc: res.structuredContent || {} };
}

function expectOneKeyReply(c, message) {
  expect(c.res.isError).not.toBe(true);
  expect(c.text).toContain('One DC Hub key per email');
  expect(c.text).toContain(message);
  expect(c.text).toContain(PLACEHOLDER_LINE);
  expect(c.text).not.toContain('Could not mint');
  expect(c.text).not.toContain('with this email bound');
  expect(c.text).not.toMatch(/dch_live_[A-Za-z0-9]{6,}/);
  expect(JSON.stringify(c.sc)).not.toContain(EXISTING);
  expect(c.sc.api_key).toBeUndefined();
  expect(c.sc.error).toBe('email_has_key');
  expect(c.sc.key_sent).toBe(true);
  expect(c.sc.paste_line_template).toBe(PLACEHOLDER_LINE);
  expect(c.sc.next_tool).toBe('recover_my_key');
}

describe('an email that already has a key', () => {
  it('claim_free_key: says one key per email, placeholder line, no error, no key', async () => {
    expectOneKeyReply(await call('claim_free_key', { email: HAS_KEY, client_name: 'onekey-check' }, hdr()), MSG);
  });

  it('bind_email with no key (mint+bind path): the claim reply, not a "minted" lead', async () => {
    const b = await call('bind_email', { email: HAS_KEY }, hdr());
    expectOneKeyReply(b, MSG);
    expect(b.text).not.toContain('minted a free DC Hub key');
  });

  it('bind_email with a key: the bind refusal, said the same way', async () => {
    const b = await call('bind_email', { email: HAS_KEY, api_key: HELD }, hdr());
    expectOneKeyReply(b, BIND_MSG);
    expect(b.sc.bound).toBe(false);
    expect(b.text).not.toContain('try another email');
  });
});

describe('CONTROL: a new email', () => {
  it('claim_free_key returns the key with the paste-ready line carrying it', async () => {
    const c = await call('claim_free_key', { email: NEW, client_name: 'onekey-new' }, hdr());
    const line = 'url https://dchub.cloud/mcp, headers {"X-API-Key": "' + MINTED + '"}';
    expect(c.res.isError).not.toBe(true);
    expect(c.sc.api_key).toBe(MINTED);
    expect(c.sc.paste_line).toBe(line);
    expect(c.text).toContain('Paste-ready');
    expect(c.text).toContain(line);
    expect(c.sc.error).toBeUndefined();
  });
});
