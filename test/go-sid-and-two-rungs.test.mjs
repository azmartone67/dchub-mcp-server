// go-sid-and-two-rungs.test.mjs — r-go-sid + r-relay-key-bind + r-two-rungs (2026-09-13).
//
// Qualifies for the hard gate: pure functions over AsyncLocalStorage, no network.
//
// Three contracts, each a cross-repo token shape or the text a relaying model sees:
//   1. /go/c carries the caller's session BESIDE a key/anon ref (plan|ref|sid), so
//      the funnel's session-keyed self-traffic exclusion can bind to a keyed click.
//      A keyless session caller's token must stay byte-identical (its ref IS the sid).
//   2. /upgrade/h carries pk-<sha256(key)> as an optional fifth field for keyed
//      callers, so the page sells the pack onto the key; keyless tokens unchanged.
//   3. The relayed ask names BOTH rungs — $10 on the human page, then Developer on /go/c
//      (Pro instead only when the gated tool is Pro-only; r-dev-rung 2026-09-21) — with
//      the price read from the canon, and composeHumanCta keeps both links.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  _goUrl, _ctxALS, PRO_URL, _priceLabel, _callsPerDay, composeHumanCta,
  buildHumanRelay, _rungsText, trialHeader,
} from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

const SECRET = 'test-internal-key-not-a-real-secret';
const PACK = 'https://buy.stripe.com/9B69AU08y2FfbSR55UaZi0i';
const SID = '1aa6536d-b1d4-24b4-74a8-e89ba266e781';
const KEY = 'dch_live_testkey_not_real';
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');

const ENV = ['DCHUB_INTERNAL_KEY', 'DCHUB_GO_LINKS', 'DCHUB_GO_SID', 'DCHUB_HUMAN_RELAY',
  'DCHUB_RELAY_KEY_BIND', 'DCHUB_ANON_ATTRIB'];
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

const withCtx = (store, fn) => _ctxALS.run({ ...store }, fn);

/** Split a signed dchub.cloud/<path>/<payload>.<sig> link the way the backend verifies it. */
function fields(url, prefix) {
  expect(url.startsWith(prefix)).toBe(true);
  const token = url.slice(prefix.length);
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
  expect(token.slice(i + 1)).toBe(sig);
  return { payload, parts: Buffer.from(payload, 'base64url').toString().split('|') };
}
const GO = 'https://dchub.cloud/go/c/';
const RELAY = 'https://dchub.cloud/upgrade/h/';

describe('r-go-sid — /go/c binds the session beside a key ref', () => {
  it('a keyed ref gains the session as a third field; the ref reaches the backend intact', () => {
    const url = withCtx({ session_id: SID }, () =>
      _goUrl(PACK + '?client_reference_id=pk-' + KEY_HASH));
    expect(fields(url, GO).parts).toEqual(['metered', 'pk-' + KEY_HASH, SID]);
  });

  it('a keyless session caller (ref IS the sid) keeps the old two-field token byte for byte', () => {
    const url = withCtx({ session_id: SID }, () => _goUrl(PACK + '?client_reference_id=' + SID));
    const { payload, parts } = fields(url, GO);
    expect(parts).toEqual(['metered', SID]);
    expect(payload).toBe(Buffer.from('metered|' + SID).toString('base64url'));
  });

  it('an explicit sessionId argument is used when the store has none', () => {
    const url = _goUrl(PACK + '?client_reference_id=k-' + KEY_HASH, SID);
    expect(fields(url, GO).parts).toEqual(['metered', 'k-' + KEY_HASH, SID]);
  });

  it('no session, the no-session sentinel, a junk sid and the kill switch all stay two-field', () => {
    const ref = '?client_reference_id=pk-' + KEY_HASH;
    expect(fields(withCtx({}, () => _goUrl(PACK + ref)), GO).parts).toHaveLength(2);
    expect(fields(withCtx({ session_id: 'no-session' }, () => _goUrl(PACK + ref)), GO).parts).toHaveLength(2);
    expect(fields(withCtx({ session_id: 'a|b c' }, () => _goUrl(PACK + ref)), GO).parts).toHaveLength(2);
    process.env.DCHUB_GO_SID = '0';
    expect(fields(withCtx({ session_id: SID }, () => _goUrl(PACK + ref)), GO).parts).toHaveLength(2);
  });
});

