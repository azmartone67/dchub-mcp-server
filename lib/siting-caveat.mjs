// siting-caveat.mjs -- planner 5.55: a siting answer never names a far-away search area, or an AVOID metro's areas,
// without one plain line saying so (Grok QA 2026-11-20 P2; owner: "anchor results to the metro and state the AVOID
// caveat").
//
// WHY. find_sites state=IL listed ten downstate MISO substations on St. Louis / Madison CAUTION, 56-170 km from
// Chicago, and nothing said why Chicago was missing: Chicago-area markets are PJM AVOID, and find_sites ranks AVOID
// after every CAUTION by design. A plan that ran find_sites could hand those rows on as the answer to a Chicago buyer.
//
// WHAT. sitingCaveat(executed, fullByEntry, { namedMarkets }) reads every find_sites step that ran and returns one
// line, or null:
//   * the AVOID part: the step's own avoid_note (backend routes/find_sites.py, first sentence), else the named
//     metro's DCPI card when it reads AVOID ("Chicago-area markets (PJM) read AVOID ..."), else the step's
//     ranked_after block (backend: the state's markets whose verdict is worse than every listed area);
//   * the distance part: when a named metro's point is known (its DCPI card, else the step's anchored_market) and an
//     area the answer names sits FAR_KM or more from it, how far, and the call that centres the search there. Below
//     full access (a preview find_sites result) the distance is said without a figure, as mcp#1600 words it.
// withSitingCaveat(answer, cav) puts the line FIRST in the headline (the lead text is cut at 600 characters, so a line
// after a long land-search headline would not survive) and on the answer as siting_caveat.
// Warm, neutral wording; no plan name, no price. Pure; nothing here throws.

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const num = (v) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };

export const FAR_KM = 100;
// The areas a siting lead names (lib/land-search.mjs landSearchLead names the top three).
export const SHOWN_AREAS = 3;

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const titleCase = (slug) => String(slug || '').replace(/-[a-z]{2}$/, '').replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
const firstSentence = (s) => { const t = one(s); const m = /^(.+?[.!?])(?:\s|$)/.exec(t); return m ? m[1] : t; };
const ranStep = (e) => e && (e.status === 'executed' || e.status === 'gated_preview');

// The one named metro (a DCPI card the plan read for it): { name, slug, iso, verdict, lat, lon } or null.
function namedMetro(executed, fullByEntry, namedMarkets) {
  const want = new Set((Array.isArray(namedMarkets) ? namedMarkets : []).filter(Boolean).map((x) => String(x).toLowerCase()));
  if (want.size !== 1) return null;
  const [slug0] = [...want];
  const bare = slug0.replace(/-[a-z]{2}$/, '');
  for (const e of executed) {
    if (!e || e.tool !== 'get_market_dcpi_rank' || !ranStep(e)) continue;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (!p) continue;
    const slugs = [p.market_slug, p._requested_slug, p._canonical_slug, isObj(e.args) && e.args.market_slug]
      .filter(Boolean).map((x) => String(x).toLowerCase());
    if (!slugs.some((x) => x === slug0 || x === bare)) continue;
    const v = one(p.verdict).toUpperCase();
    return { name: one(p.market_name) || titleCase(p.market_slug || slug0), slug: one(p.market_slug) || bare,
      iso: one(p.iso) || null, verdict: /^(BUILD|CAUTION|AVOID)$/.test(v) ? v : null,
      lat: num(p.latitude), lon: num(p.longitude) };
  }
  return { name: titleCase(slug0), slug: bare, iso: null, verdict: null, lat: null, lon: null };
}

// The find_sites step's own anchor (a market= call): { name, slug, iso, verdict, lat, lon } or null.
function anchoredMetro(p) {
  const am = isObj(p.anchored_market) && p.anchored_market.resolved !== false ? p.anchored_market : null;
  if (!am) return null;
  const f = isObj(p.filter) ? p.filter : {};
  return { name: one(am.market) || titleCase(am.slug), slug: one(am.slug), iso: one(am.iso) || null,
    verdict: one(am.verdict).toUpperCase() || null,
    lat: am.search_centre === 'market_centre' ? num(f.lat) : null, lon: am.search_centre === 'market_centre' ? num(f.lon) : null };
}

// A find_sites result served below full access: the backend's or the MCP preview (coordinates coarsened to 1.1 or
// 11 km; a full caller's are 0.1 km), or a step the plan marks gated.
function isPreview(e, p) {
  if (e && e.status === 'gated_preview') return true;
  if (p._gated === true) return true;
  return (Array.isArray(p.candidates) ? p.candidates : []).some((c) => isObj(c) && (num(c.coordinate_precision_km) ?? 0) >= 1);
}

function rankedAfterPart(ra) {
  if (!isObj(ra) || !Array.isArray(ra.markets) || !ra.markets.length) return '';
  const rows = ra.markets.filter(isObj).slice(0, 3);
  const names = rows.map((m) => `${one(m.market) || titleCase(m.slug)} (${[one(m.iso), one(m.verdict)].filter(Boolean).join(', ')})`);
  const more = num(ra.count) != null && ra.count > rows.length ? ' and others' : '';
  const verb = rows.length === 1 && !more ? 'ranks' : 'rank';
  return `${names.join(', ')}${more} ${verb} after every area listed here on the Data Center Power Index (DCPI), so none of ${rows.length === 1 && !more ? 'its' : 'their'} substations is shown.`;
}

