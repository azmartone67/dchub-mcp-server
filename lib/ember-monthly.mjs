// ember-monthly.mjs — Ember monthly electricity data on get_global_power and compare_isos (2026-11-18).
//
// dchub-backend be#8978 adds GET /api/v1/ember/monthly?area=<ISO3 | name | US-XX>&months=N:
// a country's (or US state's) monthly generation mix, demand and carbon intensity from
// Ember's public bulk files, licensed CC BY 4.0, with a provenance block that carries
// Ember's attribution. The loader is off until DCHUB_EMBER_INGEST_ENABLED=1, and while it
// is off (or before be#8978 merges) the read answers 404. So everything here is ADDITIVE
// and fails soft: any non-200, an ok:false body, no months, a timeout or a transport error
// gives null, and the calling tool answers exactly as it did before (its current source).
//
// What Ember measures is NOT what either tool already returns:
//   * get_global_power is the GEM asset inventory (power plants, MW of capacity). Ember is
//     a country's monthly ENERGY (TWh), mix shares and carbon intensity. It rides beside
//     the plant summary as `electricity_monthly`, never merged into it.
//   * compare_isos rows are live grid telemetry (MW, a snapshot). Ember is a monthly
//     country total. It rides on the row as `ember_monthly`, never fills the live fields,
//     and says when the country is wider than the grid.
//
// CC BY 4.0 needs the credit wherever the figures go, so every block carries Ember's
// attribution, licence id and licence URL, taken from the backend's provenance block when
// it sends one (it is the authority) and from the constants below only when it does not.

export const EMBER_PATH = '/api/v1/ember/monthly';
export const EMBER_LICENSE = 'CC-BY-4.0';
export const EMBER_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const EMBER_ATTRIBUTION_FALLBACK = 'Source: Ember, Monthly Electricity Data (ember-energy.org), CC-BY-4.0.';
const EMBER_TIMEOUT_MS = 4000;

// compare_isos grid code -> Ember ISO 3 country code, ONLY where the grid is one country's
// grid (or most of it). Sub-national zones (EU_IT_NORD, EU_DK1, EU_NO1, EU_SE3, JP_TOKYO)
// and the Canadian provinces (IESO, AESO, HYDROQUEBEC: Ember's global file has Canada as
// one row) are left out: a national figure on a provincial row would read as the
// province's. The US ISOs are left out for the same reason (Ember has US states, and no
// ISO is one state). `wider` marks a grid that covers less than the country Ember reports.
export const GRID_EMBER_AREA = Object.freeze({
  NGESO: { area: 'GBR', wider: 'Ember reports the United Kingdom; NESO operates the Great Britain grid (not Northern Ireland).' },
  NESO: { area: 'GBR', wider: 'Ember reports the United Kingdom; NESO operates the Great Britain grid (not Northern Ireland).' },
  EU_DE_LU: { area: 'DEU', wider: 'Ember reports Germany; the EU_DE_LU bidding zone also includes Luxembourg.' },
  EU_FR: { area: 'FRA' }, EU_NL: { area: 'NLD' }, EU_BE: { area: 'BEL' }, EU_ES: { area: 'ESP' },
  EU_PT: { area: 'PRT' }, EU_PL: { area: 'POL' }, EU_AT: { area: 'AUT' }, EU_CH: { area: 'CHE' },
  EU_CZ: { area: 'CZE' }, EU_FI: { area: 'FIN' }, EU_SK: { area: 'SVK' }, EU_HU: { area: 'HUN' },
  EU_RO: { area: 'ROU' }, EU_BG: { area: 'BGR' }, EU_GR: { area: 'GRC' }, EU_SI: { area: 'SVN' },
  EU_HR: { area: 'HRV' }, EU_EE: { area: 'EST' }, EU_LV: { area: 'LVA' }, EU_LT: { area: 'LTU' },
  TAIPOWER: { area: 'TWN' },
  OCCTO: { area: 'JPN' },
  'KEPCO-KR': { area: 'KOR' },
  ONS: { area: 'BRA' },
  AEMO: { area: 'AUS', wider: 'Ember reports all of Australia; AEMO\'s NEM excludes Western Australia and the Northern Territory.' },
  EMA: { area: 'SGP' },
});

export function emberAreaForGrid(code) {
  const k = String(code || '').trim().toUpperCase();
  return GRID_EMBER_AREA[k] || null;
}

const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// PURE. The backend body -> the block a tool attaches, or null when there is nothing honest
// to attach. Newest month only (as_of); the backend already orders months newest first.
export function shapeEmberMonthly(body, extra = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.ok !== true) return null;
  const months = Array.isArray(body.months) ? body.months : [];
  const m = months[0];
  if (!m || typeof m !== 'object' || !m.month) return null;
  const prov = body.provenance && typeof body.provenance === 'object' ? body.provenance : {};
  const mix = (m.mix && typeof m.mix === 'object') ? m.mix : {};
  const shares = Object.entries(mix)
    .map(([k, v]) => [k, v && typeof v === 'object' ? _num(v.share_pct) : null])
    .filter(([, v]) => v !== null)
    .sort((a, b) => b[1] - a[1]);
  const area = body.area && typeof body.area === 'object' ? body.area : {};
  return {
    area: { code: area.code || null, name: area.name || null, scope: area.scope || null },
    ...(extra.area_note ? { area_note: extra.area_note } : {}),
    month: m.month,
    demand_twh: _num(m.demand_twh),
    generation_twh: _num(m.generation_twh),
    net_imports_twh: _num(m.net_imports_twh),
    carbon_intensity_gco2e_kwh: _num(m.carbon_intensity_gco2e_kwh),
    mix_share_pct: Object.fromEntries(shares),
    as_of: body.as_of || m.month,
    as_of_basis: body.as_of_basis || 'as_of is the newest month Ember publishes for this area',
    measure_note: 'Monthly energy (TWh) and shares of generation for the whole area, from Ember; '
      + 'not live grid telemetry and not installed capacity.',
    source: prov.source || 'Ember',
    source_url: prov.source_url || 'https://ember-energy.org/data/monthly-electricity-data/',
    license: prov.license || EMBER_LICENSE,
    license_url: prov.license_url || EMBER_LICENSE_URL,
    attribution: prov.attribution || EMBER_ATTRIBUTION_FALLBACK,
    ...(prov.source_published_at ? { source_published_at: prov.source_published_at } : {}),
  };
}

// Read one area, fail soft. `callAPI` is server.mjs's reader (returns {error:'API 404'}
// on a non-200 rather than throwing); anything that is not an ok body is null.
export async function fetchEmberMonthly(callAPI, area, extra = {}) {
  const a = String(area || '').trim();
  if (!a) return null;
  try {
    const body = await callAPI(EMBER_PATH, { area: a, months: 1 }, { internal: true, timeout: EMBER_TIMEOUT_MS });
    return shapeEmberMonthly(body, extra);
  } catch {
    return null;
  }
}
