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
    expect(desc).toMatch(/no wholesale\/LMP price and no grid-status flag/);
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
