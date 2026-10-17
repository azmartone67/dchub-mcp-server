// Item 8 (owner 2026-10-16): every FREE answer ends with exactly one citable line,
//   Source: DC Hub (dchub.cloud/<path>), as of <data date>
// Unit half: lib/source-line.mjs (path selection, data date only, no duplicate, text only).
// Wiring half: the real server.mjs app on loopback (stub backend, no network): keyless and free-key
// answers end with it; a paid key, /mcp/claude and a clean platform (ChatGPT) get none.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withSourceLine, sourceLine, sourcePath, dataAsOfDay, dataAsOfHour, isSourceLine, pagePathFromUrl }
  from '../lib/source-line.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const J = (o) => JSON.stringify(o);
const res = (sc, extra = []) => ({ content: [{ type: 'text', text: J(sc) }, ...extra], structuredContent: sc });
const SRC_RE = /^Source: DC Hub \(dchub\.cloud(\/[^\s)]+)?\)(, as of \d{4}-\d{2}-\d{2})?$/;
const lastText = (r) => r.content[r.content.length - 1].text;
const sourceLines = (r) => r.content.filter((b) => typeof b.text === 'string' && SRC_RE.test(b.text));

describe('withSourceLine: one line, appended to the text only', () => {
  const sc = { market: 'columbus', provenance: { as_of: '2026-10-11T09:03:00+00:00', retrieved_at: '2026-10-16T12:00:00Z' } };

  it('adds exactly one trailing text item and leaves structuredContent byte-identical', () => {
    const r = res(sc);
    const out = withSourceLine(r, 'get_market_intel', { market: 'columbus' });
    expect(out.content).toHaveLength(2);
    expect(lastText(out)).toBe('Source: DC Hub (dchub.cloud/markets/columbus), as of 2026-10-11');
    expect(out.structuredContent).toBe(r.structuredContent);
    expect(out.content[0]).toBe(r.content[0]);
  });

  it('is idempotent and never adds a second line', () => {
    const once = withSourceLine(res(sc), 'get_market_intel', {});
    const twice = withSourceLine(once, 'get_market_intel', {});
    expect(twice).toBe(once);
    expect(sourceLines(twice)).toHaveLength(1);
  });

  it('a result that already ends with an equivalent line is returned unchanged', () => {
    const r = res(sc, [{ type: 'text', text: 'note\nSource: DC Hub (dchub.cloud), as of 2026-10-01' }]);
    expect(withSourceLine(r, 'get_market_intel', {})).toBe(r);
  });

  it('takes out the visible "Cite as:" sentence, so the answer carries one citable line', () => {
    const r = res(sc, [{ type: 'text', text: 'Next question to offer the user: "Want X?" (DC Hub tool: rank_markets). Cite as: DC Hub (dchub.cloud), as of 2026-10-16.' }]);
    const out = withSourceLine(r, 'get_market_intel', {});
    expect(out.content.map((b) => b.text).join('\n')).not.toContain('Cite as:');
    expect(out.content[1].text).toBe('Next question to offer the user: "Want X?" (DC Hub tool: rank_markets).');
    expect(lastText(out)).toMatch(SRC_RE);
    // a block that was only the Cite as sentence goes whole
    const r2 = res(sc, [{ type: 'text', text: 'Cite as: DC Hub (dchub.cloud), as of 2026-10-16.' }]);
    expect(withSourceLine(r2, 'get_market_intel', {}).content).toHaveLength(2);
  });

  it('leaves errors and error envelopes alone', () => {
    const e1 = { isError: true, content: [{ type: 'text', text: 'boom' }] };
    expect(withSourceLine(e1, 'get_market_intel', {})).toBe(e1);
    for (const bad of [{ error: 'API 404' }, { ok: false }, { success: false }, { _error_mitigation: {} }]) {
      const r = res(bad);
      expect(withSourceLine(r, 'get_market_intel', {})).toBe(r);
    }
    const empty = { content: [] };
    expect(withSourceLine(empty, 'x', {})).toBe(empty);
  });

  it('a tier preview flagged isError (the free preview stub) still gets the line; a real failure does not', () => {
    const prev = { isError: true, ...res({ market: 'columbus', provenance: { as_of: '2026-10-11', completeness: 'partial_preview' } }) };
    expect(lastText(withSourceLine(prev, 'get_market_intel', {}))).toBe('Source: DC Hub (dchub.cloud/markets/columbus), as of 2026-10-11');
    const fail = { isError: true, ...res({ error: 'API 502', provenance: { completeness: 'partial_preview' } }) };
    expect(withSourceLine(fail, 'get_market_intel', {})).toBe(fail);
    const nodata = { isError: true, ...res({ error: 'region_not_covered' }) };
    expect(withSourceLine(nodata, 'get_grid_intelligence', {})).toBe(nodata);
  });

  it('reads the payload from content[0] when there is no structuredContent', () => {
    const r = { content: [{ type: 'text', text: J(sc) }] };
    expect(lastText(withSourceLine(r, 'get_market_intel', {}))).toBe('Source: DC Hub (dchub.cloud/markets/columbus), as of 2026-10-11');
  });
});

