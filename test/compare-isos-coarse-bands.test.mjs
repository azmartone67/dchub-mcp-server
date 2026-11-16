// compare-isos-coarse-bands.test.mjs — owner decision 2026-11-16 (Grok Note K item 7, option A).
//
// A keyless or free compare_isos answer withholds each ISO's time to power, constraint score and
// headroom (stranded capacity). It now carries a coarse band of the SAME exact value in their
// place, in a `bands` object per ISO plus a `bands_summary` sentence, in text block 0 and in
// structuredContent alike, and through execute_plan's compare step. The exact figures stay
// withheld (their `_<field>_in_pro` markers too), a missing value gets no band, and a caller who
// sees the figure gets no band.
//
// The containment checks read each band LABEL as the range it states ("24-48 mo" is
// 24 <= x < 48), independently of lib/iso-bands.mjs, so a moved threshold fails here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { timeToPowerBand, constraintLevel, headroomBand, isoRowBands, BAND_NOTE } from '../lib/iso-bands.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { gridIntelligence } from './helpers/us-grid-stub.mjs';

// ── the range a label states, parsed from the label text ─────────────────────
// "<24 mo" = [-inf, 24); "24-48 mo" = [24, 48); "48+ mo" = [48, inf). Same for GW.
function labelRange(label, unit) {
  const esc = unit.replace(/\s/g, '\\s');
  let m = new RegExp(`^<(\\d+(?:\\.\\d+)?)\\s${esc}$`).exec(label);
  if (m) return [-Infinity, Number(m[1])];
  m = new RegExp(`^(\\d+(?:\\.\\d+)?)-(\\d+(?:\\.\\d+)?)\\s${esc}$`).exec(label);
  if (m) return [Number(m[1]), Number(m[2])];
  m = new RegExp(`^(\\d+(?:\\.\\d+)?)\\+\\s${esc}$`).exec(label);
  if (m) return [Number(m[1]), Infinity];
  throw new Error(`unparseable band label "${label}" (${unit})`);
}
const contains = ([lo, hi], x) => x >= lo && x < hi;
// The DCPI constraint ceilings (DCPI_VERDICT_BANDS: BUILD constraint_max 50, CAUTION 70; pinned by
// test/band-matches-verdict.test.mjs). Higher = more constrained.
const CONSTRAINT_RANGE = { low: [0, 50], medium: [50, 70], high: [70, 100] };
const constraintContains = (level, x) => {
  const r = CONSTRAINT_RANGE[level];
  if (!r) return false;
  return level === 'low' ? x >= r[0] && x <= r[1] : x > r[0] && x <= r[1];
};

const TTP_EDGES = [0, 0.5, 12, 23.99, 24, 24.01, 36, 47.9876, 48, 48.01, 72, 140];
const MW_EDGES = [0, 1, 999.9, 1000, 1000.1, 2999.99, 3000, 5000, 9999.99, 10000, 10000.1, 61234];
const CONSTRAINT_EDGES = [0, 10, 49.99, 50, 50.01, 69.99, 70, 70.01, 99.9, 100];

describe('lib/iso-bands: every band contains the exact figure it was cut from', () => {
  it('time_to_power_band contains avg_time_to_power_months across the 24 / 48 month edges', () => {
    for (const x of TTP_EDGES) {
      const b = timeToPowerBand(x);
      expect(b, `${x} months got no band`).toBeTruthy();
      expect(contains(labelRange(b, 'mo'), x), `${x} months -> "${b}" does not contain it`).toBe(true);
    }
    // the edges land on the lower-inclusive side, as the labels read
    expect([timeToPowerBand(23.99), timeToPowerBand(24), timeToPowerBand(47.99), timeToPowerBand(48)])
      .toEqual(['<24 mo', '24-48 mo', '24-48 mo', '48+ mo']);
  });

  it('headroom_band contains stranded_capacity_mw (as GW) across the 1 / 3 / 10 GW edges', () => {
    for (const mw of MW_EDGES) {
      const b = headroomBand(mw);
      expect(b, `${mw} MW got no band`).toBeTruthy();
      expect(contains(labelRange(b, 'GW'), mw / 1000), `${mw} MW -> "${b}" does not contain it`).toBe(true);
    }
    expect([headroomBand(999.9), headroomBand(1000), headroomBand(2999.99), headroomBand(3000),
      headroomBand(9999.99), headroomBand(10000)])
      .toEqual(['<1 GW', '1-3 GW', '1-3 GW', '3-10 GW', '3-10 GW', '10+ GW']);
  });

  it('constraint_level contains constraint_score across the DCPI 50 / 70 ceilings', () => {
    for (const x of CONSTRAINT_EDGES) {
      const l = constraintLevel(x);
      expect(constraintContains(l, x), `constraint ${x} -> "${l}" does not contain it`).toBe(true);
    }
  });

  it('a missing or unusable value gets no band, never a guessed one', () => {
    for (const bad of [null, undefined, NaN, Infinity, '36', -1, {}]) {
      expect(timeToPowerBand(bad), `ttp ${String(bad)}`).toBeNull();
      expect(headroomBand(bad), `headroom ${String(bad)}`).toBeNull();
      expect(constraintLevel(bad), `constraint ${String(bad)}`).toBeNull();
    }
    expect(constraintLevel(100.5)).toBeNull();          // off the 0-100 scale
  });

  it('a band is emitted only where the trim withheld the figure', () => {
    const raw = { avg_time_to_power_months: 30, constraint_score: 60, stranded_capacity_mw: 2500 };
    expect(isoRowBands(raw, { avg_time_to_power_months: null, constraint_score: null, stranded_capacity_mw: null }))
      .toEqual({ time_to_power_band: '24-48 mo', constraint_level: 'medium', headroom_band: '1-3 GW', band_note: BAND_NOTE });
    expect(isoRowBands(raw, raw)).toBeNull();          // the caller sees every figure: no bands
    expect(isoRowBands({ constraint_score: 60 }, { constraint_score: null }))
      .toEqual({ constraint_level: 'medium', band_note: BAND_NOTE });
  });
});

