// lib/wall-connect-tag.mjs — a below-paid answer's /connect link says it came from an MCP wall (owner 2026-11-19,
// Grok CLI note 2026-11-18 item 4).
//
// Option A (owner 2026-11-16) points every keyless / free wall at the plain https://dchub.cloud/connect
// (lib/neutral-cta.mjs, lib/neutral-connect.mjs), in place of the tagged relay link. A human who followed it was
// counted on no channel: via_channels read 0 mcp-wall and 0 mcp visits for the 7 days to 2026-11-18.
//
// So every JSON string value that IS that URL (human_url, for_your_human.url, and the copies intent_answer /
// ranked_answer keep of it) becomes /connect?via=mcp-wall&wall=connect. /connect loads js/dchub-nav.js, whose beacon
// sends {via:'mcp-wall', wall:'connect'}; dchub-backend routes/via_funnel.py via_visit counts that one mcp-wall beacon
// (visit + wall:connect) and still refuses every other. Prose is never touched: "More detail is available at
// dchub.cloud/connect." stays as it is. Pure, no I/O. Kill switch DCHUB_WALL_CONNECT_TAG=0 (read per call).

import { splitLeadingJson } from './facility-location.mjs';

export const BARE_CONNECT_URL = 'https://dchub.cloud/connect';
export const WALL_CONNECT_URL = BARE_CONNECT_URL + '?via=mcp-wall&wall=connect';

export function wallConnectTagOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_CONNECT_TAG) || '').trim());
}

// v with every string value equal to the bare URL tagged; the same object (===) when nothing changed.
export function tagConnectValues(v, depth = 0) {
  if (v === BARE_CONNECT_URL) return WALL_CONNECT_URL;
  if (depth > 60 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => { const y = tagConnectValues(x, depth + 1); if (y !== x) changed = true; return y; });
    return changed ? out : v;
  }
  let out = null;
  for (const [k, x] of Object.entries(v)) {
    const y = tagConnectValues(x, depth + 1);
    if (y !== x) { if (!out) out = { ...v }; out[k] = y; }
  }
  return out || v;
}

// A tool result: structuredContent and each text block that is (or leads with) JSON.
export function wallConnectTagStep(result, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !wallConnectTagOn(env) || !result || !Array.isArray(result.content)) return result;
    let changed = false;
    const content = result.content.map((b) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string' || !b.text.includes('"' + BARE_CONNECT_URL + '"')) return b;
      const sp = splitLeadingJson(b.text);
      if (!sp || !sp.json || typeof sp.json !== 'object') return b;
      const j = tagConnectValues(sp.json);
      if (j === sp.json) return b;
      changed = true;
      return { ...b, text: sp.head + JSON.stringify(j) + sp.rest };
    });
    const sc = tagConnectValues(result.structuredContent);
    if (sc !== result.structuredContent) changed = true;
    if (!changed) return result;
    return { ...result, content, ...(result.structuredContent !== undefined ? { structuredContent: sc } : {}) };
  } catch (_) { return result; }   // a link tag never breaks a response
}
