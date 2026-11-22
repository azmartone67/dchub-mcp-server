// token-seal-1121.test.mjs — relay (/upgrade/h/) and checkout (/go/c/) tokens carry a sealed payload.
//
// Pure functions over AsyncLocalStorage, no network. The vectors are shared with the backend's
// implementation of lib/token-seal.mjs; both sides must produce these exact bytes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sealPayload, unsealPayload, signPayload, tokenSealOn } from '../lib/token-seal.mjs';
import { decodeGoToken } from '../lib/wall-user-line.mjs';
import { mintedOnly } from '../lib/wall-offers.mjs';
import { LONG_RELAY_RE } from '../lib/wall-tag.mjs';
import { PARTIAL_RELAY_LINK_RE } from '../lib/chatgpt-directory.mjs';
import {
  _goUrl, _ctxALS, buildHumanRelay, _relayEverywhereUrl, _relayTokenFields, _restampRelayUrl,
} from '../server.mjs';

const VEC_KEY = 'test-internal-key';
const VEC_NONCE = Buffer.from('000102030405060708090a0b', 'hex');
const VECTORS = [
  {
    raw: 'sid-123|get_energy_prices|free|1795303314|w-freekey|c-claude|u-email|s-1',
    payload: 'x1AAECAwQFBgcICQoLfgraS-K-b_IvWOgyCaY03g-XnkcnvtkQoHXCVmMOZHNNotC6pbVWEn6y9xcnO_UWD2_7D-V5ppws2KZiPwkQ3rbWFTGiGi7P',
    sig: '4b87e395d8c8a04c818e889c23c33ab4',
  },
  {
    raw: 'pro|ref-abc|sid-123|analyze_site|v2',
    payload: 'x1AAECAwQFBgcICQoLfRHRGqHpOqMpX_8RH6E1gVnc8ks0udsZqnPBe3UCbCcG7dc',
    sig: '9a1eaef590596b0a8c3151e8c490da24',
  },
];

const SECRET = 'test-internal-key-not-a-real-secret';
const SID = '1aa6536d-b1d4-24b4-74a8-e89ba266e781';
const PACK = 'https://buy.stripe.com/9B69AU08y2FfbSR55UaZi0i';
const ENV = ['DCHUB_INTERNAL_KEY', 'DCHUB_TOKEN_SEAL', 'DCHUB_GO_LINKS', 'DCHUB_GO_SID', 'DCHUB_HUMAN_RELAY',
  'DCHUB_RELAY_KEY_BIND', 'DCHUB_ANON_ATTRIB', 'DCHUB_GO_TOOL'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.DCHUB_INTERNAL_KEY = SECRET;
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
const withCtx = (store, fn) => _ctxALS.run({ ...store }, fn);

// <prefix><payload>.<sig32>[?query] -> { payload, sig } after checking the signature over the payload as sent.
function split(url, prefix) {
  expect(url.startsWith(prefix)).toBe(true);
  const token = url.slice(prefix.length).split('?')[0];
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  expect(sig).toBe(createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32));
  return { payload, sig };
}
// The sid must not be readable from the URL text nor from the payload's base64url-decoded bytes.
function expectNoPlainSid(url, payload, sid) {
  expect(url).not.toContain(sid);
  expect(Buffer.from(payload, 'base64url').toString('latin1')).not.toContain(sid);
  expect(Buffer.from(payload.replace(/^x1/, ''), 'base64url').toString('latin1')).not.toContain(sid);
}
const RELAY = 'https://dchub.cloud/upgrade/h/';
const GO = 'https://dchub.cloud/go/c/';

