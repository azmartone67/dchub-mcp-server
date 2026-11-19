// land-search.mjs -- planner 5.42: "find land for N MW near <place>" runs find_sites first and names the areas.
//
// WHY. Grok's LAND head-to-head (2026-11-18, L2): the Columbus 100 MW land question went to dc_power_place (market
// intel, PJM queue, feeders, timeline) and no find_sites step ran, so no candidate area was named. Worded slightly
// differently it went to capacity_search, which ran find_sites state=OH as its LAST step (a whole-state search for a
// question about Columbus), and the lead was the market verdict alone.
//
// WHAT.
//   * landSearchAsk(text, d): land wording (find / need / looking for ... land, acres, parcels, sites; powered land;
//     land for/near/in; sites for N MW), a size and no point given (a point is a site screen, not a search).
//   * landSearchArgs(d, point, state): find_sites around the place's point (60 km) when the planner holds one, else
//     the state. The owner-decided ranking (an unresolved grid ranks after same-grid reads) is find_sites' own.
//   * landSearchFirst(seq, args, why): find_sites becomes step 1 (added, or moved and re-aimed at the point), the
//     other steps keep their order and their depends_on is remapped.
//   * landSearchLead(executed, fullByEntry, label): "find_sites: N search areas within 60 km of Columbus, OH (3 shown):
//     near 40.2, -83 (500 kV+ substation; fiber route 0.26 km, gas pipeline 18.1 km; Worthington DCPI AVOID); ..."
//     or a no-match sentence. A search area is said as one: not a parcel, not land for sale.
// Pure; nothing here throws.

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : null);

export const LAND_RADIUS_KM = 60;

const LAND_RE = new RegExp([
  String.raw`\bpowered\s+land\b`,
  String.raw`\b(?:find|finding|need|needs|want|looking\s+for|look\s+for|search(?:ing)?\s+for|locate|identify|scout|source|sourcing)\b[^.?!]{0,60}\b(?:land|acres?|acreage|parcels?|sites|site\s+options|greenfield)\b`,
  String.raw`\bland\s+(?:for|near|in|around)\b`,
  String.raw`\bsites?\s+for\s+(?:a\s+|an\s+)?\d`,
].join('|'), 'i');

// The classes whose plan a land question may lead with find_sites. Rankings (site_selection_canvas), point reads,
// colocation, permitting and named-project classes keep their own plan.
export const LAND_FIRST_CLASSES = new Set(['capacity_search', 'dc_power_place', 'dc_capacity', 'market_outlook',
  'grid_headroom', 'interconnection_queue', 'power_timeline']);

export function landSearchAsk(text, d) {
  const t = String(text || '').slice(0, 2000);
  if (!LAND_RE.test(t)) return false;
  if (isObj(d) && isObj(d.coords)) return false;
  return !!(isObj(d) && num(d.mw) != null && d.mw > 0);
}

export function landSearchArgs(point, state) {
  if (isObj(point) && num(point.lat) != null && num(point.lon) != null) {
    return { lat: point.lat, lon: point.lon, radius_km: LAND_RADIUS_KM };
  }
  const st = typeof state === 'string' && /^[A-Z]{2}$/.test(state) ? state : null;
  return st ? { state: st } : null;
}

/** In place. find_sites is step 1 with `args`; returns the step or null. */
export function landSearchFirst(seq, args, why) {
  try {
    if (!Array.isArray(seq) || !isObj(args)) return null;
    let fs = seq.find((s) => s && s.tool === 'find_sites');
    if (fs) {
      const h = isObj(fs.args_hint) ? fs.args_hint : {};
      // A state-wide search is re-aimed at the place's point; one already at a point keeps it.
      if (args.lat != null && !(num(h.lat) != null && num(h.lon) != null)) fs.args_hint = { ...args };
      fs.why = why;
    } else {
      fs = { step: 0, tool: 'find_sites', depends_on: [], estimated_calls: 1, why, args_hint: { ...args } };
      seq.unshift(fs);
    }
    fs.land_search = true;
    fs.depends_on = [];
    const rest = seq.filter((s) => s !== fs);
    const renum = new Map(rest.map((s, k) => [s.step, k + 2]));
    for (const s of rest) {
      if (Array.isArray(s.depends_on)) s.depends_on = s.depends_on.map((n) => (n === fs.step ? 1 : renum.has(n) ? renum.get(n) : n));
    }
    for (const s of rest) s.step = renum.get(s.step);
    fs.step = 1;
    seq.splice(0, seq.length, fs, ...rest);
    return fs;
  } catch (_e) { return null; }
}

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}

