// evidence-contract.test.mjs: partner program 2026-10-27, section 6 (provenance.evidence).
//
// MEASURED live before (raw tools/call, 2026-10-27, worker 4.9.118): get_market_intel,
// get_grid_data and source_capacity carried as_of / retrieved_at / basis_class / completeness
// but no data_basis in the contract's words, no per-layer licence id (the flat provenance.license
// "CC-BY-4.0" sat over a composite answer), no attribution_text, no limitations[], no coverage
// object and no partner_credit. This pins the additive block and the rules it keeps.
import { describe, it, expect, afterEach } from 'vitest';
import {
  buildEvidence, dataBasisOf, licenseIdOf, evidenceContractOn,
  DATA_BASIS_OF, DATA_BASIS, EVIDENCE_ENV,
} from '../lib/evidence-contract.mjs';
import { stampEnvelopeAttribution, BASIS_CLASSES, BASIS_12, PEERINGDB_LICENSE } from '../lib/attribution.mjs';

const NOW = Date.parse('2026-10-27T08:00:00Z');
const stamp = (payload, opts = {}) => {
  const out = stampEnvelopeAttribution(
    { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: { ...payload } },
    { toolName: 'get_market_intel', tier: 'free', now: NOW, ...opts });
  return { text: JSON.parse(out.content[0].text), sc: out.structuredContent, out };
};
afterEach(() => { delete process.env[EVIDENCE_ENV]; });

const gridLike = () => ({
  demand_mw: 41234,
  provenance: {
    provenance_version: 1, provenance_revision: '1.2', source: 'EIA-930', as_of: '2026-10-27T06:00:00Z',
    basis: 'measured', basis_class: 'measured', fetched_at: '2026-10-27T07:48:02Z',
    caveats: [{ code: 'preliminary', text: 'EIA-930 hourly values are preliminary.' }],
    fields: { demand_mw: { basis: 'measured', basis_class: 'measured', source_id: 'eia930' } },
    sources: [{ id: 'eia930', name: 'EIA-930', url: 'https://www.eia.gov/electricity/gridmonitor/',
      license: 'public domain (US government)', attribution: 'Source: U.S. Energy Information Administration' }],
  },
});

describe('the block is on every stamped envelope, in both surfaces', () => {
  it('rides provenance.evidence in content[0] and structuredContent', () => {
    const { text, sc } = stamp(gridLike());
    expect(text.provenance.evidence.contract_revision).toBe('1');
    expect(sc.provenance.evidence.contract_revision).toBe('1');
  });
  it('carries every contract field this server can honestly fill', () => {
    const ev = stamp(gridLike()).text.provenance.evidence;
    for (const k of ['evidence_as_of', 'retrieved_at', 'data_basis', 'license_id', 'license_layers',
      'attribution_text', 'limitations', 'coverage', 'source_owner', 'source_url', 'partner_credit']) {
      expect(Object.prototype.hasOwnProperty.call(ev, k), k).toBe(true);
    }
  });
  it('the existing provenance keys are untouched', () => {
    const { text } = stamp(gridLike());
    expect(text.provenance.as_of).toBe('2026-10-27T06:00:00Z');
    expect(text.provenance.license).toBe('CC-BY-4.0');
    expect(text.provenance.retrieved_at).toBe('2026-10-27T08:00:00.000Z');
  });
  it('an error result gets no evidence block', () => {
    const out = stampEnvelopeAttribution({ isError: true, content: [{ type: 'text', text: '{"error":"x"}' }] },
      { toolName: 'get_market_intel', now: NOW });
    expect(JSON.stringify(out)).not.toContain('"evidence"');
  });
});

