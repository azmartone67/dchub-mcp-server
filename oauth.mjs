// oauth.mjs — DC Hub MCP OAuth 2.1 Authorization Server (Phase 1, DORMANT).
// =====================================================================
// The durable-identity fix for hosted web connectors (Claude.ai web) that
// can't persist an X-API-Key header. RFC 9728 (protected-resource metadata)
// + RFC 8414 (AS metadata) + RFC 7591 (dynamic client registration) +
// OAuth 2.1 authorization-code with mandatory PKCE S256.
//
// ── DORMANCY CONTRACT (the safety guarantee for shipping this in-repo) ──
// Every route AND token resolution checks oauthEnabled() (env
// DCHUB_OAUTH_ENABLED, default OFF) as its FIRST action. When OFF:
//   • every /oauth/* and /.well-known/oauth-* route returns 404 (as if absent)
//   • resolveOAuthToken() returns null → a Bearer header falls through to the
//     existing X-API-Key path, unchanged
// → live behavior is byte-identical to a build WITHOUT this module. The CF
// worker also 404s these paths today, so there are TWO independent guards.
// Arm (P3) only AFTER: the CF worker routes these paths to the gateway, the
// stores move to the backend (P2 — these in-memory maps die on restart), and
// a security review of the armed flow. Header/X-API-Key auth stays in parallel
// (OAuth is ADDITIVE, never a replacement).
//
// Conservative by construction: PKCE S256 ONLY (no 'plain'), exact pre-
// registered redirect_uri match (no open redirect), single-use short-TTL
// codes burned on any failure, opaque random tokens, constant-time PKCE compare.

