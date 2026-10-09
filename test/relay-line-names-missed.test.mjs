// relay-line-names-missed.test.mjs — r-relay-names-missed (owner-approved 2026-09-29)
//
// The "→ **For your human:**" relay line used to say only how many rows were
// behind the wall (treatment arm) or nothing at all (control arm). It now also
// names the fields THIS response stripped and the lowest plan that returns
// them. frz-claude-relay-wording was already broken (2026-09-29T07:56:01Z)
// and the owner asked for this change.
//
// Checked through the REAL server against a stub backend that answers each
// tool with a complete payload, for rank_markets, get_grid_intelligence,
// get_market_intel and search_facilities:
//   1. FIELDS. The named fields are the ones this response stripped: every
//      label names a field that is a figure for a Pro key and null or missing
//      for this caller, and every stripped field is named or counted.
//   2. PLAN. The named plan is the gate's own required rung. A caller holding
//      THAT plan gets every stripped field back, and a caller one rung lower
//      still does not.
//   3. SHAPE. One line, relayable verbatim, no monthly price, and nothing that
//      calls the $10 pack an unlock.
//   4. /mcp/chatgpt does not change: the directory profile never carries the
//      line, and the paywall contract does not assign it.
// Pure-helper cases pin the wording and prove the clause falls back to the old
// line when either half is unknown.
//
// Hard-gate qualified: real server on 127.0.0.1 against a local stub, no egress.
// Item 2 (Grok 10-08): depth walls are plan-less by default, so this file's rung checks run with
// DCHUB_DEPTH_WALL_PLANLESS=0 (they test WHICH rung the gate computes; the plan-less copy is pinned in
// free-decision-tools-preview-only.test.mjs).
process.env.DCHUB_DEPTH_WALL_PLANLESS = '0';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import {
  relayMissedClause, relayPlanName, hiddenFieldsPhrase, fieldLabel, RUNGS,
} from '../lib/upgrade-missed.mjs';
import { continuationHumanText } from '../lib/continuation.mjs';

// ── seats ────────────────────────────────────────────────────────────────────
// A fresh free and pack key per tool, so one tool's daily counters cannot
// decide another tool's answer.
const TOOLS = ['rank_markets', 'get_grid_intelligence', 'get_market_intel', 'search_facilities'];
const keyFor = (kind, tool) => `dch_live_${kind}${tool.replace(/_/g, '')}0123456789abcdef`.slice(0, 48);
const FREE_KEYS = new Set(TOOLS.map((t) => keyFor('FREE', t)));
const PACK_KEYS = new Set(TOOLS.map((t) => keyFor('PACK', t)));
const DEV_KEY = 'dch_live_DEVkey0123456789abcdefabcdef00';

// ── complete backend payloads ────────────────────────────────────────────────
const MARKETS = ['northern-virginia', 'dallas', 'phoenix', 'chicago', 'atlanta', 'hillsboro', 'columbus', 'reno', 'san-antonio', 'salt-lake-city'];
const PAYLOADS = {
  '/api/v1/mcp/tools/rank_markets': {
    criteria: 'best_overall', region: 'us', result_count: 10,
    results: MARKETS.map((m, i) => ({ rank: i + 1, market: m, state: 'VA', total_mw: 5000 - i * 300,
      facility_count: 300 - i * 10, operator_count: 40 - i, dcpi_score: 90 - i * 3, avg_lease_rate_kw_mo: 140 - i * 5 })),
  },
  '/api/v1/grid/intelligence/PJM': {
    region: 'PJM', demand_mw: 120000, demand_period: '2026-09-29T09', generation_mix_period: '2026-09-29T09',
    generation_mix: { NG: { mw: 50000 }, NUC: { mw: 33000 }, WND: { mw: 6000 }, SUN: { mw: 4000 }, COL: { mw: 20000 } },
  },
  '/api/v1/dcpi/iso-comparison': {
    isos: [{ iso: 'PJM', iso_name: 'PJM Interconnection', avg_constraint: 71.2, avg_excess: 55.4,
      avg_time_to_power_months: 36, avg_queue_wait_months: 48, avg_curtailment_pct: 2.1,
      market_count: 10, build_count: 4, grid_emergencies_30d: 1 }],
  },
  '/api/v1/interconnection-queue/snapshot': { by_iso: [{ iso: 'PJM', queue_depth_gw: 250, dc_share_pct: 18 }] },
  '/api/v1/facilities': {
    success: true, count: 12, total: 12,
    data: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Campus ' + (i + 1), operator: 'Op' + i,
      city: 'Ashburn', state: 'VA', power_mw: 20 + i, total_power_mw: 30 + i, latitude: 39.0, longitude: -77.4 })),
  },
  '/api/v1/markets/northern-virginia': {
    market: { slug: 'northern-virginia', name: 'Northern Virginia' }, stats: { facility_count: 310, total_mw: 5200, operational_mw: 4100 },
    by_status: { operational: 250, planned: 60 }, top_providers: [{ name: 'Equinix', facility_count: 20, total_mw: 400 }],
    market_pricing: { lease_rate_kw_mo: 140, basis: 'broker survey' },
  },
};
const ARGS = {
  rank_markets: {}, get_grid_intelligence: { region_id: 'PJM' },
  get_market_intel: { market: 'northern-virginia' }, search_facilities: { state: 'VA' },
};

