// lib/wall-via-tag.mjs — a session that was handed a wall link credits its LATER claim / bind to mcp-wall
// (owner 2026-11-05, "ship ... MCP-side via tag").
//
// A wall hands the human a relay link tagged ?via=mcp-wall&wall=<type> (lib/wall-tag.mjs). A human who opens it
// is counted by the page (dchub-backend routes/via_funnel.py). But an agent that instead asks its human for an
// email and calls claim_free_key / bind_email reaches the backend from this server, with no browser cookie and
// (unless the connector URL said so) no via, so that unlock / key was counted on no channel at all.
//
// So: when a wall result in a transport session carries the wall link, the session is noted here; that
// session's later claim_free_key (POST /api/v1/keys/claim) and bind_email (POST /api/v1/keys/identify) send
// `X-DCHub-Via: mcp-wall`. The backend's after_request hook counts the `key` / `unlock` stage for the channel
// that header names (via_funnel.channel_from_request reads the header first; both paths are in _HOOKED).
// The wall TYPE is not sent: the backend reads it only from the /via/visit beacon body.
//
//   * explicit wins: a connector URL that declared any via keeps it (this never overrides it);
//   * a session that saw no wall link sends nothing; a call with no transport session id sends nothing;
//   * QA callers and the relay-readout exclusions (server.mjs) are never noted;
//   * kill switch DCHUB_WALL_VIA_TAG=0 (read per call).
//
// Pure apart from the memo's own Map: no ctx, no network.

export const WALL_VIA_CHANNEL = 'mcp-wall';

export function wallViaTagOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_VIA_TAG) || '').trim());
}

// The wall link a result hands out: structuredContent.human_url, a /u/ short link or a long /upgrade/h/ relay.
const WALL_LINK_RE = /^https:\/\/dchub\.cloud\/(?:u|upgrade\/h)\/[A-Za-z0-9_.-]+/;
export function wallLinkIssued(result) {
  try {
    const sc = result && result.structuredContent;
    const hu = sc && typeof sc === 'object' ? sc.human_url : null;
    return typeof hu === 'string' && WALL_LINK_RE.test(hu);
  } catch (_) { return false; }
}

// A real transport session id ('no-session' is the shared literal for "none").
export function usableSessionId(sid) {
  const s = typeof sid === 'string' ? sid.trim() : '';
  return s && s !== 'no-session' ? s : '';
}

export function createWallViaMemo({ cap = 20000, ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const seen = new Map();   // session id -> { wall, at }
  return {
    note(sid, wall) {
      try {
        const s = usableSessionId(sid);
        if (!s) return false;
        if (seen.size >= cap && !seen.has(s)) seen.clear();
        seen.set(s, { wall: String(wall || ''), at: now() });
        return true;
      } catch (_) { return false; }
    },
    get(sid) {
      try {
        const s = usableSessionId(sid);
        const m = s ? seen.get(s) : null;
        if (!m) return null;
        if (now() - m.at > ttlMs) { seen.delete(s); return null; }
        return m;
      } catch (_) { return null; }
    },
    size() { return seen.size; },
    clear() { seen.clear(); },
  };
}

// The X-DCHub-Via value for one claim / bind call, or null. `explicitVia` is whatever via the request
// itself declared (server.mjs getVia()); any value there wins, so this only fills a gap.
export function wallViaHeaderFor({ on = true, explicitVia = null, qa = false, sawWall = false } = {}) {
  if (!on || qa || !sawWall) return null;
  if (explicitVia) return null;
  return WALL_VIA_CHANNEL;
}
