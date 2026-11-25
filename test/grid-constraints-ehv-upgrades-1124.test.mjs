// grid-constraints-ehv-upgrades-1124.test.mjs -- the Loudoun grid-constraints answer (Grok Brain note 2026-11-24, item 2).
//
// Live p5 said "Nearest transmission line: 69 kV, 7.2 km away, JEA (from HAMILTON substation)" and printed the AEP and
// Dominion halves of one 765 kV project as two upgrades, each cut at 90 characters. be#9386 fixes the substation join
// and adds nearest_ehv (nearest line at 230 kV+); the composer names that line and keeps the true nearest as a clause.
import { describe, it, expect } from 'vitest';
import { buildGridConstraintsAnswer } from '../lib/power-rotation-1123.mjs';
import { nearestTransmission } from '../lib/site-point-depth.mjs';

const ctx = { intent_class: 'grid_constraints', state: 'VA', place_label: 'Loudoun County, VA' };
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const DOM = 'VIRGINIA ELECTRIC & POWER CO';
const PROX = { available: true, line_count: 40, ehv_230kv_plus: 22, max_voltage_kv: 500,
  nearest: { distance_km: 1.2, voltage_kv: 115, operator: DOM, from_sub: 'SHELLHORN', to_sub: 'X' } };
const EHV = { distance_km: 3.4, voltage_kv: 500, operator: DOM, from_sub: 'BEAUMEADE', to_sub: 'Y' };
const infra = (prox) => ex(1, 'get_infrastructure', { lat: 39.03, lon: -77.47, radius_km: 30 },
  { counts: { substations: 90 }, filter: { radius_km: 30 }, nearest_transmission: nearestTransmission(prox) });

describe('grid_constraints: the 230 kV+ line', () => {
  it('nearest_ehv served: the 500 kV line is named with km and owner; the 115 kV nearest stays as a second clause', () => {
    const a = buildGridConstraintsAnswer(ctx, [infra({ ...PROX, nearest_ehv: EHV, nearest_ehv_basis: 'nearest line at 230 kV or above' })]);
    const ev = a.evidence.join(' ');
    expect(ev).toMatch(/Nearest transmission line at 230 kV or above: 500 kV, 3\.4 km away, VIRGINIA ELECTRIC & POWER CO \(from BEAUMEADE substation\); the nearest line of any voltage is 115 kV, 1\.2 km away/);
    expect(a.headline).toMatch(/nearest 230 kV\+ line 500 kV 3\.4 km away \(VIRGINIA ELECTRIC & POWER CO\), nearest line of any voltage 115 kV 1\.2 km away/);
  });
  it('nearest_ehv is the nearest line: no second clause', () => {
    const n = { ...EHV };
    const a = buildGridConstraintsAnswer(ctx, [infra({ ...PROX, nearest: n, nearest_ehv: EHV })]);
    expect(a.evidence.join(' ')).toMatch(/at 230 kV or above: 500 kV, 3\.4 km away/);
    expect(a.evidence.join(' ')).not.toMatch(/any voltage/);
  });
  it('nearest_ehv absent (backend before be#9386): output is exactly the old nearest-line wording', () => {
    const nt = nearestTransmission(PROX);
    expect(nt).not.toHaveProperty('ehv');
    const a = buildGridConstraintsAnswer(ctx, [infra(PROX)]);
    const ev = a.evidence.join(' ');
    expect(ev).toMatch(/Nearest transmission line: 115 kV, 1\.2 km away, VIRGINIA ELECTRIC & POWER CO \(from SHELLHORN substation\)/);
    expect(ev).not.toMatch(/230 kV or above:/);
    expect(a.headline).toMatch(/nearest line 115 kV 1\.2 km away/);
  });
  it('a nearest_ehv under 230 kV is not trusted as one', () => {
    expect(nearestTransmission({ ...PROX, nearest_ehv: { ...EHV, voltage_kv: 138 } })).not.toHaveProperty('ehv');
  });
});

const ip = (rows) => ex(4, 'get_infra_projects', { type: 'transmission', state: 'VA' },
  { summary: { by_type: { transmission: { matching: rows.length, by_status: { Planned: rows.length } } } }, transmission_projects: rows });
const AEP = { iso: 'PJM', kv: 765, owner: 'AEP', status: 'Planned', projected_isd: '2029-06-01',
  description: 'Build a new 115 mile 765kV line from Joshua Falls – Yeat. (Roughly 1 mile in AEP section).' };
const DVP = { iso: 'PJM', kv: 765, owner: 'Dominion', status: 'Planned',
  description: 'Build a new 115 mile 765kV line from Joshua Falls – Yeat. (Roughly 114 miles in Dominion section).' };
const SUB = { iso: 'PJM', kv: 765, owner: 'Dominion', status: 'Planned',
  description: 'Build a new 765/500KV substation called Yeat. Install (2) 765/500 kV transformers. Cut in 500kV line Spotsylvania – Morrisville into Yeat.' };
const upgradeLine = (a) => a.evidence.find((t) => /^Highest-voltage upgrades shown/.test(t)) || '';

describe('grid_constraints: planned upgrades', () => {
  it('the AEP and Dominion halves of one project are one upgrade line, with both owners', () => {
    const line = upgradeLine(buildGridConstraintsAnswer(ctx, [ip([AEP, DVP, SUB])]));
    expect(line.match(/Joshua Falls/g)).toHaveLength(1);
    expect(line).toMatch(/765 kV Build a new 115 mile 765kV line from Joshua Falls – Yeat\. \(AEP\/Dominion, planned, in service 2029-06-01\)/);
    expect(line).toMatch(/substation called Yeat/);
  });
  it('titles that differ only in case, punctuation, spacing or an owner prefix are one', () => {
    const a = { iso: 'PJM', kv: 500, owner: 'Dominion', status: 'Planned', description: 'Dominion: Rebuild Elmont - Chickahominy 500 kV line' };
    const b = { iso: 'PJM', kv: 500, owner: 'NEET', status: 'Planned', description: 'rebuild  ELMONT – Chickahominy 500kV  line (NEET Portion)' };
    const line = upgradeLine(buildGridConstraintsAnswer(ctx, [ip([a, b])]));
    expect(line.match(/Chickahominy/gi)).toHaveLength(1);
    expect(line).toMatch(/Dominion\/NEET/);
  });
  it('a long title is cut at a word boundary with an ellipsis; a short one is not cut', () => {
    const long = { iso: 'PJM', kv: 500, owner: 'Dominion', status: 'Planned',
      description: 'Rebuild approximately 27.7 miles of 500 kV transmission line from Elmont to Chickahominy with current 500 kV standards' };
    const short = { iso: 'PJM', kv: 230, owner: 'Dominion', status: 'Planned', description: 'Rebuild 230 kV line' };
    const line = upgradeLine(buildGridConstraintsAnswer(ctx, [ip([long, short])]));
    const m = line.match(/500 kV (.*?) \(Dominion/);
    expect(m).not.toBeNull();
    expect(m[1].endsWith('…')).toBe(true);
    const words = long.description.split(' ');
    const shown = m[1].slice(0, -1).split(' ');
    expect(shown.every((w, i) => w === words[i])).toBe(true);   // every word shown is a whole word of the title
    expect(m[1].length).toBeLessThanOrEqual(91);
    expect(line).toMatch(/230 kV Rebuild 230 kV line \(Dominion/);
  });
});
