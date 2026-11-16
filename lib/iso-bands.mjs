// iso-bands.mjs — coarse ISO-level bands for a free compare_isos answer.
//
// Owner decision 2026-11-16 (Grok Note K item 7, option A): where a keyless or free
// compare_isos answer withholds an ISO's time to power, constraint score or headroom,
// it carries a coarse band of the SAME exact value instead of nothing. The exact
// figure stays withheld (its `_<field>_in_pro` marker is untouched); the band is
// computed here from the value the paid answer shows, so a free band always contains
// the paid figure. A missing or non-numeric value gets no band, never a guessed one.
//
// Bucket edges are lower-inclusive: 24 months reads "24-48 mo", 48 reads "48+ mo".
//   time_to_power_band  avg_time_to_power_months  <24 mo | 24-48 mo | 48+ mo
//   constraint_level    constraint_score (0-100,   low (<=50) | medium (<=70) | high (>70)
//                       higher = more constrained) — the DCPI verdict ceilings
//                       (DCPI_VERDICT_BANDS constraint_max 50 / 70), so the level
//                       never contradicts constraint_score_band (BUILD / CAUTION / AVOID).
//   headroom_band       stranded_capacity_mw (the  <1 GW | 1-3 GW | 3-10 GW | 10+ GW
//                       ISO's DCPI stranded, i.e.
//                       unused, capacity), in GW
// Pure: no I/O, no env.

export const BAND_NOTE = 'Coarse range; the exact figure is in the full answer.';

// Which exact field each band is cut from (named in the answer, so an agent can tell
// what the range is a range OF).
export const BAND_SOURCE = Object.freeze({
  time_to_power_band: 'avg_time_to_power_months',
  constraint_level: 'constraint_score',
  headroom_band: 'stranded_capacity_mw',
});

const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function timeToPowerBand(months) {
  const n = _num(months);
  if (n === null || n < 0) return null;
  if (n < 24) return '<24 mo';
  if (n < 48) return '24-48 mo';
  return '48+ mo';
}

export function constraintLevel(score) {
  const n = _num(score);
  if (n === null || n < 0 || n > 100) return null;
  if (n <= 50) return 'low';
  if (n <= 70) return 'medium';
  return 'high';
}

export function headroomBand(mw) {
  const n = _num(mw);
  if (n === null || n < 0) return null;
  const gw = n / 1000;
  if (gw < 1) return '<1 GW';
  if (gw < 3) return '1-3 GW';
  if (gw < 10) return '3-10 GW';
  return '10+ GW';
}

const _BANDERS = { time_to_power_band: timeToPowerBand, constraint_level: constraintLevel, headroom_band: headroomBand };

// The bands for one ISO row: `raw` is the row before the free trim, `trimmed` after it.
// A band is emitted only for a field the trim withheld (raw had a number, trimmed has
// none), so a caller who already sees the figure gets no band. null = nothing to band.
export function isoRowBands(raw, trimmed) {
  if (!raw || typeof raw !== 'object' || !trimmed || typeof trimmed !== 'object') return null;
  const out = {};
  for (const [band, src] of Object.entries(BAND_SOURCE)) {
    if (_num(trimmed[src]) !== null) continue;          // not withheld: the figure is there
    const b = _BANDERS[band](raw[src]);
    if (b) out[band] = b;
  }
  if (!Object.keys(out).length) return null;
  out.band_note = BAND_NOTE;
  return out;
}

// The labels a band may carry. A `bands` object that arrives on a row (set by the compare_isos
// handler, below) is passed on only through this list, so nothing but a label can ride it.
const _LABELS = Object.freeze({
  time_to_power_band: new Set(['<24 mo', '24-48 mo', '48+ mo']),
  constraint_level: new Set(['low', 'medium', 'high']),
  headroom_band: new Set(['<1 GW', '1-3 GW', '3-10 GW', '10+ GW']),
});
export function cleanBands(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const out = {};
  for (const [band, ok] of Object.entries(_LABELS)) if (ok.has(b[band])) out[band] = b[band];
  if (!Object.keys(out).length) return null;
  out.band_note = BAND_NOTE;
  return out;
}

