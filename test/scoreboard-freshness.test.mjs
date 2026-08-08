// GUARD — get_grid_scoreboard must carry the freshness the backend already
// returns, and must rank on the definition it publishes.
//
// The defects (measured live 2026-08-08T03:17Z):
//
//   get_grid_scoreboard ERCOT row : {"mix_period":"2026-08-07T04", "demand_mw":78623}
//   get_grid_intelligence ERCOT   : {"generation_mix_period":"2026-08-07T04",
//                                    "demand_period":"2026-08-08T02",
//                                    "generation_mix_age_hours":22.9,
//                                    "generation_mix_note":"...do not narrate it as
//                                     \"right now\"..."}
//
// Same instant, same upstream. The scoreboard shaper published one period and
// dropped every age plus the backend's own do-not-narrate warning, under a tool
// description that said "RIGHT NOW". Separately its renewable_share_pct counted
// geothermal while the 33 ENTSO-E rows it is ranked against did not.
//
// Pure tests — no network.
import { describe, it, expect } from 'vitest';
import {
  shapeScoreboardUsRow,
  SCOREBOARD_RENEWABLE_DEFINITION,
  SCOREBOARD_STALE_MIX_HOURS,
} from '../server.mjs';

// The real ERCOT payload from that measurement, trimmed to what the shaper reads.
const ERCOT_LIVE = {
  region: 'ERCOT',
  demand_mw: 78623,
  demand_period: '2026-08-08T02',
  generation_mix_period: '2026-08-07T04',
  generation_mix_age_hours: 22.9,
  generation_mix_lag_at_snapshot_hours: 22,
  generation_mix_freshness_basis: 'measured against the CURRENT UTC clock at request time',
  generation_mix_note: 'Fuel mix is EIA\'s latest PUBLISHED hour (2026-08-07T04) ... do not narrate it as "right now".',
  generation_mix: {
    NG: { mw: 37471, period: '2026-08-07T04' }, NUC: { mw: 4953 },
    COL: { mw: 10533 }, WND: { mw: 20200 }, SUN: { mw: 8 },
    WAT: { mw: 45 }, OTH: { mw: 98 }, BAT: { mw: 630 },
  },
};
const NOW = Date.UTC(2026, 7, 8, 3, 0);   // 2026-08-08T03:00Z

describe('get_grid_scoreboard US row — freshness', () => {
  it('carries the mix age, not just the mix period', () => {
    const row = shapeScoreboardUsRow('ERCOT', ERCOT_LIVE, NOW);
    expect(row.mix_period).toBe('2026-08-07T04');
    expect(row.mix_age_hours).toBe(22.9);
  });

  it('publishes BOTH clocks — a demand period as well as a mix period', () => {
    const row = shapeScoreboardUsRow('ERCOT', ERCOT_LIVE, NOW);
    expect(row.demand_period).toBe('2026-08-08T02');
    expect(row.demand_age_hours).not.toBeNull();
    // The whole point: they are not the same reading.
    expect(row.demand_period).not.toBe(row.mix_period);
  });

  it('says how far the mix trails demand instead of pairing them silently', () => {
    const row = shapeScoreboardUsRow('ERCOT', ERCOT_LIVE, NOW);
    expect(row.demand_vs_mix_lag_hours).toBe(22);
  });

  it('flags a stale mix and carries the backend\'s do-not-narrate warning verbatim', () => {
    const row = shapeScoreboardUsRow('ERCOT', ERCOT_LIVE, NOW);
    expect(row.mix_is_stale).toBe(true);
    expect(row.mix_note).toBe(ERCOT_LIVE.generation_mix_note);
    expect(row.mix_note).toMatch(/right now/i);
  });

  it('warns that generation minus demand across two clocks is not an import', () => {
    // The row implied a multi-GW import into a grid with ~1.2 GW of DC ties,
    // purely because the two numbers came from hours 22h apart.
    const row = shapeScoreboardUsRow('ERCOT', ERCOT_LIVE, NOW);
    expect(row.mix_vs_demand_warning).toMatch(/not net imports|not.*imports/i);
  });

  it('derives an age when the backend build has no age field, never ships none', () => {
    const noAge = { ...ERCOT_LIVE };
    delete noAge.generation_mix_age_hours;
    delete noAge.generation_mix_lag_at_snapshot_hours;
    const row = shapeScoreboardUsRow('ERCOT', noAge, NOW);
    expect(row.mix_age_hours).toBe(23);      // 2026-08-07T04 -> 2026-08-08T03
    expect(row.demand_age_hours).toBe(1);
    expect(row.demand_vs_mix_lag_hours).toBe(22);
  });

  it('does not flag a genuinely fresh mix', () => {
    const fresh = {
      ...ERCOT_LIVE, generation_mix_age_hours: 0.5,
      generation_mix_period: '2026-08-08T02', demand_period: '2026-08-08T02',
      generation_mix_lag_at_snapshot_hours: 0,
    };
    const row = shapeScoreboardUsRow('ERCOT', fresh, NOW);
    expect(row.mix_is_stale).toBeUndefined();
    expect(row.mix_vs_demand_warning).toBeUndefined();
    expect(row.mix_age_hours).toBe(0.5);     // the age is present regardless
  });

  it('threshold matches the backend note threshold', () => {
    expect(SCOREBOARD_STALE_MIX_HOURS).toBe(3);
  });
});

