// grid-sell-line.test.mjs — keyless get_grid_intelligence: one ISO-specific human
// sentence with a one-click link (owner-approved 2026-10-03), the same on both A/B
// arms, behind DCHUB_GRID_SELL_LINE; and r-go-tool: /go/c carries tool and arm
// (DCHUB_GO_TOOL). Real registered handler, backend stubbed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { gridSellLine, buyUrl, gridAgentLine, fiberAgentLine, fiberSellLine, GRID_SELL_MAX } from '../lib/grid-sell-line.mjs';

const URL1 = 'https://dchub.cloud/upgrade/h/tok.sig';

describe('gridSellLine (pure)', () => {
  const ALL = ['queue_depth_gw', 'avg_time_to_power_months', 'constraint_score', 'excess_power_score',
    'grid_emergencies_30d', 'retail_price_cents_kwh'];
  it('equal bands: the brief sentence, no em dash, price, one click', () => {
    const s = gridSellLine({ iso: 'ERCOT', bands: { constraint: 'BUILD', excess: 'BUILD' },
      withheld: ALL.slice(0, 5), url: URL1 });
    expect(s).toBe('DC Hub rates ERCOT BUILD for power, but this free preview hides queue depth, time to power, '
      + 'the constraint and excess power scores and 30-day grid emergencies. The plans that include the full ERCOT brief are on this page: '
      + '' + URL1);
    expect(s).not.toMatch(/—|\/mo|facilit/i);
  });
  it('differing bands, and no bands', () => {
    expect(gridSellLine({ iso: 'PJM', bands: { constraint: 'CAUTION', excess: 'BUILD' }, withheld: ALL, url: URL1 }))
      .toMatch(/^DC Hub rates PJM CAUTION on constraint and BUILD on excess power, but this free preview hides /);
    expect(gridSellLine({ iso: 'PJM', bands: {}, withheld: ALL, url: URL1 }))
      .toMatch(/^This free DC Hub preview of PJM hides /);
  });
  it('names at most 5, fits 240 before the URL, and says nothing it did not measure', () => {
    for (const w of [ALL, ALL.slice(0, 1), ['constraint_score'], ['excess_power_score', 'queue_depth_gw']]) {
      const s = gridSellLine({ iso: 'MISO', bands: { constraint: 'BUILD', excess: 'BUILD' }, withheld: w, url: URL1 });
      expect(s.slice(0, s.indexOf(URL1)).length).toBeLessThanOrEqual(GRID_SELL_MAX + 90);
    }
    expect(gridSellLine({ iso: 'ERCOT', withheld: ['demand_mw', 'nonsense'], url: URL1 })).toBeNull();
    expect(gridSellLine({ iso: '', withheld: ALL, url: URL1 })).toBeNull();
    expect(gridSellLine({ iso: 'ERCOT', withheld: ['constraint_score'], url: '' })).toBeNull();
  });
  it('buyUrl keeps ?pc and is idempotent', () => {
    expect(buyUrl(URL1)).toBe(URL1 + '?buy=1');
    expect(buyUrl(URL1 + '?pc=v2')).toBe(URL1 + '?pc=v2&buy=1');
    expect(buyUrl(buyUrl(URL1))).toBe(URL1 + '?buy=1');
    expect(buyUrl('https://dchub.cloud/go/c/x.y')).toBe('https://dchub.cloud/go/c/x.y');
  });
  it('repeat lines end on the /go/c link, nothing glued after it', () => {
    const link = 'https://dchub.cloud/go/c/abc.def0123';
    for (const l of [gridAgentLine('ERCOT', 13, 'x', true, link), fiberAgentLine('Ashburn', true, link)]) {
      expect(l.endsWith(link)).toBe(true);
      expect(l.indexOf(link)).toBe(l.lastIndexOf(link));
    }
    expect(gridAgentLine('ERCOT', 13, 'x', true, '')).not.toContain('go/c');
  });
  it('fiber sentence names what the preview cut, from the gate markers only', () => {
    const u = 'https://dchub.cloud/upgrade/h/x.y?buy=1';
    const s = fiberSellLine({ place: 'ashburn', hid: 'the total', url: u, shown: 3, total: 500, truncated: true, geom: true });
    expect(s).toBe('This free DC Hub fiber preview of Ashburn shows 3 of at least 500 routes, each with its path cut short. '
      + 'The full fiber answer returns all of them with complete route geometry. The plans that include it are on this page: ' + u);
    expect(s).not.toMatch(/—|carrier|capacity/i);
    expect(fiberSellLine({ place: 'ashburn', hid: 'x', url: u, shown: 3, total: 12, truncated: false, geom: false }))
      .toContain('shows 3 of 12 routes. The full fiber answer returns all of them. The plans that include it are on this page: ');
    expect(fiberSellLine({ place: 'ashburn', hid: 'x', url: u, shown: 3, total: 3, geom: true })).toContain('shows only some routes, each with its path cut short');
    // No markers: the old sentence, unchanged.
    expect(fiberSellLine({ place: 'ashburn', hid: 'the total', url: u }))
      .toBe('This free DC Hub fiber preview of Ashburn hides the total. The plans that include the full fiber answer are on this page: ' + u);
    expect(fiberSellLine({ place: 'ashburn', url: u })).toBeNull();
  });
  it('agent line: no free-allowance claim, no em dash', () => {
    const l = gridAgentLine('ERCOT', 13);
    expect(l).toContain('13 fields are withheld');
    expect(l).not.toMatch(/Free full answers left|—|bind_email|Developer/);
  });
});