const km = (v) => (v < 10 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);

function areaText(c) {
  const lat = num(c.lat); const lon = num(c.lon);
  const at = lat != null && lon != null ? `near ${lat}, ${lon}` : 'an area';
  const a = isObj(c.anchor) ? c.anchor : {};
  const kv = num(a.voltage_kv) != null ? `${a.voltage_kv} kV` : one(a.kv_band);
  const sub = [one(a.name), kv && `${kv} substation`].filter(Boolean).join(' ') || 'a substation';
  const fib = num(c.fiber_distance_km) ?? num(c.fiber_route_km);
  const gas = num(c.gas_distance_km);
  const m = isObj(c.market) ? c.market : {};
  const mk = one(m.market) && one(c.verdict || m.verdict) ? `${one(m.market)} DCPI ${one(c.verdict || m.verdict)}` : '';
  const grid = isObj(c.grid_operator) && c.grid_operator.resolved === false ? 'grid unresolved' : '';
  const bits = [sub, fib != null && `fiber route ${km(fib)} km`, gas != null && `gas pipeline ${km(gas)} km`, mk, grid].filter(Boolean);
  return `${at} (${bits.join('; ')})`;
}

/** { headline, fact, not_established } from the land-search find_sites step, or null when it did not run. */
export function landSearchLead(executed, fullByEntry, label) {
  try {
    const e = (Array.isArray(executed) ? executed : []).find((x) => x && x.tool === 'find_sites'
      && (x.status === 'executed' || x.status === 'gated_preview'));
    if (!e) return null;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (!p) return null;
    const a = isObj(e.args) ? e.args : {};
    const r = num(a.radius_km);
    const where = num(a.lat) != null && r != null ? `within ${r} km of ${one(label) || `${a.lat}, ${a.lon}`}`
      : one(a.state) ? `in ${a.state}` : 'in the area searched';
    const rows = (Array.isArray(p.candidates) ? p.candidates : []).filter(isObj);
    const total = num(p._candidates_total_available) ?? num(p.count) ?? rows.length;
    const asOf = rows.map((c) => (isObj(c.market) ? day(c.market.as_of) : null)).filter(Boolean).sort()[0] || null;
    const ne = ['A search area is a substation-anchored place to start looking: not a parcel, not a listing and not land known to be for sale.'];
    if (!total) {
      const headline = `No substation-anchored search area matched ${where} (find_sites).`;
      return { headline, fact: { tool: 'find_sites', step: e.step, entity: one(label) || one(a.state) || '', as_of: null, text: headline }, not_established: ne };
    }
    const top = rows.slice(0, 3);
    const shown = rows.length && rows.length < total ? ` (${rows.length} shown)` : '';
    const coarse = top.some((c) => num(c.coordinate_precision_km) != null)
      ? ` Coordinates are coarsened to about ${num(top.find((c) => num(c.coordinate_precision_km) != null).coordinate_precision_km)} km in this read.` : '';
    const headline = `find_sites: ${total.toLocaleString('en-US')} search area${total === 1 ? '' : 's'} ${where}${shown}`
      + (top.length ? `, top ${top.length}: ${top.map((c, i) => `${i + 1}) ${areaText(c)}`).join('; ')}` : '')
      + `.${coarse}`;
    return { headline, fact: { tool: 'find_sites', step: e.step, entity: one(label) || one(a.state) || '', as_of: asOf, text: headline }, not_established: ne };
  } catch (_e) { return null; }
}

/** The plan's answer with the land-search lead in front (a new answer when there was none). Never throws. */
export function withLandLead(answer, lead) {
  try {
    if (!lead || !lead.headline) return answer;
    if (!isObj(answer)) {
      return { kind: 'land_search', requested_mw: null, geography: lead.fact.entity || null, headline: lead.headline,
        verdict: null, evidence: [lead.headline], not_established: lead.not_established.slice(), as_of: lead.fact.as_of,
        relay: null, source: 'Source: DC Hub (dchub.cloud) find_sites, substation-anchored search areas.', facts: [lead.fact] };
    }
    const { source, ...rest } = answer;
    return { ...rest,
      headline: `${lead.headline} ${one(answer.headline)}`.trim(),
      evidence: [lead.headline, ...(Array.isArray(answer.evidence) ? answer.evidence : [])],
      not_established: [...(Array.isArray(answer.not_established) ? answer.not_established : []), ...lead.not_established],
      ...(Array.isArray(answer.facts) ? { facts: [lead.fact, ...answer.facts] } : {}),
      source };
  } catch (_e) { return answer; }
}
