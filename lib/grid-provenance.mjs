// grid-provenance.mjs: the provenance block for get_grid_intelligence (G-2, 2026-10-06).
//
// MEASURED live before: get_grid_intelligence PJM returned provenance.source "DC Hub",
// basis_class unknown, no method. The tool reads FOUR upstreams (EIA telemetry, the DCPI
// iso-comparison, the interconnection-queue snapshot, gridstatus extended signals) and
// shapeGridIntelligence rebuilds the payload from them without carrying any of their
// provenance, so the backend's own EIA-named block (main.py) never reached the caller.
//
// This composes ONE block from what actually contributed to THIS answer:
//   * source   names each contributing upstream (the backend's own name when it sent one);
//   * sources  lists them ({id, name, as_of?}); as_of only when that upstream's block stated
//              one, never invented; no licence per source yet (the backend stamps a blanket
//              CC-BY-4.0 that is not ours to repeat per source, so none is claimed here);
//   * basis    'mixed' (envelope 1.2: fields disagree) when two or more contributed;
//   * as_of    left to the merge, which derives the oldest stamp in the payload.
// One contributor: that upstream's own block, unchanged. None: null (attach nothing).
// Pure, never throws.

const DCPI_CODE = { ISONE: 'ISONE', HYDROQUEBEC: 'HQ', HQ: 'HQ' };
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const UPSTREAMS = [
  { id: 'eia930', fallback: 'EIA-930 hourly grid telemetry' },
  { id: 'dcpi', fallback: 'DC Hub Data Center Power Index (DCPI)' },
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
      const asOf = own && text(own.as_of);
      if (asOf) entry.as_of = asOf;
      picked.push({ entry, own });
    });
    if (!picked.length) return null;
    if (picked.length === 1) return picked[0].own ? { ...picked[0].own } : null;
    const sources = picked.map((p) => p.entry);
    return {
      provenance_version: 1,
      provenance_revision: '1.2',
      source: sources.map((s) => s.name).join('; '),
      sources,
      basis: 'mixed',
      method: `Composite of ${sources.length} upstream reads for this region, each listed in sources. `
        + 'Per-figure basis is not labelled yet; read the field names for what each figure is.',
    };
  } catch (_) {
    return null;
  }
}
