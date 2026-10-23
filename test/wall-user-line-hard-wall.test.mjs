// wall-user-line-hard-wall.test.mjs — copy v11 on the anonymous per-IP hard wall (2026-09-30)
// ANON_DAILY_CAP is read once at import, so this lives in its own file. A keyless caller past
// the wall gets the person's line first; the pack is described as API capacity (the wall pauses
// anonymous access, it does not sell a plan), and claim_free_key is still offered after it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// This file pins the copy the inner wall/retention steps build; the lean step (lib/lean-response.mjs,
// agent QA A 2026-10-20) trims it to one ask on /mcp. Off here so these guards keep testing the inner
// steps; test/lean-response.test.mjs guards the default.
process.env.DCHUB_LEAN_RESPONSES = '0';

let S, TOOLS, realFetch; const prev = {};
const SHORT = 'https://dchub.cloud/u/hw2345';
const RELAY_SHORT = 'https://dchub.cloud/u/hwr234';
const json = (b, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { 'content-type': 'application/json' } });
beforeAll(async () => {
  for (const k of ['DCHUB_INTERNAL_KEY', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_API_BASE']) prev[k] = process.env[k];
  process.env.DCHUB_INTERNAL_KEY = 'hard-wall-line-key';
  process.env.DCHUB_ANON_DAILY_CAP = '30';
  process.env.DCHUB_API_BASE = 'https://backend.hard-wall-line.test';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    let p = ''; try { p = new URL(String(input && input.url ? input.url : input)).pathname; } catch { /* */ }
    if (p === '/api/v1/mcp/anon-usage') return json({ ok: true, count: 999 });
    // A relay-page mint (body.relay_url, wall-to-paid P1) answers RELAY_SHORT; a /go/c mint answers SHORT.
    if (p === '/api/v1/relay/short') {
      let b = {}; try { b = JSON.parse((init && init.body) || '{}'); } catch { /* */ }
      return json({ ok: true, url: b.relay_url !== undefined ? RELAY_SHORT : SHORT });
    }
    return json({});
  };
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('anon_hard_wall', () => {
  it('leads with the person\'s line, then the existing wall, claim_free_key after', async () => {
    const T = TOOLS.get_news;
    const a = await T.inputSchema.safeParseAsync({});
    const r = await S._ctxALS.run({ tier: 'anonymous', platform: 'cursor', client_name_raw: 'cursor',
      client_ip: '198.51.100.77', session_id: 'sess-hard-wall-line-1' },
    () => T.handler(a.data || {}, { signal: new AbortController().signal }));
    expect(r.structuredContent.error).toBe('anon_hard_wall');
    const line = r.content[0].text.split('\n')[0];
    // Grok audit 2026-10-08 (one link per wall): below Developer the person's line carries the
    // relay page (the one link the wall ends with), not a /u short of the /go/c pack checkout.
    expect(line).toMatch(/https:\/\/dchub\.cloud\/(upgrade\/h\/|u\/hwr234)/);   // the relay page, as its /u/ short (wall-to-paid P1)
    expect(line).toContain(r.structuredContent.human_url);
    expect(line).not.toContain(SHORT);
    expect(line).toContain('a one-time pack adds 1,000 API credits');   // v14: no amount
    expect(line).not.toMatch(/\$\d/);
    expect(line).toMatch(/usage capacity/);
    expect(line).not.toMatch(/unlock/i);
    expect(r.structuredContent.user_message).toBe(line);
    expect(r.structuredContent.show_to_user).toBe(true);
    expect(r.structuredContent.copy_version).toBe('v14');
    expect(r.content[0].text.indexOf('claim_free_key')).toBeGreaterThan(line.length);
    expect(r.isError).toBe(true);   // owner-controlled, default unchanged
  });
});
