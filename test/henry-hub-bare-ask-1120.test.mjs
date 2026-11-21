// Grok daily 2026-11-19 item 6, re-tested live 2026-11-20 (planner 5.51): "what is the Henry Hub gas price today"
// planned get_gas_index + get_gas_economics with no market, so the economics step ran skipped_unresolved, nothing read
// the Henry Hub spot, and the answer had no headline at all. 5.52: a Henry Hub ask with no place reads the keyless
// Henry Hub spot (get_energy_prices, EIA RNGWHHD, dated by its trading day) and leads with it.
import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { buildGasPriceAnswer } from '../lib/energy-answers.mjs';

const ex = (step, tool, args, result, extra = {}) => ({ step, tool, args, status: 'executed', result, ...extra });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));
const tools = (q) => _planQuery(q).recommended_sequence.map((s) => s.tool);

// What GET /api/v1/energy/summary served keyless on 2026-11-20 (trimmed to the fields read).
const EP = { natural_gas_usd_mmbtu: 3.1, natural_gas: { hub: 'Henry Hub', as_of: '2026-11-17', period: '2026-11-17', price_type: 'daily spot' } };
// get_gas_index with no state, keyless: per-state rows, no single score block.
const GI = { ok: true, states: [{ state: 'TX', gas_price: 2.803, gas_price_period: '2026-08', data_as_of: '2026-08-01' }] };

describe('5.52: a bare Henry Hub ask reads the Henry Hub spot', () => {
  it('plans get_energy_prices and no unresolvable gas-economics step', () => {
    expect(PLANNER_VERSION).toBe('5.57');
    const p = _planQuery('what is the Henry Hub gas price today');
    expect(p.intent_class).toBe('gas_price');
    const t = p.recommended_sequence.map((s) => s.tool);
    expect(t).toContain('get_energy_prices');
    expect(t).not.toContain('get_gas_economics');
  });
  it('a gas ask without Henry Hub keeps its sequence; a place keeps the economics step', () => {
    expect(tools('natural gas prices for data centers')).toEqual(['get_gas_index', 'get_gas_economics']);
    const tx = tools('Henry Hub gas price for a data center in Texas');
    expect(tx).toContain('get_gas_economics');
    expect(tx).not.toContain('get_energy_prices');
  });
  it('leads with the Henry Hub spot and its EIA trading day', () => {
    const executed = [ex(1, 'get_gas_index', { limit: 10 }, GI), ex(2, 'get_energy_prices', {}, EP)];
    const a = buildGasPriceAnswer({ intent: 'what is the Henry Hub gas price today', intent_class: 'gas_price' }, executed, asMap(executed));
    expect(a).not.toBeNull();
    expect(a.headline).toMatch(/^Henry Hub spot: \$3\.1\/MMBtu \(EIA daily spot via DC Hub, as of 2026-11-17\)\./);
    expect(a.evidence[0]).toMatch(/^Henry Hub spot/);
    expect(a.not_established.join(' ')).not.toMatch(/Henry Hub spot is not shown/);
  });
  it('the energy step\'s spot leads over the economics copy, dated by its own trading day', () => {
    const GE = { ok: true, market: 'dallas', as_of: '2026-11-20', henry_hub_spot_usd_mmbtu: 3.05, delivered_electric_usd_mmbtu: 3.4 };
    const executed = [ex(1, 'get_gas_economics', { market: 'dallas' }, GE), ex(2, 'get_energy_prices', { state: 'TX' }, EP)];
    const a = buildGasPriceAnswer({ intent: 'Henry Hub price in Texas', intent_class: 'gas_price' }, executed, asMap(executed));
    expect(a.headline).toMatch(/^Henry Hub spot: \$3\.1\/MMBtu \(EIA daily spot via DC Hub, as of 2026-11-17\)/);
  });
  it('a withheld spot (no figure) does not invent one', () => {
    const executed = [ex(1, 'get_energy_prices', {}, { natural_gas_usd_mmbtu: null, natural_gas: { hub: 'Henry Hub' } })];
    expect(buildGasPriceAnswer({ intent: 'Henry Hub price', intent_class: 'gas_price' }, executed, asMap(executed))).toBeNull();
  });
});
