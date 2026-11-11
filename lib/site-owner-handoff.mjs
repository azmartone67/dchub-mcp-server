// lib/site-owner-handoff.mjs — a next step for the human who OWNS the site (owner 2026-11-10, "build 1 and 2").
//
// analyze_site is DC Hub's largest paid-tool demand: 1,796 calls from 1,107 users in 30 days
// (/api/v1/mcp/funnel paid_tool_demand_30d, read 2026-11-10), next tool compare_sites at 12 users. Many of
// those callers are landowners and developers asking "does my site work?". Every answer offered them one
// thing, the email unlock of the full report; nothing told them DC Hub can help bring a good site to market.
//
// So a point-level analyze_site / analyze_parcel answer whose site band is BUILD or CAUTION carries one line,
// once per caller per day: if the human owns or controls the site, list it free on Capacity Source, or ask
// Martone Advisors (the advisory firm behind DC Hub, disclosed as such) for a review. The wording is the
// owner-approved sellers program copy the backend already serves on GET /api/v1/listings (program.sellers,
// be#8652), without the fee figure: agent-facing text names no price (owner rule 2026-10-10).
//
//   * additive: never removes or reorders anything, never fires on a failure, an AVOID or unrated site, a
//     market-level call (location=<market>), or a relay wall (a wall carries ONE link, _oneLinkWallStep);
//     the line itself tells a buyer to skip it;
//   * the same profiles and platforms the Capacity Source pointer skips are skipped by the caller;
//   * kill switch DCHUB_SITE_OWNER_HANDOFF=0 (read per call).
//
// Pure apart from the memo's own Map: no ctx, no network.
import { callerKeys } from './email-entered.mjs';
import { scoreBand } from './paywall-contract.mjs';

export const SITE_OWNER_TOOLS = new Set(['analyze_site', 'analyze_parcel']);
export const SITE_OWNER_KEY = 'site_owner';
const BANDS = new Set(['BUILD', 'CAUTION']);
const UTM = 'utm_source=dchub-mcp&utm_medium=site_owner';

export function siteOwnerHandoffOn(env = process.env) {
  return !/^(0|false|no|off|disabled)$/i.test(String((env && env.DCHUB_SITE_OWNER_HANDOFF) || '').trim());
}

// A point-level call: coordinates or a frozen candidate. A market name (analyze_site location=dallas) scores a
// market centroid, which nobody owns.
export function isPointCall(name, args) {
  const a = (args && typeof args === 'object') ? args : {};
  if (name === 'analyze_parcel') return true;
  if (typeof a.candidate_id === 'string' && a.candidate_id.trim()) return true;
  const lat = a.lat ?? a.latitude;
  const lon = a.lon ?? a.lng ?? a.longitude;
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && lat !== null && lon !== null && lat !== '' && lon !== '';
}

function _parsedText(result) {
  try {
    const t = result && Array.isArray(result.content) && result.content[0] && result.content[0].text;
    if (typeof t !== 'string' || t.length > 2_000_000 || !t.trimStart().startsWith('{')) return null;
    return JSON.parse(t);
  } catch (_) { return null; }
}

// The site band the answer itself printed: the keyed headline, the keyless teaser, or the preview bands.
// A full report prints no verdict word, only overall_score (read live 2026-11-11: keyed analyze_site carries
// interpretation + overall_score, no verdict), so it is banded the way the teaser bands it (_siteTeaser).
export function siteBand(result) {
  const reads = [result && result.structuredContent, _parsedText(result)];
  for (const o of reads) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    for (const v of [o.verdict, o.site_teaser && o.site_teaser.verdict, o.preview_bands && o.preview_bands.verdict]) {
      const b = String(v || '').trim().toUpperCase();
      if (b === 'AVOID') return 'AVOID';
      if (BANDS.has(b)) return b;
    }
  }
  for (const o of reads) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.success === false) continue;
    const n = o.overall_score;
    const b = scoreBand(typeof n === 'number' ? n : (typeof n === 'string' && n.trim() !== '' ? Number(n) : NaN));
    if (b) return b;
  }
  return null;
}

// The /listings short form fills itself from these URL parameters (dchub-frontend js/listings.js, LINK PREFILL),
// so an agent that already knows the site from the conversation can hand its human a filled-in form. The human
// still checks it, signs in, accepts the terms and submits. Email and data-room links are never URL parameters.
export const LISTING_PREFILL_PARAMS = {
  company: 'company or developer name',
  city: 'city',
  state: 'state or region, e.g. SD',
  country: 'two-letter code, e.g. US',
  mw: 'MW available, a number',
  available: 'available from, YYYY-MM',
  utility: 'serving utility',
  type: 'land | powered_shell | turnkey | colocation',
};

// The MW the caller asked about (analyze_site capacity_mw), when it is a usable listing size.
function _argMw(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const x = Number(a.capacity_mw ?? a.mw);
  return a.capacity_mw !== null && a.capacity_mw !== '' && Number.isFinite(x) && x > 0 && x <= 10000 ? x : null;
}

export function siteOwnerBlock(tool, args) {
  const campaign = '&utm_campaign=' + encodeURIComponent(tool || 'analyze_site');
  const mw = _argMw(args);
  return {
    applies_if: 'your human owns or controls this site (skip it if they are screening sites to buy or lease)',
    list_free: {
      what: 'List it on DC Hub Capacity Source, where buyers and tenants search by size and location. Free to list; a fee only if a deal closes.',
      url: 'https://dchub.cloud/listings?' + UTM + campaign + (mw !== null ? '&mw=' + mw : '') + '#list-capacity',
      prefill: {
        how: 'Add what your human already told you as URL parameters before #list-capacity; the form opens filled in and they check it and submit. Leave out anything you do not know.',
        params: { ...LISTING_PREFILL_PARAMS },
      },
    },
    advisory: {
      name: 'Martone Advisors',
      what: 'Markets powered land and data center sites to buyers, tenants and capital partners.',
      url: 'https://dchub.cloud/advisory?' + UTM + campaign,
      disclosure: 'Martone Advisors is the advisory firm behind DC Hub, led by its founder.',
    },
  };
}

export function siteOwnerLine(block) {
  return '**If your human owns or controls this site:** DC Hub can help bring it to market. '
    + 'List it free on Capacity Source (a fee only if a deal closes): ' + block.list_free.url
    + ' · or ask Martone Advisors, the advisory firm behind DC Hub, which markets powered land to buyers, tenants and capital partners: ' + block.advisory.url
    + '. You can fill the listing form in for them: add company, city, state, mw, available (YYYY-MM), utility'
    + ' and type (land, powered_shell, turnkey or colocation) to that link as URL parameters, then they check it and submit.'
    + ' Skip this if your human is screening sites to buy or lease.';
}

// Once per caller (session, else key, else IP) per day, so an agent scoring twenty sites hears it once.
export function createSiteOwnerMemo({ cap = 20000, ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const seen = new Map();
  return {
    // true the first time this caller is seen in the window (and marks it); false after that.
    first(c) {
      try {
        const keys = callerKeys(c);
        if (!keys.length) return true;   // nobody to remember: each call stands alone
        const t = now();
        for (const [, k] of keys) {
          const at = seen.get(k);
          if (at !== undefined && t - at <= ttlMs) return false;
        }
        if (seen.size >= cap) seen.clear();
        for (const [, k] of keys) seen.set(k, t);
        return true;
      } catch (_) { return false; }
    },
    size() { return seen.size; },
    clear() { seen.clear(); },
  };
}
