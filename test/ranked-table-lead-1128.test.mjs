// Grok -> Brain 2026-11-28 Change 1: a gated execute_plan ranking answer leads with an inline ranked table
// (lib/ranked-table-lead.mjs). Unit tests on the pure builder, then the real server on loopback with a stub backend.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildRankedTableLead, withRankedTableLead, rankedTableLeadOn, TABLE_MARKER, UNAVAILABLE } from '../lib/ranked-table-lead.mjs';
import { NOTE_F_WORDS } from '../lib/continuity-ask.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const RANK_ROWS = [
  { rank: 1, market: 'Midland–Odessa', slug: 'midland-tx', state: 'TX', iso: 'ERCOT', dcpi_verdict: 'BUILD', score: 80.6,
    time_to_power_months: null, _time_to_power_months_in_pro: true, as_of: '2026-11-28T08:45:21Z',
    dcpi_confidence: { level: 'medium', value: 0.62 },
    dcpi_provenance: { live_inputs: ['interconnection queue depth'], modeled_inputs: ['behind-the-meter headroom'], blended_inputs: ['reserve margin'] } },
  { rank: 2, market: 'Abilene', slug: 'abilene-tx', state: 'TX', iso: 'ERCOT', dcpi_verdict: 'CAUTION', score: 44.1,
    time_to_power_months: null, _time_to_power_months_in_pro: true },
];
const CANVAS_ROWS = [
  { market: 'Midland–Odessa', slug: 'midland-tx', state: 'TX', iso: 'ERCOT', verdict: 'BUILD',
    composite_score: null, _composite_score_withheld: true, time_to_power_months: null, _time_to_power_months_withheld: true },
  { market: 'El Paso', slug: 'el-paso', state: 'TX', iso: 'WECC', verdict: 'BUILD',
    composite_score: null, _composite_score_withheld: true, time_to_power_months: null, _time_to_power_months_withheld: true },
];
const step = (tool, args, result, status = 'executed') => ({ tool, args, status, result });