/** { line, parts, metro } for the plan's find_sites steps, or null. */
export function sitingCaveat(executed, fullByEntry, { namedMarkets = [] } = {}) {
  try {
    const ex = Array.isArray(executed) ? executed : [];
    const steps = ex.filter((e) => e && e.tool === 'find_sites' && ranStep(e));
    if (!steps.length) return null;
    const named = namedMetro(ex, fullByEntry, namedMarkets);
    let avoid = ''; let ranked = ''; let rankedSlug = ''; let far = null; let metro = named; let preview = false;
    for (const e of steps) {
      const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
      if (!p) continue;
      if (isPreview(e, p)) preview = true;
      const am = anchoredMetro(p);
      if (!metro || (metro.lat == null && am && am.lat != null)) metro = am ? { ...(metro || {}), ...am } : metro;
      if (!avoid && typeof p.avoid_note === 'string' && p.avoid_note.trim()) avoid = firstSentence(p.avoid_note);
      if (!ranked) {
        ranked = rankedAfterPart(p.ranked_after);
        const m0 = ranked && p.ranked_after.markets.find((m) => isObj(m) && one(m.slug));
        rankedSlug = m0 ? one(m0.slug) : '';
      }
      if (metro && metro.lat != null && metro.lon != null) {
        const rows = (Array.isArray(p.candidates) ? p.candidates : []).filter(isObj).slice(0, SHOWN_AREAS);
        for (const c of rows) {
          const lat = num(c.lat); const lon = num(c.lon);
          if (lat == null || lon == null) continue;
          const d = haversineKm(metro.lat, metro.lon, lat, lon);
          if (d >= FAR_KM) far = { n: (far ? far.n : 0) + 1, of: rows.length, max: Math.max(far ? far.max : 0, d) };
        }
      }
    }
    if (!avoid && metro && metro.verdict === 'AVOID') {
      avoid = `${metro.name}-area markets${metro.iso ? ` (${metro.iso})` : ''} read AVOID on the Data Center Power Index (DCPI), so they rank last: any CAUTION or BUILD area ranks ahead of them.`;
    }
    const parts = [];
    if (far) {
      const many = far.n === 1 ? `One of the ${far.of} areas shown sits` : `${far.n} of the ${far.of} areas shown sit`;
      // mcp#1600: below full access the distance stays digit-free (find_sites withholds distance_km and words its
      // distance_note "well away from the centre of"), so the line does not state the km either.
      parts.push(preview ? `${many} well away from ${metro.name}, outside its metro area.`
        : `${many} ${FAR_KM} km or more from ${metro.name} (up to about ${Math.round(far.max / 10) * 10} km).`);
    }
    if (avoid) parts.push(avoid);
    else if (ranked) parts.push(ranked);
    if (!parts.length) return null;
    if ((far || (!avoid && ranked)) && metro && metro.slug) parts.push(`For areas near ${metro.name}, call find_sites market=${metro.slug}.`);
    else if (!avoid && ranked && rankedSlug) parts.push(`For areas near one of them, call find_sites market=${rankedSlug}.`);
    return { line: parts.join(' '), parts, far: !!far, named: !!(named && named.name), metro: metro ? { name: metro.name, slug: metro.slug, verdict: metro.verdict } : null };
  } catch (_e) { return null; }
}

/** The plan's answer with the caveat line first in its headline. A new minimal answer when there was none.
 *  opts.after: the land-search lead (lib/land-search.mjs landSearchLead headline). When the headline starts with it,
 *  the caveat follows it: the answer names its search areas first, then their DCPI verdict (Grok head-to-head
 *  2026-11-25, L2: the Ohio land answer opened "Every area listed reads AVOID ..." before naming any area).
 *  A caveat about a metro the question named (cav.metro: "areas near Chicago", distance from it) still leads
 *  (planner 5.58): the areas it warns about are never named before the warning.
 *  GDL 2026-11-26 item 4: that holds for a metro the QUESTION named (cav.named) or a distance warning (cav.far); a
 *  metro only find_sites anchored ("land for 100 MW in Ohio" -> market=columbus, AVOID) follows the areas. A caveat
 *  object without either flag (an older caller) keeps the 5.58 behavior. */
export function withSitingCaveat(answer, cav, opts = {}) {
  try {
    if (!cav || !cav.line) return answer;
    if (!isObj(answer)) {
      return { kind: 'siting_caveat', headline: cav.line, verdict: null, evidence: [cav.line], not_established: [],
        as_of: null, siting_caveat: cav.line, source: 'Source: DC Hub (dchub.cloud) find_sites, substation-anchored search areas.' };
    }
    const head = one(answer.headline);
    if (head.includes(cav.line)) return answer;
    const lead = one(opts && opts.after);
    const metroLeads = isObj(cav.metro) && cav.metro.name
      && (('named' in cav || 'far' in cav) ? (cav.named || cav.far) : true);
    if (lead && head.startsWith(lead) && !metroLeads) {
      const rest = head.slice(lead.length).trim();
      return { ...answer, headline: `${lead} ${cav.line}${rest ? ` ${rest}` : ''}`, siting_caveat: cav.line };
    }
    return { ...answer, headline: head ? `${cav.line} ${head}` : cav.line, siting_caveat: cav.line };
  } catch (_e) { return answer; }
}
