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
//   * sources  lists them ({id, name, as_of?, license?}); as_of is that SOURCE's own date as the
//              upstream's block states it (ownSourceAsOf), never invented; a per-source licence only where DC Hub's own
//              data-license statement names one (EIA: public domain; DCPI: DC Hub-computed,
//              CC-BY-4.0). The ISO queues and gridstatus.io carry none: their terms are theirs;
//   * license  the collection says "Mixed" and points at the source list, never the blanket
//              CC-BY-4.0 (measured live 2026-10-07: a composite of EIA + ISO queues + gridstatus.io
//              claimed CC-BY-4.0, which is not ours to grant over third-party data);
//   * basis    'mixed' (envelope 1.2: fields disagree) when two or more contributed;
//   * fields   the per-figure labels the upstreams stated (carryFields), so each figure keeps its hour;
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
  { id: 'dcpi', fallback: 'DC Hub Data Center Power Index (DCPI)', license: 'CC-BY-4.0 after 30 days; current values per DC Hub Terms 5.2' },
  { id: 'iso_queues', fallback: 'US ISO public interconnection queues' },
  { id: 'gridstatus', fallback: 'gridstatus.io forward load, reserves and LMP' },
];

// An upstream's OWN as_of for its source entry (2026-10-21). MEASURED live 2026-10-20 23:27Z:
// get_grid_intelligence PJM listed sources[eia930].as_of "2026-10-20T03:00:00Z", while the backend's
// own EIA-930 source entry said T22. The backend block's top-level as_of is its COLLECTION date, the
// oldest labelled figure (routes/provenance_grid.py: fuel mix, which EIA publishes about once a day,
// ~19h behind demand); its sources[] entry states the newest hour that source supplied. This copied the
// collection date onto the source. Now: the backend's source entry with this id, else its only source
// entry, else (the backend names no source date) its collection as_of as before. Never invented.
function ownSourceAsOf(own, id) {
  if (!own) return null;
  const list = Array.isArray(own.sources) ? own.sources.filter(isObj) : [];
  const match = list.find((s) => s.id === id) || (list.length === 1 ? list[0] : null);
  return (match && text(match.as_of)) || text(own.as_of);
}

// The per-figure labels an upstream stated (`fields`, envelope 1.2: {figure: {basis, source_id,
// unit, method, as_of}}). The composite dropped them, so the hour each figure describes (demand T22,
// fuel mix T03) was nowhere in the block once the source entry carried one date. Carried as given for
// the keys below, source_id rewritten to the composite's own id for that upstream (the composite's
// sources[] is what a source_id must resolve against); first upstream wins a name. A figure the
// upstream did not label is not labelled here.
const FIELD_KEYS = ['basis', 'basis_class', 'unit', 'method', 'as_of', 'window'];
function carryFields(picked) {
  const out = {};
  for (const { entry, own } of picked) {
    const f = own && isObj(own.fields) ? own.fields : null;
    if (!f) continue;
    for (const [name, spec] of Object.entries(f)) {
      if (!isObj(spec) || Object.prototype.hasOwnProperty.call(out, name)) continue;
      const kept = { source_id: entry.id };
      for (const k of FIELD_KEYS) {
        const v = spec[k];
        if (typeof v === 'string' ? v.trim() : (v !== undefined && v !== null && typeof v !== 'object')) kept[k] = v;
      }
      out[name] = kept;
    }
  }
  return out;
}

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
      const asOf = ownSourceAsOf(own, u.id);
      if (asOf) entry.as_of = asOf;
      picked.push({ entry, own });
    });
    if (!picked.length) return null;
    if (picked.length === 1) return picked[0].own ? { ...picked[0].own } : null;
    const sources = picked.map((p) => p.entry);
    const caveats = carryCaveats(picked);
    const fields = carryFields(picked);
    const labelled = Object.keys(fields).length > 0;
    return {
      provenance_version: 1,
      provenance_revision: '1.2',
      source: sources.map((s) => s.name).join('; '),
      sources,
      license: LICENSE_COMPOSITE,
      basis: 'mixed',
      method: `Composite of ${sources.length} upstream reads for this region, each listed in sources. `
        + (labelled
          ? 'Per-figure basis and as_of are in fields where an upstream labelled them; a figure not listed there is unlabelled.'
          : 'Per-figure basis is not labelled yet; read the field names for what each figure is.'),
      ...(labelled ? { fields } : {}),
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
