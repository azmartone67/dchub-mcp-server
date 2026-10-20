// r-market-pricing (2026-09-28) — get_market_intel's `market_pricing` block
// passes the free preview intact.
//
// Live defect: asked "how much is 1 MW turnkey colo in Los Angeles", the tool
// had no rate to give. dchub-backend#5799 adds the block; without this
// exemption the anon trim would null `asking_rate` (_rate$) and
// `vacancy_percent` (_pct-shaped metric) — the exact figures /markets/<slug>
// publishes free on the web — and the depth tease would do the same for keyed
// free callers.
import { describe, it, expect } from 'vitest';
import { trimForTrial, buildDepthTease, _isMetricKey } from '../server.mjs';

const broker = () => ({
  available: true, basis: 'broker_report', asking_rate: 215.0,
  asking_rate_range: null, unit: '$/kW/mo', deal_size: '250-500 kW wholesale',
  vacancy_percent: 2.0, period: 'H1 2025', stale: true,
  source: 'CBRE / JLL market reports, H1 2025 (as held by DC Hub)',
  excludes: 'Electricity is normally billed separately.',
});
const payload = (pricing) => ({
  success: true,
  market: { id: 'northern virginia', name: 'Northern Virginia', cities: ['Ashburn', 'Sterling', 'Reston', 'Herndon'] },
  stats: { facility_count: 857, total_power_mw: 13366.0, provider_count: 90 },
  top_providers: [1, 2, 3, 4, 5].map((i) => ({ name: `p${i}`, facilities: i, power_mw: null })),
  market_pricing: pricing,
});

// ★2026-10-20 OWNER DECISION (verbatim): "Keep CBRE/JLL broker lease rates Pro-only everywhere:
// remove them from public pages to match MCP." The block still survives the trims (its source line,
// basis and period are the one citable sentence), but every rate, range, vacancy and deal-size
// figure is nulled and the block carries BROKER_RATES_LINE. The public pages no longer print them.
const masked = (b) => {
  const o = { ...b };
  for (const k of ['asking_rate', 'asking_rate_range', 'vacancy_percent', 'deal_size', 'unit']) if (k in o) o[k] = null;
  return { ...o, rates_withheld: true, rates_note: 'Broker lease rates (CBRE/JLL): available on paid plans' };
};

describe('market_pricing survives the free-tier trims, masked', () => {
  it('CONTROL: the trim does mask these key names anywhere else', () => {
    // Without this the exemption test below could pass because the keys were
    // never metric-shaped — a guard that cannot fail.
    expect(_isMetricKey('asking_rate')).toBe(true);
    const t = trimForTrial({ other: { asking_rate: 215.0 }, stats: { facility_count: 9 } }, 'get_market_intel');
    expect(t.other.asking_rate).toBeNull();
    expect(t.stats.facility_count).toBeNull();
  });

  it('anon trim: broker block survives with every figure withheld, siblings still trimmed', () => {
    const t = trimForTrial(payload(broker()), 'get_market_intel');
    expect(t.market_pricing).toEqual(masked(broker()));
    expect(t.stats.facility_count).toBeNull();
    expect(t.top_providers.length).toBeLessThan(5);
  });

  it('anon trim: an estimate range is withheld too', () => {
    const est = { available: true, basis: 'dchub_estimate', asking_rate: null,
                  asking_rate_range: [160, 200], unit: '$/kW/mo', vacancy_percent: 3.0, period: '2026-H2' };
    expect(trimForTrial(payload(est), 'get_market_intel').market_pricing).toEqual(masked(est));
  });

  it('depth tease (keyed free): no rate or vacancy figure', async () => {
    const result = { content: [{ type: 'text', text: JSON.stringify(payload(broker())) }] };
    const out = await buildDepthTease('get_market_intel', result, {}, 'free');
    const text = out?.content?.find((c) => c.text && c.text.includes('market_pricing'))?.text
      ?? JSON.stringify(out?.structuredContent ?? out);
    expect(text).toContain('"market_pricing"');
    expect(text).not.toContain('"asking_rate":215');
    expect(text).not.toContain('"vacancy_percent":2');
    expect(text).toContain('available on paid plans');
  });
});
