// DCPI hold #117162 (Grok QA 2026-11-25): no tool answer hands an agent a /dcpi/<slug> link that 404s.
//
// The backend (dchub-backend util/dcpi_coverage.py, be#9344/be#9396) answers 404 on https://dchub.cloud/dcpi/<slug>
// for every market outside the public DCPI coverage: markets served by a held grid operator (ERCOT, MISO) or in a
// held state (AZ). Its siting rows (find_sites, analyze_site, site_selection_canvas, execute_plan steps, ...) still
// carry source_url / dcpi_url = https://dchub.cloud/dcpi/<slug> for those markets, and this server passed them on.
//
// This module is the ONE place the MCP server decides a DCPI market link. It rewrites every such link to the
// market's /markets/<slug> page (200 for every held market, and since be#9364 that page itself never links /dcpi
// for one). It changes links only: whether a held market's number or verdict is shown follows the owner's
// 2026-11-24 decision on MCP outputs (unchanged) and is not touched here.
//
// The held list is config/dcpi-hold.json, a copy of the backend's config/dcpi-hold.json (the one list; only
// Jonathan changes it). test/dcpi-hold-links.test.mjs pins the copy's shape; the matching rule mirrors
// util/dcpi_coverage.out_of_scope: the serving ISO, the state, or a name/slug naming a held ISO, a held state or
// that state's DCPI metro anchor. A missing or broken JSON keeps the hold (the backend's _FALLBACK), never lifts it.
//
// Kill switch: DCHUB_DCPI_HOLD_LINKS=0. PURE apart from reading the JSON once at load; never throws.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DCPI_MARKETS } from './dcpi-markets.data.mjs';

export const HOLD_PATH = fileURLToPath(new URL('../config/dcpi-hold.json', import.meta.url));
const FALLBACK = { hold_id: '117162', held_isos: ['ERCOT', 'MISO'], held_states: ['AZ'] };
// util/dcpi_coverage._STATE_NAMES: a state's full name and the metro DCPI anchors it on (facts about the state).
const STATE_NAMES = { AZ: ['ARIZONA', 'PHOENIX'] };

export function loadHold(path = HOLD_PATH) {
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('not an object');
    const norm = (a) => (Array.isArray(a) ? a : []).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    const held_isos = norm(cfg.held_isos);
    const held_states = norm(cfg.held_states);
    if (!held_isos.length && !held_states.length) throw new Error('empty hold');
    return { hold_id: String(cfg.hold_id || FALLBACK.hold_id), held_isos, held_states };
  } catch (_) {
    return { ...FALLBACK, held_isos: [...FALLBACK.held_isos], held_states: [...FALLBACK.held_states] };
  }
}

export function compileHold(cfg) {
  const isos = new Set(cfg.held_isos);
  const states = new Set(cfg.held_states);
  const words = cfg.held_isos.map((i) => i.toLowerCase());
  for (const st of cfg.held_states) {
    const names = STATE_NAMES[st] || [];
    if (names[0]) states.add(names[0]);
    for (const n of names) words.push(n.toLowerCase());
  }
  const uniq = [...new Set(words)];
  const nameRe = uniq.length ? new RegExp(uniq.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i') : null;
  const bySlug = new Map(DCPI_MARKETS.map(([slug, name, sts, iso, rto]) => [slug, { name, states: sts, iso, rto }]));
  return { isos, states, nameRe, bySlug };
}

let _HOLD = compileHold(loadHold());
export function _setHoldForTest(cfg) { _HOLD = compileHold(cfg || loadHold()); }

const up = (v) => String(v == null ? '' : v).trim().toUpperCase();

// util/dcpi_coverage.out_of_scope, plus the server's own market catalog for the slug's states and grid.
// ctx: { state, iso } read off the object the link sits in (a row the catalog does not know yet).
export function isHeldMarket(slug, ctx = {}, H = _HOLD) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return false;
  const row = H.bySlug.get(s);
  // A market the catalog knows is decided by its own row; the context (which may be inherited from an enclosing
  // object about another place) is consulted only for a slug the catalog does not know yet.
  const c = row ? {} : (ctx || {});
  const isosSeen = [c.iso, row && row.iso, row && row.rto];
  if (isosSeen.some((i) => i && H.isos.has(up(i)))) return true;
  const statesSeen = [c.state, ...((row && row.states) || [])];
  if (statesSeen.some((st) => st && H.states.has(up(st)))) return true;
  const text = [s, row && row.name, c.iso].filter(Boolean).join(' ');
  return !!(H.nameRe && H.nameRe.test(text));
}

// https://dchub.cloud/dcpi/<slug>[/sub/path] (any scheme, www or bare host). The query/fragment is left in place.
const DCPI_LINK = /((?:https?:\/\/)?(?:www\.)?dchub\.cloud)\/dcpi\/([a-z0-9][a-z0-9-]*)(\/[a-z0-9_\-./]*)?(?![a-z0-9-])/gi;

