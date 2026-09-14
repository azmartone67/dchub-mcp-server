// unlock-leads-with-both-rungs.test.mjs — r-unlock-rungs-first (2026-09-14).
//
// Qualifies for the hard gate: pure functions over AsyncLocalStorage, no network.
//
// unlock_more_data exists to hand an agent the links for its human. Measured live
// on an anonymous call the same day: its text opened on the MPP paragraph, the
// first link sat at character 812 of 1,436, and no /upgrade/h link appeared
// anywhere in the response. These pin the fixed shape:
//   1. the FIRST line of content[0].text is the ask, carrying both rungs — $10 on
//      the signed /upgrade/h page, then Pro on the signed /go/c checkout — and no
//      link comes before it;
//   2. structuredContent.for_your_human.url is that same /upgrade/h token;
//   3. both tokens carry the caller's identity: the session, plus the key's hash
//      for a keyed caller;
//   4. no checkout link repeats, and the MPP option follows the human ask.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { _unlockMoreDataEnvelope, _ctxALS, HUMAN_FIRST_MARKER } from '../server.mjs';

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
  it('keyless session: line one is the ask, $10 on /upgrade/h then Pro on /go/c', () => {
    const text = unlock({ session_id: SID }).content[0].text;
    const first = text.split('\n')[0];
    expect(first.startsWith(HUMAN_FIRST_MARKER)).toBe(true);
    const links = first.match(LINK_RE);
    expect(links).toHaveLength(2);
    const relay = fields(links[0], RELAY);
    expect(relay).toHaveLength(4);
    expect(relay.slice(0, 3)).toEqual([SID, 'unlock_more_data', 'free']);
    expect(fields(links[1], GO)).toEqual(['pro', SID]);
    expect(first).toContain('$10 one-time');
    // Nothing links out ahead of the ask.
    expect(text.search(LINK_RE)).toBe(first.search(LINK_RE));
  });

  it('for_your_human is the same /upgrade/h token the text leads with', () => {
    const env = unlock({ session_id: SID });
    const fyh = env.structuredContent.for_your_human;
    expect(fyh && fyh.url).toBeTruthy();
    expect(env.content[0].text.split('\n')[0].match(LINK_RE)[0]).toBe(fyh.url);
    expect(env.structuredContent.human_message.split('\n')[0]).toBe(env.content[0].text.split('\n')[0]);
  });

  it('keyed: /upgrade/h names the key, Pro binds k- with the session beside it', () => {
    const first = unlock({ session_id: SID, api_key: KEY }).content[0].text.split('\n')[0];
    const [relayUrl, proUrl] = first.match(LINK_RE);
    const relay = fields(relayUrl, RELAY);
    expect(relay).toHaveLength(5);
    expect(relay[0]).toBe(SID);
    expect(relay[4]).toBe('pk-' + KEY_HASH);
    expect(fields(proUrl, GO)).toEqual(['pro', 'k-' + KEY_HASH, SID]);
  });

  it('no link repeats anywhere in the text, and the ladder below keeps Starter and Developer', () => {
    const text = unlock({ session_id: SID }).content[0].text;
    const links = text.match(LINK_RE);
    expect(new Set(links).size).toBe(links.length);
    expect(links.map((u) => (u.startsWith(GO) ? fields(u, GO)[0] : 'relay')))
      .toEqual(['relay', 'pro', 'starter', 'developer']);
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

  it('relay switched off: line one still carries a payable $10 checkout and Pro', () => {
    process.env.DCHUB_HUMAN_RELAY = '0';
    const env = unlock({ session_id: SID });
    const links = env.content[0].text.split('\n')[0].match(LINK_RE);
    expect(links.map((u) => fields(u, GO)[0])).toEqual(['metered', 'pro']);
    expect(env.structuredContent.for_your_human).toBeUndefined();
  });

  it('no session and no key: the ask still leads, and the payer is told the key is emailed', () => {
    const env = unlock({});
    const lines = env.content[0].text.split('\n');
    expect(lines[0].startsWith(HUMAN_FIRST_MARKER)).toBe(true);
    expect(lines[0].match(LINK_RE)).toHaveLength(2);
    expect(lines[1]).toContain('DC Hub emails you an API key');
    expect(lines[1]).not.toContain('my very next query');
    expect(env.structuredContent.next_call_full_after_checkout).toBe(false);
  });

  it('a reason rides on the unlock sentence without breaking the first line', () => {
    const lines = unlock({ session_id: SID }, { reason: 'PJM queue depth' }).content[0].text.split('\n');
    expect(lines[0].match(LINK_RE)).toHaveLength(2);
    expect(lines.slice(1, 3).join('\n')).toContain('You asked me for: *PJM queue depth*');
  });
});