describe('r-relay-key-bind — /upgrade/h carries the key hash for keyed callers only', () => {
  it('keyed: a fifth field pk-<sha256(key)>', () => {
    const rel = withCtx({ session_id: SID, api_key: KEY }, () => buildHumanRelay('rank_markets', 'free'));
    const { parts } = fields(rel.url, RELAY);
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe(SID);
    expect(parts[1]).toBe('rank_markets');
    expect(parts[4]).toBe('pk-' + KEY_HASH);
  });

  it('keyless: the four-field token the backend has always parsed', () => {
    const rel = withCtx({ session_id: SID }, () => buildHumanRelay('rank_markets', 'free'));
    expect(fields(rel.url, RELAY).parts).toHaveLength(4);
  });

  it('kill switch DCHUB_RELAY_KEY_BIND=0 drops the fifth field', () => {
    process.env.DCHUB_RELAY_KEY_BIND = '0';
    const rel = withCtx({ session_id: SID, api_key: KEY }, () => buildHumanRelay('rank_markets', 'free'));
    expect(fields(rel.url, RELAY).parts).toHaveLength(4);
  });

  it('one token per tool per request, whatever tier label a second caller passes', () => {
    withCtx({ session_id: SID }, () => {
      const a = buildHumanRelay('rank_markets', 'trial');
      const b = buildHumanRelay('rank_markets', 'free');
      const other = buildHumanRelay('get_fiber_intel', 'free');
      expect(b.url).toBe(a.url);
      expect(other.url).not.toBe(a.url);
    });
  });
});

describe('r-two-rungs + r-dev-rung — the relayed ask names the $10 page and the Developer checkout', () => {
  const GO_RE = /https:\/\/dchub\.cloud\/go\/c\/[A-Za-z0-9._-]+/g;
  const RELAY_RE = /https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9._-]+/g;

  it('keyless session: $10 → the SAME /upgrade/h token as for_your_human; Developer → /go/c developer on the session', () => {
    withCtx({ session_id: SID }, () => {
      const text = _rungsText('rank_markets', 'free');
      const rel = buildHumanRelay('rank_markets', 'free');
      expect(text.match(RELAY_RE)).toEqual([rel.url]);
      const go = text.match(GO_RE);
      expect(go).toHaveLength(1);
      expect(fields(go[0], GO).parts).toEqual(['developer', SID]);
      expect(text).toContain('**$10 one-time = 1,000 API calls**');
      expect(text).toContain('**Developer ' + _priceLabel('developer') + '**');
      expect(text).toContain(_callsPerDay('developer').toLocaleString('en-US') + ' calls/day');
      // Pro is not the agent default: a tool Developer opens never names it.
      expect(text).not.toContain('**Pro ');
      expect(text.indexOf(rel.url)).toBeLessThan(text.indexOf(go[0]));
    });
  });

  it('keyed: Developer binds k-<sha256(key)> with the session beside it', () => {
    withCtx({ session_id: SID, api_key: KEY }, () => {
      const go = _rungsText('rank_markets', 'free').match(GO_RE);
      expect(go).toHaveLength(1);
      expect(fields(go[0], GO).parts).toEqual(['developer', 'k-' + KEY_HASH, SID]);
    });
  });

  it('r-trial-sub-bind: a dch_trial_ key in the store gets the session-bound subscription rung, not k-', () => {
    withCtx({ session_id: SID, api_key: 'dch_trial_testkey_not_real' }, () => {
      const go = _rungsText('rank_markets', 'free').match(GO_RE);
      expect(go).toHaveLength(1);
      expect(fields(go[0], GO).parts).toEqual(['developer', SID]);
      const proGo = _rungsText('get_grid_intelligence', 'free').match(GO_RE);
      expect(fields(proGo[0], GO).parts).toEqual(['pro', SID]);
    });
  });

  it('r-dev-rung: a Pro-only tool keeps Pro — Developer does not open it', () => {
    for (const tool of ['get_grid_intelligence', 'get_fiber_intel', 'analyze_site', 'compare_sites']) {
      withCtx({ session_id: SID }, () => {
        const text = _rungsText(tool, 'free');
        const go = text.match(GO_RE);
        expect(go, tool).toHaveLength(1);
        expect(fields(go[0], GO).parts, tool).toEqual(['pro', SID]);
        expect(text, tool).toContain('**Pro ' + _priceLabel('pro') + '**');
        expect(text, tool).not.toContain('Developer');
      });
    }
  });

  it('the Pro rung is the canon Pro link, never a founding or retired one', () => {
    expect(PRO_URL).toBe('https://buy.stripe.com/dRm28s2gGcfP6yx0PEaZi0p');
  });

  it('composeHumanCta keeps both rungs and adds no third ask', () => {
    withCtx({ session_id: SID }, () => {
      const body = '{"results":[1,2,3]}\n\n---\n\u{1F464} **Tell your human:** unlock `rank_markets` — '
        + _rungsText('rank_markets', 'free') + '\n';
      const out = composeHumanCta(buildHumanRelay('rank_markets', 'free').url, body);
      expect(out.match(RELAY_RE)).toHaveLength(1);
      expect(out.match(GO_RE)).toHaveLength(1);
      expect(out).not.toContain('→ **For your human:**');
    });
  });

  it('fail-open: with the relay switched off the $10 rung is still a payable /go/c pack link', () => {
    process.env.DCHUB_HUMAN_RELAY = '0';
    withCtx({ session_id: SID }, () => {
      const go = _rungsText('rank_markets', 'free').match(GO_RE);
      expect(go.map((u) => fields(u, GO).parts[0])).toEqual(['metered', 'developer']);
    });
  });
});

