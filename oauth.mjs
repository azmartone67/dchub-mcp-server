// oauth.mjs — DC Hub MCP OAuth 2.1 Authorization Server (Phase 2, DORMANT).
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
//     existing X-API-Key path, unchanged (and makes ZERO backend calls)
// → live behavior is byte-identical to a build WITHOUT this module. The CF
// worker also 404s these paths today, so there are TWO independent guards.
//
// ── P2 (durable store) ──
// Clients / authorization-codes / access-tokens persist through a `store`
// adapter (server.mjs wires it to the backend oauth_store endpoints; tests use
// the default in-memory adapter). So the AS survives a gateway restart instead
// of mass-logging-out on every redeploy. Authorization codes are consumed
// ATOMICALLY (store.consume → DELETE…RETURNING) so a code can't be replayed
// even across gateway replicas. resolveOAuthToken keeps a warm in-process token
// cache over the store so the hot /mcp path never adds a per-request DB call
// (only a 'dcht_'-prefixed Bearer on a cache miss hits the store, once, then
// it's cached). Arm (P3) only AFTER the CF worker routes these paths + review.
//
// Conservative by construction: PKCE S256 ONLY (no 'plain'), exact pre-
// registered redirect_uri match (no open redirect), single-use short-TTL codes,
// opaque random tokens, constant-time PKCE compare.