describe('evidence_as_of is a data date, never the retrieval time', () => {
  it('equals provenance.as_of and differs from retrieved_at', () => {
    const ev = stamp(gridLike()).text.provenance.evidence;
    expect(ev.evidence_as_of).toBe('2026-10-27T06:00:00Z');
    expect(ev.retrieved_at).toBe('2026-10-27T08:00:00.000Z');
    expect(ev.evidence_as_of).not.toBe(ev.retrieved_at);
  });
  it('is null when the response has no collection date, and says so', () => {
    const ev = stamp({ ok: true, items: [{ name: 'a' }] }).text.provenance.evidence;
    expect(ev.evidence_as_of).toBeNull();
    expect(ev.retrieved_at).toBe('2026-10-27T08:00:00.000Z');
    expect(ev.evidence_as_of_basis).toMatch(/UNMEASURED/);
    expect(ev.limitations.map((l) => l.code)).toContain('evidence_as_of_unmeasured');
  });
});

describe('data_basis reads only a class a backend block stated', () => {
  it('maps every envelope class to one contract word or none', () => {
    const want = { filed: 'reported', stated: 'reported', published: 'reported', cited: 'reported',
      measured: 'measured', estimated: 'modeled', modelled: 'modeled', derived: 'inferred' };
    for (const [cls, word] of Object.entries(want)) expect(dataBasisOf(cls)).toBe(word);
    for (const none of ['mixed', 'unknown', 'guess', undefined, null, 4]) expect(dataBasisOf(none)).toBeNull();
    expect(DATA_BASIS).toEqual(['reported', 'measured', 'modeled', 'inferred']);
  });
  it('covers every class in both envelope vocabularies (a new class cannot slip past unmapped)', () => {
    const named = new Set([...BASIS_CLASSES, ...BASIS_12]);
    for (const c of named) {
      if (c === 'unknown' || c === 'mixed') expect(DATA_BASIS_OF[c]).toBeUndefined();
      else expect(DATA_BASIS_OF[c], c).toBeTruthy();
    }
  });
  it('is null, with the reason, when no backend block names a class', () => {
    const ev = stamp({ ok: true, items: [] }).text.provenance.evidence;
    expect(ev.data_basis).toBeNull();
    expect(ev.data_basis_basis).toMatch(/does not guess/);
  });
  it('the 1.2 basis wins over the v1.1 class, and per-field words ride along', () => {
    const p = gridLike(); p.provenance.basis = 'modelled'; p.provenance.basis_class = 'measured';
    const ev = stamp(p).text.provenance.evidence;
    expect(ev.data_basis).toBe('modeled');
    expect(ev.data_basis_by_field).toEqual({ demand_mw: 'measured' });
  });
  it('mixed is null, not a guess', () => {
    const p = gridLike(); p.provenance.basis = 'mixed'; delete p.provenance.basis_class;
    expect(stamp(p).text.provenance.evidence.data_basis).toBeNull();
  });
});

describe('licence is per layer; a composite record does not inherit one', () => {
  it('lists the layer the payload declares under its own id, and does not name CC-BY-4.0 for it', () => {
    const ev = stamp(gridLike()).text.provenance.evidence;
    expect(ev.license_layers.map((l) => l.id)).toEqual(['public-domain']);
    expect(ev.license_id).toBeNull();
    expect(ev.license_id_basis).toMatch(/not a per-layer grant/);
  });
  it('an OpenStreetMap layer is ODbL-1.0 with its credit, never folded into CC-BY-4.0', () => {
    const ev = stamp({ ok: true, facilities: [{ name: 'a', source: 'openstreetmap' }],
      provenance: { source: 'DC Hub', as_of: '2026-10-01', basis_class: 'published' } }).text.provenance.evidence;
    expect(ev.license_layers).toContainEqual(expect.objectContaining({ id: 'ODbL-1.0', reuse: 'share_alike' }));
    expect(ev.license_layers.map((l) => l.id)).not.toContain('CC-BY-4.0');
    expect(ev.attribution_text).toContain('© OpenStreetMap contributors');
    expect(ev.license_id).toBeNull();
  });
  it('two different layers read composite', () => {
    const p = gridLike();
    p.related = [{ license: { id: 'publisher-copyright', reuse: 'link_only', attribution: 'the publisher' } }];
    const ev = stamp(p).text.provenance.evidence;
    expect(ev.license_id).toBe('composite');
    expect(ev.license_layers.map((l) => l.id).sort()).toEqual(['public-domain', 'publisher-copyright']);
  });
  it('a tool whose envelope licence is not the default grant keeps its own id', () => {
    const { text } = stamp({ ok: true, providers: [] }, { toolName: 'get_peering_intel' });
    expect(text.provenance.license).toBe(PEERINGDB_LICENSE);
    expect(text.provenance.evidence.license_id).toBe('peeringdb-aup');
  });
  it('licenseIdOf names the ids and sends anything else to other', () => {
    expect(licenseIdOf('CC-BY-4.0 — DCPI scores')).toBe('CC-BY-4.0');
    expect(licenseIdOf('ODbL 1.0 share-alike')).toBe('ODbL-1.0');
    expect(licenseIdOf('Mixed — see https://dchub.cloud/data-sources')).toBe('composite');
    expect(licenseIdOf('some proprietary terms')).toBe('other');
    expect(licenseIdOf('')).toBeNull();
  });
});

