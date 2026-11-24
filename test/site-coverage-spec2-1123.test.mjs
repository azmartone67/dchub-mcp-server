// site-coverage-spec2-1123.test.mjs — Grok spec 2 (2026-11-23): the site screen says what analyze_parcel's new
// blocks hold (flood, contamination, zoning, owner, coverage), each present only when the backend's own flag is on,
// and DCHUB_SITE_FLOOD_V2 on this server adds the analyze_parcel read to a flood-zone / BFE ask. Flag off and with
// no new blocks in the payload, the screen is byte-identical to origin/main 7d69664 (recorded below).
import { describe, it, expect, afterEach } from 'vitest';
import { siteScreenSteps, siteScreenFacts, parcelFloodLine, parcelContaminationLine, parcelZoningLine,
  parcelOwnerLine, _siteFloodV2On } from '../lib/site-screen-facts.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const PT = { lat: 39.0438, lon: -77.4874 };
const DR = { coverage: 'validated', hazards: { 'Riverine Flooding': 'Relatively Low' },
  location: { county: 'Loudoun', state: 'VA' }, disaster_risk: { rating: 'Relatively Low' } };
const PARCEL = { _entity: 'parcel_analysis', ok: true, total_acres: 4.2,
  hosted_parcel: { parcel_id: 'LOUD-1', county: 'Loudoun', state: 'VA' } };
const ASK = 'Screen 39.0438,-77.4874 Ashburn for flood zone, zoning and parcel';
const ASHBURN_FLOOD = { status: 'measured', zone: 'X', zone_subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false,
  firm_panel: '51107C0261E', panel_effective_date: '2017-02-17', static_bfe_ft: null, nearest_bfe_line_ft: null,
  nearest_bfe_line_distance_m: null, loma_lomr_present: false, as_of: '2017-02-17',
  confirm: 'Confirm any flood determination on the official FEMA map.' };

// Recorded from origin/main 7d69664's lib/site-screen-facts.mjs on the inputs above.
const MAIN_FACTS = '{"lines":[{"tool":"get_disaster_risk","step":1,"text":"Flood: Loudoun County, VA rates riverine flooding Relatively Low in the FEMA National Risk Index (all hazards: Relatively Low); a county rating, not the parcel\'s FEMA flood zone.","as_of":null},{"tool":"analyze_parcel","step":2,"text":"Parcel: 4.2 acres, parcel LOUD-1 (Loudoun County, VA GIS layer hosted by DC Hub).","as_of":null}],"flood":"Flood: Loudoun County, VA rates riverine flooding Relatively Low in the FEMA National Risk Index (all hazards: Relatively Low); a county rating, not the parcel\'s FEMA flood zone.","infra":null,"not_established":["The parcel\'s zoning designation is not held by DC Hub; the permitting line is state and county records."]}';
const MAIN_STEPS_FLOOD_ONLY = '[{"tool":"get_infrastructure","depends_on":[],"estimated_calls":1,"site_screen":"infrastructure","why":"A site screen at a point: the nearest transmission line in km (EIA lines located at their HIFLD substation), plus substation, transmission-line and gas-pipeline records within 10 km of the point. Independent of the other reads: same wave.","args_hint":{"lat":39.0438,"lon":-77.4874,"radius_km":10}}]';

afterEach(() => { delete process.env.DCHUB_SITE_FLOOD_V2; });

describe('flags off: byte-identical to origin/main', () => {
  it('a payload without the new blocks screens exactly as before', () => {
    const r = siteScreenFacts([ex(1, 'get_disaster_risk', PT, DR), ex(2, 'analyze_parcel', PT, PARCEL)], null, ASK);
    expect(JSON.stringify(r)).toBe(MAIN_FACTS);
  });
  it('a flood / BFE ask adds no read with the switch off', () => {
    expect(_siteFloodV2On()).toBe(false);
    expect(JSON.stringify(siteScreenSteps('flood zone and BFE here', PT, []))).toBe(MAIN_STEPS_FLOOD_ONLY);
  });
});

describe('DCHUB_SITE_FLOOD_V2: the flood / BFE ask reads analyze_parcel', () => {
  it('adds one analyze_parcel step at the point', () => {
    process.env.DCHUB_SITE_FLOOD_V2 = '1';
    const s = siteScreenSteps('what is the base flood elevation here', PT, []);
    expect(s.filter((x) => x.tool === 'analyze_parcel')).toHaveLength(1);
    expect(s[0]).toMatchObject({ tool: 'analyze_parcel', site_screen: 'flood', args_hint: PT });
  });
  it('never twice, and not when the plan already reads it', () => {
    process.env.DCHUB_SITE_FLOOD_V2 = '1';
    expect(siteScreenSteps('parcel acreage and flood zone', PT, []).filter((x) => x.tool === 'analyze_parcel')).toHaveLength(1);
    expect(siteScreenSteps('flood zone', PT, ['analyze_parcel']).some((x) => x.tool === 'analyze_parcel')).toBe(false);
    expect(siteScreenSteps('grid headroom here', PT, []).some((x) => x.tool === 'analyze_parcel')).toBe(false);
  });
});