let H, fence;
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, _req, body, u) => {
      if (p === '/api/v1/keys/validate' && body) {
        if (FREE_KEYS.has(body.api_key) || PACK_KEYS.has(body.api_key)) return { valid: true, tier: 'free', developer_id: 'dev_' + body.api_key.slice(9, 20) };
        if (body.api_key === DEV_KEY) return { valid: true, tier: 'developer', developer_id: 'dev_developer' };
      }
      if (p === '/api/v1/mcp/credits/balance') {
        const k = u.searchParams.get('key');
        return { credits: PACK_KEYS.has(k) ? 1000 : 0, had_pack: PACK_KEYS.has(k) };
      }
      if (PAYLOADS[p]) return PAYLOADS[p];
      return undefined;
    },
  });
}, 60_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

// ── helpers ──────────────────────────────────────────────────────────────────
const MARKER = '→ **For your human:**';
const textOf = (r) => ((r.msg && r.msg.result && r.msg.result.content) || []).map((c) => c.text || '').join('\n');
function payloadOf(r) {
  const t = (r.msg && r.msg.result && r.msg.result.content && r.msg.result.content[0] && r.msg.result.content[0].text) || '';
  try { return JSON.parse(t); } catch (_) { /* JSON head + prose */ }
  const cut = t.search(/\n\s*\n/);
  try { return JSON.parse(cut > 0 ? t.slice(0, cut) : t); } catch (_) { return null; }
}
const relayLines = (text) => text.split('\n').filter((l) => l.startsWith(MARKER));

// Leaf figures, keyed by path. Arrays compare row by row up to the shorter one,
// so a preview that shows 3 of 10 rows is judged on the 3 it shows.
function figures(o, base = '', out = new Map()) {
  if (Array.isArray(o)) { o.forEach((x, i) => figures(x, `${base}[${i}]`, out)); return out; }
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('_')) continue;
    const p = base ? `${base}.${k}` : k;
    if (typeof v === 'number') out.set(p, v);
    else if (v && typeof v === 'object') figures(v, p, out);
  }
  return out;
}
// Paths holding a figure in the full answer that this answer nulled or dropped.
function strippedPaths(full, gated) {
  const f = figures(full);
  const g = figures(gated);
  const out = [];
  for (const p of f.keys()) {
    if (g.has(p)) continue;
    // Only rows this answer actually shows: a row cut by the preview is a row
    // count, not a stripped field.
    const row = /^(.*)\[(\d+)\]/.exec(p);
    if (row) {
      const arr = row[1].split('.').reduce((o, k) => (o == null ? o : o[k]), gated);
      if (!Array.isArray(arr) || Number(row[2]) >= arr.length) continue;
    }
    out.push(p);
  }
  return out;
}
const leaf = (p) => p.replace(/\[\d+\]/g, '').split('.').pop();
function parseClause(line) {
  const m = /this answer hid (.+); (the plans that return them are on the page behind the link|the lowest plan that returns them is (?:DC Hub Developer|DC Hub Pro|a free DC Hub key)) — open (https:\/\/\S+) to see what your agent found\.$/.exec(line);
  if (!m) return null;
  const parts = m[1].replace(/ and (?=[^,]*$)/, ', ').split(', ');
  let others = 0;
  if (/^\d+ other fields?$/.test(parts[parts.length - 1])) others = parseInt(parts.pop(), 10);
  return { named: parts, others, plan: m[2].replace(/^the lowest plan that returns them is /, ''), url: m[3] };
}
const PLAN_RUNG = { 'a free DC Hub key': 'free_key', 'the plans that return them are on the page behind the link': 'pack', 'DC Hub Developer': 'developer', 'DC Hub Pro': 'pro' };
const seatKey = (rung, tool) => ({ free_key: keyFor('FREE', tool), pack: keyFor('PACK', tool), developer: DEV_KEY, pro: PRO_KEY })[rung];