describe('token-seal v1 — shared test vectors', () => {
  for (const v of VECTORS) {
    it('seals ' + v.raw.split('|')[0] + '… to the exact bytes and signature', () => {
      const p = sealPayload(v.raw, VEC_KEY, { nonce: VEC_NONCE });
      expect(p).toBe(v.payload);
      expect(signPayload(p, VEC_KEY)).toBe(v.sig);
      expect(createHmac('sha256', VEC_KEY).update(p).digest('hex').slice(0, 32)).toBe(v.sig);
      expect(unsealPayload(v.payload, VEC_KEY)).toBe(v.raw);
    });
  }
  it('reads the legacy plain form, and a sealed payload needs the key', () => {
    const raw = VECTORS[0].raw;
    expect(unsealPayload(Buffer.from(raw).toString('base64url'), VEC_KEY)).toBe(raw);
    expect(unsealPayload(VECTORS[0].payload, '')).toBe('');
    expect(unsealPayload(VECTORS[0].payload, 'another-key')).not.toBe(raw);
  });
  it('a fresh nonce per mint: two seals of one line differ and both open', () => {
    const a = sealPayload('x|y', VEC_KEY), b = sealPayload('x|y', VEC_KEY);
    expect(a).not.toBe(b);
    expect(unsealPayload(a, VEC_KEY)).toBe('x|y');
    expect(unsealPayload(b, VEC_KEY)).toBe('x|y');
  });
  it('kill switch DCHUB_TOKEN_SEAL=0 (or no key) mints the legacy plain form', () => {
    expect(tokenSealOn({})).toBe(true);
    expect(tokenSealOn({ DCHUB_TOKEN_SEAL: '0' })).toBe(false);
    expect(sealPayload('a|b', VEC_KEY, { env: { DCHUB_TOKEN_SEAL: '0' } })).toBe(Buffer.from('a|b').toString('base64url'));
    expect(sealPayload('a|b', '')).toBe(Buffer.from('a|b').toString('base64url'));
  });
});

describe('minters emit sealed payloads with no readable session id', () => {
  it('buildHumanRelay', () => {
    const rel = withCtx({ session_id: SID }, () => buildHumanRelay('rank_markets', 'free', SID));
    const { payload } = split(rel.url, RELAY);
    expect(payload.startsWith('x1')).toBe(true);
    expectNoPlainSid(rel.url, payload, SID);
    expect(unsealPayload(payload, SECRET).split('|').slice(0, 3)).toEqual([SID, 'rank_markets', 'free']);
    expect(_relayTokenFields(rel.url).slice(0, 3)).toEqual([SID, 'rank_markets', 'free']);
  });
  it('_goUrl (checkout)', () => {
    const out = withCtx({ session_id: SID }, () => _goUrl(PACK + '?client_reference_id=' + SID, SID));
    const { payload } = split(out, GO);
    expect(payload.startsWith('x1')).toBe(true);
    expectNoPlainSid(out, payload, SID);
    expect(unsealPayload(payload, SECRET).split('|').slice(0, 2)).toEqual(['metered', SID]);
    expect(decodeGoToken(out)).toEqual({ plan: 'metered', ref: SID, sid: '' });
  });
  it('_relayEverywhereUrl (via _signRelayPayload)', () => {
    const url = _relayEverywhereUrl('analyze_site', {}, { session_id: SID, tier: 'free' }, { client: 'claude' });
    const { payload } = split(url, RELAY);
    expect(payload.startsWith('x1')).toBe(true);
    expect(payload.length).toBeLessThanOrEqual(400);   // PARTIAL_RELAY_LINK_RE / claude-directory cap
    expectNoPlainSid(url, payload, SID);
    expect(unsealPayload(payload, SECRET).split('|')[0]).toBe(SID);
  });
  it('_restampRelayUrl re-seals and keeps sid / tool / tier', () => {
    const rel = withCtx({ session_id: SID }, () => buildHumanRelay('rank_markets', 'free', SID));
    const out = _restampRelayUrl(rel.url, 'w-depth');
    const { payload } = split(out, RELAY);
    expect(payload.startsWith('x1')).toBe(true);
    expectNoPlainSid(out, payload, SID);
    const f = _relayTokenFields(out);
    expect(f.slice(0, 3)).toEqual([SID, 'rank_markets', 'free']);
    expect(f).toContain('w-depth');
  });
});

