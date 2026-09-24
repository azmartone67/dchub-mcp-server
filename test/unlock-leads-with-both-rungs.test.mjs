// unlock-leads-with-both-rungs.test.mjs — r-unlock-rungs-first (2026-09-14).
//
// Qualifies for the hard gate: pure functions over AsyncLocalStorage, no network.
//
// unlock_more_data exists to hand an agent the links for its human. Measured live
// on an anonymous call the same day: its text opened on the MPP paragraph, the
// first link sat at character 812 of 1,436, and no /upgrade/h link appeared
// anywhere in the response. These pin the fixed shape:
//   1. the FIRST line of content[0].text is the ask, carrying the whole ladder —
//      $10 on the signed /upgrade/h page, then Developer, then Pro, each on a
//      signed /go/c checkout (r-dev-rung, 2026-09-21: agent rungs before the $99
//      human-screener rung) — and no link comes before it;
//   2. structuredContent.for_your_human.url is that same /upgrade/h token;
//   3. both tokens carry the caller's identity: the session, plus the key's hash
//      for a keyed caller;
//   4. no checkout link repeats, and the MPP option follows the human ask.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { _unlockMoreDataEnvelope, _ctxALS, HUMAN_FIRST_MARKER, _priceLabel } from '../server.mjs';

const SECRET = 'test-internal-key-not-a-real-secret';
const SID = '2bb6536d-b1d4-44b4-94a8-e89ba266e782';
const KEY = 'dch_live_unlock_rungs_not_real';
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');
const GO = 'https://dchub.cloud/go/c/';
const RELAY = 'https://dchub.cloud/upgrade/h/';
const LINK_RE = /https:\/\/dchub\.cloud\/(?:go\/c|upgrade\/h)\/[A-Za-z0-9._-]+/g;

const ENV = ['DCHUB_INTERNAL_KEY', 'DCHUB_GO_LINKS', 'DCHUB_GO_SID', 'DCHUB_HUMAN_RELAY',
  'DCHUB_RELAY_KEY_BIND', 'DCHUB_ANON_ATTRIB', 'MPP_ENABLED', 'MPP_SIDECAR_URL'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.DCHUB_INTERNAL_KEY = SECRET;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

const unlock = (store, args = {}) => _ctxALS.run({ ...store }, () => _unlockMoreDataEnvelope(args));

/** Verify a signed dchub.cloud link the way the backend does, and return its fields. */
function fields(url, prefix) {
  expect(url.startsWith(prefix), url).toBe(true);
  const token = url.slice(prefix.length);
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  expect(token.slice(i + 1)).toBe(createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32));
  return Buffer.from(payload, 'base64url').toString().split('|');
}

