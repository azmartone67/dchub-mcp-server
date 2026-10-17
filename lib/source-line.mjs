// source-line.mjs — one citable source line at the end of every free answer.
//
// Owner 2026-10-16 (item 8): every FREE tool answer (keyless, free key, email
// key; previews and free full answers) ends with exactly one line an agent can
// paste under a figure:
//
//     Source: DC Hub (dchub.cloud/<path>), as of <date>
//
// <path> is the most specific public page for the result, read from what the
// result already carries (a dchub.cloud profile_url / dcpi_url, the market
// slug, the ISO) or from the tool's own page; the fallback is the bare
// dchub.cloud. <date> is the DATA date (provenance.as_of, the citation's as_of,
// a dated cite_as), never the serve time: when the result carries no data date
// the line has no "as of" at all. An explicit provenance.as_of of null means
// UNMEASURED and wins over a top-level as_of (same rule as citeAsFor in
// lib/agent-outreach.mjs, Grok 2026-10-06 item 8).
//
// TEXT ONLY: the line is a new trailing text item. structuredContent is not
// touched (cite_as and citation already live there), so no outputSchema moves.
//
// ONE LINE: the visible "Cite as: ..." sentence lib/agent-outreach.mjs adds to
// a full answer is the same citation, less specific and dated by retrieval when
// the data has no date, so on a result that gets this line that sentence is
// taken out (structuredContent.cite_as keeps it). A result that already ends
// with a Source line of this shape is returned unchanged.
//
// The caller decides WHO gets the line (free tiers only, and not on the
// surfaces whose contracts fix the trailing text: see server.mjs
// _sourceLineStep). Everything here is pure and never throws.

const HOST = 'dchub.cloud';

// First path segments of public pages a citation may point at. Anything else
// on the host (upgrade, pricing, go/, u/, connect, install, api/) is not a
// source page and is never put in a citation line.
const PAGE_RE = /^(?:markets|facilities|grid|dcpi)(?:\/[a-z0-9][a-z0-9-]{0,120})?$|^(?:transactions|construction-pipeline|news|tax-incentives|interconnection-queue|hyperscaler-deals|listings)$/;

// The seven US ISO pages (measured 200 on 2026-10-16; /grid/iso-ne is a 404,
// /grid/isone is the page).
const ISO_PAGE = Object.freeze({
  pjm: 'pjm', ercot: 'ercot', caiso: 'caiso', miso: 'miso', spp: 'spp', nyiso: 'nyiso',
  isone: 'isone', 'iso-ne': 'isone', iso_ne: 'isone',
});

// A tool whose answer has one public page of its own (measured 200 on 2026-10-16).
const TOOL_PAGE = Object.freeze({
  list_transactions: 'transactions',
  get_news: 'news',
  get_pipeline: 'construction-pipeline',
  hyperscaler_deals: 'hyperscaler-deals',
  get_tax_incentives: 'tax-incentives',
  get_interconnection_queue: 'interconnection-queue',
  source_capacity: 'listings',
  rank_markets: 'dcpi',
  ai_capacity_index: 'dcpi',
});

// Tools whose answer is about one market, so a market slug names its page.
const MARKET_TOOLS = new Set([
  'get_market_intel', 'get_market_context', 'get_market_dcpi_rank', 'predict_market_trajectory',
  'get_metro_fiber', 'get_fiber_intel',
]);
// Tools whose answer is about one ISO.
const ISO_TOOLS = new Set([
  'get_grid_intelligence', 'get_grid_data', 'get_iso_context', 'get_interconnection_queue',
  'get_refined_queue', 'get_energy_prices',
]);

const LINE_RE = /^Source: DC Hub \(dchub\.cloud(?:\/[^\s)]+)?\)(?:, as of \d{4}-\d{2}-\d{2})?$/;

const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const _slug = (v) => {
  const s = _str(v);
  return s && /^[a-z0-9][a-z0-9-]{0,120}$/.test(s.toLowerCase()) ? s.toLowerCase() : null;
};

