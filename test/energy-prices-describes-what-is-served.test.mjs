// get_energy_prices promises only what /api/v1/energy/summary serves (2026-10-25).
//
// The description promised a wholesale/LMP price and a real-time grid-status
// flag that the backend never returns, called monthly EIA retail rates "live",
// and the output schema labelled the $/kWh fields as cents/kWh (the backend
// divides by 100: main.py avg_rate_kwh / retail_rate_kwh / industrial_rate_kwh).
// natural_gas_usd_mmbtu is served since be#7754 (latest Henry Hub spot).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const start = src.indexOf("trackedTool(srv, 'get_energy_prices'");
// The description is the 3rd argument: from its opening quote to the first
// "'," AFTER it (slicing from the tool name would stop at the name itself).
const descOpen = src.indexOf(", '", start + "trackedTool(srv, 'get_energy_prices'".length) + 3;
const desc = src.slice(descOpen, src.indexOf("',", descOpen));
const sStart = src.indexOf('get_energy_prices: z.looseObject({');
const schema = src.slice(sStart, src.indexOf('}).describe(', sStart));

describe('get_energy_prices text matches the served payload', () => {
  it('found both blocks', () => {
    expect(start).toBeGreaterThan(0);
    expect(sStart).toBeGreaterThan(0);
    // a real description, not an empty or truncated slice
    expect(desc.length).toBeGreaterThan(400);
    expect(desc.startsWith('Use this when')).toBe(true);
  });
  it('promises no field the backend never returns', () => {
    for (const f of ['wholesale_price_usd_mwh', 'grid_status', 'real-time grid-status']) {
      expect(desc).not.toContain(f);
      expect(schema).not.toContain(f);
    }
    expect(desc).toMatch(/This tool has no grid-status flag\./);
  });
  // 2026-11-18 (owner, Grok note 2026-11-17 item 2): the backend serves a wholesale_lmp hub block.
  it('describes the wholesale_lmp block it now serves, and the hub argument', () => {
    expect(desc).not.toMatch(/no wholesale\/LMP price/);
    expect(desc).toMatch(/wholesale_lmp/);
    expect(desc).toMatch(/label "wholesale LMP, \$\/MWh"/);
    for (const f of ['real_time {lmp_usd_mwh, interval_ending, as_of, market "RTM", stale, stale_after_minutes}',
      'day_ahead {lmp_usd_mwh, delivery_date, hour_ending, as_of, market "DAM"} or null', 'hubs_available',
      'day_ahead_note', 'source_url', 'license', 'basis', 'wholesale_lmp_withheld {iso, reason}']) {
      expect(desc, f).toContain(f);
    }
    expect(desc).toMatch(/served to every caller/);
    // The backend decides which ISOs; the text names only the two whose terms are clear.
    expect(desc).toMatch(/for ERCOT and CAISO where their terms allow/);
    expect(src).toMatch(/hub: S\.describe\('Optional ISO pricing hub for wholesale_lmp/);
    for (const f of ['wholesale_lmp: _oObj(', 'wholesale_lmp_withheld: _oObj(', "lmp_usd_mwh: _oNum('Real-time hub LMP, USD/MWh')"]) {
      expect(schema, f).toContain(f);
    }
  });
  it('names no plan and no price (Note F)', () => {
    expect(desc).not.toMatch(/\$\d|paid plan|\bPro\b|free tier/i);
  });
  it('says the retail rates are monthly, not live', () => {
    expect(desc).toMatch(/monthly and not live/);
    expect(desc).not.toMatch(/live energy PRICING/);
  });
  it('labels the flat rate fields in dollars and the block in cents', () => {
    for (const f of ['retail_rate_kwh', 'industrial_rate_kwh', 'avg_rate_kwh']) {
      const line = schema.split('\n').find((l) => l.trim().startsWith(f + ':'));
      expect(line, f).toMatch(/DOLLARS\/kWh/);
    }
    expect(schema).toMatch(/avg_cents_kwh: _oNum\('Average retail, cents\/kWh'\)/);
  });
  it('describes the gas price as one national Henry Hub benchmark', () => {
    expect(desc).toMatch(/natural_gas_usd_mmbtu, the latest Henry Hub daily spot/);
    expect(desc).toMatch(/national benchmark/);
  });
});