describe('buildRankedTableLead (pure)', () => {
  it('rank_markets preview rows: verdict, composite, confidence, inputs modeled, metro, as_of; held TTP reads withheld, never 0', () => {
    const t = buildRankedTableLead('market_ranking', [
      step('rank_markets', { criteria: 'ai_ready', iso: 'ERCOT' }, { results: RANK_ROWS }, 'gated_preview'),
      step('get_market_dcpi_rank', { market_slug: 'midland-tx' }, { verdict: 'BUILD', composite_score: 80.6, as_of: '2026-11-28' }),
    ]);
    expect(t && t.source).toBe('rank_markets');
    const midland = t.markdown.split('\n').find((l) => l.includes('midland-tx'));
    expect(midland).toBe('| 1 | Midland–Odessa, TX (midland-tx) | BUILD | 80.6 | withheld | medium (0.62) | 1 of 3 | metro | 2026-11-28 |');
    const abilene = t.markdown.split('\n').find((l) => l.includes('abilene-tx'));
    expect(abilene).toContain('| CAUTION | 44.1 | withheld |');
    expect(t.markdown).not.toMatch(/\|\s*0\s*\|/);
    expect(t.markdown.startsWith('Source: DC Hub (dchub.cloud), as of 2026-11-28.')).toBe(true);
  });
  it('canvas preview rows: a composite the canvas withheld reads withheld, even when the plan read a DCPI card (Grok 14:46Z)', () => {
    const t = buildRankedTableLead('market_ranking', [
      step('site_selection_canvas', { region: 'TX', capacity_mw: 200 }, { shortlist: CANVAS_ROWS }),
      step('get_market_dcpi_rank', { market_slug: 'midland-tx' }, { verdict: 'BUILD', composite_score: 80.6, as_of: '2026-11-28' }),
    ]);
    expect(t.source).toBe('site_selection_canvas');
    const lines = t.markdown.split('\n');
    expect(lines.find((l) => l.includes('midland-tx'))).toContain('| BUILD | withheld | withheld |');
    expect(lines.find((l) => l.includes('el-paso'))).toContain('| BUILD | withheld | withheld |');
    expect(t.markdown).not.toContain('80.6');
  });
  it('a canvas row that did not withhold composite still takes the DCPI card; no card and no field reads unavailable', () => {
    const rows = [{ market: 'Midland–Odessa', slug: 'midland-tx', state: 'TX', verdict: 'BUILD' },
      { market: 'The Woodlands', slug: 'the-woodlands', state: 'TX', verdict: 'CAUTION' }];
    const t = buildRankedTableLead('market_ranking', [
      step('site_selection_canvas', { region: 'TX' }, { shortlist: rows }),
      step('get_market_dcpi_rank', { market_slug: 'midland-tx' }, { verdict: 'BUILD', composite_score: 80.6 }),
    ]);
    const lines = t.markdown.split('\n');
    expect(lines.find((l) => l.includes('midland-tx'))).toContain('| BUILD | 80.6 | unavailable |');
    expect(lines.find((l) => l.includes('the-woodlands'))).toContain('| CAUTION | unavailable | unavailable |');
  });
  it('as_of falls back to the DCPI card computed_at / provenance.as_of, never retrieved_at (live Texas canvas rows, 2026-11-28)', () => {
    const t = buildRankedTableLead('market_ranking', [
      step('site_selection_canvas', { region: 'TX' }, { shortlist: CANVAS_ROWS }),
      step('get_market_dcpi_rank', { market_slug: 'midland-tx' }, { verdict: 'BUILD', composite_score: 80.6, computed_at: '2026-11-28T08:45:21Z' }),
      step('get_market_dcpi_rank', { market_slug: 'el-paso' }, { verdict: 'BUILD', composite_score: 67.3,
        provenance: { as_of: '2026-11-27T08:45:21Z', retrieved_at: '2026-11-28T09:51:37Z' } }),
    ]);
    const lines = t.markdown.split('\n');
    expect(lines.find((l) => l.includes('midland-tx')).endsWith('| 2026-11-28 |')).toBe(true);
    expect(lines.find((l) => l.includes('el-paso')).endsWith('| 2026-11-27 |')).toBe(true);
    expect(t.markdown.startsWith('Source: DC Hub (dchub.cloud), as of 2026-11-27.')).toBe(true);
  });
  it('no table for other intent classes, or when no ranking step returned rows', () => {
    expect(buildRankedTableLead('site_analysis', [step('rank_markets', {}, { results: RANK_ROWS })])).toBeNull();
    expect(buildRankedTableLead('market_ranking', [step('rank_markets', {}, { results: [] })])).toBeNull();
    expect(buildRankedTableLead('market_ranking', [step('rank_markets', {}, { results: RANK_ROWS }, 'not_run')])).toBeNull();
  });
  it('copy: no link, no price / plan / "free" wording, DCPI named in full', () => {
    const t = buildRankedTableLead('market_ranking', [step('rank_markets', {}, { results: RANK_ROWS })]);
    expect(t.markdown).not.toMatch(/https?:\/\//);
    expect(NOTE_F_WORDS.test(t.markdown)).toBe(false);
    expect(t.markdown).toContain('Data Center Power Index (DCPI)');
  });
  it('withRankedTableLead puts the table first, once', () => {
    const r = { content: [{ type: 'text', text: 'Withheld here: x.' }] };
    const once = withRankedTableLead(r, `${TABLE_MARKER} a |`);
    expect(once.content[0].text.startsWith(TABLE_MARKER)).toBe(true);
    expect(withRankedTableLead(once, `${TABLE_MARKER} a |`).content.length).toBe(2);
  });
  it('kill switch DCHUB_RANKED_TABLE_LEAD=0; default on', () => {
    expect(rankedTableLeadOn({})).toBe(true);
    expect(rankedTableLeadOn({ DCHUB_RANKED_TABLE_LEAD: '0' })).toBe(false);
  });
});

// ── end to end ──────────────────────────────────────────────────────────────────────────────────────────────
const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131 Safari/537.36' };
const INTENT = 'Where can 100 MW get power fastest in ERCOT, by DCPI?';
const CARDS = { 'midland-tx': ['BUILD', 80.6], 'abilene-tx': ['CAUTION', 44.1] };
const ENV = { DCHUB_WALL_VALUE_FIRST: '1' };   // the live value-first lead, so "table before the withheld list" is tested
let H, fence, prevEnv;
const parse = (raw) => JSON.parse((raw.split('\n').find((l) => l.startsWith('data:')) || raw).replace(/^data:\s*/, '')).result;
async function run(path, client, headers, intent = INTENT) {
  const init = await H.init(path, client, headers);
  return parse((await H.call(path, 'execute_plan', { intent }, { ...headers, 'mcp-session-id': init.headers.get('mcp-session-id') })).raw);
}
beforeAll(async () => {
  prevEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => {
    if (p === '/api/v1/mcp/tools/rank_markets') return { criteria: 'ai_ready', region: 'us', count: 2, results: RANK_ROWS };
    const m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p);
    if (m && CARDS[m[1]]) return { ok: true, market_slug: m[1], iso: 'ERCOT', as_of: '2026-11-28', verdict: CARDS[m[1]][0], composite_score: CARDS[m[1]][1] };
    return undefined;
  } });
}, 120_000);
afterAll(async () => {
  if (H) await H.stop(); if (fence) fence.restore();
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('execute_plan keyless ranking answer (real server)', () => {
  it('first content item is the ranked table: Midland, its DCPI verdict and composite, held TTP unavailable', async () => {
    const r = await run('/mcp', 'brain-acc', UA);
    const first = r.content[0].text;
    expect(first).toContain(TABLE_MARKER);
    expect(first).toMatch(/\| 1 \| Midland–Odessa, TX \(midland-tx\) \| BUILD \| 80\.6 \| withheld \|/);
    expect(first).not.toMatch(/\/u\/|\/h\/|\/r\/a\//);
    expect(first).not.toMatch(/\|\s*0\s*\|/);
    // control: the gated answer still carries its withheld lead and link, after the table
    const rest = r.content.slice(1).map((x) => x.text || '').join('\n');
    expect(rest).toMatch(/Withheld here:|preview/i);
    // the table and the withheld list agree: a column the table marks withheld is one the list names (Grok 14:46Z)
    expect(first).toMatch(/\| withheld \|/);
    expect(rest).toMatch(/Withheld here:[^\n]*time to power/);
    expect(r.structuredContent.ranked_answer).toBeUndefined();   // the owner's 11-23 rule is unchanged
  }, 60_000);
  it('kill switch: DCHUB_RANKED_TABLE_LEAD=0 leaves the answer as it was', async () => {
    process.env.DCHUB_RANKED_TABLE_LEAD = '0';
    try {
      const r = await run('/mcp', 'brain-acc', UA);
      expect(r.content.some((x) => (x.text || '').includes(TABLE_MARKER))).toBe(false);
    } finally { delete process.env.DCHUB_RANKED_TABLE_LEAD; }
  }, 60_000);
  it('a paid key gets no table (its ranked_answer is unchanged)', async () => {
    const r = await run('/mcp', 'brain-acc', { ...UA, 'x-api-key': PRO_KEY });
    expect(r.content.some((x) => (x.text || '').includes(TABLE_MARKER))).toBe(false);
    expect(r.structuredContent.ranked_answer).toBeTruthy();
  }, 60_000);
  it('/mcp/chatgpt is frozen: no table', async () => {
    const r = await run('/mcp/chatgpt', 'chatgpt', { 'user-agent': 'openai-mcp' });
    expect(JSON.stringify(r)).not.toContain(TABLE_MARKER);
  }, 60_000);
});