export function marketLinkFor(slug) { return `https://dchub.cloud/markets/${String(slug).toLowerCase()}`; }

export function rewriteText(text, held) {
  if (typeof text !== 'string' || text.indexOf('dchub.cloud/dcpi/') < 0) return text;
  return text.replace(DCPI_LINK, (m, host, slug) => {
    if (!held(slug)) return m;
    const h = /^https?:\/\//i.test(host) ? 'https://dchub.cloud' : 'dchub.cloud';
    return `${h}/markets/${slug.toLowerCase()}`;
  });
}

function ctxOf(obj, parent) {
  const pick = (o, k) => (o && typeof o === 'object' && typeof o[k] === 'string' ? o[k] : null);
  const st = pick(obj, 'state') || (Array.isArray(obj && obj.states) ? obj.states[0] : null);
  return {
    state: st && /^[A-Za-z]{2}$|^[A-Za-z ]{4,}$/.test(st) ? st : parent.state,
    iso: pick(obj, 'iso') || pick(obj, 'rto') || parent.iso,
  };
}

// Pass 1: slugs a row's own state/iso holds that the catalog does not know; these are rewritten in prose too.
function collectHeld(node, parent, out, depth, H) {
  if (depth > 40 || node == null) return;
  if (Array.isArray(node)) { for (const v of node) collectHeld(v, parent, out, depth + 1, H); return; }
  if (typeof node !== 'object') return;
  const ctx = ctxOf(node, parent);
  for (const v of Object.values(node)) {
    if (typeof v === 'string' && v.indexOf('dchub.cloud/dcpi/') >= 0) {
      for (const m of v.matchAll(DCPI_LINK)) if (isHeldMarket(m[2], ctx, H)) out.add(m[2].toLowerCase());
    } else if (v && typeof v === 'object') collectHeld(v, ctx, out, depth + 1, H);
  }
}

const TEMPLATE = /((?:https?:\/\/)?(?:www\.)?dchub\.cloud)\/dcpi\/(\{(?:market_)?slug\})/gi;
function rewriteTemplate(text) {
  if (typeof text !== 'string' || text.indexOf('dchub.cloud/dcpi/{') < 0) return text;
  return text.replace(TEMPLATE, (m, host, ph) => `${host}/markets/${ph}`);
}

// True when any market_slug / slug value in the answer is a held market.
function anyHeldSlug(node, held, depth = 0) {
  if (depth > 40 || node == null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((v) => anyHeldSlug(v, held, depth + 1));
  for (const [k, v] of Object.entries(node)) {
    if ((k === 'market_slug' || k === 'slug') && typeof v === 'string' && v && held(v)) return true;
    if (v && typeof v === 'object' && anyHeldSlug(v, held, depth + 1)) return true;
  }
  return false;
}

function rewriteNode(node, held, depth, template = false) {
  if (depth > 40 || node == null) return node;
  if (typeof node === 'string') return template ? rewriteTemplate(node) : rewriteText(node, held);
  if (Array.isArray(node)) {
    let changed = false;
    const out = node.map((v) => { const r = rewriteNode(v, held, depth + 1, template); if (r !== v) changed = true; return r; });
    return changed ? out : node;
  }
  if (typeof node !== 'object') return node;
  let out = null;
  for (const [k, v] of Object.entries(node)) {
    const r = rewriteNode(v, held, depth + 1, template);
    if (r !== v) { if (!out) out = { ...node }; out[k] = r; }
  }
  return out || node;
}

export function holdLinksOn(env = process.env) {
  return String((env && env.DCHUB_DCPI_HOLD_LINKS) ?? '').trim() !== '0';
}

// The step: every /dcpi/<held slug> link anywhere in a tool result (structuredContent, content[].text, nested
// execute_plan step bodies) becomes /markets/<slug>. Returns the same object when nothing changes.
export function withHeldDcpiLinks(result, { env = process.env, H = _HOLD } = {}) {
  try {
    if (!holdLinksOn(env) || result == null || typeof result !== 'object') return result;
    const extra = new Set();
    collectHeld(result, { state: null, iso: null }, extra, 0, H);
    const held = (slug) => extra.has(String(slug).toLowerCase()) || isHeldMarket(slug, {}, H);
    const out = rewriteNode(result, held, 0);
    // The backend's collection-level cite_url_template ("https://dchub.cloud/dcpi/{market_slug}", routes/provenance.py)
    // names no slug, so the agent fills it in. When the answer names a held market, the template points at
    // /markets/{market_slug} instead (a page every market has), so the filled-in link never 404s.
    return anyHeldSlug(out, held) ? rewriteNode(out, () => false, 0, true) : out;
  } catch (_) { return result; }
}
