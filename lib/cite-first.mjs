// Brain 2026-11-23 item 4 (Grok answer-quality note): ONE citation wrapper for every answer.
//
//   a. The date resolves in this order: provenance.as_of, structuredContent.as_of, citation.as_of, the newest
//      row as_of; else the retrieval time, labelled "(retrieved)". A provenance block that states the collection
//      date is UNMEASURED (as_of: null) or a retrieval / generated stamp skips straight to the rows, then the
//      retrieval time, so a load date is never shown as the data's date (Grok 2026-10-06 item 8).
//   b. structuredContent.cite_as = "DC Hub (dchub.cloud), as of <YYYY-MM-DD>", plus " — partial preview" on a
//      preview. A cite_as that already reads that way keeps its wording (hour precision, partial note). The
//      citation{} and provenance{} objects are never touched.
//   c. The last text item is "Source: DC Hub (dchub.cloud[/page]), as of <date>".
//   d. The same line sits inside the first 300 characters of content[0]: a JSON block gets a `_source_line` key
//      FIRST (it still parses), a text block (an execute_plan lead, a wall) gets the line as its first line, so a
//      walled answer names its source before the wall text.
//   e. One date per answer: cite_as and both Source lines carry the same stamp.
//
// No price or plan name is ever written here. Pure: the caller decides the skips (directory / Claude / core
// profiles, clean platforms, loopback plan steps). Flag DCHUB_CITE_FIRST (default OFF, see citeFirstOn). Fail-soft:
// any throw returns the result unchanged.
import { sourcePath, isTierPreview } from './source-line.mjs';

export const CITE_AS_RE = /^DC Hub \(dchub\.cloud\), as of \d{4}-\d{2}-\d{2}/;
export const SOURCE_LINE_RE = /^Source: DC Hub \(dchub\.cloud(?:\/[^\s)]+)?\), as of \d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}Z)?(?: \(retrieved\))?$/;
const LEAD_CHARS = 300;
const STAMP_RE = /^DC Hub \(dchub\.cloud\), as of (\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}Z)?)(\s*\(retrieved\))?/;
const ROW_KEYS = ['rows', 'results', 'data', 'items', 'facilities', 'markets', 'records', 'projects', 'deals',
  'transactions', 'listings', 'events', 'articles', 'sites', 'candidates'];

// DEFAULT OFF (DCHUB_CITE_FIRST=1 turns it on, on both services). Items c and d cross three owner decisions that
// pinned tests guard: the "Tell the user" sentence is line 1 of a key / email answer, the front-desk and referral
// lines end an execute_plan answer as its ONE last line, and a preview ends with the identity footer after the Source
// line. Which wins is the owner's call, so the wrapper ships dark until that is decided.
export const citeFirstOn = (env = process.env) => /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_CITE_FIRST) || '').trim());

const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
function _day(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

// The newest as_of on any row list the payload carries (one level down, plus data.{rows,...}).
export function newestRowDay(sc) {
  const p = _obj(sc);
  if (!p) return null;
  let best = null;
  const scan = (holder) => {
    if (!_obj(holder)) return;
    for (const k of ROW_KEYS) {
      const arr = holder[k];
      if (!Array.isArray(arr)) continue;
      for (const r of arr) {
        const d = _obj(r) && (_day(r.as_of) || _day(r.updated_at) || _day(r.last_updated));
        if (d && (!best || d > best)) best = d;
      }
    }
  };
  scan(p);
  scan(p.data);
  return best;
}

// Item a. Returns { stamp, retrieved }. `now` is the fallback retrieval time.
export function resolveCiteStamp(sc, now = new Date()) {
  const p = _obj(sc) || {};
  const own = typeof p.cite_as === 'string' && p.cite_as.match(STAMP_RE);
  if (own) return { stamp: own[1], retrieved: !!own[2] };
  const prov = _obj(p.provenance) || {};
  const cit = _obj(p.citation) || {};
  const unmeasured = (Object.prototype.hasOwnProperty.call(prov, 'as_of') && prov.as_of == null)
    || prov.as_of_kind === 'retrieval' || prov.as_of_kind === 'generated_at';
  const stated = unmeasured ? null : (_day(prov.as_of) || _day(p.as_of) || _day(cit.as_of));
  const day = stated || newestRowDay(p);
  if (day) return { stamp: day, retrieved: false };
  const r = _day(p.retrieved_at) || _day(cit.retrieved_at) || _day(prov.retrieved_at)
    || new Date(Number.isFinite(+now) ? +now : Date.now()).toISOString().slice(0, 10);
  return { stamp: r, retrieved: true };
}

export function isPartialPayload(sc) {
  const p = _obj(sc);
  if (!p) return false;
  return isTierPreview(p) || p.completeness === 'partial_preview' || p.partial === true
    || (typeof p.cite_as === 'string' && /partial/i.test(p.cite_as));
}

export function canonicalCiteAs(stamp, { retrieved = false, partial = false } = {}) {
  return 'DC Hub (dchub.cloud), as of ' + stamp + (retrieved ? ' (retrieved)' : '') + (partial ? ' — partial preview' : '');
}

function _payload(result) {
  const sc = _obj(result.structuredContent);
  if (sc) return sc;
  try {
    const first = result.content.find((it) => typeof it?.text === 'string' && it.text.trim().startsWith('{'));
    return first ? _obj(JSON.parse(first.text)) : null;
  } catch (_) { return null; }
}

const _isSource = (line) => /^Source: DC Hub \(dchub\.cloud[^)]*\)/.test(String(line || '').trim());