// ── end to end, the real server.mjs on loopback ─────────────────────────────
const K_PRO = 'dch_live_cmpbands_pro_0001';
const K_FREE = 'dch_live_cmpbands_free_001';
// Edge values on purpose: ERCOT sits ON the 24-month and constraint-50 edges, MISO on the 70
// ceiling and the 10 GW edge. SPP has a DCPI row with no time to power, constraint or stranded MW.
const DCPI_ROWS = [
  { iso: 'PJM', iso_name: 'PJM Interconnection', market_count: 64, build_count: 3, avg_constraint: 71.2345, avg_excess: 40.1,
    avg_time_to_power_months: 47.9876, total_stranded_capacity_mw: 9876.54, latest_computed_at: '2026-11-15T18:32:13Z' },
  { iso: 'ERCOT', iso_name: 'ERCOT', market_count: 19, build_count: 1, avg_constraint: 50, avg_excess: 66.2,
    avg_time_to_power_months: 24, total_stranded_capacity_mw: 999.9, latest_computed_at: '2026-11-15T18:32:01Z' },
  { iso: 'MISO', iso_name: 'Midcontinent ISO', market_count: 39, build_count: 0, avg_constraint: 70, avg_excess: 52,
    avg_time_to_power_months: 23.5, total_stranded_capacity_mw: 10000, latest_computed_at: '2026-11-15T18:32:08Z' },
  { iso: 'SPP', iso_name: 'Southwest Power Pool', market_count: 12, build_count: 12, latest_computed_at: '2026-11-15T18:32:09Z' },
];
const FIELDS = [['time_to_power_band', 'avg_time_to_power_months'], ['constraint_level', 'constraint_score'],
  ['headroom_band', 'stranded_capacity_mw']];
// Figures that must never reach a free answer (four decimals: no clock-derived text carries them).
const NEEDLES = ['47.9876', '71.2345', '9876.54'];

function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