describe('r-unlock-rungs-first — unlock_more_data leads with both rungs', () => {
  it('keyless session: line one is the ask — Developer, Pro, then the $10 pack as capacity, each a /go/c checkout on the session', () => {
    const text = unlock({ session_id: SID }).content[0].text;
    const first = text.split('\n')[0];
    expect(first.startsWith(HUMAN_FIRST_MARKER)).toBe(true);
    const links = first.match(LINK_RE);
    expect(links).toHaveLength(3);
    // r-direct-pack (2026-09-21, owner): no page sits in front of the $10 click.
    expect(fields(links[0], GO)).toEqual(['developer', SID]);
    expect(fields(links[1], GO)).toEqual(['pro', SID]);
    expect(fields(links[2], GO)).toEqual(['metered', SID]);
    // r-pack-is-capacity (2026-09-24): the plans that open tools lead ($49, then
    // $99); the $10 pack closes the line, labelled as capacity.
    const at = (s) => first.indexOf(s);
    expect(at('$10 one-time')).toBeGreaterThanOrEqual(0);
    expect(at('**Developer ' + _priceLabel('developer') + '**')).toBeLessThan(at('**Pro ' + _priceLabel('pro') + '**'));
    expect(at('**Pro ' + _priceLabel('pro') + '**')).toBeLessThan(at('more API capacity: **$10 one-time'));
    // Nothing links out ahead of the ask.
    expect(text.search(LINK_RE)).toBe(first.search(LINK_RE));
  });

  it('for_your_human still rides structuredContent, but never in front of the checkout the text leads with', () => {
    const env = unlock({ session_id: SID });
    const fyh = env.structuredContent.for_your_human;
    expect(fyh && fyh.url && fyh.url.startsWith(RELAY)).toBe(true);
    const first = env.content[0].text.split('\n')[0];
    expect(first).not.toContain(fyh.url);
    expect(first.match(LINK_RE)[0].startsWith(GO)).toBe(true);
    expect(env.structuredContent.human_message.split('\n')[0]).toBe(first);
  });

  it('keyed: the pack binds pk-, Developer and Pro bind k-, each with the session beside it', () => {
    const first = unlock({ session_id: SID, api_key: KEY }).content[0].text.split('\n')[0];
    const [devUrl, proUrl, packUrl] = first.match(LINK_RE);
    expect(fields(packUrl, GO)).toEqual(['metered', 'pk-' + KEY_HASH, SID]);
    expect(fields(devUrl, GO)).toEqual(['developer', 'k-' + KEY_HASH, SID]);
    expect(fields(proUrl, GO)).toEqual(['pro', 'k-' + KEY_HASH, SID]);
  });

  it('no link repeats anywhere in the text, and Starter (not on /pricing) is never offered', () => {
    const text = unlock({ session_id: SID }).content[0].text;
    const links = text.match(LINK_RE);
    expect(new Set(links).size).toBe(links.length);
    expect(links.map((u) => (u.startsWith(GO) ? fields(u, GO)[0] : 'relay')))
      .toEqual(['developer', 'pro', 'metered']);
    const env = unlock({ session_id: SID });
    expect(env.structuredContent.plans.map((p) => p.id)).toEqual(['credits', 'developer', 'pro']);
    expect(env.structuredContent.recommended_subscription).toBe('developer');
  });

  it('with the MPP rail on, the autonomous option follows the human ask', () => {
    process.env.MPP_ENABLED = '1';
    process.env.MPP_SIDECAR_URL = 'http://127.0.0.1:9';
    const env = unlock({ session_id: SID });
    const text = env.content[0].text;
    expect(text.split('\n')[0].startsWith(HUMAN_FIRST_MARKER)).toBe(true);
    expect(text.indexOf('mpp_pay=true')).toBeGreaterThan(text.search(LINK_RE));
    expect(env.structuredContent.machine_pay).toBeTruthy();
    expect(env.structuredContent.recommended).toBe('mpp');
  });

  it('relay switched off: line one still carries payable Developer, Pro and $10 checkouts', () => {
    process.env.DCHUB_HUMAN_RELAY = '0';
    const env = unlock({ session_id: SID });
    const links = env.content[0].text.split('\n')[0].match(LINK_RE);
    expect(links.map((u) => fields(u, GO)[0])).toEqual(['developer', 'pro', 'metered']);
    expect(env.structuredContent.for_your_human).toBeUndefined();
  });

  it('no session and no key: the ask still leads, and the payer is told the key is emailed', () => {
    const env = unlock({});
    const lines = env.content[0].text.split('\n');
    expect(lines[0].startsWith(HUMAN_FIRST_MARKER)).toBe(true);
    expect(lines[0].match(LINK_RE)).toHaveLength(3);
    expect(lines[1]).toContain('DC Hub emails you an API key');
    expect(lines[1]).not.toContain('my very next query');
    expect(env.structuredContent.next_call_full_after_checkout).toBe(false);
  });

  it('a reason rides on the unlock sentence without breaking the first line', () => {
    const lines = unlock({ session_id: SID }, { reason: 'PJM queue depth' }).content[0].text.split('\n');
    expect(lines[0].match(LINK_RE)).toHaveLength(3);
    expect(lines.slice(1, 3).join('\n')).toContain('You asked me for: *PJM queue depth*');
  });
});
