// token-seal.mjs — the payload of a signed relay (/upgrade/h/) or checkout (/go/c/) link.
//
// Sealed payload v1 (the backend reads and writes the same bytes):
//   encKey    = HMAC_SHA256(DCHUB_INTERNAL_KEY, "dchub-token-seal-v1")
//   keystream = HMAC_SHA256(encKey, nonce || uint32be(counter)) for counter 0, 1, 2, ...
//   payload   = "x1" + base64url_nopad(nonce(12) || utf8(raw) XOR keystream)
// The link's signature stays hex(HMAC_SHA256(key, payload))[:32] over the payload as sent.
// A payload without the "x1" prefix is the legacy plain base64url form; both are read.
// DCHUB_TOKEN_SEAL=0 mints the legacy form (default on).
import { createHmac, randomBytes } from 'crypto';

export const SEAL_PREFIX = 'x1';
const NONCE_LEN = 12;
const SEAL_INFO = 'dchub-token-seal-v1';

export function tokenSealOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_TOKEN_SEAL) || ''));
}

function encKey(key) {
  return createHmac('sha256', Buffer.from(String(key), 'utf8')).update(SEAL_INFO).digest();
}

function keystream(ek, nonce, n) {
  const out = Buffer.alloc(n);
  const ctr = Buffer.alloc(4);
  for (let off = 0, c = 0; off < n; c += 1) {
    ctr.writeUInt32BE(c >>> 0, 0);
    const block = createHmac('sha256', ek).update(Buffer.concat([nonce, ctr])).digest();
    block.copy(out, off, 0, Math.min(block.length, n - off));
    off += block.length;
  }
  return out;
}

function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

// raw "a|b|c" -> the payload to sign and put in the URL. `nonce` is for tests only.
export function sealPayload(raw, key = process.env.DCHUB_INTERNAL_KEY, { nonce, env = process.env } = {}) {
  const pt = Buffer.from(String(raw), 'utf8');
  if (!key || !tokenSealOn(env)) return pt.toString('base64url');
  const n = nonce ? Buffer.from(nonce) : randomBytes(NONCE_LEN);
  if (n.length !== NONCE_LEN) throw new Error('token-seal: nonce must be 12 bytes');
  const ct = xor(pt, keystream(encKey(key), n, pt.length));
  return SEAL_PREFIX + Buffer.concat([n, ct]).toString('base64url');
}

// payload (sealed or legacy) -> raw "a|b|c". Sealed without a key, or too short -> ''.
export function unsealPayload(payload, key = process.env.DCHUB_INTERNAL_KEY) {
  const p = String(payload || '');
  if (!p.startsWith(SEAL_PREFIX)) return Buffer.from(p, 'base64url').toString('utf8');
  if (!key) return '';
  const buf = Buffer.from(p.slice(SEAL_PREFIX.length), 'base64url');
  if (buf.length < NONCE_LEN) return '';
  const n = buf.subarray(0, NONCE_LEN);
  const ct = buf.subarray(NONCE_LEN);
  return xor(ct, keystream(encKey(key), n, ct.length)).toString('utf8');
}

// The 32-hex link signature over the payload as transmitted.
export function signPayload(payload, key = process.env.DCHUB_INTERNAL_KEY) {
  return createHmac('sha256', String(key)).update(String(payload)).digest('hex').slice(0, 32);
}
