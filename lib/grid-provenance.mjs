// grid-provenance.mjs: the provenance block for get_grid_intelligence and compare_isos
// (G-2, 2026-10-06).
//
// MEASURED live before: get_grid_intelligence PJM returned provenance.source "DC Hub",
// basis_class unknown, no method. The tool reads FOUR upstreams (EIA telemetry, the DCPI
// iso-comparison, the interconnection-queue snapshot, gridstatus extended signals) and
// shapeGridIntelligence rebuilds the payload from them without carrying any of their
// provenance, so the backend's own EIA-named block (main.py) never reached the caller.
//
// This composes ONE block from what actually contributed to THIS answer:
//   * source   names each contributing upstream (the backend's own name when it sent one);
//   * sources  lists them ({id, name, as_of?, license?}); as_of only when that upstream's block
//              stated one, never invented; a per-source licence only where DC Hub's own
//              data-license statement names one (EIA: public domain; DCPI: DC Hub-computed,
//              CC-BY-4.0). The ISO queues and gridstatus.io carry none: their terms are theirs;
//   * license  the collection says "Mixed" and points at the source list, never the blanket
//              CC-BY-4.0 (measured live 2026-10-07: a composite of EIA + ISO queues + gridstatus.io
//              claimed CC-BY-4.0, which is not ours to grant over third-party data);
//   * basis    'mixed' (envelope 1.2: fields disagree) when two or more contributed;
//   * as_of    left to the merge, which derives the oldest stamp in the payload.
// One contributor: that upstream's own block, unchanged. None: null (attach nothing).
// Pure, never throws.

const DCPI_CODE = { ISONE: 'ISONE', HYDROQUEBEC: 'HQ', HQ: 'HQ' };
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Same wording as the backend's LICENSE_COMPOSITE (routes/provenance.py).
export const LICENSE_COMPOSITE = 'Mixed — see https://dchub.cloud/data-sources';

// Envelope 1.2 caveat codes: a CLOSED list pinned to canonical/provenance_envelope_1_2.json
// (`caveat_codes`; the test compares them). An upstream's caveat is carried only when its code is
// on the list and its text is a non-empty string; anything else is dropped, never passed through.
export const CAVEAT_CODES = Object.freeze([
  'buildout_not_it_load', 'county_centroid', 'synthetic_segment', 'preliminary', 'third_party_model',
]);

// The caveats of every contributing upstream, one per code (first wins). G-2 (2026-10-07): the
// composed blocks built their own provenance and dropped the backend's `caveats[]` (the EIA
// `preliminary` warning, be#6488), so a figure that carries a warning on get_grid_data carried
// none on get_grid_intelligence or compare_isos. A caveat describes figures this answer serves
// because an upstream that contributed to it said so.
function carryCaveats(picked) {
  const out = [];
  const seen = new Set();
  for (const { own } of picked) {
    const list = own && Array.isArray(own.caveats) ? own.caveats : [];
    for (const c of list) {
      if (!isObj(c) || !CAVEAT_CODES.includes(c.code) || seen.has(c.code)) continue;
      const t = text(c.text);
      if (!t) continue;
      seen.add(c.code);
      out.push({ code: c.code, text: t });
    }
  }
  return out;
}

const UPSTREAMS = [
  { id: 'eia930', fallback: 'EIA-930 hourly grid telemetry', license: 'public domain (US government)' },
  { id: 'dcpi', fallback: 'DC Hub Data Center Power Index (DCPI)', license: 'CC-BY-4.0' },
  { id: 'iso_queues', fallback: 'US ISO public interconnection queues' },
  { id: 'gridstatus', fallback: 'gridstatus.io forward load, reserves and LMP' },
];

function contributors(ISO, { gi, cmp, qsnap, ext }) {
  const want = norm(ISO);
  const dcpiIso = DCPI_CODE[want] || want;
  const has = (rows, key) => Array.isArray(rows) && rows.some((r) => isObj(r) && norm(r.iso) === key);
  return [
    isObj(gi) && !gi.error ? gi : null,
    isObj(cmp) && !cmp.error && has(cmp.isos, dcpiIso) ? cmp : null,
    isObj(qsnap) && !qsnap.error && has(qsnap.by_iso, want) ? qsnap : null,
    isObj(ext) && ext.available ? ext : null,
  ];
}

