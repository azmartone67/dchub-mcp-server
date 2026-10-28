// evidence-per-layer.test.mjs: partner program 2026-10-27, section 6, the busiest tools.
//
// MEASURED live before (raw tools/call, anonymous, QA header, worker 4.9.118, 2026-10-28):
//   analyze_site            provenance.as_of null over a response whose market_verdict carries a DCPI day
//                           (the gated preview adds it after the envelope was stamped)
//   get_energy_prices       source_owner / source_url null although provenance names one upstream and links it
//   get_refined_queue       a third-party layer credited in attribution[] (own licence + citation) not in
//                           license_layers; per-ISO report dates only inside freshness_by_iso, none in the block
//   get_market_intel        five dated sub-layers (siting.*) and a priced layer under a different owner, none
//                           of them in the block
//   execute_plan            license_layers [] although two composed steps declare different upstream licences
//   search_facilities       PeeringDB named in the backend attribution but not a licence layer
// This pins the additive fixes and the rules they keep: a fresh retrieved_at is not a measurement; a
// composite never claims one licence; a fetch date is not a data date; nothing is filled that the payload
// does not state.
import { describe, it, expect } from 'vitest';
import { buildEvidence } from '../lib/evidence-contract.mjs';
import { stampEnvelopeAttribution } from '../lib/attribution.mjs';
import { gatedPreviewStep } from '../lib/gated-preview.mjs';

const NOW = Date.parse('2026-10-28T00:00:00Z');
const stamp = (payload, toolName = 'get_market_intel') => {
  const out = stampEnvelopeAttribution(
    { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: structuredClone(payload) },
    { toolName, tier: 'free', now: NOW });
  return { ev: out.structuredContent.provenance.evidence, prov: out.structuredContent.provenance,
    text: JSON.parse(out.content[0].text), out };
};

const energyLike = () => ({
  ok: true, tool: 'get_energy_prices', as_of: '2026-08-31', as_of_basis: 'last month in the average',
  provenance: { source: 'Example Statistics Agency, retail electricity sales', url: 'https://dchub.cloud',
    license: 'Public domain (U.S. government work)', as_of: '2026-08-31', basis_class: 'measured',
    source_url: 'https://stats.example.gov/retail-sales' },
});
const siteLike = () => ({
  market: 'x', as_of: '2026-10-19 23:35:08.162806+00', as_of_basis: 'MAX of a column',
  market_pricing: { period: 'H1 2026', basis: 'broker_report', source: 'Example Broker Trends H1 2026: Market X',
    source_url: 'https://broker.example.com/trends-h1-2026' },
  siting: {
    dcpi: { as_of: '2026-10-27T18:32:06.036642+00:00', data_basis: 'mixed' },
    utilities: { as_of: '2026-09-30', basis: 'CURATED', source_url: 'https://county.example.gov/utilities' },
    mw: { as_of: '2026-10-19 23:35:08.162806+00' },
  },
});
const queueLike = () => ({
  ok: true, results: [{ queue_id: 'row' }],
  provenance: { source: 'ISO queues', license: 'CC-BY-4.0', as_of: null,
    as_of_basis: 'UNMEASURED at collection level: live feeds carry no report date.', basis_class: 'published' },
  attribution: [{ source: 'Example Queue Dashboard', url: 'https://queue.example.org', license: 'CC-BY-4.0',
    citation: 'Example, A. (2026). queue.example.org, independent queue dashboard.', as_of: '2026-10-06T11:41:53' }],
  freshness_by_iso: {
    AAA: { source_as_of: '2026-09-30', source_as_of_basis: 'published_report', source_report: 'AAA GIS Report' },
    BBB: { source_as_of: '2026-10-27', source_as_of_basis: 'live_feed_fetch_date', source_report: 'BBB status feed' },
  },
  upstream_sources: { AAA: { publisher: 'Example Reliability Council' }, BBB: { publisher: 'Example Power Pool' } },
});
const planLike = () => ({
  ok: true, tool: 'execute_plan',
  executed: [
    { step: 1, tool: 'get_grid_data', result: { provenance: { tool: 'get_grid_data', as_of: '2026-10-27T23:00:00Z',
      basis_class: 'measured', sources: [{ id: 'g', name: 'Grid Monitor', url: 'https://grid.example.gov',
        license: 'public domain (US government)', as_of: '2026-10-27T23:00:00Z' }] } } },
    { step: 2, tool: 'search_facilities', result: { provenance: { tool: 'search_facilities', as_of: null,
      as_of_basis: 'UNMEASURED', sources: [{ id: 'o', name: 'Map Data', url: 'https://map.example.org',
        license: 'ODbL 1.0 (OpenStreetMap contributors)' }] } } },
  ],
});