import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function oauthEnabled() {
  const v = String(process.env.DCHUB_OAUTH_ENABLED || '').toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

// ── in-memory stores (P1; P2 moves to backend tables for durability) ──
const _clients = new Map();   // client_id  -> { redirect_uris:Set<string>, created }
const _codes   = new Map();   // code        -> { client_id, redirect_uri, challenge, expires, used }
const _tokens  = new Map();   // access_token-> { api_key, tier, client_id, expires }

const CODE_TTL_MS = 60_000;   // 60s authorization-code lifetime (RFC: short)
const TOKEN_TTL_S = 3600;     // 1h access-token lifetime

// P1 caps + lazy eviction (security review M1/G2): bound every map so an
// attacker can't OOM the single backend replica once armed. No background
// timer (keeps tests deterministic) — expired entries are swept and the oldest
// is evicted on each write. (P2/P3 add real rate-limiting; see review M2.)
const MAX_CLIENTS = 5000, MAX_CODES = 5000, MAX_TOKENS = 20000;
function _sweepExpired(map) {
  const now = Date.now();
  for (const [k, v] of map) if (v && v.expires && v.expires < now) map.delete(k);
}
function _capInsert(map, key, val, max) {
  if (map.size >= max) { const oldest = map.keys().next().value; if (oldest !== undefined) map.delete(oldest); }
  map.set(key, val);
}

// Rate limiter (security review M2): per-IP fixed-window counters so an ARMED
// AS can't be used to hammer the backend key-mint (the /token success path
// mints a dev key per exchange) or OOM via /register|/authorize spam. In-memory
// + bounded (limiter state is soft and self-heals on restart). No-op when
// dormant (the guard short-circuits before touching state).
const _rl = new Map();              // `${ip}|${bucket}` -> { count, resetAt }
const RL_MAX_KEYS = 50_000;
const RL_WINDOW_MS = 10 * 60_000;   // 10-minute window
function _clientIp(req) {
  return ((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim()
      || (req.socket && req.socket.remoteAddress) || 'unknown';
}
// Returns null if allowed, else seconds until the window resets.
function _rateLimited(req, bucket, max) {
  const key = _clientIp(req) + '|' + bucket;
  const now = Date.now();
  let e = _rl.get(key);
  if (!e || e.resetAt <= now) {
    if (_rl.size >= RL_MAX_KEYS) _rl.clear();   // hard bound (coarse, soft state)
    e = { count: 0, resetAt: now + RL_WINDOW_MS };
    _rl.set(key, e);
  }
  e.count += 1;
  return e.count > max ? Math.ceil((e.resetAt - now) / 1000) : null;
}
function _rlGuard(bucket, max) {
  return (req, res, next) => {
    if (!oauthEnabled()) return next();         // dormant: never touch state
    const retry = _rateLimited(req, bucket, max);
    if (retry != null) {
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'rate_limited', error_description: 'too many requests', retry_after: retry });
    }
    next();
  };
}

function _b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _rand(n = 32) { return _b64url(randomBytes(n)); }

// PKCE S256: BASE64URL(SHA256(verifier)) === challenge, constant-time.
export function verifyPkceS256(verifier, challenge) {
  if (typeof verifier !== 'string' || typeof challenge !== 'string') return false;
  if (verifier.length < 43 || verifier.length > 128) return false;          // RFC 7636 §4.1
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;                   // unreserved only
  const computed = _b64url(createHash('sha256').update(verifier).digest());
  const a = Buffer.from(computed), b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

// Resolve a Bearer token to its bound identity, or null (flag off / unknown /
// expired). Null = caller falls back to the X-API-Key path (dormant-safe).
export function resolveOAuthToken(token) {
  if (!oauthEnabled() || !token || typeof token !== 'string') return null;
  const t = _tokens.get(token);
  if (!t) return null;
  if (t.expires < Date.now()) { _tokens.delete(token); return null; }
  return { api_key: t.api_key, tier: t.tier };
}

function _validRedirect(client, uri) {
  return !!client && typeof uri === 'string' && client.redirect_uris.has(uri);
}

// registerOAuthRoutes(app, { issuer, mintIdentity })
//   issuer       : public base URL, e.g. 'https://dchub.cloud'
//   mintIdentity : async () => ({ api_key, tier }) — binds the OAuth subject to
//                  a durable dev key (server.mjs wires this to the backend claim;
//                  tests inject a stub). Called once per successful code exchange.
export function registerOAuthRoutes(app, opts = {}) {
  const issuer = (opts.issuer || 'https://dchub.cloud').replace(/\/$/, '');
  const mintIdentity = opts.mintIdentity || (async () => ({ api_key: null, tier: 'free' }));
  const off = (res) => res.status(404).json({ error: 'not_found' });
  const form = express.urlencoded({ extended: false });  // OAuth token endpoint is form-encoded

  // ── RFC 9728 — protected-resource metadata (path-suffixed for /mcp) ──
  const prm = (_req, res) => {
    if (!oauthEnabled()) return off(res);
    res.json({
      resource: issuer + '/mcp',
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
      resource_documentation: issuer + '/playground',
    });
  };
  app.get('/.well-known/oauth-protected-resource', prm);
  app.get('/.well-known/oauth-protected-resource/mcp', prm);

  // ── RFC 8414 — authorization-server metadata ──
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    if (!oauthEnabled()) return off(res);
    res.json({
      issuer,
      authorization_endpoint: issuer + '/oauth/authorize',
      token_endpoint:         issuer + '/oauth/token',
      registration_endpoint:  issuer + '/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported:    ['authorization_code'],     // refresh is P2
      code_challenge_methods_supported: ['S256'],            // PKCE S256 ONLY
      token_endpoint_auth_methods_supported: ['none'],       // public clients
      scopes_supported: ['mcp'],
    });
  });

  // ── RFC 7591 — dynamic client registration (public, PKCE) ──
  app.post('/oauth/register', _rlGuard('reg', 20), (req, res) => {
    if (!oauthEnabled()) return off(res);
    const body = req.body || {};
    const uris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
    if (!uris.length) {
      return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris required' });
    }
    for (const u of uris) {
      let ok = false;
      try {
        const p = new URL(u);
        ok = p.protocol === 'https:' || p.hostname === 'localhost' || p.hostname === '127.0.0.1';
      } catch { ok = false; }
      if (!ok) return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https (or localhost)' });
    }
    const client_id = 'dchc_' + _rand(18);
    _capInsert(_clients, client_id, { redirect_uris: new Set(uris), created: Date.now() }, MAX_CLIENTS);
    res.status(201).json({
      client_id,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  });

  // ── OAuth 2.1 authorization endpoint (PKCE required) ──
  app.get('/oauth/authorize', _rlGuard('authz', 60), (req, res) => {
    if (!oauthEnabled()) return off(res);
    const q = req.query || {};
    const client = _clients.get(String(q.client_id || ''));
    const redirect_uri = String(q.redirect_uri || '');
    // redirect_uri MUST be pre-registered — validate BEFORE any redirect so we
    // never bounce an error to an attacker-controlled URI (no open redirect).
    if (!_validRedirect(client, redirect_uri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'unknown client_id or unregistered redirect_uri' });
    }
    const ru = new URL(redirect_uri);
    const state = q.state != null ? String(q.state) : null;
    const fail = (error, desc) => {
      ru.searchParams.set('error', error);
      if (desc) ru.searchParams.set('error_description', desc);
      if (state != null) ru.searchParams.set('state', state);
      return res.redirect(302, ru.toString());
    };
    if (String(q.response_type) !== 'code')          return fail('unsupported_response_type');
    if (String(q.code_challenge_method) !== 'S256')  return fail('invalid_request', 'PKCE S256 required');
    const challenge = String(q.code_challenge || '');
    if (challenge.length < 43 || challenge.length > 128) return fail('invalid_request', 'code_challenge required (S256)');
    // P1: auto-approve (no consent UI — P2 adds it). Issue a single-use code.
    _sweepExpired(_codes);
    const code = _rand(24);
    _capInsert(_codes, code, {
      client_id: String(q.client_id),
      redirect_uri,
      challenge,
      expires: Date.now() + CODE_TTL_MS,
      used: false,
    }, MAX_CODES);
    ru.searchParams.set('code', code);
    if (state != null) ru.searchParams.set('state', state);
    return res.redirect(302, ru.toString());
  });

  // ── OAuth 2.1 token endpoint (authorization_code + PKCE) ──
  app.post('/oauth/token', _rlGuard('token', 60), form, async (req, res) => {
    if (!oauthEnabled()) return off(res);
    res.set('Cache-Control', 'no-store');
    const b = req.body || {};
    if (String(b.grant_type) !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }
    const codeKey = String(b.code || '');
    const rec = _codes.get(codeKey);
    if (!rec || rec.used || rec.expires < Date.now()) {
      if (rec) _codes.delete(codeKey);               // burn on any failure
      return res.status(400).json({ error: 'invalid_grant', error_description: 'code invalid/expired/used' });
    }
    // The code is bound to the client_id + redirect_uri from /authorize.
    if (rec.client_id !== String(b.client_id || '') || rec.redirect_uri !== String(b.redirect_uri || '')) {
      _codes.delete(codeKey);
      return res.status(400).json({ error: 'invalid_grant', error_description: 'client/redirect mismatch' });
    }
    if (!verifyPkceS256(String(b.code_verifier || ''), rec.challenge)) {
      _codes.delete(codeKey);
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }
    _codes.delete(codeKey);                            // single-use: consume now

    let identity = null;
    try { identity = await mintIdentity(); } catch { identity = null; }
    // C3 (review): never issue a HOLLOW token. The code is already consumed
    // (single-use), so on a binding failure the client must re-authorize —
    // better than a 200 token that silently resolves to anonymous forever.
    if (!identity || !identity.api_key) {
      return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'identity binding failed; please retry the authorization' });
    }
    _sweepExpired(_tokens);
    const access_token = 'dcht_' + _rand(32);
    _capInsert(_tokens, access_token, {
      api_key: identity.api_key,
      tier:    identity.tier || 'free',
      client_id: rec.client_id,
      expires: Date.now() + TOKEN_TTL_S * 1000,
    }, MAX_TOKENS);
    return res.json({ access_token, token_type: 'Bearer', expires_in: TOKEN_TTL_S, scope: 'mcp' });
  });
}

// Test-only hooks (never used by production paths).
export const __test = { _clients, _codes, _tokens, _rl, _b64url, _rand, CODE_TTL_MS, TOKEN_TTL_S };
