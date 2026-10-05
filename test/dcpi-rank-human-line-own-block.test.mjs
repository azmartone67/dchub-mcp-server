// get_market_dcpi_rank, keyless (Grok / Jonathan, 2026-10-04 6:40 PM PT):
//   1. content[0].text had the JSON AND the "For your human" line in one block, so an
//      agent that json.loads block 0 failed. The line is now its own content block.
//   2. the line said "the lowest plan that returns them is the $10 pack". Canon: the pack
//      is API capacity, never named as what returns gated fields. For this tool a pack
//      rung now points at the page that lists the plans.
// Real registered handler, stubbed backend, no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'https://backend.dcpi-own-block.test';
const SCORES = { ok: true, ghost_field: null, _ghost_field_in_pro: true, market: { slug: 'ashburn', name: 'Ashburn' }, verdict: 'BUILD',
  composite_score: 72.1, excess_power_score: 80.4, constraint_score: 31.2, quality_score: 88.0,
  avg_kwh_cents: '13.024', as_of: '2026-10-04', computed_at: '2026-10-04T12:00:00Z' };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, T, realFetch, prevBase, prevInternal;
beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'dcpi-own-block-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (p.startsWith('/api/v1/dcpi/scores/')) return json(structuredClone(SCORES));
    if (p === '/api/v1/relay/short') return json({ ok: true, code: 'abc234', url: 'https://dchub.cloud/u/abc234' });
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE; process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  T = S.createServer()._registeredTools.get_market_dcpi_rank;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal; });

let n = 0;
const seat = () => ({ tier: 'free', platform: 'cursor', client_name_raw: 'cursor',
  client_ip: '198.51.100.' + (30 + (n % 100)), session_id: 'sess-dcpi-own-block-' + (++n) });
async function call() {
  const parsed = await T.inputSchema.safeParseAsync({ market_slug: 'ashburn' });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return S._ctxALS.run(seat(), () => T.handler(parsed.data, { signal: new AbortController().signal }));
}

describe('keyless get_market_dcpi_rank', () => {
  it('block 0 is parseable JSON on its own; the human line is a separate block', async () => {
    const r = await call();
    expect(r.content.length, 'no human line was produced: the checks below would be vacuous').toBeGreaterThanOrEqual(2);
    expect(() => JSON.parse(r.content[0].text)).not.toThrow();
    expect(r.content[0].text).not.toContain('→ **For your human:**');   // the quote-free URL stand-ins inside the JSON are not the line
    const line = r.content.slice(1).find((b) => b.text.includes('→ **For your human:**'));
    expect(line, 'the line must still reach the text channel').toBeTruthy();
    expect(line.text.startsWith('→ **For your human:**')).toBe(true);
    expect(line.text).toMatch(/https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c|u)\//);
    const all = r.content.map((b) => b.text).join('\n');
    expect(all.split('→ **For your human:**').length - 1, 'exactly one human line').toBe(1);
  });

  it('never ties the $10 pack to the fields this answer hid', async () => {
    const r = await call();
    const all = r.content.map((b) => b.text).join('\n') + JSON.stringify(r.structuredContent.for_your_human || {});
    expect(all).not.toMatch(/lowest plan that returns them is the \$10 pack/);
    const up = JSON.parse(r.content[0].text)._upgrade.message;
    expect(up).toMatch(/^This answer hid /);                       // control: the missed-field sentence is there
    expect(up).not.toMatch(/\$10 pack|1,000 API credits/);          // and does not tie the pack to those fields
    expect(up).toMatch(/plans that return them/);
    const line = r.content.find((b) => b.text.includes('→ **For your human:**')).text;
    expect(line, 'the line names what was hidden (control that the clause path ran)').toMatch(/this answer hid/);
    expect(line).toMatch(/the plans that return them are on the page behind the link|the lowest plan that returns them is DC Hub (Developer|Pro)|a free DC Hub key/);
  });

  it('the relay line and _upgrade.message name the same hidden fields (a marker with no figure behind it is counted by neither)', async () => {
    const r = await call();
    const msg = JSON.parse(r.content[0].text)._upgrade.message;
    const line = r.content.find((b) => b.text.includes('→ **For your human:**')).text;
    const hid = (t) => /this answer hid (.+?)(?:\.|;)/i.exec(t)[1];
    expect(hid(msg)).toBe(hid(line));
    expect(hid(msg)).not.toMatch(/ghost/);          // control: the figure-less marker was in the payload and is not named
    expect(JSON.parse(r.content[0].text)._ghost_field_in_pro).toBe(true);
  });
});