import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function oauthEnabled() {
  const v = String(process.env.DCHUB_OAUTH_ENABLED || '').toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

const TOKEN_PREFIX = 'dcht_';   // hot-path gate: only our tokens trigger a store lookup
const CODE_TTL_S   = 60;        // 60s authorization-code lifetime (RFC: short)
const TOKEN_TTL_S  = 3600;      // 1h access-token lifetime
const TOKEN_CACHE_MS = 300_000; // warm-cache a store-resolved token ≤5 min (bounds staleness)

// ── in-memory maps: the DEFAULT store (tests) + the warm token cache (prod) ──
const _clients = new Map();   // client_id   -> { redirect_uris:[...], expires? }
const _codes   = new Map();   // code        -> { client_id, redirect_uri, challenge, expires }
const _tokens  = new Map();   // access_token-> { api_key, tier, client_id, expires }

// Caps + lazy eviction (review M1/G2): bound every map so an attacker can't OOM
// the single backend replica once armed. No background timer (deterministic for
// tests) — expired entries swept + oldest evicted on each write.
const MAX_CLIENTS = 5000, MAX_CODES = 5000, MAX_TOKENS = 20000;
function _sweepExpired(map) {
  const now = Date.now();
  for (const [k, v] of map) if (v && v.expires && v.expires < now) map.delete(k);
}
function _capInsert(map, key, val, max) {
  if (map.size >= max) { const oldest = map.keys().next().value; if (oldest !== undefined) map.delete(oldest); }
  map.set(key, val);
}

// Default in-memory store adapter. The maps above ARE this store; prod passes a
// backend-backed adapter with the same {put,get,consume} shape. Single-thread
// JS → consume()'s get-then-delete is atomic enough for the in-memory case;
// the backend adapter gets real atomicity via DELETE…RETURNING.
function _memStore() {
  const mapFor = (k) => k === 'client' ? _clients : k === 'code' ? _codes : _tokens;
  const maxFor = (k) => k === 'client' ? MAX_CLIENTS : k === 'code' ? MAX_CODES : MAX_TOKENS;
  return {
    async put(kind, key, data, ttlS) {
      const rec = { ...data };
      if (ttlS) rec.expires = Date.now() + ttlS * 1000;
      const m = mapFor(kind); _sweepExpired(m); _capInsert(m, key, rec, maxFor(kind));
    },
    async get(kind, key) {
      const m = mapFor(kind); const rec = m.get(key);
      if (!rec) return null;
      if (rec.expires && rec.expires < Date.now()) { m.delete(key); return null; }
      return rec;
    },
    async consume(kind, key) {
      const m = mapFor(kind); const rec = m.get(key);
      if (!rec) return null;
      m.delete(key);
      if (rec.expires && rec.expires < Date.now()) return null;
      return rec;
    },
  };
}

// The active store for the standalone resolveOAuthToken() export. Set by
// registerOAuthRoutes(); defaults to in-memory so resolve never throws.
let _activeStore = null;
function _store() { return _activeStore || (_activeStore = _memStore()); }

// Rate limiter (review M2): per-IP fixed-window counters so an ARMED AS can't be
// used to hammer the backend key-mint (the /token success path mints a dev key
// per exchange) or OOM via /register|/authorize spam. In-memory + bounded.
// No-op when dormant (guard short-circuits before touching state).
const _rl = new Map();
const RL_MAX_KEYS = 50_000;
const RL_WINDOW_MS = 10 * 60_000;
function _clientIp(req) {
  return ((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim()
      || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function _rateLimited(req, bucket, max) {
  const key = _clientIp(req) + '|' + bucket;
  const now = Date.now();
  let e = _rl.get(key);
  if (!e || e.resetAt <= now) {
    if (_rl.size >= RL_MAX_KEYS) _rl.clear();
    e = { count: 0, resetAt: now + RL_WINDOW_MS };
    _rl.set(key, e);
  }
  e.count += 1;
  return e.count > max ? Math.ceil((e.resetAt - now) / 1000) : null;
}
function _rlGuard(bucket, max) {
  return (req, res, next) => {
    if (!oauthEnabled()) return next();
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

// Resolve a Bearer to its bound identity, or null. ASYNC (P2): on a warm-cache
// miss it reads the durable store. Null when: flag off, not a 'dcht_' token
// (→ caller falls back to X-API-Key — the hot path for normal keys never hits
// the store), unknown, or expired. Dormant-safe + dormant makes ZERO store calls.
export async function resolveOAuthToken(token) {
  if (!oauthEnabled() || !token || typeof token !== 'string') return null;
  if (!token.startsWith(TOKEN_PREFIX)) return null;           // not our token → fall through, no store call
  const cached = _tokens.get(token);                          // warm cache (fast path)
  if (cached) {
    if (!cached.expires || cached.expires >= Date.now()) return { api_key: cached.api_key, tier: cached.tier };
    _tokens.delete(token);
  }
  let rec = null;
  try { rec = await _store().get('token', token); } catch { rec = null; }
  if (!rec || !rec.api_key) return null;
  // warm the cache (bounded: ≤5 min, or the rec's own expiry if sooner)
  const exp = rec.expires && rec.expires < Date.now() + TOKEN_CACHE_MS ? rec.expires : Date.now() + TOKEN_CACHE_MS;
  _capInsert(_tokens, token, { api_key: rec.api_key, tier: rec.tier, client_id: rec.client_id, expires: exp }, MAX_TOKENS);
  return { api_key: rec.api_key, tier: rec.tier };
}

function _validRedirect(client, uri) {
  return !!client && Array.isArray(client.redirect_uris)
      && typeof uri === 'string' && client.redirect_uris.includes(uri);
}

// registerOAuthRoutes(app, { issuer, mintIdentity, store })
//   issuer       : public base URL, e.g. 'https://dchub.cloud'
//   mintIdentity : async () => ({ api_key, tier }) — binds the OAuth subject to
//                  a durable dev key (server.mjs wires this to the backend claim).
//   store        : optional {put,get,consume} durable adapter (default: in-memory).
export function registerOAuthRoutes(app, opts = {}) {
  const issuer = (opts.issuer || 'https://dchub.cloud').replace(/\/$/, '');
  const mintIdentity = opts.mintIdentity || (async () => ({ api_key: null, tier: 'free' }));
  const store = opts.store || _memStore();
  _activeStore = store;   // resolveOAuthToken() reads the same store
  const off = (res) => res.status(404).json({ error: 'not_found' });
  const form = express.urlencoded({ extended: false });

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
      grant_types_supported:    ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    });
  });

  // ── RFC 7591 — dynamic client registration (public, PKCE) ──
  app.post('/oauth/register', _rlGuard('reg', 20), async (req, res) => {
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
    try {
      await store.put('client', client_id, { redirect_uris: uris, created: Date.now() }, 0);
    } catch {
      return res.status(503).json({ error: 'temporarily_unavailable' });
    }
    res.status(201).json({
      client_id,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  });

  // ── OAuth 2.1 authorization endpoint (PKCE required) ──
  app.get('/oauth/authorize', _rlGuard('authz', 60), async (req, res) => {
    if (!oauthEnabled()) return off(res);
    const q = req.query || {};
    const redirect_uri = String(q.redirect_uri || '');
    let client = null;
    try { client = await store.get('client', String(q.client_id || '')); } catch { client = null; }
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
    // P2: auto-approve (no consent UI yet). Issue a single-use code into the store.
    const code = _rand(24);
    try {
      await store.put('code', code, { client_id: String(q.client_id), redirect_uri, challenge }, CODE_TTL_S);
    } catch {
      return fail('temporarily_unavailable');
    }
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
    // ATOMIC single-use: consume the code (DELETE…RETURNING at the backend, or
    // get-then-delete in-memory). Any exchange attempt burns it — a wrong PKCE
    // verifier can't be retried with a guessed one.
    let rec = null;
    try { rec = await store.consume('code', String(b.code || '')); } catch { rec = null; }
    if (!rec) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'code invalid/expired/used' });
    }
    if (rec.client_id !== String(b.client_id || '') || rec.redirect_uri !== String(b.redirect_uri || '')) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'client/redirect mismatch' });
    }
    if (!verifyPkceS256(String(b.code_verifier || ''), rec.challenge)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }
    let identity = null;
    try { identity = await mintIdentity(); } catch { identity = null; }
    // C3 (review): never issue a HOLLOW token. The code is already consumed, so
    // on a binding failure the client must re-authorize.
    if (!identity || !identity.api_key) {
      return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'identity binding failed; please retry the authorization' });
    }
    const access_token = TOKEN_PREFIX + _rand(32);
    const tokenRec = { api_key: identity.api_key, tier: identity.tier || 'free', client_id: rec.client_id };
    try {
      await store.put('token', access_token, tokenRec, TOKEN_TTL_S);
    } catch {
      return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'could not persist token; please retry' });
    }
    // warm the in-process cache so the agent's very next /mcp call is fast
    _capInsert(_tokens, access_token, { ...tokenRec, expires: Date.now() + TOKEN_TTL_S * 1000 }, MAX_TOKENS);
    return res.json({ access_token, token_type: 'Bearer', expires_in: TOKEN_TTL_S, scope: 'mcp' });
  });
}

// Test-only hooks (never used by production paths).
export const __test = { _clients, _codes, _tokens, _rl, _memStore, _b64url, _rand, CODE_TTL_S, TOKEN_TTL_S };
