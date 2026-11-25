// source-pointers.mjs -- dated public source pointers for flood, broadband and water (Grok spec item 7, 2026-11-24).
//
// WHY. A flood, broadband or water question whose steps held no figure the lead could read ended on the dead-end line
// "... and no figure in them could be summarised here" (CI sweep 2026-11-24; live sample the same day: 7 of 9 Loudoun
// and Ashburn flood / broadband / water asks led with it). The person learned nothing and had nowhere to go.
//
// WHAT. config/source-pointers.json holds one public page per topic ({topic, label, url, publisher, checked_on,
// fail_count}). When the flag is on and a topic the question names (or a topic step that ran) has no figure in the
// plan's facts, the lead carries that topic's dated pointer instead of the dead-end line. When a figure IS held, the
// figure leads and the pointer follows as "Verify at <url>". Links only: nothing here calls an outside service, and
// the wording stays neutral ("check", "public data").
//
// checked_on is moved by scripts/check-source-pointers.mjs (weekly, .github/workflows/source-pointers-check.yml). A
// pointer that failed two checks in a row (fail_count >= 2) is dropped from answers and logged once per process.
//
// Flag: DCHUB_SOURCE_POINTERS_V1 (source_pointers_v1), default OFF. Off, the lead is byte-identical to before.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addressFromText } from './plan-step-facts.mjs';

export const POINTERS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'source-pointers.json');
export const POINTER_DROP_AFTER = 2;

export function sourcePointersOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_SOURCE_POINTERS_V1) || '').trim());
}

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Which topics a question or a plan is about ("disaster recovery" is a site role, not a hazard). `re` reads the intent; `trigger` tools put the topic on the plan when
// they ran (a hazard step is a flood question's step); `figure` tools are the ones whose facts count as a figure.
export const TOPICS = [
  { topic: 'flood', re: /\b(flood\w*|fema|nfhl|storm surge|natural[-\s]hazards?|hazards?|disasters?(?!\s+recovery))\b/i,
    trigger: ['get_disaster_risk'], figure: ['get_disaster_risk'] },
  { topic: 'broadband', re: /\b(broadband|isps?|internet (?:access|service|availability|providers?))\b/i,
    trigger: [], figure: ['get_fiber_readiness', 'get_fiber_intel', 'get_metro_fiber'] },
  { topic: 'water', re: /\b(water|groundwater|surface water|aquifers?|drought|streamflow)\b/i,
    trigger: ['get_water_risk'], figure: ['get_water_risk'] },
];

const _logged = new Set();
function logDrop(p) {
  const k = `${p.topic}|${p.url}`;
  if (_logged.has(k)) return;
  _logged.add(k);
  try { console.warn(`[source-pointers] dropped the ${p.topic} pointer (${p.url}): it failed ${p.fail_count} link checks in a row`); } catch (_e) { /* logging is optional */ }
}