describe('a tool with an upstream as-of never returns evidence_as_of null', () => {
  it.each([
    ['energy-like (stated provenance.as_of)', energyLike(), '2026-08-31'],
    ['market-like (top-level + per-layer as_of)', siteLike(), '2026-09-30'],
    ['plan-like (composed steps)', planLike(), '2026-10-27T23:00:00.000Z'],
  ])('%s', (_n, payload, want) => {
    const { ev } = stamp(payload);
    expect(ev.evidence_as_of).not.toBeNull();
    expect(ev.evidence_as_of).toBe(want);
  });

  it('analyze_site: the gated preview adds a dated market_verdict AFTER stamping, and the block follows it', () => {
    const wall = { ok: false, error: 'pro_required', _wall: true, unlock_kind: 'email_key',
      human_url: 'https://dchub.cloud/u/abcdef', request_id: 'sr_1',
      site_teaser: { verdict: 'BUILD', power_infrastructure: 'BUILD', locked: ['overall_score'] } };
    const body = stampEnvelopeAttribution(
      { content: [{ type: 'text', text: JSON.stringify(wall) }], structuredContent: structuredClone(wall) },
      { toolName: 'analyze_site', tier: 'free', now: NOW });
    expect(body.structuredContent.provenance.as_of).toBeNull();
    expect(body.structuredContent.provenance.evidence.evidence_as_of).toBeNull();
    const ctx = { analyze_site_market: { market: 'Phoenix', slug: 'phoenix', verdict: 'CAUTION', composite_score: null,
      as_of: '2026-10-27', time_to_power_band: '24_to_48_months' } };
    const res = gatedPreviewStep({ ...body, isError: true }, 'analyze_site', ctx);
    const prov = res.structuredContent.provenance;
    expect(res.structuredContent.market_verdict.as_of).toBe('2026-10-27');
    expect(prov.as_of).toBe('2026-10-27');
    expect(prov.evidence.evidence_as_of).toBe('2026-10-27');
    expect(res.structuredContent.citation.as_of).toBe('2026-10-27');
    expect(prov.evidence.layers.map((l) => l.layer)).toContain('market_verdict');
  });

  it('a backend-stated UNMEASURED is not re-dated by the refresh', () => {
    const p = queueLike();
    p.market_verdict = { as_of: '2026-10-27' };
    const { prov } = stamp(p, 'get_refined_queue');
    expect(prov.as_of).toBeNull();
  });
});

