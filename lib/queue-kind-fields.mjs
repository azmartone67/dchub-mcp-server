// queue-kind-fields.mjs -- no answer carries `queued_load_total_gw` (agent QA A item 2c, 2026-10-20).
//
// The backend's load-NAMED queue column means a different thing per ISO: the GENERATION queue on
// PJM, MISO, SPP, CAISO, NYISO and ISO-NE, ERCOT's large-load (demand) queue, and a mixed
// connections queue on NESO, IESO and AESO. Agents read the name and reported generation as load.
// Its removal was scheduled for after 2026-11-15; the owner asked for it now. Every row that carries
// it leaves with the value under the name of what it measures, and `queue_kind` says which:
//   generation_queue        -> queued_generation_gw (kept as the backend sent it when present)
//   large_load              -> queued_large_load_gw
//   mixed_connection_queue  -> queued_connections_gw
//   anything else           -> queued_total_gw (queue_kind 'unclassified')
// `queued_load_total_gw_basis` goes too (queue_kind replaces it), and the name is removed from any
// `deprecated_fields` list. Pure: returns new objects, never mutates (a payload can be a cache entry).

export const QUEUE_TOTAL_BASIS = Object.freeze({
  ERCOT: 'large_load', PJM: 'generation_queue', MISO: 'generation_queue', SPP: 'generation_queue',
  CAISO: 'generation_queue', NYISO: 'generation_queue', ISONE: 'generation_queue',
  NESO: 'mixed_connection_queue', IESO: 'mixed_connection_queue', AESO: 'mixed_connection_queue',
});
const OLD = 'queued_load_total_gw';
const OLD_BASIS = 'queued_load_total_gw_basis';
const TARGET = { large_load: 'queued_large_load_gw', mixed_connection_queue: 'queued_connections_gw' };

export function queueKindOf(row) {
  if (!row || typeof row !== 'object') return 'unclassified';
  if (typeof row.queue_kind === 'string' && row.queue_kind) return row.queue_kind;
  if (typeof row[OLD_BASIS] === 'string' && row[OLD_BASIS]) return row[OLD_BASIS];
  const iso = String(row.iso || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return QUEUE_TOTAL_BASIS[iso] || 'unclassified';
}

function renameRow(o) {
  if (!(OLD in o) && !(OLD_BASIS in o)) return o;
  const kind = queueKindOf(o);
  const val = o[OLD];
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === OLD || k === OLD_BASIS) continue;
    out[k] = v;
  }
  out.queue_kind = kind;
  if (val !== undefined) {
    if (kind === 'generation_queue') {
      if (out.queued_generation_gw === undefined || out.queued_generation_gw === null) out.queued_generation_gw = val;
    } else {
      const target = TARGET[kind] || 'queued_total_gw';
      if (out[target] === undefined) out[target] = val;
    }
  }
  return out;
}

export function renameQueueTotals(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 8) return v;
  if (Array.isArray(v)) {
    const arr = v.map((x) => renameQueueTotals(x, depth + 1));
    return arr.some((x, i) => x !== v[i]) ? arr : v;
  }
  let changed = false;
  const kids = {};
  for (const [k, x] of Object.entries(v)) {
    let y = renameQueueTotals(x, depth + 1);
    if (k === 'deprecated_fields' && Array.isArray(x)) y = x.filter((f) => f !== OLD && !(f && typeof f === 'object' && f.field === OLD));
    if (y !== x && !(Array.isArray(x) && Array.isArray(y) && y.length === x.length && y.every((e, i) => e === x[i]))) changed = true;
    kids[k] = y;
  }
  const base = changed ? kids : v;
  return renameRow(base);
}