/** The usable pointers from a parsed config array: dated, https, failing fewer than POINTER_DROP_AFTER checks. */
export function usablePointers(list) {
  const out = new Map();
  for (const p of Array.isArray(list) ? list : []) {
    if (!isObj(p) || typeof p.topic !== 'string' || typeof p.url !== 'string' || !/^https:\/\//.test(p.url)) continue;
    if (typeof p.checked_on !== 'string' || !DAY_RE.test(p.checked_on)) continue;
    if (typeof p.publisher !== 'string' || !p.publisher.trim()) continue;
    if (Number(p.fail_count) >= POINTER_DROP_AFTER) { logDrop(p); continue; }
    if (!out.has(p.topic)) out.set(p.topic, p);
  }
  return out;
}

let _cache = null;
/** Pointers read from config/source-pointers.json (once per process). A missing or bad file gives none. */
export function loadSourcePointers(file = POINTERS_FILE) {
  if (_cache && _cache.file === file) return _cache.map;
  let list = [];
  try { list = JSON.parse(readFileSync(file, 'utf8')); } catch (_e) { list = []; }
  const map = usablePointers(list);
  _cache = { file, map };
  return map;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function pointOf(executed, tools) {
  const steps = Array.isArray(executed) ? executed : [];
  const pick = (e) => {
    const a = e && isObj(e.args) ? e.args : null;
    const lat = a ? num(a.lat) : null, lon = a ? num(a.lon) : null;
    return lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  };
  for (const e of steps) if (e && tools.includes(e.tool)) { const p = pick(e); if (p) return p; }
  for (const e of steps) { const p = pick(e); if (p) return p; }
  return null;
}

// A step point stands for "this location" only when the question gave it: the lat/lon written in the intent, or a
// street address (geocoded to the point). A county or market centroid the planner minted is not the asker's site.
function askedPoint(intent, point) {
  if (!point) return null;
  const t = String(intent || '');
  const has = (n) => new RegExp(`(^|[^0-9.])${String(n).replace('.', '\\.')}(?![0-9])`).test(t);
  return (has(point.lat) && has(point.lon)) || addressFromText(t) ? point : null;
}

// The FEMA viewer reads AddressQuery into the ArcGIS World geocoder as one line, and that geocoder resolves
// "lat,lon" to the point (checked 2026-11-24: msc.fema.gov/portal/js/addressSearchV2.js, locateAddress()).
function urlFor(p, point) {
  if (p.topic === 'flood' && point && /^https:\/\/msc\.fema\.gov\/portal\/search\/?$/.test(p.url)) {
    return `${p.url}?AddressQuery=${encodeURIComponent(`${point.lat},${point.lon}`)}`;
  }
  return p.url;
}

function noFigureSentence(p, url) {
  const dated = `(${p.publisher}, public data; pointer checked ${p.checked_on})`;
  if (p.topic === 'flood') return `Flood zone not summarised here. Check FEMA's National Flood Hazard Layer for this location: ${url} ${dated}.`;
  if (p.topic === 'broadband') return `Fixed broadband availability: FCC National Broadband Map, ${url} ${dated}.`;
  if (p.topic === 'water') return `Surface and groundwater data: USGS Water Data for the Nation, ${url} ${dated}.`;
  return `Check ${p.label || p.publisher}: ${url} ${dated}.`;
}
const verifySentence = (p, url) => `Verify at ${url} (${p.publisher}, public data; pointer checked ${p.checked_on}).`;

/**
 * The pointer sentences for one finished plan, in priority order: topics the question names first, then topics only a
 * step put on the plan. Each: { topic, named, has_figure, text, url, checked_on }. facts: the plan's step facts.
 * Pure apart from the one-time config read; never throws.
 */
export function pointerSentences(plan, facts, { pointers } = {}) {
  try {
    if (!isObj(plan)) return [];
    const map = pointers instanceof Map ? pointers : loadSourcePointers();
    if (!map.size) return [];
    const intent = typeof plan.intent === 'string' ? plan.intent : '';
    const executed = Array.isArray(plan.executed) ? plan.executed : [];
    const ran = new Set(executed.filter((e) => e && (e.status === 'executed' || e.status === 'gated_preview')).map((e) => e.tool));
    const factTools = new Set((Array.isArray(facts) ? facts : []).map((f) => f && f.tool).filter(Boolean));
    const named = [], viaStep = [];
    for (const t of TOPICS) {
      const p = map.get(t.topic);
      if (!p) continue;
      const isNamed = t.re.test(intent);
      if (!isNamed && !t.trigger.some((x) => ran.has(x))) continue;
      const hasFigure = t.figure.some((x) => factTools.has(x));
      const url = urlFor(p, askedPoint(intent, pointOf(executed, t.trigger.concat(t.figure))));
      const row = { topic: t.topic, named: isNamed, has_figure: hasFigure, url, checked_on: p.checked_on,
        text: hasFigure ? verifySentence(p, url) : noFigureSentence(p, url) };
      (isNamed ? named : viaStep).push(row);
    }
    return named.concat(viaStep);
  } catch (_e) { return []; }
}

/** Test hook: forget the cached config read and the drop log. */
export function _resetSourcePointersCache() { _cache = null; _logged.clear(); }