const BASE = 'https://backend.grid-sell.test';
let S, TOOLS, realFetch, prevInternal;
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'grid-sell-test-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const p = new URL(String(input && input.url ? input.url : input)).pathname;
    if (p.startsWith('/api/v1/grid/intelligence/')) {
      return json({ iso: 'ERCOT', iso_name: 'ERCOT', fuel_mix: { gas: 40, wind: 30 }, constraint_score: 46.5,
        excess_power_score: 60, avg_time_to_power_months: 30, queue_depth_gw: 120, retail_price_cents_kwh: 8.1,
        grid_emergencies_30d: 2, demand_mw: 70000, news: [{ title: 'x', url: 'https://n.example/1' }] });
    }
    if (p.includes('fiber')) return json({ routes: [{ id: 'r1', carrier: 'X', miles: 10 }], total: 1, metro: 'ashburn' });
    // Owner 2026-10-08: the taste marks a field withheld only when it was PRESENT (the old trim marked
    // the shaper's nulls too), so the DCPI row and queue row the sentence names come from their feeds.
    if (p === '/api/v1/dcpi/iso-comparison') {
      return json({ isos: [{ iso: 'ERCOT', iso_name: 'ERCOT', avg_constraint: 46.5, avg_excess: 60, avg_time_to_power_months: 30,
        avg_queue_wait_months: 31, avg_kwh_cents: 8.1, sum_emergency_30d: 2, avg_reserve_margin_pct: 11.2, market_count: 5, build_count: 3 }] });
    }
    if (p === '/api/v1/interconnection-queue/snapshot') {
      return json({ by_iso: [{ iso: 'ERCOT', queued_load_total_gw: 120, queued_load_total_gw_basis: 'generation_queue', queued_generation_gw: 120, as_of: '2026-10-07' }] });
    }
    return json({});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});