// Drop a trailing Source line (whole item or its last line): this step writes the one dated line.
function _dropTrailingSource(content) {
  const out = content.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const it = out[i];
    if (!it || it.type !== 'text' || typeof it.text !== 'string') continue;
    const t = it.text.replace(/\s+$/, '');
    const cut = t.lastIndexOf('\n');
    const last = t.slice(cut + 1);
    if (!_isSource(last)) break;
    if (cut < 0) out.splice(i, 1);
    else out[i] = { ...it, text: t.slice(0, cut).replace(/\s+$/, '') };
    break;
  }
  return out;
}

function _leadWith(block, line) {
  const text = block.text;
  if (text.slice(0, LEAD_CHARS).includes(line)) return block;
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      if (_obj(obj)) {
        const { _source_line: _old, ...rest } = obj;
        const ind = text.match(/^\{\r?\n([ \t]+)"/);
        return { ...block, text: JSON.stringify({ _source_line: line, ...rest }, null, ind ? ind[1] : undefined) };
      }
    } catch (_) { /* not JSON: falls through to a plain first line */ }
  }
  return { ...block, text: line + '\n\n' + text };
}

// The step. `skip` is the caller's audience decision; failures (errors that are not tier previews) pass through.
export function withCiteFirst(result, toolName, args, { skip = false, now = new Date(), env = process.env } = {}) {
  try {
    if (skip || !citeFirstOn(env) || !result || typeof result !== 'object') return result;
    if (!Array.isArray(result.content) || !result.content.length) return result;
    const sc = _payload(result);
    if (sc && (sc._error_mitigation || (typeof sc.error === 'string' && /^API \d{3}$/.test(sc.error)))) return result;
    if (!isTierPreview(sc) && (result.isError === true || (sc && (sc.error || sc.ok === false || sc.success === false)))) return result;
    if (!result.content.some((it) => it && it.type === 'text' && typeof it.text === 'string')) return result;
    const { stamp, retrieved } = resolveCiteStamp(sc, now);
    let path = '';
    try { path = sourcePath(sc, toolName, args) || ''; } catch (_) { path = ''; }
    const line = 'Source: DC Hub (dchub.cloud' + (path ? '/' + path : '') + '), as of ' + stamp + (retrieved ? ' (retrieved)' : '');
    let content = _dropTrailingSource(result.content);
    const i0 = content.findIndex((it) => it && it.type === 'text' && typeof it.text === 'string');
    if (i0 >= 0) content[i0] = _leadWith(content[i0], line);
    content = [...content, { type: 'text', text: line }];
    const out = { ...result, content };
    const own = _obj(result.structuredContent);
    if (own && !(typeof own.cite_as === 'string' && CITE_AS_RE.test(own.cite_as))) {
      out.structuredContent = { ...own, cite_as: canonicalCiteAs(stamp, { retrieved, partial: isPartialPayload(own) }) };
    }
    return out;
  } catch (_) {
    return result;
  }
}
