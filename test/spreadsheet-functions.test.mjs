// DC Hub spreadsheet functions (2026-10-31): Google Sheets (integrations/spreadsheets/
// google-sheets) and Excel (integrations/spreadsheets/excel, hosted at
// https://dchub.cloud/addins/excel/). One mapper, cells.js, turns a DC Hub REST response
// into cells; the two hosts carry byte-identical copies. The fixtures below are cut
// from real keyless responses read 2026-10-31.
//
// The rule that matters: a value DC Hub withholds becomes "withheld: <link>", never a
// number. Read-only: it reads committed files and runs the mapper on fixtures.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = path.join(ROOT, 'integrations/spreadsheets');
const read = (f) => fs.readFileSync(path.join(SP, f), 'utf8');
// Loaded as a plain script, the way Apps Script and the Excel runtime load it.
const sandbox = { module: { exports: {} }, encodeURIComponent };
vm.runInNewContext(read('cells.js'), sandbox, { filename: 'cells.js' });
const C = sandbox.module.exports;

const GRID_CAPPED = { error: 'upgrade_required', gate: 'map_session_cap', upgrade_url: 'https://dchub.cloud/go/c/x', message: "You've used your free map session" };
const DCPI_PREVIEW = { _gated: true, _locked_fields: ['excess_power_score', 'time_to_power_months'], verdict: 'CAUTION', composite_score: 41.9, excess_power_score: null, market_name: 'Phoenix', iso: 'WECC' };
const FAC_PARTIAL = { success: true, tier: 'free', total_matching: 234, human_url: 'https://dchub.cloud/upgrade/h/abc',
  data: [{ name: 'Level 3 Ashburn', provider: 'Lumen Technologies', city: 'Ashburn', state: 'VA', country: 'US', as_of: '2026-03-30', profile_url: 'https://dchub.cloud/facilities/x' }] };
const ENERGY_GATED = { gated: true, retail_rate_kwh: null, message: 'Sign up free (email only) to unlock state-specific retail rates.' };
const GRID_FULL = { region: 'PJM', demand_mw: 101234, demand_24h: '<gated: identified-tier or higher>', fuel_mix: { gas: 0.45 } };

describe('host copies are the mapper, byte for byte', () => {
  it.each(['google-sheets/Cells.gs', 'excel/cells.js'])('%s', (f) => {
    expect(read(f)).toBe(read('cells.js'));
  });
});

describe('the four functions line up across hosts', () => {
  const ids = Object.keys(C.DCHUB_FUNCTIONS).sort();
  it('functions.json ids = associate() ids = mapper ids', () => {
    const meta = JSON.parse(read('excel/functions.json')).functions.map((f) => f.id).sort();
    const assoc = [...read('excel/functions.js').matchAll(/CustomFunctions\.associate\("([A-Z_]+)"/g)].map((m) => m[1]).sort();
    expect(meta).toEqual(ids);
    expect(assoc).toEqual(ids);
  });
  it('Code.gs defines DCHUB_<id> as a @customfunction for each', () => {
    const gs = read('google-sheets/Code.gs');
    for (const id of ids) expect(gs).toMatch(new RegExp(`@customfunction\\s*\\n\\s*\\*/\\s*\\nfunction DCHUB_${id}\\(`));
  });
  it('FACILITIES is a matrix in Excel', () => {
    const f = JSON.parse(read('excel/functions.json')).functions.find((x) => x.id === 'FACILITIES');
    expect(f.result.dimensionality).toBe('matrix');
  });
});

describe('manifest.xml points at hosted files that exist', () => {
  const xml = read('excel/manifest.xml');
  it('every resource URL is under https://dchub.cloud/addins/excel/ and names a file in excel/', () => {
    const urls = [...xml.matchAll(/DefaultValue="(https:\/\/dchub\.cloud\/addins\/excel\/[^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(3);
    for (const u of urls) {
      // Cloudflare Pages serves x.html at /x and 308s /x.html there, so an HTML page is
      // referenced extensionless (no redirect hop for the Office runtime); a file name
      // with an extension is served as is.
      const rel = u.split('/addins/excel/')[1];
      expect(rel.endsWith('.html')).toBe(false);
      const file = path.extname(rel) ? rel : rel + '.html';
      expect(fs.existsSync(path.join(SP, 'excel', file))).toBe(true);
    }
  });
  it('namespace DCHUB, one GUID id', () => {
    expect(xml).toMatch(/id="Functions\.Namespace" DefaultValue="DCHUB"/);
    expect(xml).toMatch(/<Id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}<\/Id>/);
  });
});

describe('mapper', () => {
  it('URLs carry the via tag and encode arguments', () => {
    expect(C.dchubUrl('GRID', ['pjm'], 'sheets')).toBe('https://dchub.cloud/api/v1/grid/intelligence/PJM?via=sheets');
    expect(C.dchubUrl('FACILITIES', ['Ashburn VA', 500], 'excel')).toBe('https://dchub.cloud/api/v1/facilities?q=Ashburn%20VA&limit=100&via=excel');
    expect(C.dchubUrl('ENERGY_RATE', ['va'], 'excel')).toBe('https://dchub.cloud/api/v1/energy/retail/rates?state=VA&via=excel');
  });
  it('real values pass through', () => {
    expect(C.dchubCell('DCPI', DCPI_PREVIEW, '')).toBe('CAUTION');
    expect(C.dchubCell('DCPI', DCPI_PREVIEW, 'composite_score')).toBe(41.9);
    expect(C.dchubCell('GRID', GRID_FULL, '')).toBe(101234);
    expect(C.dchubCell('GRID', GRID_FULL, 'fuel_mix.gas')).toBe(0.45);
  });
  it('withheld values are withheld, never a number', () => {
    expect(C.dchubCell('GRID', GRID_CAPPED, '')).toBe('withheld: https://dchub.cloud/go/c/x');
    expect(C.dchubCell('DCPI', DCPI_PREVIEW, 'excess_power_score')).toBe('withheld: https://dchub.cloud/signup');
    expect(C.dchubCell('ENERGY_RATE', ENERGY_GATED, '')).toBe('withheld: https://dchub.cloud/signup');
    expect(C.dchubCell('GRID', GRID_FULL, 'demand_24h')).toBe('withheld: https://dchub.cloud/signup');
    expect(C.dchubCell('GRID', GRID_FULL, 'no_such_field')).toBe('not reported');
    expect(C.dchubCell('GRID', null, '')).toBe('error: no response from DC Hub');
    // the live keyless energy gate returns a site-relative link (read 2026-10-31)
    expect(C.dchubCell('ENERGY_RATE', { ...ENERGY_GATED, upgrade_url: '/signup?next=/connect' }, '')).toBe('withheld: https://dchub.cloud/signup?next=/connect');
  });
  it('facility tables have a header, rows, and say when they are partial', () => {
    const t = C.dchubTable(FAC_PARTIAL);
    expect(t[0]).toEqual(C.FACILITY_COLUMNS);
    expect(t[1][0]).toBe('Level 3 Ashburn');
    expect(t[2][0]).toBe('showing 1 of 234: https://dchub.cloud/upgrade/h/abc');
    expect(t.every((r) => r.length === C.FACILITY_COLUMNS.length)).toBe(true);
    expect(C.dchubTable(GRID_CAPPED)).toEqual([['withheld: https://dchub.cloud/go/c/x']]);
  });
});
