// site-owner-handoff-handler.test.mjs — the site-owner step is wired into the real analyze_site chain
// (owner 2026-11-10, move 1). Unit tests of _withSiteOwnerHandoff prove its rules; this proves the registered
// handler's response actually passes through it. Every network answer is a fixture.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'http://127.0.0.1:1';
let S, TOOLS, realFetch;
let verdict = 'BUILD';
beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    if (!url.startsWith(BASE)) throw new Error(`network refused by test: ${url}`);
    return new Response(JSON.stringify({ ok: true, success: true, overall_score: 72, verdict,
      scores: { power_infrastructure: 80 }, power_infrastructure: { score: 80 } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => { verdict = 'BUILD'; S._resetSiteOwnerMemoForTest(); });

async function call(seat, args) {
  const T = TOOLS.analyze_site;
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const SEAT = { tier: 'anonymous', platform: 'cursor', session_id: 'handler-owner-1', client_ip: '192.0.2.5' };
const lines = (r) => (r.content || []).filter((c) => String(c.text || '').startsWith('**If your human owns or controls this site:**'));

describe('analyze_site handler carries the site-owner hand-off', () => {
  it('BUILD at a point: one line and structuredContent.site_owner (the tool schema accepts it)', async () => {
    const r = await call(SEAT, { lat: 44.08, lon: -103.21, capacity_mw: 50 });
    expect(lines(r)).toHaveLength(1);
    expect(r.structuredContent.site_owner.advisory.name).toBe('Martone Advisors');
  });
  it('control: AVOID at the same point carries nothing', async () => {
    verdict = 'AVOID';
    const r = await call({ ...SEAT, session_id: 'handler-owner-2', client_ip: '192.0.2.6' }, { lat: 44.08, lon: -103.21 });
    expect(lines(r)).toHaveLength(0);
    expect(r.structuredContent && r.structuredContent.site_owner).toBeUndefined();
  });
});