describe('the date is the data date, never the serve time', () => {
  it('uses provenance.as_of, not retrieved_at', () => {
    expect(dataAsOfDay({ provenance: { as_of: '2026-08-31', retrieved_at: '2026-10-16T00:00:00Z' } })).toBe('2026-08-31');
  });
  it('prefers the citation date the attribution step chose', () => {
    expect(dataAsOfDay({ citation: { as_of: '2026-10-02T00:00:00Z', cite_as: 'DC Hub, dchub.cloud (as of 2026-10-02)' },
                         provenance: { as_of: '2026-09-01' } })).toBe('2026-10-02');
  });
  it('omits "as of" when the result carries no data date (retrieved_at alone is not one)', () => {
    const line = sourceLine({ citation: { retrieved_at: '2026-10-16T01:00:00Z' }, provenance: { retrieved_at: '2026-10-16T01:00:00Z' } }, 'get_news', {});
    expect(line).toBe('Source: DC Hub (dchub.cloud/news)');
    expect(line).not.toContain('as of');
  });
  it('an explicit provenance.as_of null (UNMEASURED) beats a top-level as_of', () => {
    expect(dataAsOfDay({ as_of: '2026-10-16', provenance: { as_of: null } })).toBe(null);
    expect(dataAsOfDay({ as_of: '2026-10-15' })).toBe('2026-10-15');
  });
  it('as_of_kind "retrieval" is the compute time, not a data date', () => {
    expect(dataAsOfDay({ provenance: { as_of: '2026-10-16T10:00:00Z', as_of_kind: 'retrieval' } })).toBe(null);
  });
  it('the top-level cite_as (dated by retrieval when the data has none) is not read', () => {
    expect(dataAsOfDay({ cite_as: 'DC Hub (dchub.cloud), as of 2026-10-16', provenance: { as_of: null } })).toBe(null);
  });
});

describe('path selection: the most specific public page', () => {
  it('a dchub.cloud profile_url the result carries wins', () => {
    expect(sourcePath({ data: { profile_url: 'https://dchub.cloud/facilities/equinix-dc1-83d15302?x=1' } }, 'get_facility', {}))
      .toBe('facilities/equinix-dc1-83d15302');
    expect(sourcePath({ dcpi_url: 'https://dchub.cloud/dcpi/columbus' }, 'get_market_dcpi_rank', {})).toBe('dcpi/columbus');
  });
  it('never a checkout, pricing, relay or foreign URL', () => {
    for (const u of ['https://dchub.cloud/pricing', 'https://dchub.cloud/upgrade/h/abc.def', 'https://dchub.cloud/go/c/x',
      'https://dchub.cloud/u/abcdef', 'https://evil.example/markets/columbus', 'http://dchub.cloud/markets/columbus',
      'https://dchub.cloud/api/v1/markets/columbus']) {
      expect(pagePathFromUrl(u), u).toBe(null);
    }
    expect(sourcePath({ profile_url: 'https://dchub.cloud/pricing' }, 'search_facilities', {})).toBe('');
  });
  it('a market tool: the result\'s market slug, then the argument', () => {
    expect(sourcePath({ market: 'columbus' }, 'get_market_context', { market: 'dallas' })).toBe('markets/columbus');
    expect(sourcePath({}, 'get_market_intel', { market: 'phoenix' })).toBe('markets/phoenix');
    expect(sourcePath({ market: { slug: 'reno', name: 'Reno' } }, 'get_market_intel', { market: 'x' })).toBe('markets/reno');
    expect(sourcePath({}, 'get_market_dcpi_rank', { market_slug: 'ashburn' })).toBe('markets/ashburn');
    expect(sourcePath({}, 'get_market_intel', { market: 'Not A Slug!' })).toBe('');
    expect(sourcePath({}, 'get_fiber_intel', { metro: 'ashburn' })).toBe('markets/ashburn');
  });
  it('an ISO tool: the grid page (ISO-NE is /grid/isone); a non-US region falls back', () => {
    expect(sourcePath({}, 'get_grid_intelligence', { iso: 'ERCOT' })).toBe('grid/ercot');
    expect(sourcePath({ iso: 'ISO-NE' }, 'get_iso_context', {})).toBe('grid/isone');
    expect(sourcePath({}, 'get_grid_intelligence', { iso: 'AESO' })).toBe('');
    expect(sourcePath({}, 'get_interconnection_queue', {})).toBe('interconnection-queue');
  });
  it('a tool with a page of its own, else the bare site', () => {
    expect(sourcePath({}, 'rank_markets', {})).toBe('dcpi');
    expect(sourcePath({}, 'list_transactions', {})).toBe('transactions');
    expect(sourcePath({}, 'search_facilities', {})).toBe('');
    expect(sourceLine({}, 'search_facilities', {})).toBe('Source: DC Hub (dchub.cloud)');
  });
  it('isSourceLine recognises the shape and nothing looser', () => {
    expect(isSourceLine('Source: DC Hub (dchub.cloud/grid/pjm), as of 2026-10-11')).toBe(true);
    expect(isSourceLine('Source: DC Hub (dchub.cloud)')).toBe(true);
    expect(isSourceLine('Source: DC Hub (dchub.cloud) — live data-center & energy intelligence.')).toBe(false);
  });
});

