// lib/email-entered.mjs — which wall led to each email entered (Grok -> Brain 2026-11-08, ask 3).
//
// A wall asks for an email (the grid/queue line, the rows ask, the email link) or offers the weekly
// digest. When the human then gives one, the agent calls bind_email, claim_free_key {email} or
// subscribe_digest, and until now the backend saw at most `X-DCHub-Via: mcp-wall` (lib/wall-via-tag.mjs):
// a channel, not the wall. So "which tool's ask works" could not be read.
//
// So: every quota_wall_hit this server sends notes the caller's last wall here (tool, wall status, the
// ask kind the walled response carried), keyed by transport session, by key (sha256, never the raw key)
// and by client IP (in memory only, never sent). A later successful email entry from the same caller
// sends ONE `email_entered` funnel event naming that wall, the entry path and which key matched.
//
//   * telemetry only: no response text changes, nothing subscribes anyone (subscribe_digest stays double
//     opt-in, bind_email's marketing_opt_in stays the caller's explicit choice);
//   * no email in the event: the backend stores the key as its pk-sha256 ref, like every funnel row;
//   * success only: a refused bind, a failed mint, a held-key claim (which binds nothing) or a digest
//     request the backend did not accept sends nothing;
//   * in memory per replica, 24 h: a deploy or a second replica loses a pending wall, so the event then
//     names no tool (tool '' = no wall seen), it never names a wrong one;
//   * kill switch DCHUB_EMAIL_ENTERED_EVENT=0 (read per call).
//
// Pure apart from the memo's own Map: no ctx, no network.
import { createHash } from 'node:crypto';

export const EMAIL_ENTRY_TOOLS = new Set(['bind_email', 'claim_free_key', 'subscribe_digest']);

export function emailEnteredEventOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_EMAIL_ENTERED_EVENT) || '').trim());
}

const _sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const _sid = (s) => { const v = typeof s === 'string' ? s.trim() : ''; return v && v !== 'no-session' ? v : ''; };

// The memo keys for one caller, most specific first: session, key, IP.
export function callerKeys(c) {
  const out = [];
  try {
    const s = _sid(c && c.session_id);
    if (s) out.push(['session', 's:' + s]);
    const k = c && typeof c.api_key === 'string' ? c.api_key.trim() : '';
    if (k) out.push(['key', 'k:' + _sha(k)]);
    const ip = c && typeof c.client_ip === 'string' ? c.client_ip.trim() : '';
    if (ip) out.push(['ip', 'ip:' + _sha(ip)]);
  } catch (_) { /* no keys: nothing is noted or matched */ }
  return out;
}

export function createLastWallMemo({ cap = 20000, ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const seen = new Map();   // memo key -> { tool, status, ask, at }
  return {
    // One wall for this caller, from the quota_wall_hit body it produced.
    note(c, body) {
      try {
        if (!body || body.event !== 'quota_wall_hit' || !body.tool) return false;
        const keys = callerKeys(c);
        if (!keys.length) return false;
        if (seen.size >= cap) seen.clear();
        const w = { tool: String(body.tool), status: String(body.wall_status || ''), ask: String(body.email_ask || ''), at: now() };
        for (const [, k] of keys) seen.set(k, w);
        return true;
      } catch (_) { return false; }
    },
    // The caller's last wall and the key that matched it, or null.
    get(c, extraKey = '') {
      try {
        const keys = callerKeys(c);
        const k2 = typeof extraKey === 'string' ? extraKey.trim() : '';
        if (k2) keys.splice(1, 0, ['key', 'k:' + _sha(k2)]);
        for (const [match, k] of keys) {
          const w = seen.get(k);
          if (!w) continue;
          if (now() - w.at > ttlMs) { seen.delete(k); continue; }
          return { ...w, match };
        }
        return null;
      } catch (_) { return null; }
    },
    size() { return seen.size; },
    clear() { seen.clear(); },
  };
}

function _parsedText(result) {
  try {
    const b = result && Array.isArray(result.content) ? result.content[0] : null;
    return b && typeof b.text === 'string' ? JSON.parse(b.text) : null;
  } catch (_) { return null; }
}

// Did this call enter an email successfully? Returns { path, apiKey } or null. apiKey is the key the
// email now sits on when the result names one (a keyless mint), else ''.
export function emailEntered(name, args, result) {
  try {
    if (!EMAIL_ENTRY_TOOLS.has(name) || !result || result.isError) return null;
    const email = args && typeof args.email === 'string' ? args.email.trim() : '';
    if (!email) return null;
    const sc = result.structuredContent && typeof result.structuredContent === 'object' ? result.structuredContent : {};
    const minted = typeof sc.api_key === 'string' ? sc.api_key : '';
    if (name === 'bind_email') {
      if (sc.bound === true) return { path: 'bind_email', apiKey: '' };
      // Keyless session: bind_email minted a key with the email bound (claim_free_key's path).
      if (sc.bind_email_path === 'keyless_mint_bind' && minted && _mintBound(sc)) return { path: 'bind_email', apiKey: minted };
      return null;
    }
    if (name === 'claim_free_key') return minted && _mintBound(sc) ? { path: 'claim_free_key', apiKey: minted } : null;
    // subscribe_digest relays the backend's JSON as its one text block.
    const r = _parsedText(result);
    return r && typeof r === 'object' && r.ok !== false && !r.error ? { path: 'subscribe_digest', apiKey: '' } : null;
  } catch (_) { return null; }
}
// A claim result that is a fresh mint carrying the email: not the held-key / already-held returns
// (they bind nothing) and not the bind gate (the identity still needs an email).
function _mintBound(sc) {
  return !sc.already_keyed && !sc.already_held && !sc.reused && sc.gate !== 'bind_email_required';
}

// The email_entered body for dchub-backend routes/mcp_funnel_events. wall null = no wall seen for this
// caller on this replica in 24 h (tool ''). The api key travels to the backend, which stores only its ref.
export function emailEnteredEventBody({ c = {}, path, wall = null, apiKey = '', isQa = false, platform = '' }) {
  return {
    event: 'email_entered',
    path: String(path || ''),
    tool: wall ? wall.tool : '',
    wall_status: wall ? wall.status : '',
    email_ask: wall ? wall.ask : '',
    match: wall ? wall.match : '',
    session_id: _sid(c.session_id),
    api_key: apiKey || c.api_key || '',
    platform: String(platform || c.platform || ''),
    user_agent: String(c.client_ua || c.user_agent || '').slice(0, 300),
    is_qa: !!isQa,
  };
}