// "https://dchub.cloud/markets/columbus?x=1" -> "markets/columbus"; null unless
// it is a public page on the host.
export function pagePathFromUrl(u) {
  const s = _str(u);
  if (!s) return null;
  let url;
  try { url = new URL(s); } catch (_) { return null; }
  if (url.protocol !== 'https:' || (url.hostname !== HOST && url.hostname !== 'www.' + HOST)) return null;
  const p = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  return PAGE_RE.test(p) ? p : null;
}

function _day(v) {
  const s = _str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

// The data date, YYYY-MM-DD, or null. Never retrieved_at / served_at.
export function dataAsOfDay(sc) {
  const p = _obj(sc);
  if (!p) return null;
  const cit = _obj(p.citation) || {};
  const prov = _obj(p.provenance) || {};
  const unmeasured = Object.prototype.hasOwnProperty.call(prov, 'as_of') && prov.as_of == null;
  // as_of_kind "retrieval": the backend says its as_of is when the answer was
  // computed (analyze_site), with each layer's own date elsewhere. Not a data date.
  if (prov.as_of_kind === 'retrieval') return null;
  // The attribution step dates citation.cite_as "(as of D)" from the data. The
  // top-level cite_as is NOT read: agent-outreach falls back to the retrieval
  // or serve date there when the data has none.
  const m = typeof cit.cite_as === 'string' && cit.cite_as.match(/\(as of (\d{4}-\d{2}-\d{2})\)\s*$/);
  if (m && !unmeasured) return m[1];
  return _day(cit.as_of) || _day(prov.as_of) || (unmeasured ? null : _day(p.as_of));
}

// The most specific public page for this result, "" for the bare host.
export function sourcePath(sc, toolName, args) {
  const p = _obj(sc) || {};
  const a = _obj(args) || {};
  const data = _obj(p.data);
  // 1) A page URL the result already carries for its one subject.
  for (const holder of [p, data, _obj(p.facility), _obj(p.market)]) {
    if (!holder) continue;
    for (const k of ['profile_url', 'dcpi_url', 'page_url', 'market_url']) {
      const got = pagePathFromUrl(holder[k]);
      if (got) return got;
    }
  }
  // 2) One market: the market page.
  if (MARKET_TOOLS.has(toolName)) {
    const mk = _obj(p.market);
    const m = _slug(p.market_slug) || _slug(typeof p.market === 'string' ? p.market : null) || _slug(mk && mk.slug)
      || _slug(data && (data.market_slug || data.slug)) || _slug(a.market_slug) || _slug(a.market) || _slug(a.metro);
    if (m) return 'markets/' + m;
  }
  // 3) One ISO: the grid page.
  if (ISO_TOOLS.has(toolName)) {
    const raw = _str(typeof p.iso === 'string' ? p.iso : null) || _str(a.iso) || _str(a.region_id);
    const iso = raw && ISO_PAGE[raw.toLowerCase()];
    if (iso) return 'grid/' + iso;
  }
  // 4) The tool's own page.
  return TOOL_PAGE[toolName] || '';
}

// An hour-precise data stamp "YYYY-MM-DDTHH:MMZ" from a cite that ends with one, or null.
// Only the stamp form the grid taste writes is read, so a serve-time fallback never qualifies.
const _HOUR_CITE_RE = /\bas of (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)\)?\s*$/;
export function dataAsOfHour(sc) {
  const p = _obj(sc);
  if (!p) return null;
  for (const v of [(_obj(p.citation) || {}).cite_as, p.cite_as]) {
    const m = typeof v === 'string' && _HOUR_CITE_RE.exec(v);
    if (m) return m[1];
  }
  return null;
}

