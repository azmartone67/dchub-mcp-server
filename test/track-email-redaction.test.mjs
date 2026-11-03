// Logged params carry no email address (2026-11-02). bind_email and claim_free_key args reached
// mcp_call_log.params with the raw address; trackToolCall now redacts every logged payload.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { redactEmails } from '../lib/log-redact.mjs';

const ADDR = 'qa-redact-person@example.com';

describe('lib/log-redact redactEmails', () => {
  it('R1 replaces every address at any depth and keeps the keys', () => {
    expect(redactEmails({ email: ADDR, iso: 'PJM' })).toEqual({ email: '[email]', iso: 'PJM' });
    expect(redactEmails({ q: 'mail ' + ADDR + ' or b.c+d@x.co.uk' })).toEqual({ q: 'mail [email] or [email]' });
    expect(redactEmails({ a: [{ to: ADDR }], n: 3, ok: true, z: null })).toEqual({ a: [{ to: '[email]' }], n: 3, ok: true, z: null });
    expect(redactEmails('{"email":"' + ADDR + '"}')).toBe('{"email":"[email]"}');
  });
  it('R2 leaves text without an address untouched', () => {
    const p = { query: 'Ashburn @ 100 MW', handle: '@dchub' };
    expect(redactEmails(p)).toEqual(p);
    expect(redactEmails(undefined)).toBeUndefined();
  });
});

let H, fence;
async function settle(quietMs = 400, maxMs = 8000) {
  const t0 = Date.now();
  let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((res) => setTimeout(res, 50));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function hitsFor(tool, args) {
  await settle();
  const before = H.hits.length;
  let hdr = { 'user-agent': 'Claude-User' };
  const init = await H.init('/mcp', 'probe-client', hdr);
  const sid = init.headers.get('mcp-session-id');
  if (sid) hdr = { ...hdr, 'mcp-session-id': sid };
  await H.call('/mcp', tool, args, hdr);
  await settle();
  const hits = H.hits.slice(before);
  return { hits, track: hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === tool) };
}
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({}); }, 60_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('R3 over the real app (stub backend, no network)', () => {
  for (const tool of ['bind_email', 'claim_free_key']) {
    it(tool + ': the track row says an email was given, never which', async () => {
      const { hits, track } = await hitsFor(tool, { email: ADDR });
      expect(track.length, 'control: the call is logged').toBeGreaterThan(0);
      for (const t of track) expect(t.body.params.email).toBe('[email]');
      const allTrack = hits.filter((h) => h.path === '/api/v1/mcp/track');
      expect(JSON.stringify(allTrack.map((h) => h.body))).not.toContain(ADDR);
      // control: the handler itself still got the real address (only the log copy is redacted)
      const other = hits.filter((h) => h.path !== '/api/v1/mcp/track');
      expect(JSON.stringify(other.map((h) => [h.path, h.body, h.query]))).toContain(ADDR);
    });
  }
});
