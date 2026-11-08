// ── market_outlook geography eval over every tracked DCPI market (planner 5.17) ──
//
// Owner priority 1, 2026-11-08 (after Grok #118011): "power outlook for <any
// tracked market>" answers that market. Table-driven over the generated index
// (lib/dcpi-markets.data.mjs, 336 markets), so a market added on regeneration
// is tested without editing this file.
//
// What fails here:
//   - any tracked market whose DCPI and brief steps do not both carry its own
//     canonical slug, or whose grid step is not its RTO (or is run without one);
//   - a place the index does not track bound to some market instead of unresolved;
//   - a same-ISO market standing in for the one asked (San Antonio/Midland–Odessa,
//     Phoenix/Tucson, Ashburn/Richmond), in the plan or in answer_guide;
//   - a city name read in the wrong state (Columbus, GA as Columbus, OH;
//     Portland, ME as Portland, OR), or a bare shared name guessed.
// Pure functions, no network. The executor half (no placeholder filled for an
// unresolved market) is in test/market-outlook-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { _planQuery, _execAnswerGuide } from '../server.mjs';
import { DCPI_MARKETS } from '../lib/dcpi-markets.data.mjs';

const step = (p, tool) => p.recommended_sequence.find((s) => s.tool === tool);
const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const PICKERS = ['get_dchub_recommendation', 'rank_markets', 'site_selection_canvas', 'ai_capacity_index'];
const ALIAS_USES = new Map();
for (const r of DCPI_MARKETS) for (const a of r[5]) ALIAS_USES.set(a, (ALIAS_USES.get(a) || 0) + 1);

// The way a person names each market: its index name, qualified with its state
// when the bare name is shared by two tracked markets or is an ordinary word.
const QUALIFY = /^(?:Enterprise|Mason|Allen|Monroe|Chester|Troy|Lebanon|Laurel|Canton|Edison|Maiden|Sheridan|Somerset|Bend|Franklin|Salem|Hammond|Garland|Clifton|Centennial|Luckey|Brandon|Quincy|Springfield|Fayetteville|Lafayette|Elk Grove|Altoona|West Chester)$/;
const asked = ([, name, states, , , aliases]) => {
  const shared = aliases.some((a) => ALIAS_USES.get(a) > 1) && !/, [A-Z]{2}$/.test(name);
  return (shared || QUALIFY.test(name)) ? `${name}, ${states[0]}` : name;
};

function expectBound(p, slug, rto) {
  expect(p.intent_class).toBe('market_outlook');
  expect(step(p, 'get_market_dcpi_rank').args_hint).toEqual({ market_slug: slug });
  expect(step(p, 'get_market_intel').args_hint).toEqual({ market: slug });
  for (const t of PICKERS) expect(tools(p), t).not.toContain(t);
  if (rto) expect(step(p, 'get_grid_intelligence').args_hint).toEqual({ iso: rto });
  else expect(tools(p)).not.toContain('get_grid_intelligence');
  expect(p.unresolved).toBeUndefined();
}

describe(`every tracked DCPI market (${DCPI_MARKETS.length}) is read as itself`, () => {
  it('the index is the full list', () => expect(DCPI_MARKETS.length).toBeGreaterThanOrEqual(300));
  for (const m of DCPI_MARKETS) {
    const [slug, , , iso, rto] = m;
    it(`${asked(m)} → ${slug} (${iso}${rto ? '' : ', no RTO'})`, () => {
      expectBound(_planQuery(`What is the data center power outlook for ${asked(m)}?`, {}), slug, rto);
    });
  }
});

describe('a place the index does not track is unresolved, never bound', () => {
  const cases = [
    ['Timbuktu', 'market_not_matched'],
    ['Gotham', 'market_not_matched'],
    ['Columbus, GA', 'market_not_matched'],       // tracked only in OH
    ['Columbus, Georgia', 'market_not_matched'],
    ['Springfield, IL', 'market_not_matched'],    // tracked only in MA
    ['Dublin, Ohio', 'market_not_matched'],       // tracked only in Ireland
    ['Midland, MI', 'market_not_matched'],        // tracked only in TX
    ['Portland', 'market_ambiguous'],             // OR and ME
    ['Charleston', 'market_ambiguous'],           // WV and SC
    ['Aurora', 'market_ambiguous'],               // IL and CO
    ['Phoenix and Tucson', 'multiple_markets'],
  ];
  for (const [place, kind] of cases) {
    it(`${place} → ${kind}`, () => {
      const p = _planQuery(`What is the data center power outlook for ${place}?`, {});
      expect(p.intent_class).toBe('market_outlook');
      expect(p.unresolved && p.unresolved.kind).toBe(kind);
      expect(p.unresolved.note).toMatch(/does not substitute another market/);
      for (const tool of ['get_market_dcpi_rank', 'get_market_intel']) {
        expect(step(p, tool).args_hint, tool).toEqual(
          tool === 'get_market_intel' ? { market: '<market_slug of the metro named in the intent>' }
                                      : { market_slug: '<market_slug of the metro named in the intent>' });
      }
      expect(tools(p)).not.toContain('get_grid_intelligence');
      for (const t of PICKERS) expect(tools(p), t).not.toContain(t);
    });
  }
  it('names the tracked market a state conflict is not', () => {
    const p = _planQuery('power outlook for Columbus, GA', {});
    expect(p.unresolved.tracked_elsewhere).toEqual([{ slug: 'columbus', name: 'Columbus', state: 'OH' }]);
    const a = _planQuery('power outlook for Portland', {});
    expect(a.unresolved.candidates.map((c) => c.slug).sort()).toEqual(['portland-me', 'portland-or']);
  });
});