export function sourceLine(sc, toolName, args) {
  const path = sourcePath(sc, toolName, args);
  const day = dataAsOfDay(sc);
  // G-1016-01 follow-up: a grid cite names its hour ("as of 2026-10-16T04:00Z"); the Source line
  // carries the same hour when that hour falls on the data day, else the day alone.
  const hour = dataAsOfHour(sc);
  const stamp = hour && day && hour.startsWith(day) ? hour : day;
  return 'Source: DC Hub (' + HOST + (path ? '/' + path : '') + ')' + (stamp ? ', as of ' + stamp : '');
}

export function isSourceLine(text) {
  return typeof text === 'string' && LINE_RE.test(text.trim());
}

function _lastLine(text) {
  const t = String(text || '').replace(/\s+$/, '');
  return t.slice(t.lastIndexOf('\n') + 1);
}

// The JSON payload of the result: structuredContent, else content[0] JSON.
function _payload(result) {
  const sc = _obj(result.structuredContent);
  if (sc) return sc;
  try {
    const first = result.content.find((it) => typeof it?.text === 'string' && it.text.trim().startsWith('{'));
    return first ? _obj(JSON.parse(first.text)) : null;
  } catch (_) { return null; }
}

// Drop the visible "Cite as: ..." sentence agent-outreach appends (always the
// last sentence of its block). A block left empty goes.
function _dropCiteAsSentence(content) {
  const out = [];
  for (const it of content) {
    if (!it || it.type !== 'text' || typeof it.text !== 'string') { out.push(it); continue; }
    const i = it.text.lastIndexOf('Cite as: DC Hub');
    const tail = i >= 0 ? it.text.slice(i) : '';
    if (i < 0 || tail.includes('\n') || !tail.endsWith('.') || (i > 0 && !/\s$/.test(it.text.slice(0, i)))) {
      out.push(it);
      continue;
    }
    const rest = it.text.slice(0, i).replace(/\s+$/, '');
    if (rest) out.push({ ...it, text: rest });
  }
  return out;
}

// A partial answer the tier gate cut (it carries data, so it is cited). The
// flags are the preview markers server.mjs's relay step reads
// (_RELAY_STRONG_FLAGS less _wall, which marks a wall with no data) plus the
// free-tier depth note `_upgrade` and the completeness the attribution step
// stamps.
const PREVIEW_FLAGS = ['_gated', '_preview_only', 'trial_preview', 'tease', 'preview_is_partial', 'taste_bounded'];
export function isTierPreview(sc) {
  const p = _obj(sc);
  if (!p) return false;
  const prov = _obj(p.provenance) || {};
  const cit = _obj(p.citation) || {};
  const comp = _obj(p.completeness);
  return prov.completeness === 'partial_preview' || cit.completeness === 'partial_preview'
    || (comp && comp.status === 'partial') || PREVIEW_FLAGS.some((k) => p[k] === true) || !!_obj(p._upgrade);
}

// Append the line. Unchanged when: a failure (an error that is not a tier
// preview), no text content, or the result already ends with a Source line.
export function withSourceLine(result, toolName, args) {
  try {
    if (!result || typeof result !== 'object') return result;
    if (!Array.isArray(result.content) || !result.content.length) return result;
    const sc = _payload(result);
    // An upstream failure is never cited (same markers as server.mjs _isFailureEnvelope).
    if (sc && (sc._error_mitigation || (typeof sc.error === 'string' && /^API \d{3}$/.test(sc.error)))) return result;
    // A tier preview is a free answer even where the wall flags it isError
    // (the free-tier preview stub does); any other error is not.
    if (!isTierPreview(sc) && (result.isError === true
        || (sc && (sc.error || sc.ok === false || sc.success === false)))) return result;
    const texts = result.content.filter((it) => it && it.type === 'text' && typeof it.text === 'string');
    if (!texts.length) return result;
    if (isSourceLine(_lastLine(texts[texts.length - 1].text))) return result;
    const line = sourceLine(sc, toolName, args);
    const content = _dropCiteAsSentence(result.content);
    return { ...result, content: [...content, { type: 'text', text: line }] };
  } catch (_) {
    return result;
  }
}