export function composeGridProvenance(ISO, upstreams) {
  try {
    const used = contributors(ISO, upstreams || {});
    const picked = [];
    UPSTREAMS.forEach((u, i) => {
      const body = used[i];
      if (!body) return;
      const own = isObj(body.provenance) ? body.provenance : null;
      const entry = { id: u.id, name: (own && text(own.source)) || u.fallback };
      if (u.license) entry.license = u.license;
      const asOf = own && text(own.as_of);
      if (asOf) entry.as_of = asOf;
      picked.push({ entry, own });
    });
    if (!picked.length) return null;
    if (picked.length === 1) return picked[0].own ? { ...picked[0].own } : null;
    const sources = picked.map((p) => p.entry);
    const caveats = carryCaveats(picked);
    return {
      provenance_version: 1,
      provenance_revision: '1.2',
      source: sources.map((s) => s.name).join('; '),
      sources,
      license: LICENSE_COMPOSITE,
      basis: 'mixed',
      method: `Composite of ${sources.length} upstream reads for this region, each listed in sources. `
        + 'Per-figure basis is not labelled yet; read the field names for what each figure is.',
      ...(caveats.length ? { caveats } : {}),
    };
  } catch (_) {
    return null;
  }
}

// ── compare_isos: the same four-upstream read, once per ISO ─────────────────
// compare_isos shapes each requested ISO with the same shaper and attached nothing (live:
// provenance.source "DC Hub", no method). One block for the whole comparison:
//   * telemetry: one source per ISO whose telemetry did not error, id eia930_<iso>, named by
//     that ISO's own backend block (they differ by region code) else the fallback;
//   * DCPI / queue: one source each, when ANY requested ISO has a row in it;
//   * basis 'mixed', revision 1.2, as_of only where a telemetry block stated one.
// A single contributor returns that upstream's own block when it has one (telemetry only);
// none: null. Pure, never throws.
export function composeCompareProvenance(isos, giList, cmp, qsnap) {
  try {
    const list = Array.isArray(isos) ? isos : [];
    const picked = [];
    list.forEach((iso, i) => {
      const gi = Array.isArray(giList) ? giList[i] : null;
      if (!(isObj(gi) && !gi.error)) return;
      const own = isObj(gi.provenance) ? gi.provenance : null;
      const entry = { id: `eia930_${norm(iso).toLowerCase()}`,
        name: (own && text(own.source)) || `${UPSTREAMS[0].fallback} (${iso})`, license: UPSTREAMS[0].license };
      const asOf = own && text(own.as_of);
      if (asOf) entry.as_of = asOf;
      picked.push({ entry, own });
    });
    const anyRow = (body, rowsKey, codeOf) => isObj(body) && !body.error && Array.isArray(body[rowsKey])
      && list.some((iso) => body[rowsKey].some((r) => isObj(r) && norm(r.iso) === codeOf(norm(iso))));
    const shared = [
      [anyRow(cmp, 'isos', (w) => DCPI_CODE[w] || w), cmp, UPSTREAMS[1]],
      [anyRow(qsnap, 'by_iso', (w) => w), qsnap, UPSTREAMS[2]],
    ];
    for (const [ok, body, u] of shared) {
      if (!ok) continue;
      const own = isObj(body.provenance) ? body.provenance : null;
      const entry = { id: u.id, name: (own && text(own.source)) || u.fallback };
      if (u.license) entry.license = u.license;
      const asOf = own && text(own.as_of);
      if (asOf) entry.as_of = asOf;
      picked.push({ entry, own });
    }
    if (!picked.length) return null;
    if (picked.length === 1) return picked[0].own ? { ...picked[0].own } : null;
    const sources = picked.map((p) => p.entry);
    const caveats = carryCaveats(picked);
    return {
      provenance_version: 1,
      provenance_revision: '1.2',
      source: [...new Set(sources.map((x) => x.name))].join('; '),
      sources,
      license: LICENSE_COMPOSITE,
      basis: 'mixed',
      method: `Side-by-side of ${list.length} regions composed from ${sources.length} upstream reads, each listed in `
        + 'sources. Per-figure basis is not labelled yet; read the field names for what each figure is.',
      ...(caveats.length ? { caveats } : {}),
    };
  } catch (_) {
    return null;
  }
}