describe('r-two-rungs — the envelopes an agent actually relays', () => {
  const GO_RE = /https:\/\/dchub\.cloud\/go\/c\/[A-Za-z0-9._-]+/g;

  it('trialHeader (the gated preview line) names the relay page and the Developer checkout', () => {
    withCtx({ session_id: SID }, () => {
      const line = trialHeader('rank_markets', SID, '3 of 10 results shown');
      expect(line).toContain(buildHumanRelay('rank_markets', 'free').url);
      const go = line.match(GO_RE);
      expect(go).toHaveLength(1);
      expect(fields(go[0], GO).parts[0]).toBe('developer');
    });
  });

  // buildAutoMintBlock, siteHeadlineHeader and the paid_only markdown are not
  // exported and only run inside a live gated tools/call, so this floor reads the
  // source: every relayed 👤/👉 ask routes through _rungsText, and none of them
  // hands the human a bare pack checkout variable any more.
  it('every Tell-your-human ask is built by _rungsText', () => {
    const asks = SRC.split('\n')
      .map((l) => l.replace(/\s\/\/.*$/, ''))                   // drop trailing comments
      .filter((l) => l.includes('**Tell your human:**')
        && !/^\s*\/\//.test(l) && !l.includes('save this key')
        // composeHumanCta's _HUMAN_CTA_SIGNATURES entry names the phrase; it is not an ask
        && !/^\s*'\*\*Tell your human:\*\*',\s*$/.test(l));
    expect(asks.length).toBeGreaterThanOrEqual(7);
    for (const l of asks) {
      expect(l, l.trim().slice(0, 120)).toContain('_rungsText(');
      expect(l).not.toMatch(/_meteredUrl|\$\{_packUrl\}|' \+ _pack \+/);
    }
    const calls = (SRC.match(/_rungsText\(/g) || []).length - 1;   // minus the definition
    expect(calls).toBeGreaterThanOrEqual(10);
  });
});