describe('source name and link, per layer, from what the payload states', () => {
  it('a single external upstream stated as provenance.source + source_url fills source_owner/source_url', () => {
    const { ev } = stamp(energyLike(), 'get_energy_prices');
    expect(ev.source_owner).toBe('Example Statistics Agency, retail electricity sales');
    expect(ev.source_url).toBe('https://stats.example.gov/retail-sales');
  });
  it('the envelope fallback (source "DC Hub", url dchub.cloud) is not an upstream', () => {
    const p = energyLike();
    p.provenance.source = 'DC Hub'; p.provenance.source_url = 'https://dchub.cloud/data-sources';
    const { ev } = stamp(p);
    expect(ev.source_owner).toBeNull();
    expect(ev.source_url).toBeNull();
  });
  it('a link to dchub.cloud is the envelope fallback even under another name', () => {
    const p = energyLike(); p.provenance.source_url = 'https://dchub.cloud/data-sources';
    const { ev } = stamp(p);
    expect(ev.source_owner).toBeNull();
    expect(ev.source_url).toBeNull();
  });
  it('a source name with no link, or a link with no name, stays null', () => {
    const a = energyLike(); delete a.provenance.source_url;
    expect(stamp(a).ev.source_owner).toBeNull();
    const b = energyLike(); b.provenance.source = 'DC Hub';
    expect(stamp(b).ev.source_owner).toBeNull();
  });
  it('named sub-layers keep their own date, owner and link', () => {
    const { ev } = stamp(siteLike());
    const by = Object.fromEntries(ev.layers.map((l) => [l.layer, l]));
    expect(by['siting.dcpi'].evidence_as_of).toBe('2026-10-27T18:32:06.036642+00:00');
    expect(by['siting.utilities'].evidence_as_of).toBe('2026-09-30');
    expect(by['siting.utilities'].source_url).toBe('https://county.example.gov/utilities');
    expect(by['siting.mw'].evidence_as_of).toBe('2026-10-19 23:35:08.162806+00');
    expect(by['market_pricing'].source_owner).toMatch(/^Example Broker/);
    expect(by['market_pricing'].period).toBe('H1 2026');
  });
  it('a layer that states no date is UNMEASURED, never dated from its siblings', () => {
    const { ev } = stamp(siteLike());
    const mp = ev.layers.find((l) => l.layer === 'market_pricing');
    expect(mp.evidence_as_of).toBeNull();
    expect(mp.as_of_basis).toMatch(/UNMEASURED/);
  });
  it('a data_basis is read only from a contract word the layer states', () => {
    const { ev } = stamp(siteLike());
    expect(ev.layers.find((l) => l.layer === 'siting.dcpi').data_basis).toBeUndefined();   // "mixed" has no contract word
    const p = siteLike(); p.siting.iso = { as_of: '2026-10-01', basis_class: 'measured' };
    expect(stamp(p).ev.layers.find((l) => l.layer === 'siting.iso').data_basis).toBe('measured');
  });
  it('a fetch date is not a measurement date', () => {
    const { ev } = stamp(queueLike(), 'get_refined_queue');
    const by = Object.fromEntries(ev.layers.map((l) => [l.layer, l]));
    expect(by['freshness_by_iso.AAA'].evidence_as_of).toBe('2026-09-30');
    expect(by['freshness_by_iso.AAA'].source_owner).toBe('Example Reliability Council');
    expect(by['freshness_by_iso.BBB'].evidence_as_of).toBeNull();
    expect(by['freshness_by_iso.BBB'].fetched_on).toBe('2026-10-27');
    expect(ev.evidence_as_of).toBeNull();   // the backend's collection-level UNMEASURED stands
  });
});