describe('get_grid_scoreboard US row — renewable definition', () => {
  // CAISO at the same instant: geothermal 757 MW is 2.5pp of the mix, which is
  // enough to move a greenest-first ranking.
  const CAISO_LIVE = {
    region: 'CAISO', demand_mw: 41399, demand_period: '2026-08-08T02',
    generation_mix_period: '2026-08-07T06', generation_mix_age_hours: 21,
    generation_mix: {
      NG: { mw: 14278 }, NUC: { mw: 2241 }, COL: { mw: 0 }, WND: { mw: 4596 },
      SUN: { mw: 0 }, WAT: { mw: 4296 }, GEO: { mw: 757 }, OIL: { mw: 46 },
      OTH: { mw: 4442 },
    },
  };

  it('ranks on wind+solar+hydro, matching the stated definition and the EU rows', () => {
    const row = shapeScoreboardUsRow('CAISO', CAISO_LIVE, NOW);
    // total non-storage = 30656; (4596+0+4296)/30656 = 29.0%
    expect(row.renewable_share_pct).toBe(29);
    // 31.5% is what shipped — geothermal silently in the numerator.
    expect(row.renewable_share_pct).not.toBe(31.5);
  });

  it('keeps the geothermal-inclusive figure as its own named field', () => {
    // get_grid_intelligence publishes this one; the two must be reconcilable
    // rather than silently different under one name.
    const row = shapeScoreboardUsRow('CAISO', CAISO_LIVE, NOW);
    expect(row.renewable_share_incl_geothermal_pct).toBe(31.5);
  });

  it('omits the geothermal variant where there is no geothermal', () => {
    const row = shapeScoreboardUsRow('ERCOT', ERCOT_LIVE, NOW);
    expect(row.renewable_share_incl_geothermal_pct).toBeUndefined();
  });

  it('states the definition on every row, and it excludes geothermal', () => {
    const row = shapeScoreboardUsRow('CAISO', CAISO_LIVE, NOW);
    expect(row.renewable_definition).toBe(SCOREBOARD_RENEWABLE_DEFINITION);
    expect(SCOREBOARD_RENEWABLE_DEFINITION).toMatch(/wind\+solar\+hydro/);
    expect(SCOREBOARD_RENEWABLE_DEFINITION).toMatch(/geothermal.*NOT in this numerator/is);
  });

  it('excludes storage from the denominator but still reports it honestly', () => {
    // BAT 630 MW must not inflate the total (it is not primary generation).
    const row = shapeScoreboardUsRow('ERCOT', ERCOT_LIVE, NOW);
    const total = 37471 + 4953 + 10533 + 20200 + 8 + 45 + 98;   // no BAT
    expect(row.gas_share_pct).toBe(Math.round((37471 / total) * 1000) / 10);
  });
});

describe('get_grid_scoreboard tool description', () => {
  const readSrc = () => import('node:fs/promises')
    .then(fs => fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8'));
  const desc = async () => {
    const src = await readSrc();
    const a = src.indexOf("'GLOBAL grid scoreboard —");
    const b = src.indexOf('Try: get_grid_scoreboard.', a);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return src.slice(a, b);
  };

  it('no longer promises the mix is RIGHT NOW, and points at the age fields', async () => {
    const d = await desc();
    expect(d.length).toBeGreaterThan(200);
    expect(d).not.toMatch(/ranked side-by-side RIGHT NOW/);
    expect(d).toMatch(/mix_age_hours/);
    expect(d).toMatch(/LATEST PUBLISHED reading/);
  });

  it('warns that the US mix trails demand by hours', async () => {
    const d = await desc();
    expect(d).toMatch(/behind aggregate demand/i);
    expect(d).toMatch(/18-24h/);
  });

  it('the US grid count it advertises matches _US_ISOS', async () => {
    // The description used to say "7 US grid operators" while nine ranked
    // (BPA and TVA were added and the text never followed). Derive, don't
    // transcribe: the claim is checked against the list the tool actually fans
    // out to, so adding a tenth ISO fails here until the text is updated.
    const src = await readSrc();
    const listed = /const _US_ISOS = \[([^\]]+)\]/.exec(src);
    expect(listed, '_US_ISOS not found').toBeTruthy();
    const isos = listed[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    const d = await desc();
    const claimed = /(\d+) US grid operators/.exec(d);
    expect(claimed, 'description must state a US grid count').toBeTruthy();
    expect(Number(claimed[1])).toBe(isos.length);
    for (const iso of isos) expect(d).toContain(iso);
  });

  it('asserts no frozen EU zone count — that number is measured per call', async () => {
    // Live 2026-08-08: 33 configured / 32 live, against a description that said
    // "~24" and a canon fact still on 24. A count that drifts belongs in the
    // payload (counts_basis.eu_zones_live/_configured), not in a description string.
    const d = await desc();
    expect(d).not.toMatch(/\d+\s*European bidding zones/);
    expect(d).toMatch(/eu_zones_live/);
  });
});
