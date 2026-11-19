// lib/wall-connect-tag.mjs — a walled answer's /connect link says where the click came from (Grok CLI note
// 2026-11-18, item 4).
//
// Option A (owner 2026-11-16) points every keyless wall at the bare https://dchub.cloud/connect (lib/neutral-cta.mjs,
// lib/neutral-connect.mjs), which replaced the tagged relay link. A human who followed it was counted on no channel:
// via_channels showed 0 mcp-wall and 0 mcp visits for the 7 days to 2026-11-18.
//
// So the LINK FIELDS only (human_url, for_your_human.url) become /connect?via=agent-referral&src=wall. Not mcp-wall:
// the backend counts mcp-wall only from a signed relay open and drops it from the page beacon on purpose (dchub-backend
// routes/via_funnel.py via_visit, 2026-11-08: forged beacons). agent-referral is the channel for "a link an MCP answer
// itself puts in front of the human", counted by /connect's own beacon (js/dchub-nav.js); `wall` joins its closed src
// set (dchub-backend AGENT_REFERRAL_SRCS, same change). Prose is never touched: "More detail is available at
// dchub.cloud/connect." stays as it is. Pure, no I/O. Kill switch DCHUB_WALL_CONNECT_TAG=0 (read per call).

import { splitLeadingJson } from './facility-location.mjs';

export const BARE_CONNECT_URL = 'https://dchub.cloud/connect';
export const WALL_CONNECT_URL = BARE_CONNECT_URL + '?via=agent-referral&src=wall';

export function wallConnectTagOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_CONNECT_TAG) || '').trim());
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The object with its top-level link fields tagged, or the same object when neither is the bare /connect.
export function tagConnectFields(o) {
  if (!isObj(o)) return o;
  let out = o;
  if (o.human_url === BARE_CONNECT_URL) out = { ...out, human_url: WALL_CONNECT_URL };
  if (isObj(o.for_your_human) && o.for_your_human.url === BARE_CONNECT_URL) {
    out = { ...out, for_your_human: { ...o.for_your_human, url: WALL_CONNECT_URL } };
  }
  return out;
}

// A tool result: structuredContent and each text block that is (or leads with) a JSON object.
export function wallConnectTagStep(result, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !wallConnectTagOn(env) || !result || !Array.isArray(result.content)) return result;
    let changed = false;
    const content = result.content.map((b) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') return b;
      const sp = splitLeadingJson(b.text);
      if (!sp || !isObj(sp.json)) return b;
      const j = tagConnectFields(sp.json);
      if (j === sp.json) return b;
      changed = true;
      return { ...b, text: sp.head + JSON.stringify(j) + sp.rest };
    });
    const sc = tagConnectFields(result.structuredContent);
    if (sc !== result.structuredContent) changed = true;
    if (!changed) return result;
    return { ...result, content, ...(result.structuredContent !== undefined ? { structuredContent: sc } : {}) };
  } catch (_) { return result; }   // a link tag never breaks a response
}