describe('limitations, coverage, source and partner credit', () => {
  it('carries the backend caveats with their codes', () => {
    const ev = stamp(gridLike()).text.provenance.evidence;
    expect(ev.limitations).toContainEqual({ code: 'preliminary', text: 'EIA-930 hourly values are preliminary.' });
  });
  it('a gated preview is a limitation and a measured shown-of-total coverage', () => {
    const { text } = stamp({ ok: true, items: [{ n: 1 }], _items_total_in_pro: 40,
      provenance: { source: 'DC Hub', as_of: '2026-10-01', basis_class: 'published' } });
    const ev = text.provenance.evidence;
    expect(ev.coverage).toMatchObject({ status: 'partial_preview', shown: 1, total: 40 });
    expect(ev.limitations.map((l) => l.code)).toContain('partial_preview');
  });
  it('one upstream is the source owner; several are not collapsed into one', () => {
    expect(stamp(gridLike()).text.provenance.evidence).toMatchObject({
      source_owner: 'EIA-930', source_url: 'https://www.eia.gov/electricity/gridmonitor/' });
    const p = gridLike();
    p.provenance.sources.push({ id: 'x', name: 'Other', url: 'https://example.org', license: 'CC-BY-4.0' });
    expect(stamp(p).text.provenance.evidence).toMatchObject({ source_owner: null, source_url: null });
  });
  it('a block with no sources[] does not claim DC Hub as the origin', () => {
    expect(stamp({ ok: true, items: [] }).text.provenance.evidence).toMatchObject({ source_owner: null, source_url: null });
  });
  it('partner_credit is null on every response until a partner exists', () => {
    for (const p of [gridLike(), { ok: true }, { ok: true, items: [{ n: 1 }], _items_total_in_pro: 9 }]) {
      expect(stamp(p).text.provenance.evidence.partner_credit).toBeNull();
    }
  });
});

describe('kill switch and precedence', () => {
  it('DCHUB_EVIDENCE_CONTRACT=0 removes the block and leaves the rest byte-identical', () => {
    const on = stamp(gridLike()).text;
    process.env[EVIDENCE_ENV] = '0';
    const off = stamp(gridLike()).text;
    expect(off.provenance.evidence).toBeUndefined();
    const { evidence, ...rest } = on.provenance;
    expect(off.provenance).toEqual(rest);
    expect(evidenceContractOn({ [EVIDENCE_ENV]: 'off' })).toBe(false);
    expect(evidenceContractOn({})).toBe(true);
  });
  it('a backend that sends its own evidence object keeps it', () => {
    const p = gridLike(); p.provenance.evidence = { contract_revision: 'backend', mine: true };
    expect(stamp(p).text.provenance.evidence).toEqual({ contract_revision: 'backend', mine: true });
  });
  it('buildEvidence never throws on junk', () => {
    expect(buildEvidence(null, null, () => {})).toBeNull();
    expect(buildEvidence({}, { license: 5, sources: 'x', caveats: 3, fields: 7 }, () => { throw new Error('x'); })).toBeTruthy();
  });
});