describe('compare_isos coarse bands (real server.mjs on loopback)', () => {
  let H, fence, paid;
  const routes = (p, req, body) => {
    if (p === '/api/v1/keys/validate') {
      const key = (body && body.api_key) || '';
      if (key === K_PRO) return { status: 200, body: { valid: true, tier: 'pro', developer_id: 'dev_cmpbands_pro' } };
      if (key === K_FREE) return { status: 200, body: { valid: true, tier: 'free', developer_id: 'dev_cmpbands_free' } };
      return { status: 200, body: { valid: false, tier: 'free' } };
    }
    if (p === '/api/v1/dcpi/iso-comparison') return { status: 200, body: { isos: DCPI_ROWS } };
    if (p === '/api/v1/interconnection-queue/snapshot') return { status: 200, body: { by_iso: [] } };
    const m = /^\/api\/v1\/grid\/intelligence\/([A-Za-z-]+)$/.exec(p);
    if (m) { const b = gridIntelligence(m[1].toUpperCase()); return b ? { status: 200, body: b } : undefined; }
    return undefined;
  };
  const ISOS = 'PJM,ERCOT,MISO,SPP';

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: routes });
    const r = await H.call('/mcp', 'compare_isos', { isos: ISOS }, { 'x-api-key': K_PRO, 'user-agent': 'test-client' });
    paid = r.msg.result;
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  // Every band in `cmp` contains the figure the paid answer shows for that ISO.
  function expectBandsContainPaid(cmp, label) {
    const pc = paid.structuredContent.comparison;
    let checked = 0;
    for (const iso of ['PJM', 'ERCOT', 'MISO']) {
      const b = cmp[iso] && cmp[iso].bands;
      expect(b, `${label} ${iso}: no bands`).toBeTruthy();
      expect(b.band_note).toBe(BAND_NOTE);
      for (const [band, src] of FIELDS) {
        const x = pc[iso][src];
        expect(typeof x, `${label} ${iso}: the paid answer has no ${src}`).toBe('number');
        expect(cmp[iso][src], `${label} ${iso}.${src}: the exact figure reached a free answer`).toBeNull();
        if (band === 'constraint_level') expect(constraintContains(b[band], x), `${label} ${iso} ${band} "${b[band]}" vs paid ${x}`).toBe(true);
        else expect(contains(labelRange(b[band], band === 'headroom_band' ? 'GW' : 'mo'), band === 'headroom_band' ? x / 1000 : x),
          `${label} ${iso} ${band} "${b[band]}" vs paid ${x}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBe(9);
    // SPP: no figure, so no band (and no invented one)
    expect(cmp.SPP && cmp.SPP.bands, `${label} SPP: a band was invented for missing values`).toBeUndefined();
  }

  it('the paid answer shows every figure and carries no bands', () => {
    const sc = paid.structuredContent;
    expect(sc.comparison.PJM.avg_time_to_power_months).toBe(47.9876);
    expect(sc.comparison.ERCOT.constraint_score).toBe(50);
    expect(sc.comparison.MISO.stranded_capacity_mw).toBe(10000);
    for (const iso of Object.keys(sc.comparison)) expect(sc.comparison[iso].bands, iso).toBeUndefined();
    expect(sc.bands_summary).toBeUndefined();
  });

  for (const [label, headers] of [
    ['keyless', { 'user-agent': 'test-client', 'x-dc-client-ip': '203.0.113.61' }],
    ['free key', { 'x-api-key': K_FREE, 'user-agent': 'test-client' }],
  ]) {
    it(`${label}: each withheld figure leaves a band that contains it, in text block 0 and structuredContent alike`, async () => {
      const r = (await H.call('/mcp', 'compare_isos', { isos: ISOS }, headers)).msg.result;
      const sc = r.structuredContent;
      const text0 = r.content[0].text;
      const lead = leadingJson(text0);
      expect(lead && lead.comparison, `${label}: text block 0 does not lead with the comparison JSON`).toBeTruthy();
      expectBandsContainPaid(sc.comparison, `${label} structuredContent`);
      expectBandsContainPaid(lead.comparison, `${label} text`);
      for (const iso of ['PJM', 'ERCOT', 'MISO', 'SPP']) {
        expect(lead.comparison[iso].bands, `${label} ${iso}: the two copies differ`).toEqual(sc.comparison[iso].bands);
      }
      // the exact figures stay gated, markers included
      expect(sc.comparison.PJM._avg_time_to_power_months_in_pro).toBe(true);
      expect(sc.comparison.PJM._constraint_score_in_pro).toBe(true);
      for (const n of NEEDLES) {
        expect(text0.includes(n) || JSON.stringify(sc).includes(n), `${label}: ${n} leaked`).toBe(false);
      }
      // the bands said in prose, the same sentence in both copies
      expect(sc.bands_summary).toBe(lead.bands_summary);
      expect(sc.bands_summary).toContain('PJM: time-to-power band 24-48 mo, constraint level high, headroom band 3-10 GW');
      expect(sc.bands_summary).toContain('ERCOT: time-to-power band 24-48 mo, constraint level low, headroom band <1 GW');
      expect(sc.bands_summary).toContain('MISO: time-to-power band <24 mo, constraint level medium, headroom band 10+ GW');
      expect(sc.bands_summary).not.toMatch(/SPP/);
      expect(text0).toContain(sc.bands_summary);
      // no plan names or prices in what this change writes
      expect(JSON.stringify([sc.bands_summary, sc.comparison.PJM.bands])).not.toMatch(/\$\d|\b(Pro|Developer|Enterprise|Starter)\b|plan/i);
      // within the free answer budget (lib/answer-shape.mjs, 30,000 B per copy) for a 4-ISO compare
      expect(Buffer.byteLength(text0), `${label} text block 0 bytes`).toBeLessThan(30_000);
      expect(Buffer.byteLength(JSON.stringify(sc)), `${label} structuredContent bytes`).toBeLessThan(30_000);
    }, 120_000);
  }

  it('keyless execute_plan: the compare_isos step carries the same bands', async () => {
    const r = (await H.call('/mcp', 'execute_plan', { intent: 'compare PJM vs ERCOT vs MISO vs SPP for 100 MW by 2028' },
      { 'user-agent': 'test-client', 'x-dc-client-ip': '203.0.113.62' })).msg.result;
    for (const [where, o] of [['structuredContent', r.structuredContent], ['text', leadingJson(r.content[0].text)]]) {
      expect(o, `execute_plan ${where}: no JSON`).toBeTruthy();
      const step = (o.executed || []).find((e) => e.tool === 'compare_isos');
      expect(step, `execute_plan ${where}: no compare_isos step`).toBeTruthy();
      expectBandsContainPaid(step.result.comparison, `execute_plan ${where}`);
      for (const n of NEEDLES) expect(JSON.stringify(o).includes(n), `execute_plan ${where}: ${n} leaked`).toBe(false);
    }
  }, 120_000);
});
