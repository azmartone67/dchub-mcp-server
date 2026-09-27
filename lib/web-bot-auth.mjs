/**
 * web-bot-auth.mjs (2026-09-27) — sign this process's requests to our own hosts.
 *
 * Web Bot Auth (HTTP Message Signatures, RFC 9421, Ed25519). Cloudflare's WAF
 * lets DC Hub's self-probes skip bot checks by User-Agent, which anyone can copy;
 * signed requests are verified instead against the key directory at
 * https://dchub.cloud/.well-known/http-message-signatures-directory.
 * Same scheme byte-for-byte as dchub-frontend scripts/web-bot-auth.mjs and
 * dchub-backend web_bot_auth.py (pinned by a shared RFC 8032 test vector).
 *
 * installFetchSigning() wraps globalThis.fetch once: every request to
 * dchub.cloud or *.dchub.cloud gets Signature-Agent / Signature-Input /
 * Signature. Other hosts are untouched, a request that already carries a
 * Signature keeps it, and with no WEB_BOT_AUTH_PRIVATE_JWK it is a no-op.
 * A signing error sends the request unsigned; it never fails a request.
 *
 * Preload for scripts: NODE_OPTIONS="--import ./lib/web-bot-auth-preload.mjs"
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';

export const SIGNATURE_AGENT = 'https://dchub.cloud';
const INSTALLED = Symbol.for('dchub.webBotAuth.fetch');

export function jwkThumbprint(jwk) {
  // RFC 7638 / RFC 8037: crv, kty, x in lexicographic order, no whitespace.
  const canon = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return createHash('sha256').update(canon).digest('base64url');
}

let _keyCache = { d: null, key: null };
function loadJwk(jwk) {
  if (!jwk) {
    const raw = process.env.WEB_BOT_AUTH_PRIVATE_JWK;
    if (!raw) return null;
    try { jwk = JSON.parse(raw); } catch { return null; }
  }
  return jwk && jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.x && jwk.d ? jwk : null;
}

export function isOwnHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  return h === 'dchub.cloud' || h.endsWith('.dchub.cloud');
}

/** Headers that sign a request to `url`; {} when no key is configured. */
export function webBotAuthHeaders(url, opts = {}) {
  const jwk = loadJwk(opts.jwk);
  if (!jwk) return {};
  let authority;
  try { authority = new URL(url).host.toLowerCase(); } catch { return {}; }
  if (!authority) return {};
  let key = _keyCache.d === jwk.d ? _keyCache.key : null;
  if (!key) {
    try { key = createPrivateKey({ key: jwk, format: 'jwk' }); } catch { return {}; }
    _keyCache = { d: jwk.d, key };
  }
  const created = opts.now ?? Math.floor(Date.now() / 1000);
  const expires = created + (opts.ttl ?? 300);
  const agent = `"${SIGNATURE_AGENT}"`;
  const params = `("@authority" "signature-agent");created=${created};keyid="${jwkThumbprint(jwk)}";alg="ed25519";expires=${expires};tag="web-bot-auth"`;
  const base = `"@authority": ${authority}\n"signature-agent": ${agent}\n"@signature-params": ${params}`;
  return {
    'Signature-Agent': agent,
    'Signature-Input': `sig1=${params}`,
    'Signature': `sig1=:${sign(null, Buffer.from(base), key).toString('base64')}:`,
  };
}

/** {} unless `url` is one of our own hosts. */
export function signIfOwnHost(url) {
  try {
    if (!isOwnHost(new URL(url).hostname)) return {};
  } catch { return {}; }
  return webBotAuthHeaders(url);
}

/** Wrap globalThis.fetch once so every request to our own hosts is signed. */
export function installFetchSigning() {
  const orig = globalThis.fetch;
  if (typeof orig !== 'function' || orig[INSTALLED]) return false;
  const signed = function fetch(input, init) {
    try {
      const url = typeof input === 'string' ? input
        : input instanceof URL ? input.href
        : input && typeof input.url === 'string' ? input.url : '';
      const sig = url ? signIfOwnHost(url) : {};
      if (Object.keys(sig).length) {
        const headers = new Headers(input && typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined);
        if (init && init.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
        if (!headers.has('signature')) {
          for (const [k, v] of Object.entries(sig)) headers.set(k, v);
          init = { ...(init || {}), headers };
        }
      }
    } catch { /* a signature is never worth breaking a request */ }
    return orig.call(this, input, init);
  };
  signed[INSTALLED] = true;
  globalThis.fetch = signed;
  return true;
}
