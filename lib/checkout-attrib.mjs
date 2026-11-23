// lib/checkout-attrib.mjs — the attribution ref (aref) on every MCP link that can end at Stripe
// (checkout-attribution spec 2026-11-22, section 1). Behind DCHUB_CHECKOUT_ATTRIB_V1 (default OFF; on only for
// 1 / true / yes / on). Off: withArefLinks returns the result object it was given, untouched.
//
// aref = a1-<pf>-<issued_at b36>-<sig16>-<tool|x>-<subject>
//   pf      c claude | o chatgpt | g grok | x other (lib/platform-family.mjs)
//   subject the caller's key ref (pk-<sha256 of the key>) or, keyless, its MCP session id. Never an email.
//   sig16   hex(HMAC_SHA256(HMAC_SHA256(DCHUB_INTERNAL_KEY, "dchub-aref-v1"), "pf|ia|tool|subject"))[:16]
// The backend (dchub-backend routes/checkout_attribution.py) verifies the same bytes; the secret is the one the two
// services already share (lib/token-seal.mjs). No secret: no aref, links unchanged.
//
// withArefLinks appends aref= to the relay links (/u/<token>, /upgrade/h/<token>), /licence and /go/{c,p}/ links in
// every text block and in structuredContent, so the relay page and /licence can carry it to /go/* and Stripe.
// The agent still shows the link verbatim: only its query string grows. Pure apart from reading env.
import { createHmac, createHash } from 'crypto';
import { platformFamily } from './platform-family.mjs';

export const CHECKOUT_ATTRIB_FLAG = 'DCHUB_CHECKOUT_ATTRIB_V1';
export function checkoutAttribOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[CHECKOUT_ATTRIB_FLAG]) || '').trim());
}

const PF_CODE = { claude: 'c', chatgpt: 'o', grok: 'g', other: 'x' };
const SUBJECT_OK = /^(?:pk-[0-9a-f]{64}|[A-Za-z0-9_-]{8,80})$/;
const TOOL_OK = /^[a-z][a-z0-9_]{1,40}$/;

function signKey(env) {
  const k = String((env && env.DCHUB_INTERNAL_KEY) || '').trim();
  return k ? createHmac('sha256', Buffer.from(k, 'utf8')).update('dchub-aref-v1').digest() : null;
}

export function keyRef(apiKey, env = process.env) {
  const k = String(apiKey || '').trim();
  if (!k) return '';
  const internal = String((env && env.DCHUB_INTERNAL_KEY) || '').trim();
  if (internal) return 'pk-' + createHmac('sha256', Buffer.from(internal, 'utf8')).update(k).digest('hex');
  return 'pk-' + createHash('sha256').update(k).digest('hex');
}

export function mintAref({ subject = '', family = 'other', tool = '', now = Date.now(), env = process.env } = {}) {
  const key = signKey(env);
  const s = String(subject || '').trim();
  if (!key || !SUBJECT_OK.test(s)) return '';
  const pf = PF_CODE[String(family || '').toLowerCase()] || 'x';
  const t = TOOL_OK.test(String(tool || '')) ? tool : 'x';
  const ia = Math.floor(Number(now) / 1000).toString(36);
  const sig = createHmac('sha256', key).update(`${pf}|${ia}|${t}|${s}`).digest('hex').slice(0, 16);
  return `a1-${pf}-${ia}-${sig}-${t}-${s}`;
}

// The aref for this call's caller: key ref when keyed, else the session id. "" when there is neither.
export function arefForCtx(c, tool = '', env = process.env) {
  if (!c) return '';
  const subject = c.api_key ? keyRef(c.api_key, env) : String(c.session_id || '');
  const family = platformFamily({ client: c.client_name || c.clientInfo_name || null, platform: c.platform || null });
  return mintAref({ subject, family, tool, env });
}

// https://dchub.cloud/u/<token>, /upgrade/h/<token>, /licence, /go/c/<token>, /go/p/<plan>, with any query.
// A path segment may hold dots (tok.sig) but never ends in one, so a link that ends a sentence keeps its full stop.
const SEG = '[A-Za-z0-9_~-]+(?:\\.[A-Za-z0-9_~-]+)*';
const LINK = new RegExp('(https://dchub\\.cloud/(?:u/' + SEG + '|upgrade/h/' + SEG + '|licen[cs]e|go/[cp]/' + SEG + '))'
  + '(\\?(?:[^\\s"\'<>)\\]]*[^\\s"\'<>)\\].,;:!?])?)?', 'g');   // a query never ends in punctuation
export function addArefToText(text, aref) {
  if (!aref || typeof text !== 'string' || !text.includes('dchub.cloud/')) return text;
  return text.replace(LINK, (m, base, q) => {
    if (q && /[?&]aref=/.test(q)) return m;
    return base + (q && q.length > 1 ? q + '&' : '?') + 'aref=' + aref;
  });
}

function walk(v, aref) {
  if (typeof v === 'string') return addArefToText(v, aref);
  if (Array.isArray(v)) return v.map((x) => walk(x, aref));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = walk(x, aref);
    return o;
  }
  return v;
}

export function withArefLinks(result, aref) {
  if (!aref || !result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const content = result.content.map((b) => (b && b.type === 'text' && typeof b.text === 'string'
    ? { ...b, text: addArefToText(b.text, aref) } : b));
  const out = { ...result, content };
  if (result.structuredContent && typeof result.structuredContent === 'object') out.structuredContent = walk(result.structuredContent, aref);
  return out;
}