// ── the four tools, keyless ──────────────────────────────────────────────────
const SEEN = {};
describe('the relay line names what THIS response stripped and the gate\'s own rung', () => {
  for (const tool of ['rank_markets', 'get_grid_intelligence', 'get_market_intel']) {
    it(`${tool}: fields match what was stripped; the named plan returns them and the rung below does not`, async () => {
      // The grid brief's keyless line is the grid sell line since 2026-10-03
      // (test/grid-sell-line.test.mjs); this file keeps pinning the CLAUSE machinery,
      // so that tool runs with DCHUB_GRID_SELL_LINE=0 here.
      const _prevGrid = process.env.DCHUB_GRID_SELL_LINE;
      if (tool === 'get_grid_intelligence') process.env.DCHUB_GRID_SELL_LINE = '0';
      // Owner 2026-10-08: grid and market intel serve the labelled taste on free (sections with
      // counts, test/free-decision-tools-preview-only.test.mjs); the field-by-field clause this
      // file pins is driven with that switch off, on the generic trim it was written for.
      const _prevFd = process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
      if (tool !== 'rank_markets') process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = '0';
      try {
      const gated = await H.call('/mcp', tool, ARGS[tool]);
      if (_prevGrid === undefined) delete process.env.DCHUB_GRID_SELL_LINE; else process.env.DCHUB_GRID_SELL_LINE = _prevGrid;
      const lines = relayLines(textOf(gated));
      expect(lines, 'exactly one relay line').toHaveLength(1);
      const line = lines[0];
      SEEN[tool] = line;
      const c = parseClause(line);
      expect(c, line).toBeTruthy();

      // 1. FIELDS
      const full = payloadOf(await H.call('/mcp', tool, ARGS[tool], { 'x-api-key': PRO_KEY }));
      const gp = payloadOf(gated);
      const stripped = strippedPaths(full, gp);
      const want = [...new Set(stripped.map((p) => fieldLabel(leaf(p))).filter(Boolean))];
      expect(want.length, `${tool}: the stub must make the gate strip something`).toBeGreaterThan(0);
      for (const n of c.named) expect(want, `${tool}: "${n}" was named but not stripped`).toContain(n);
      expect(c.named.length + c.others, `${tool}: every stripped field is named or counted (${want.join(' | ')})`).toBe(want.length);

      // 2. PLAN — the named rung's seat gets every stripped figure back ...
      const rung = PLAN_RUNG[c.plan];
      const opened = payloadOf(await H.call('/mcp', tool, ARGS[tool], { 'x-api-key': seatKey(rung, tool) }));
      const back = figures(opened);
      for (const p of stripped) expect(back.has(p), `${tool}: ${c.plan} should return ${p}`).toBe(true);
      // (the switch stays off until the rung-below check completes: see the finally below)
      // ... and the rung below it (above the keyless caller) does not. A free
      // key's daily taste of full answers is a taste, not the plan (the gate's
      // own rule, _tierGateOpensForSeat), so the lower seat is called until
      // the taste is spent: it must fall back to the preview within 15 calls.
      const i = RUNGS.findIndex((r) => r.id === rung);
      if (i > 0) {
        let withheld = false;
        for (let n = 0; n < 15 && !withheld; n += 1) {
          const lower = payloadOf(await H.call('/mcp', tool, ARGS[tool], { 'x-api-key': seatKey(RUNGS[i - 1].id, tool) }));
          const low = figures(lower);
          withheld = stripped.some((p) => !low.has(p));
        }
        expect(withheld, `${tool}: ${RUNGS[i - 1].id} returns everything indefinitely, so ${rung} is not the lowest`).toBe(true);
      }

      // 3. SHAPE
      expect(line).not.toMatch(/\n/);
      expect(line).not.toMatch(/\/mo\b|per month|monthly|\$\s?(49|99|199|499)\b/i);
      expect(line).not.toMatch(/unlock/i);
      expect(line.length).toBeLessThan(400);
      } finally {
        if (_prevFd === undefined) delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY; else process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = _prevFd;
      }
    }, 60_000);
  }

  it('search_facilities: its keyless answer carries no relay line, and none is invented', async () => {
    // The keyless facility trim answers with its own _upgrade block (named by
    // #652), not the relay line; this change adds no line to it.
    const r = await H.call('/mcp', 'search_facilities', ARGS.search_facilities);
    expect(relayLines(textOf(r))).toEqual([]);
    const p = payloadOf(r);
    expect(p && p._upgrade && typeof p._upgrade.message).toBe('string');
    // The stub makes the trim strip something, so an empty relay list is not
    // "nothing was hidden".
    const full = payloadOf(await H.call('/mcp', 'search_facilities', ARGS.search_facilities, { 'x-api-key': PRO_KEY }));
    expect(strippedPaths(full, p).length).toBeGreaterThan(0);
  }, 60_000);

  it('before/after, for the PR', () => {
    for (const [t, l] of Object.entries(SEEN)) console.log(`[relay-line] ${t}: ${l.replace(/https:\/\/\S+/, '<relay url>')}`);
    expect(Object.keys(SEEN).length).toBe(3);
  });
});