describe('a composite record never claims one licence', () => {
  it('a third-party layer credited in attribution[] keeps its own licence and citation', () => {
    const { ev } = stamp(queueLike(), 'get_refined_queue');
    const l = ev.license_layers.find((x) => x.name === 'Example Queue Dashboard');
    expect(l).toBeTruthy();
    expect(l.id).toBe('CC-BY-4.0');
    expect(ev.attribution_text).toContain('queue.example.org, independent queue dashboard');
    expect(ev.license_id).toBeNull();        // DC Hub's own derivation + a third party: no single licence
  });
  it('composed steps with different upstream licences list each and declare composite', () => {
    const { ev } = stamp(planLike(), 'execute_plan');
    expect(ev.license_layers.map((l) => l.id).sort()).toEqual(['ODbL-1.0', 'public-domain']);
    expect(ev.license_id).toBe('composite');
    expect(ev.license_id).not.toBe('CC-BY-4.0');
    const steps = Object.fromEntries(ev.layers.map((l) => [l.layer, l]));
    expect(steps.get_grid_data.license_id).toBe('public-domain');
    expect(steps.get_grid_data.evidence_as_of).toBe('2026-10-27T23:00:00Z');   // the step's own provenance, as stated
    expect(steps.search_facilities.license_id).toBe('ODbL-1.0');
    expect(steps.search_facilities.evidence_as_of).toBeNull();
    expect(steps.search_facilities.as_of_basis).toMatch(/UNMEASURED/);
  });
  it('an OSM-derived layer is ODbL-1.0 and PeeringDB is its own layer, never CC-BY-4.0', () => {
    const { ev } = stamp({ data: [], provenance: { source: 'DC Hub facilities registry', license: 'Mixed - see https://dchub.cloud/data-sources',
      attribution: 'Contains data from OpenStreetMap contributors (ODbL 1.0) and PeeringDB, plus operator disclosure.' } });
    const ids = ev.license_layers.map((l) => l.id);
    expect(ids).toContain('ODbL-1.0');
    expect(ids).toContain('peeringdb-aup');
    expect(ids).not.toContain('CC-BY-4.0');
    expect(ev.license_id).toBe('composite');
    expect(ev.attribution_text).toContain('PeeringDB');
  });
  it('licence spellings map to one id: "CC BY 4.0" is CC-BY-4.0', () => {
    const p = queueLike(); p.attribution[0].license = 'CC BY 4.0';
    expect(stamp(p, 'get_refined_queue').ev.license_layers.find((x) => x.name === 'Example Queue Dashboard').id).toBe('CC-BY-4.0');
  });
});

describe('nothing is filled that the payload does not state', () => {
  const bare = () => ({ ok: true, items: [{ id: 1 }], provenance: { source: 'DC Hub Capacity Source', license: 'CC-BY-4.0' } });
  it('a payload with no date, source, licence or basis keeps every field null / empty', () => {
    const { ev } = stamp(bare(), 'source_capacity');
    expect(ev.evidence_as_of).toBeNull();
    expect(ev.evidence_as_of_basis).toMatch(/UNMEASURED/);
    expect(ev.source_owner).toBeNull();
    expect(ev.source_url).toBeNull();
    expect(ev.data_basis).toBeNull();
    expect(ev.license_id).toBeNull();
    expect(ev.license_layers).toEqual([]);
    expect(ev.layers).toBeUndefined();
    expect(ev.partner_credit).toBeNull();
    expect(ev.limitations.map((l) => l.code)).toContain('evidence_as_of_unmeasured');
  });
  it('per-row dates never become a layer or a collection date', () => {
    const p = bare(); p.items = [{ id: 1, last_updated: '2026-10-01' }, { id: 2, as_of: '2026-09-01' }];
    const { ev } = stamp(p, 'source_capacity');
    expect(ev.evidence_as_of).toBeNull();
    expect(ev.layers).toBeUndefined();
  });
  it('retrieved_at never stands in for evidence_as_of', () => {
    const { ev } = stamp(bare(), 'source_capacity');
    expect(ev.retrieved_at).toBe('2026-10-28T00:00:00.000Z');
    expect(ev.evidence_as_of).not.toBe(ev.retrieved_at);
  });
  it('layers are bounded', () => {
    const p = { provenance: { source: 'x', license: 'CC-BY-4.0' }, big: {} };
    for (let i = 0; i < 100; i++) p.big[`l${i}`] = { as_of: '2026-10-01' };
    expect(stamp(p).ev.layers.length).toBeLessThanOrEqual(24);
  });
  it('the kill switch removes the block, layers included', () => {
    expect(buildEvidence(siteLike(), { as_of: null }, () => {}, { DCHUB_EVIDENCE_CONTRACT: '0' })).toBeNull();
  });
});
