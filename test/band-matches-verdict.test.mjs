// band-matches-verdict.test.mjs — r-band-is-the-verdict (2026-10-02).
//
// MEASURED, live, keyless, on https://dchub.cloud/mcp (owner report, 18:27Z):
//
//   get_market_dcpi_rank phoenix   verdict CAUTION · composite_score_band AVOID
//                                  constraint_score_band CAUTION · quality_score_band BUILD
//   site_selection_canvas AZ       verdict BUILD · composite_score_band CAUTION
//                                  constraint_score_band AVOID   (x3 rows)
//   rank_markets best_overall      ashburn-va score_band BUILD, /dcpi/ashburn verdict AVOID
//
// The depth gate masked each `*_score` and stamped `${k}_band = _scoreBand(v)`,
// the SITE scale's 70/45 cut. The DCPI verdict (util/dcpi_method.py
// verdict_from_scores) is decided by excess ≥ 65/50 AND constraint ≤ 50/70;
// composite_score is a ranking number multiplied by the verdict's own quality
// multiplier, so a CAUTION market's composite sits below 45 by construction.
//
// WHAT THIS PINS
//   * for every (excess, constraint, ttp) the backend can publish, the trimmed
//     row's composite band IS the verdict, and no input band ranks below it;
//   * constraint is inverted (low = good) — a BUILD row's constraint is BUILD;
//   * quality_score (the publish gate's data-quality grade) and per-day trend
//     rates carry no siting band;
//   * rank_markets' unscaled fleet score carries no band unless the row has a
//     DCPI verdict, and then it is that verdict;
//   * NO gating change: every masked number is still null + `_<k>_in_pro`;
//   * a site composite with no verdict on the row keeps the site 70/45 band.
//
// Pure functions; the only socket is a 127.0.0.1 stub for server.mjs startup.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';