// ── /mcp/chatgpt is not touched ──────────────────────────────────────────────
describe('/mcp/chatgpt keeps its own commerce rules', () => {
  it('no relay line and no hid/plan clause on the directory profile, same calls', async () => {
    for (const tool of ['rank_markets', 'get_grid_intelligence', 'get_market_intel']) {
      const r = await H.call('/mcp/chatgpt', tool, ARGS[tool]);
      const t = r.raw;
      expect(t, tool).not.toContain('For your human');
      expect(t, tool).not.toMatch(/this answer hid|lowest plan that returns/);
    }
  }, 60_000);
  it('the paywall contract never assigns the directory profiles', () => {
    for (const profile of ['chatgpt_directory', 'claude_directory']) {
      expect(H.S._paywallArmFor({ profile, api_key: null, client_ip: '203.0.113.9' })).toBeNull();
    }
  });
});

// ── the pure clause ──────────────────────────────────────────────────────────
describe('relayMissedClause', () => {
  const mu = (labels, rung) => ({ missed: { labels }, rung });
  it('names the fields and the rung, never a monthly price', () => {
    expect(relayMissedClause(mu(['MW', 'scores', 'lease rate'], 'pack')))
      .toBe('this answer hid MW, scores and lease rate; the plans that return them are on the page behind the link');
    expect(relayMissedClause(mu(['MW'], 'developer'))).toBe('this answer hid MW; the lowest plan that returns them is DC Hub Developer');
    expect(relayMissedClause(mu(['gas prices'], 'pro'))).toBe('this answer hid gas prices; the lowest plan that returns them is DC Hub Pro');
    expect(relayPlanName('free_key')).toBe('a free DC Hub key');
  });
  it('four labels are all named; five or more name three and count the rest', () => {
    expect(hiddenFieldsPhrase({ labels: ['a', 'b', 'c', 'd'] })).toBe('a, b, c and d');
    expect(hiddenFieldsPhrase({ labels: ['a', 'b', 'c', 'd', 'e'] })).toBe('a, b, c and 2 other fields');
  });
  it('unknown fields or unknown rung → null, so the caller keeps the old line', () => {
    expect(relayMissedClause(null)).toBeNull();
    expect(relayMissedClause(mu([], 'pack'))).toBeNull();
    expect(relayMissedClause(mu(['MW'], null))).toBeNull();
    expect(relayMissedClause(mu(['MW'], 'starter'))).toBeNull();
  });
  it('treatment arm: with a clause, its own field names are dropped (no field named twice); without, untouched', () => {
    const locked = { shown: 3, total: 10, field: 'results', fields: ['score'] };
    const full = 'your agent got 3 of 10 `results` rows here — DC Hub\'s paid layer has the other 7 rows (plus `score`)';
    expect(continuationHumanText(locked)).toBe(full);   // what the treatment arm sends today
    expect(H.S._relaySpecific(full, { locked }, 'this answer hid scores; the plans that return them are on the page behind the link'))
      .toBe('your agent got 3 of 10 `results` rows here — DC Hub\'s paid layer has the other 7 rows');
    expect(H.S._relaySpecific(full, { locked }, null)).toBe(full);
    expect(H.S._relaySpecific(null, { locked }, 'x')).toBeNull();          // control arm stays control
  });

  it('buildHumanFirstLine: with a clause it names it; without one it is byte-identical to before', () => {
    const url = 'https://dchub.cloud/upgrade/h/x.y';
    const clause = 'this answer hid MW; the plans that return them are on the page behind the link';
    expect(H.S.buildHumanFirstLine(url, null, clause).split('\n')[0])
      .toBe(`${MARKER} ${clause} — open ${url} to see what your agent found.`);
    expect(H.S.buildHumanFirstLine(url, 'your agent got 3 of 10 `results` rows here — DC Hub\'s paid layer has the other 7', clause).split('\n')[0])
      .toBe(`${MARKER} your agent got 3 of 10 \`results\` rows here — DC Hub's paid layer has the other 7; ${clause} — open ${url} to see what your agent found.`);
    expect(H.S.buildHumanFirstLine(url).split('\n')[0])
      .toBe(`${MARKER} open ${url} — see what your agent found and how to unlock it.`);
    expect(H.S.buildHumanFirstLine(url, 'DC Hub\'s paid layer has 47 rows for this query').split('\n')[0])
      .toBe(`${MARKER} DC Hub's paid layer has 47 rows for this query — open ${url} to see it and unlock.`);
  });
});