// ── Wiring: the real handler chain ─────────────────────────────────────────
const FREE_KEY = 'dch_trial_SRCLINE0123456789abcdef';
const MARKET = { market: { slug: 'columbus', name: 'Columbus' }, total_facilities: 114, total_mw: 1479,
  provenance: { source: 'DC Hub', as_of: '2026-10-11T09:03:00+00:00' } };
let H, fence;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/markets/columbus') return { ...MARKET };
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

async function call(path, { key, client = 'claude-ai', ua = 'Claude-User' } = {}) {
  const hdr = { 'user-agent': ua, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init(path, client, hdr);
  const sid = init.headers.get('mcp-session-id');
  const r = await H.call(path, 'get_market_intel', { market: 'columbus' }, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  return r.msg && r.msg.result;
}

describe('wiring: free answers end with the line, the skipped surfaces do not', () => {
  for (const [label, key] of [['keyless', null], ['free key', FREE_KEY]]) {
    it(`${label} on /mcp: the last text block is the one Source line, with the market page and the data date`, async () => {
      const r = await call('/mcp', { key });
      expect(r, 'answered').toBeTruthy();
      expect(lastText(r)).toBe('Source: DC Hub (dchub.cloud/markets/columbus), as of 2026-10-11');
      expect(sourceLines(r)).toHaveLength(1);
      expect(r.content.map((b) => b.text).join('\n')).not.toMatch(/Cite as: /);
      // structuredContent keeps its machine citation; the line is text only
      expect(JSON.stringify(r.structuredContent)).not.toContain('Source: DC Hub (dchub.cloud/markets');
    });
  }

  it('a paid key gets no Source line', async () => {
    const r = await call('/mcp', { key: PRO_KEY });
    expect(r, 'answered').toBeTruthy();
    expect(r.content[0].text, 'the paid key got the full answer').toContain('"total_mw":1479');
    expect(sourceLines(r)).toHaveLength(0);
  });

  it('/mcp/claude (directory contract: a gated result ends with the neutral line) gets none', async () => {
    const r = await call('/mcp/claude');
    expect(r, 'the directory answered').toBeTruthy();
    expect(sourceLines(r)).toHaveLength(0);
  });

  it('a clean platform (ChatGPT: one data item) gets none', async () => {
    const r = await call('/mcp', { client: 'openai-mcp', ua: 'openai-mcp/1.0' });
    expect(r, 'answered').toBeTruthy();
    expect(sourceLines(r)).toHaveLength(0);
  });

  it('kill switch DCHUB_SOURCE_LINE=0 turns it off', async () => {
    process.env.DCHUB_SOURCE_LINE = '0';
    try {
      const r = await call('/mcp');
      expect(sourceLines(r)).toHaveLength(0);
    } finally { delete process.env.DCHUB_SOURCE_LINE; }
  });
});

describe('the instructions point at summarize_for_citation', () => {
  it('the lead names it beside cite_as, with no plan name or price', async () => {
    const { OUTREACH_LEAD } = await import('../lib/agent-outreach.mjs');
    expect(OUTREACH_LEAD).toContain('(`cite_as` on every result; summarize_for_citation per figure)');
    expect(OUTREACH_LEAD).not.toMatch(/\$|\/mo\b|\bpro\b|developer|starter|per month|one-time/i);
    // served: the lean handshake every surface reads starts with the lead
    const r = await H.init('/mcp', 'claude-ai', { 'user-agent': 'Claude-User' });
    expect(r.msg.result.instructions).toContain('summarize_for_citation per figure');
  });
});

describe('Source line carries the hour a grid cite names', () => {
  const sc = { iso: 'MISO', cite_as: 'DC Hub (dchub.cloud), as of 2026-10-16T04:00Z', provenance: { as_of: '2026-10-16T04:00:00Z' } };
  it('adds the hour', () => {
    expect(dataAsOfHour(sc)).toBe('2026-10-16T04:00Z');
    expect(sourceLine(sc, 'get_grid_data', {})).toMatch(/, as of 2026-10-16T04:00Z$/);
  });
  it('a day-only cite stays day-only', () => {
    const d = { cite_as: 'DC Hub (dchub.cloud), as of 2026-10-16', provenance: { as_of: '2026-10-16' } };
    expect(dataAsOfHour(d)).toBeNull();
    expect(sourceLine(d, 'get_grid_data', {})).toMatch(/, as of 2026-10-16$/);
  });
  it('an hour on a different day than the data day is not used', () => {
    const x = { cite_as: 'DC Hub (dchub.cloud), as of 2026-10-17T01:00Z', provenance: { as_of: '2026-10-16' } };
    expect(sourceLine(x, 'get_grid_data', {})).toMatch(/, as of 2026-10-16$/);
  });
});