// Importing server.mjs fires its startup fetches at DCHUB_API_BASE, so the
// hard gate needs a loopback stub there (it refuses any connect off 127.0.0.1).
let stub, stubBase;
beforeAll(async () => {
  stub = http.createServer((req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}');
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  stubBase = `http://127.0.0.1:${stub.address().port}`;
});
afterAll(() => stub && stub.close());

const ENV = ['DCHUB_DEPTH_GATE', 'DCHUB_GRID_HEADROOM_TIER', 'DCHUB_API_BASE'];
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
async function load() {
  delete process.env.DCHUB_DEPTH_GATE;           // production default: gate ON
  process.env.DCHUB_GRID_HEADROOM_TIER = '1';
  process.env.DCHUB_API_BASE = stubBase;
  return import('../server.mjs?bandverdict=' + Math.random());
}

// util/dcpi_method.py, verbatim in JS: VERDICT_BANDS, verdict_from_scores,
// composite_from_published_fields. If the backend moves a band, this file and
// DCPI_VERDICT_BANDS must move together (the pin test below).
const BANDS = [['BUILD', 65.0, 50.0], ['CAUTION', 50.0, 70.0]];
const MULT = { BUILD: 1.0, CAUTION: 0.85, AVOID: 0.6 };
function verdictFromScores(c, e) {
  for (const [v, emin, cmax] of BANDS) if (e >= emin && c <= cmax) return v;
  return 'AVOID';
}
function composite(e, c, t, v) {
  const tt = Math.min(t, 60);
  const raw = e * 0.6 + (100 - c) * 0.3 + (1 - tt / 60) * 100 * 0.1;
  return Math.round(Math.max(0, Math.min(100, raw * MULT[v])) * 10) / 10;
}
const RANK = { AVOID: 0, CAUTION: 1, BUILD: 2 };

// Phoenix, 2026-10-02: CAUTION with the composite below the 45 cut.
const phoenix = () => {
  const e = 55.0, c = 62.0, t = 42.0, v = verdictFromScores(c, e);
  return {
    market_slug: 'phoenix', market_name: 'Phoenix', iso: 'WECC', verdict: v,
    composite_score: composite(e, c, t, v), constraint_score: c, excess_power_score: e,
    quality_score: 85, time_to_power_months: t,
    forecast: {
      available: true,
      projection: {
        '3mo': { constraint_score: 66.0, excess_power_score: 52.0, implied_verdict: 'CAUTION' },
        '6mo': { constraint_score: 71.5, excess_power_score: 49.0, implied_verdict: 'AVOID' },
        '12mo': { constraint_score: 100, excess_power_score: 0, implied_verdict: null,
                  projection_saturated: true },
      },
      trend_per_day: { constraint_score: 0.12, excess_power_score: -0.09 },
    },
  };
};

// Walk every object in a trimmed payload; for each row that publishes a
// verdict, no band on it may contradict that verdict.
function contradictions(node, path = '$', out = []) {
  if (Array.isArray(node)) { node.forEach((n, i) => contradictions(n, `${path}[${i}]`, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  const vk = ['verdict', 'dcpi_verdict', 'implied_verdict'].find((k) => k in node);
  const verdict = vk ? node[vk] : undefined;
  for (const [k, b] of Object.entries(node)) {
    if (!k.endsWith('_band') || typeof b !== 'string') continue;
    const base = k.slice(0, -'_band'.length);
    const isComposite = /^(composite_score|score|overall_score|dcpi_score)$/.test(base);
    if (typeof verdict !== 'string') {
      // A row that names a verdict key but has none (a saturated projection)
      // may not guess a composite band; an input band states only its input.
      if (vk && isComposite) out.push(`${path}.${k}=${b} beside ${vk}=null`);
      continue;
    }
    if (isComposite) {
      if (b !== verdict) out.push(`${path}.${k}=${b} but ${vk}=${verdict}`);
    } else if (RANK[b] === undefined || RANK[b] < RANK[verdict]) {
      out.push(`${path}.${k}=${b} ranks below ${vk}=${verdict}`);
    }
  }
  for (const [k, v] of Object.entries(node)) contradictions(v, `${path}.${k}`, out);
  return out;
}

describe('get_market_dcpi_rank — the band beside a masked score is the verdict', () => {
  it('★ Phoenix: verdict CAUTION, composite below 45 → composite_score_band CAUTION', async () => {
    const { trimForTrial } = await load();
    const src = phoenix();
    expect(src.verdict).toBe('CAUTION');
    expect(src.composite_score).toBeLessThan(45);       // the fixture is the bug's shape
    const out = trimForTrial(src, 'get_market_dcpi_rank');
    expect(out.verdict).toBe('CAUTION');
    expect(out.composite_score_band).toBe('CAUTION');
    expect(out.constraint_score_band).toBe('CAUTION');
    expect(out.excess_power_score_band).toBe('CAUTION');
    expect(contradictions(out)).toEqual([]);
  });

  it('★ no gating change: every number is still withheld and says so', async () => {
    const { trimForTrial } = await load();
    const out = trimForTrial(phoenix(), 'get_market_dcpi_rank');
    for (const k of ['composite_score', 'constraint_score', 'excess_power_score', 'quality_score']) {
      expect(out[k], `${k} leaked`).toBeNull();
      expect(out[`_${k}_in_pro`], `${k} lost its marker`).toBe(true);
    }
    const p3 = out.forecast.projection['3mo'];
    expect(p3.constraint_score).toBeNull();
    expect(p3._constraint_score_in_pro).toBe(true);
    expect(out.forecast.trend_per_day.excess_power_score).toBeNull();
    expect(out.forecast.trend_per_day._excess_power_score_in_pro).toBe(true);
  });

  it('a data-quality grade and a per-day rate are not siting verdicts', async () => {
    const { trimForTrial } = await load();
    const out = trimForTrial(phoenix(), 'get_market_dcpi_rank');
    expect(out).not.toHaveProperty('quality_score_band');
    expect(Object.keys(out.forecast.trend_per_day).filter((k) => k.endsWith('_band'))).toEqual([]);
  });

  it('projection rows band their inputs consistently with implied_verdict', async () => {
    const { trimForTrial } = await load();
    const out = trimForTrial(phoenix(), 'get_market_dcpi_rank');
    expect(out.forecast.projection['3mo'].constraint_score_band).toBe('CAUTION');
    expect(out.forecast.projection['6mo'].constraint_score_band).toBe('AVOID');
    expect(out.forecast.projection['6mo'].excess_power_score_band).toBe('AVOID');
    expect(contradictions(out.forecast.projection)).toEqual([]);
  });

  it('★ property: for every publishable row, no band contradicts the verdict', async () => {
    const { trimForTrial } = await load();
    let n = 0; const seen = new Set();
    for (let e = 0; e <= 100; e += 2.5) {
      for (let c = 0; c <= 100; c += 2.5) {
        for (const t of [6, 24, 42, 72]) {
          const v = verdictFromScores(c, e);
          const row = { verdict: v, composite_score: composite(e, c, t, v),
                        constraint_score: c, excess_power_score: e };
          const out = trimForTrial(row, 'get_market_dcpi_rank');
          const bad = contradictions(out);
          expect(bad, `e=${e} c=${c} t=${t}`).toEqual([]);
          expect(out.composite_score_band).toBe(v);
          seen.add(v); n++;
        }
      }
    }
    expect(n).toBeGreaterThan(5000);
    expect([...seen].sort()).toEqual(['AVOID', 'BUILD', 'CAUTION']);
  });
});

describe('the same rule on every surface that bands a DCPI score', () => {
  it('★ site_selection_canvas: a BUILD row\'s low constraint is BUILD, not AVOID', async () => {
    const { trimForTrial } = await load();
    const r = () => ({ market_slug: 'x', verdict: 'BUILD', composite_score: 58.4,
                       constraint_score: 40.0, excess_power_score: 67.0 });
    const out = trimForTrial({ ok: true, shortlist: [r(), r(), r(), r()] }, 'site_selection_canvas');
    for (const row of out.shortlist) {
      expect(row.composite_score_band).toBe('BUILD');
      expect(row.constraint_score_band).toBe('BUILD');
      expect(row.excess_power_score_band).toBe('BUILD');
    }
    expect(contradictions(out)).toEqual([]);
  });

  it('★ rank_markets ai_ready: score is the DCPI composite → band is dcpi_verdict', async () => {
    const { trimForTrial } = await load();
    const out = trimForTrial({ criteria: 'ai_ready', results: [
      { market: 'midland-tx', dcpi_verdict: 'BUILD', score: 52.1, constraint_score: 20, excess_power_score: 85 },
      { market: 'phoenix', dcpi_verdict: 'CAUTION', score: 38.2, constraint_score: 62, excess_power_score: 55 },
    ] }, 'rank_markets');
    expect(out.results[0].score_band).toBe('BUILD');
    expect(out.results[1].score_band).toBe('CAUTION');
    expect(contradictions(out)).toEqual([]);
  });

  it('★ rank_markets best_overall: an unscaled fleet score carries no DCPI band', async () => {
    const { trimForTrial } = await load();
    const out = trimForTrial({ criteria: 'best_overall', results: [
      { market: 'ashburn-va', score: 3480.4, total_mw: 5200 },
    ] }, 'rank_markets');
    expect(out.results[0].score).toBeNull();
    expect(out.results[0]._score_in_pro).toBe(true);
    expect(out.results[0]).not.toHaveProperty('score_band');
  });

  it('a verdict key present but null bands the composite as nothing, never a guess', async () => {
    const { trimForTrial } = await load();
    const out = trimForTrial({ implied_verdict: null, composite_score: 12.0 }, 'get_market_dcpi_rank');
    expect(out).not.toHaveProperty('composite_score_band');
    expect(out._composite_score_in_pro).toBe(true);
  });

  it('a site composite with no verdict on the row keeps the site 70/45 band', async () => {
    const { trimForTrial } = await load();
    expect(trimForTrial({ composite_score: 81.2 }, 'get_composite_site_score').composite_score_band).toBe('BUILD');
    expect(trimForTrial({ composite_score: 44.9 }, 'get_composite_site_score').composite_score_band).toBe('AVOID');
  });
});

describe('the DCPI bands are util/dcpi_method.py VERDICT_BANDS', () => {
  it('pins the floors and ceilings this file reproduces', async () => {
    const { DCPI_VERDICT_BANDS } = await load();
    expect(DCPI_VERDICT_BANDS.map((b) => [b.verdict, b.excess_min, b.constraint_max])).toEqual(BANDS);
  });

  it('boundaries: excess floor is >=, constraint ceiling is <=', async () => {
    const { _bandForMaskedScore } = await load();
    expect(_bandForMaskedScore('excess_power_score', 65, {}, 'x')).toBe('BUILD');
    expect(_bandForMaskedScore('excess_power_score', 64.9, {}, 'x')).toBe('CAUTION');
    expect(_bandForMaskedScore('excess_power_score', 49.9, {}, 'x')).toBe('AVOID');
    expect(_bandForMaskedScore('constraint_score', 50, {}, 'x')).toBe('BUILD');
    expect(_bandForMaskedScore('constraint_score', 50.1, {}, 'x')).toBe('CAUTION');
    expect(_bandForMaskedScore('constraint_score', 70.1, {}, 'x')).toBe('AVOID');
    expect(_bandForMaskedScore('constraint_score', null, {}, 'x')).toBeNull();
  });
});