let n = 0;
const seat = (extra = {}) => ({ tier: 'free', platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '203.0.113.' + (10 + (n % 200)), session_id: 'sess-grid-sell-' + (++n), ...extra });
async function grid(s, args = { iso: 'ERCOT' }) {
  const T = TOOLS.get_grid_intelligence;
  const parsed = await T.inputSchema.safeParseAsync(args);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const text = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const env = (k, v) => { const p = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; return () => { if (p === undefined) delete process.env[k]; else process.env[k] = p; }; };

describe.each([['control v1 (arm off)', undefined], ['contract v2 (on)', 'on']])('keyless grid preview, %s', (_n, pc) => {
  let restore; beforeEach(() => { restore = env('DCHUB_PAYWALL_CONTRACT', pc); });
  afterAll(() => env('DCHUB_PAYWALL_CONTRACT', undefined));
  it('one sentence naming the ISO and what it hid, ending in the ?buy=1 relay link', async () => {
    try {
      const r = await grid(seat());
      const t = text(r), sc = r.structuredContent;
      const s = sc.user_message;
      expect(s).toMatch(/ERCOT/); expect(s).toContain('The plans that include the full ERCOT brief are on this page: '); expect(s).not.toMatch(/\$10/);
      expect(s).toMatch(/constraint/); expect(s).not.toMatch(/—/);
      expect(s).toMatch(/https:\/\/dchub\.cloud\/upgrade\/h\/[^\s]+[?&]buy=1$/);
      expect(sc.for_your_human.text).toBe(s);
      expect(sc.for_your_human.url).toBe(s.slice(s.indexOf('https://')));
      expect(t).toContain(s);
      // the old header's false/pointing claims are gone from the keyless seat
      expect(t).not.toMatch(/Free full answers left today/);
      expect(t).not.toContain('the "For your human" link below');
      expect(t).not.toMatch(/\*\*Developer\*\*/);
      // exactly one /upgrade/h link in the text, and no /go/c
      expect((t.match(/dchub\.cloud\/upgrade\/h\//g) || []).length).toBe(1);
      expect(t).not.toContain('dchub.cloud/go/c/');
      expect(sc.preview_is_partial).toBe(true);        // still a gated preview, nothing unlocked
    } finally { restore(); }
  });
  it('kill switch DCHUB_GRID_SELL_LINE=0: today\'s header and line come back', async () => {
    const off = env('DCHUB_GRID_SELL_LINE', '0');
    try {
      const t = text(await grid(seat()));
      expect(t).not.toContain('buy=1');
      expect(t).not.toContain('30-day grid emergencies. The full');
      // Owner 2026-10-08: the grid brief has no free allowance any more; v1's header is the
      // missed-upgrade prompt naming Developer (test/free-decision-tools-preview-only).
      if (!pc) { expect(t).toMatch(/This answer hid /); expect(t).toMatch(/DC Hub Developer/); expect(t).not.toMatch(/Free full answers left today/); }
      else expect(t).toMatch(/^Tell the user: "This answer hid /);            // v2's own missed-lead copy
    } finally { off(); restore(); }
  });
});

describe('v2 value phrase no longer promises substation MW', () => {
  it('names what the brief returns; the kill switch restores the old phrase', async () => {
    const { valueLine } = await import('../lib/paywall-contract.mjs');
    expect(valueLine('get_grid_intelligence', {})).toMatch(/queue depth, time to power/);
    expect(valueLine('get_grid_intelligence', {})).not.toMatch(/substation/);
    const off = env('DCHUB_GRID_SELL_LINE', '0');
    try { expect(valueLine('get_grid_intelligence', {})).toBe('site-level available MW at nearby substations'); }
    finally { off(); }
  });
});

describe('keyed and unrelated calls are untouched', () => {
  it('a keyed free seat keeps its own header', async () => {
    const r = await grid(seat({ api_key: 'dch_live_gridsell_fixture' }));
    expect(text(r)).not.toContain('buy=1');
  });
  it('a pure function returns other tools unchanged', () => {
    const r = { content: [{ type: 'text', text: 'x' }], structuredContent: { iso: 'ERCOT' } };
    expect(S._gridSellStep(r, 'rank_markets')).toBe(r);
  });
});

describe('r-go-tool: /go/c carries tool and arm', () => {
  const link = 'https://buy.stripe.com/9B69AU08y2FfbSR55UaZi0i?client_reference_id=sess-x-1';
  const payload = (u) => Buffer.from(u.split('/go/c/')[1].split('.')[0], 'base64url').toString().split('|');
  it('stamps tool and arm from the call context, and never without a tool', () => {
    const run = (ctx, fn) => S._ctxALS.run(ctx, fn);
    const off1 = env('DCHUB_PAYWALL_CONTRACT', 'on');
    try {
      const withTool = run({ ...seat(), _go_tool: 'get_grid_intelligence' }, () => S._goUrl(link, 'sess-x-1'));
      const p = payload(withTool);
      expect(p.slice(0, 5)).toEqual(['metered', 'sess-x-1', 'sess-x-1', 'get_grid_intelligence', 'v2']);
      const none = run(seat(), () => S._goUrl(link, 'sess-x-1'));
      expect(payload(none)).toEqual(['metered', 'sess-x-1']);   // the token it always was
      const bad = run({ ...seat(), _go_tool: 'Not A Tool!' }, () => S._goUrl(link, 'sess-x-1'));
      expect(payload(bad)).toEqual(['metered', 'sess-x-1']);
    } finally { off1(); }
  });
  it('DCHUB_GO_TOOL=0 stops appending fields 4 and 5', () => {
    const off = env('DCHUB_GO_TOOL', '0');
    try {
      const u = S._ctxALS.run({ ...seat(), _go_tool: 'get_grid_intelligence' }, () => S._goUrl(link, 'sess-x-1'));
      expect(payload(u)).toEqual(['metered', 'sess-x-1']);
    } finally { off(); }
  });
  it('the wrapper marks the running tool before the tool runs', async () => {
    const s = seat();
    await grid(s);
    // the ctx the handler ran under now names the tool
    expect(s._go_tool).toBe('get_grid_intelligence');
  });
});

// ── Grok's 10-04 verify round (fails 1 to 4) ─────────────────────────────────
async function callTool(name, args, s) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
describe('repeat keyless grid call in one session (fail 1)', () => {
  it('the later response drops the old header, and says so without a second human line', async () => {
    const s = seat();
    const r1 = await grid(s), r2 = await grid(s);
    const t1 = text(r1), t2 = text(r2);
    expect(t1).toContain('Show your user the next line unchanged');
    for (const t of [t1, t2]) {
      expect(t).not.toMatch(/Free full answers left today/);
      expect(t).not.toContain('from earlier in this session');
      expect(t).not.toMatch(/\*\*Developer\*\*/);
    }
    expect(t1).not.toContain('dchub.cloud/go/c/');
    expect(t2).toContain('Your user was sent the full ask earlier in this session');
    expect(t2).not.toContain('Show your user the next line');
    expect((t2.match(/dchub\.cloud\/upgrade\/h\//g) || []).length).toBe(0);      // one human line per session stands
    expect((t2.match(/dchub\.cloud\/go\/c\//g) || []).length).toBe(1);           // ...and the wall keeps its one direct pointer
    expect(r2.structuredContent.for_your_human.url).toMatch(/[?&]buy=1$/);
  });
});

describe('the agent line and the list it points at match (fail 2)', () => {
  it('names continuation.gated.fields_unlocked and its exact length', async () => {
    const r = await grid(seat());
    const f = r.structuredContent.continuation.gated.fields_unlocked;
    const m = /(\d+) fields are withheld \(see ([^)]+)\)/.exec(text(r));
    expect(m && m[2]).toBe('continuation.gated.fields_unlocked');
    expect(Number(m[1])).toBe(f.length);
  });
});

describe('a market-scoped grid call names the market (fail 3)', () => {
  it('the sentence says whose grid it is; an iso-scoped call is unchanged', () => {
    const base = { iso: 'PJM', withheld: ['constraint_score', 'queue_depth_gw'], url: 'https://dchub.cloud/upgrade/h/a.b?buy=1',
      bands: { constraint: 'BUILD', excess: 'BUILD' } };
    expect(gridSellLine({ ...base, market: 'ashburn' })).toMatch(/^DC Hub rates PJM \(the grid behind Ashburn\) BUILD for power/);
    expect(gridSellLine({ ...base, market: 'northern-virginia' })).toContain('the grid behind Northern Virginia');
    expect(gridSellLine({ ...base, market: 'PJM' })).toMatch(/^DC Hub rates PJM BUILD/);
    expect(gridSellLine(base)).toMatch(/^DC Hub rates PJM BUILD/);
    expect(gridSellLine({ ...base, market: 'x; DROP TABLE' })).toMatch(/^DC Hub rates PJM BUILD/);   // not a plain slug: ignored
  });
  it('the handler remembers the market the caller passed', async () => {
    const s = seat();
    await S._ctxALS.run(s, () => S._goToolMark('get_grid_intelligence', { market: 'ashburn' }));
    expect(s._go_place).toBe('ashburn');
    await S._ctxALS.run(s, () => S._goToolMark('get_fiber_intel', { metro: 'Northern Virginia' }));
    expect(s._go_place).toBe('Northern Virginia');
    await S._ctxALS.run(s, () => S._goToolMark('get_fiber_intel', { iso: 'PJM' }));
    expect(s._go_place).toBe('');
  });
});

describe('get_fiber_intel keyless wall gets the same treatment (fail 4)', () => {
  it('one grammatical sentence, no em dash, header swapped, ask last', async () => {
    const s = seat();
    await S._ctxALS.run(s, () => S._goToolMark('get_fiber_intel', { metro: 'ashburn' }));
    const r = await callTool('get_fiber_intel', { metro: 'ashburn' }, s);
    const t = text(r), um = r.structuredContent.user_message;
    expect(um).toMatch(/^This free DC Hub fiber preview of Ashburn hides .+\. The plans that include the full fiber answer are on this page: https:\/\/dchub\.cloud\/upgrade\/h\/\S+\?buy=1$/);
    expect(um + t.slice(t.indexOf('get_fiber_intel returned'))).not.toMatch(/—/);
    expect(t).not.toMatch(/the lowest plan that returns them|payer checks out|Developer|claim_free_key/);
    expect(t).not.toContain('Next question to offer the user');
    expect(t).toContain('get_fiber_intel returned a free preview of Ashburn');
    expect((t.match(/dchub\.cloud\/upgrade\/h\//g) || []).length).toBe(1);
    expect(r.structuredContent.for_your_human.text).toBe(um);
    expect(t.trimEnd().endsWith('?buy=1')).toBe(true);
  });
  it('names the routes and geometry the gate cut when its markers are on the response', () => {
    const feat = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]], _coordinates_total_in_pro: 6 }, properties: {} };
    const T = S._gridSellStep({ content: [{ type: 'text', text: '{}\n\n→ **For your human:** open https://dchub.cloud/upgrade/h/a.b to see what your agent found.\n\n' }],
      structuredContent: { preview_is_partial: true, metro: 'ashburn', features: [feat, feat, feat], _features_total_in_pro: 500, _truncated: true,
        for_your_human: { url: 'https://dchub.cloud/upgrade/h/a.b' } } }, 'get_fiber_intel');
    expect(T.structuredContent.user_message).toBe('This free DC Hub fiber preview of Ashburn shows 3 of at least 500 routes, each with its path cut short. '
      + 'The full fiber answer returns all of them with complete route geometry. The plans that include it are on this page: https://dchub.cloud/upgrade/h/a.b?buy=1');
  });
  it('when the gate names nothing it hid, the sentence says only that it is a preview', async () => {
    const T = S._gridSellStep({ content: [{ type: 'text', text: '{}\n\n→ **For your human:** open https://dchub.cloud/upgrade/h/a.b to see what your agent found.\n\n' }],
      structuredContent: { preview_is_partial: true, metro: 'ashburn', for_your_human: { url: 'https://dchub.cloud/upgrade/h/a.b' } } }, 'get_fiber_intel');
    expect(T.structuredContent.user_message).toBe('This free DC Hub fiber preview of Ashburn hides part of the full answer. The plans that include the full fiber answer are on this page: https://dchub.cloud/upgrade/h/a.b?buy=1');
  });
  it('kill switch DCHUB_GRID_SELL_LINE=0 restores the old fiber wall', async () => {
    const off = env('DCHUB_GRID_SELL_LINE', '0');
    try {
      const t = text(await callTool('get_fiber_intel', { metro: 'ashburn' }, seat()));
      expect(t).toMatch(/the plans that return them are on the page behind the link/);
      expect(t).not.toContain('buy=1');
    } finally { off(); }
  });
});

describe('a repeat get_fiber_intel call in one session (live finding 10-04)', () => {
  it('swaps the header too: no Developer rung, no "earlier in this session" pointer, one direct link', async () => {
    const s = seat();
    for (const r of [await callTool('get_fiber_intel', { metro: 'ashburn' }, s), await callTool('get_fiber_intel', { metro: 'ashburn' }, s)]) {
      const t = text(r);
      expect(t).not.toMatch(/Developer|claim_free_key|from earlier in this session|payer checks out/);
    }
    const t2 = text(await callTool('get_fiber_intel', { metro: 'ashburn' }, s));
    expect(t2).toContain('Your user was sent the full ask earlier in this session');
    expect((t2.match(/dchub\.cloud\/go\/c\//g) || []).length).toBe(1);
    expect((t2.match(/dchub\.cloud\/upgrade\/h\//g) || []).length).toBe(0);
  });
  it('the header pattern matches with and without a trailing blank line', () => {
    const step = (text) => S._gridSellStep({ content: [{ type: 'text', text }],
      structuredContent: { preview_is_partial: true, metro: 'ashburn', for_your_human: { url: 'https://dchub.cloud/upgrade/h/a.b' } } }, 'get_fiber_intel');
    const hdr = '🔒 **This answer hid the total, and 9 more routes.** The payer checks out in one click: x → https://dchub.cloud/go/c/AA.BB (y) · or **Developer** z. Or call `claim_free_key` (one call).';
    for (const text of ['{}\n\n---\n\n' + hdr + '\n', '{}\n\n---\n\n' + hdr, '{}\n\n---\n\n' + hdr + '\n\nmore']) {
      const out = text.includes('more') ? step(text) : step(text);
      expect(out.content[0].text).not.toMatch(/Developer|claim_free_key/);
      expect(out.content[0].text).toContain('https://dchub.cloud/go/c/AA.BB');
    }
  });
});