describe('kill switch: DCHUB_TOKEN_SEAL=0 mints the legacy form', () => {
  it('buildHumanRelay and _goUrl carry plain base64url payloads', () => {
    process.env.DCHUB_TOKEN_SEAL = '0';
    const rel = withCtx({ session_id: SID }, () => buildHumanRelay('rank_markets', 'free', SID));
    const r = split(rel.url, RELAY);
    expect(r.payload.startsWith('x1')).toBe(false);
    expect(Buffer.from(r.payload, 'base64url').toString().split('|')[0]).toBe(SID);
    const go = withCtx({ session_id: SID }, () => _goUrl(PACK + '?client_reference_id=' + SID, SID));
    const g = split(go, GO);
    expect(Buffer.from(g.payload, 'base64url').toString().split('|')).toEqual(['metered', SID]);
  });
});

describe('decoders read both forms', () => {
  const legacyRelay = (raw) => RELAY + Buffer.from(raw).toString('base64url') + '.' + '0'.repeat(32);
  const sealedRelay = (raw) => RELAY + sealPayload(raw, SECRET) + '.' + '0'.repeat(32);
  it('_relayTokenFields', () => {
    const raw = SID + '|analyze_site|free|1795303314|w-sitekey';
    expect(_relayTokenFields(legacyRelay(raw))).toEqual(raw.split('|'));
    expect(_relayTokenFields(sealedRelay(raw))).toEqual(raw.split('|'));
  });
  it('decodeGoToken', () => {
    const raw = 'pro|ref-abc|' + SID;
    const legacy = GO + Buffer.from(raw).toString('base64url') + '.' + 'a'.repeat(32);
    const sealed = GO + sealPayload(raw, SECRET) + '.' + 'a'.repeat(32);
    expect(decodeGoToken(legacy)).toEqual({ plan: 'pro', ref: 'ref-abc', sid: SID });
    expect(decodeGoToken(sealed)).toEqual({ plan: 'pro', ref: 'ref-abc', sid: SID });
  });
});

describe('URL validators still match a sealed link', () => {
  const sealed = RELAY + VECTORS[0].payload + '.' + VECTORS[0].sig;
  const withQuery = sealed + '?via=mcp-wall&tool=analyze_site&client=claude';
  const literal = (file, name) => {
    const src = readFileSync(new URL('../lib/' + file, import.meta.url), 'utf8');
    const line = src.split('\n').find((l) => l.startsWith('const ' + name + ' = /'));
    expect(line, file + ' ' + name).toBeTruthy();
    return new Function('return ' + line.slice(line.indexOf('= ') + 2).replace(/;\s*$/, ''))();
  };
  it.each([
    ['short-wall-link.mjs', 'RELAY_HUMAN_URL_RE', withQuery],
    ['short-wall-link.mjs', 'MINTED_RE', withQuery],
    ['wall-copy-v2.mjs', 'HUMAN_LINK_RE', withQuery],
    ['wall-depth-trial.mjs', 'HUMAN_LINK_RE', withQuery],
    ['gated-preview.mjs', 'RELAY_URL_RE', withQuery],
    ['paywall-contract.mjs', 'RELAY_URL_RE', withQuery],
    ['claude-directory.mjs', '_SITE_UNLOCK_URL', sealed + '?via=mcp-wall'],
    ['wall-via-tag.mjs', 'WALL_LINK_RE', withQuery],
  ])('%s %s', (file, name, url) => {
    const re = literal(file, name);
    re.lastIndex = 0;
    const m = re.exec(url);
    expect(m).not.toBeNull();
    expect(m[0]).toContain(VECTORS[0].payload + '.' + VECTORS[0].sig);
  });
  it('wall-tag LONG_RELAY_RE, chatgpt PARTIAL_RELAY_LINK_RE', () => {
    expect(LONG_RELAY_RE.test(withQuery)).toBe(true);
    expect(PARTIAL_RELAY_LINK_RE.test(withQuery)).toBe(true);
  });
  it('wall-offers mintedOnly keeps a line naming the sealed link', () => {
    const offers = [{ line: 'Open ' + withQuery + ' to see the rest.' }];
    expect(mintedOnly(offers, withQuery, {})).toEqual(offers);
  });
});