// ── Forwarded caller tier (mcp#1476 follow-up, 2026-11-16) ──────────────────
// Since 2026-11-03 this server forwards the END USER's tier (X-DCHub-Caller-Tier), and
// /api/v1/dcpi/iso-comparison masks every ISO aggregate below the backend's paid plans. A
// keyless or free compare_isos therefore receives null time to power, constraint and stranded
// MW: the trim saw no figure, so it cut no band (live 2026-11-16 06:15Z: no bands). The handler
// now reads the server-view rows (no forwarded tier) ONLY to cut bands for a row whose caller
// view withholds a figure, and attaches them here. The caller's own figures are untouched.
// `shownComparison`: the caller's shaped rows; `rawByIso`: the same rows shaped from the
// server view. Returns a new comparison map (rows without a band are the same objects).
export function attachIsoBands(shownComparison, rawByIso) {
  if (!shownComparison || typeof shownComparison !== 'object' || !rawByIso || typeof rawByIso !== 'object') return shownComparison;
  const out = { ...shownComparison };
  for (const iso of Object.keys(shownComparison)) {
    const b = isoRowBands(rawByIso[iso], shownComparison[iso]);
    if (b) out[iso] = { ...shownComparison[iso], bands: b };
  }
  return out;
}

// True when a shaped row has a DCPI join (a free market count or name) and withholds a band
// source: the case where the server view can supply a band.
export function rowWithholdsBandSource(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.market_count == null && row.iso_name == null) return false;
  return Object.values(BAND_SOURCE).some((src) => _num(row[src]) === null);
}

// One sentence stating every row's bands, or null.
// "time-to-power band 24-48 mo", not "time to power 24-48 mo": the DCPI prose scrub
// (_scrubDcpiProse) reads a bare "time to power <n>-<m> mo" as a stated sub-score figure.
export function bandsSummary(comparison) {
  if (!comparison || typeof comparison !== 'object') return null;
  const parts = [];
  for (const iso of Object.keys(comparison)) {
    const b = comparison[iso] && comparison[iso].bands;
    if (!b || typeof b !== 'object') continue;
    const said = [];
    if (b.time_to_power_band) said.push(`time-to-power band ${b.time_to_power_band}`);
    if (b.constraint_level) said.push(`constraint level ${b.constraint_level}`);
    if (b.headroom_band) said.push(`headroom band ${b.headroom_band}`);
    if (said.length) parts.push(`${iso}: ${said.join(', ')}`);
  }
  return parts.length ? `Coarse ranges per grid (exact figures withheld): ${parts.join('; ')}. ${BAND_NOTE}` : null;
}

// compare_isos `comparison` map in the free trim: each trimmed row gains `bands` where it has
// any. A band the handler already attached (cleanBands) is kept as it came, because the trim
// itself would null a key named time_to_power_band / headroom_band under
// DCHUB_GRID_HEADROOM_TIER; otherwise the band is cut from the untrimmed row.
// Returns { comparison, summary } with summary null when no row was banded.
export function withIsoBands(rawComparison, trimmedComparison) {
  if (!rawComparison || typeof rawComparison !== 'object' || Array.isArray(rawComparison)
      || !trimmedComparison || typeof trimmedComparison !== 'object' || Array.isArray(trimmedComparison)) {
    return { comparison: trimmedComparison, summary: null };
  }
  const comparison = { ...trimmedComparison };
  for (const iso of Object.keys(trimmedComparison)) {
    const raw = rawComparison[iso];
    const row = trimmedComparison[iso];
    if (!row || typeof row !== 'object') continue;
    const b = cleanBands(raw && raw.bands) || isoRowBands(raw, row);
    if (b) comparison[iso] = { ...row, bands: b };
    else if (Object.prototype.hasOwnProperty.call(row, 'bands')) {
      const { bands: _drop, ...rest } = row;               // a trimmed husk of a bands object
      comparison[iso] = rest;
    }
  }
  return { comparison, summary: bandsSummary(comparison) };
}