describe('the lines', () => {
  it('Ashburn: zone X, outside the SFHA, no static BFE, panel and date, confirm line', () => {
    const l = parcelFloodLine(ASHBURN_FLOOD);
    expect(l).toContain('Zone X');
    expect(l).toContain('outside the Special Flood Hazard Area');
    expect(l).toContain('no static base flood elevation');
    expect(l).toContain('FIRM panel 51107C0261E effective 2017-02-17');
    expect(l).toContain('Confirm any flood determination on the official FEMA map.');
  });
  it('AE: the BFE in feet with its datum; never the zone letter as a BFE', () => {
    const l = parcelFloodLine({ ...ASHBURN_FLOOD, zone: 'AE', zone_subtype: null, sfha: true, static_bfe_ft: 312,
      static_bfe_datum: 'NAVD88', nearest_bfe_line_ft: 311, nearest_bfe_line_distance_m: 40, loma_lomr_present: true });
    expect(l).toContain('static base flood elevation 312 ft NAVD88');
    expect(l).toContain('nearest BFE line 311 ft, 40 m away');
    expect(l).toContain('a LOMA or LOMR intersects the point');
    expect(l).not.toMatch(/elevation\s+AE/);
  });
  it('a timeout is no answer, never low risk', () => {
    const l = parcelFloodLine({ status: 'timed_out', confirm: ASHBURN_FLOOD.confirm });
    expect(l).toContain('no flood determination is made');
    expect(l.toLowerCase()).not.toContain('minimal');
  });
  it('contamination: counts by program, the RCRA label, the date', () => {
    const l = parcelContaminationLine({ status: 'measured', radius_km: 10, as_of: '2026-11-23',
      counts: { superfund: 1, rcra: 1539, brownfields: 22 } });
    expect(l).toBe('Contaminated sites within 10 km (U.S. EPA EMEF, as of 2026-11-23): Superfund 1, RCRA 1,539 '
      + '(regulated hazardous-waste handlers, not confirmed contamination), Brownfields 22.');
    expect(parcelContaminationLine({ status: 'timed_out', counts: null })).toBe(null);
  });
  it('zoning and owner', () => {
    expect(parcelZoningLine({ zone_code: 'RC', zone_name: 'Rural Commercial', ordinance: '2023', case_number: 'ZMAP-2011-0003' }))
      .toBe('Zoning: RC (Rural Commercial), ordinance 2023, case ZMAP-2011-0003 (Loudoun County, VA zoning GIS).');
    expect(parcelZoningLine(null)).toBe(null);
    expect(parcelOwnerLine({ name: 'ACME DATA LLC', source: 'Franklin County Auditor (OH) parcel layer' }))
      .toBe('Owner: ACME DATA LLC (organization owner, Franklin County Auditor (OH) parcel layer).');
    expect(parcelOwnerLine({ name: null, reason: 'individual owner withheld' })).toBe('Owner: individual owner withheld.');
    expect(parcelOwnerLine({ name: null, reason: 'no open owner source on file for this county' })).toBe(null);
  });
});

describe('the screen with the new blocks present', () => {
  it('leads with the parcel-point flood zone, carries zoning, and says the coverage', () => {
    const p = { ...PARCEL, flood: ASHBURN_FLOOD,
      zoning: { zone_code: 'RC', zone_name: 'Rural Commercial', ordinance: '2023', case_number: 'ZMAP-2011-0003', as_of: '2026-11-23' },
      coverage: { summary: 'Zoning: Loudoun County, VA only. Owner: organization owners in Franklin County, OH only.' } };
    const r = siteScreenFacts([ex(1, 'get_disaster_risk', PT, DR), ex(2, 'analyze_parcel', PT, p)], null, ASK);
    expect(r.flood).toContain('Flood (FEMA NFHL at the parcel point');
    expect(r.lines.map((l) => l.text)).toContain('Zoning: RC (Rural Commercial), ordinance 2023, case ZMAP-2011-0003 (Loudoun County, VA zoning GIS, as of 2026-11-23).');
    expect(r.not_established.some((x) => /zoning designation is not held/.test(x))).toBe(false);
    expect(r.not_established).toContain('Coverage: Zoning: Loudoun County, VA only. Owner: organization owners in Franklin County, OH only.');
  });
  it('outside Loudoun, zoning is said with the backend reason, never invented', () => {
    const p = { ...PARCEL, hosted_parcel: { parcel_id: 'F-1', county: 'Franklin', state: 'OH' }, zoning: null,
      zoning_reason: 'no licensed county zoning source on file', owner: { name: 'ACME DATA LLC', source: 'Franklin County Auditor (OH) parcel layer' } };
    const r = siteScreenFacts([ex(1, 'analyze_parcel', PT, p)], null, 'zoning and owner of the parcel at 39.96,-83.0');
    expect(r.not_established).toContain("The parcel's zoning designation: no licensed county zoning source on file (DC Hub reads lot zoning in Loudoun County, VA only).");
    expect(r.lines.map((l) => l.text)).toContain('Owner: ACME DATA LLC (organization owner, Franklin County Auditor (OH) parcel layer).');
    expect(r.lines.some((l) => /^Zoning:/.test(l.text))).toBe(false);
  });
});