describe('city-vs-state: the state written after a name decides', () => {
  const cases = [
    ['Columbus', 'columbus', 'PJM'], ['Columbus, OH', 'columbus', 'PJM'], ['Columbus, Ohio', 'columbus', 'PJM'],
    ['Portland, OR', 'portland-or', null], ['Portland Oregon', 'portland-or', null], ['Portland OR', 'portland-or', null],
    ['Portland, ME', 'portland-me', 'ISONE'], ['Portland, Maine', 'portland-me', 'ISONE'],
    ['Kansas City', 'kansas-city', 'SPP'], ['Kansas City, MO', 'kansas-city', 'SPP'],
    ['Kansas City, KS', 'kansas-city', 'SPP'], ['Kansas City, Kansas', 'kansas-city', 'SPP'],
    ['North Kansas City', 'north-kansas-city', 'SPP'],
    ['Charleston, WV', 'charleston', 'PJM'], ['Charleston, SC', 'charleston-sc', null],
    ['Aurora, IL', 'aurora', 'PJM'], ['Aurora, CO', 'aurora-co', null],
    ['St. Louis', 'st-louis', 'MISO'], ['Saint Louis', 'saint-louis', 'MISO'],
    ['Washington, D.C.', 'dc', 'PJM'], ['Midland-Odessa', 'midland-tx', 'ERCOT'], ['Odessa', 'midland-tx', 'ERCOT'],
  ];
  for (const [place, slug, rto] of cases) {
    it(`${place} → ${slug}`, () => expectBound(_planQuery(`power outlook for ${place}`, {}), slug, rto));
  }
  it('"Portland or Seattle" does not read "or" as Oregon', () => {
    expect(_planQuery('power outlook for Portland or Seattle', {}).unresolved.kind).toBe('multiple_markets');
  });
  it('an ordinary word is not a market without its state ("enterprise", "mason")', () => {
    for (const q of ['What is the power outlook for enterprise AI data centers?', 'power outlook for mason county']) {
      const p = _planQuery(q, {});
      expect(JSON.stringify(p.recommended_sequence), q).not.toMatch(/"(?:enterprise|mason)"/);
    }
    expectBound(_planQuery('power outlook for Enterprise, NV', {}), 'enterprise', null);
  });
  it('a region gives way to the metro named inside it', () => {
    expectBound(_planQuery('power outlook for Midland in West Texas', {}), 'midland-tx', 'ERCOT');
    expectBound(_planQuery('power outlook for West Texas', {}), 'west-texas', 'ERCOT');
  });
  it('a bare state is a state, not a market', () => {
    const p = _planQuery('power outlook for Texas', {});
    expect(p.unresolved).toMatchObject({ kind: 'market_not_matched', phrase: 'Texas' });
    expect(p.unresolved.note).toMatch(/a state, not a market/);
  });
});

describe('same-ISO markets never stand in for each other', () => {
  const PAIRS = [['san-antonio', 'midland-tx'], ['phoenix', 'tucson'], ['ashburn', 'richmond']];
  const bySlug = new Map(DCPI_MARKETS.map((r) => [r[0], r]));
  for (const [a, b] of PAIRS) {
    for (const [want, other] of [[a, b], [b, a]]) {
      const W = bySlug.get(want), O = bySlug.get(other);
      it(`${W[1]} is not answered as ${O[1]} (both ${W[3]})`, () => {
        expect(W[3]).toBe(O[3]);
        const p = _planQuery(`What is the data center power outlook for ${W[1]}?`, {});
        expectBound(p, want, W[4]);
        expect(JSON.stringify(p.recommended_sequence)).not.toContain(`"${other}"`);
      });
    }
  }
  // Every market, against another market on the same grid label: answer_guide
  // keeps the asked market's verdict and drops the other's.
  const byIso = new Map();
  for (const r of DCPI_MARKETS) (byIso.get(r[3]) || byIso.set(r[3], []).get(r[3])).push(r);
  for (const r of DCPI_MARKETS) {
    const peers = byIso.get(r[3]);
    if (peers.length < 2) continue;
    const o = peers[(peers.indexOf(r) + 1) % peers.length];
    it(`answer_guide for ${r[0]} drops ${o[0]} (${r[3]})`, () => {
      const run = [{ step: 1, tool: 'get_market_dcpi_rank', status: 'executed', result: {
        scored: [{ market: r[1], market_slug: r[0], iso: r[3], verdict: 'CAUTION' },
                 { market: o[1], market_slug: o[0], iso: o[3], verdict: 'BUILD' }] } }];
      const g = _execAnswerGuide(run, [r[3]], r[0]);
      expect(g).toContain(`${r[1]}: CAUTION`);
      expect(g).not.toContain(`${o[1]}: BUILD`);
    });
  }
});
