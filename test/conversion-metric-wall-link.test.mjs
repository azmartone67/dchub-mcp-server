// conversion metric step 1 (2026-10-11): the analyze_site paywall -> unlock-open rate.
//
// Audit ~/Downloads/dchub-p1-conversion-baseline-2026-10-11.md found three gaps on this side:
//   1.5  walls and opens were joined only by UTC day: no wall row named the link it handed out;
//   1.4  a QA call that sent only X-DCHub-QA: 1 (UA not marked) counted as a wall;
//   1.5  session-less walls signalled session_id 'no-session' (one session in paywall_hit for all
//        of them) and never reached the high-intent / relay_minted stage.
// Pinned here, through the real server.mjs app on loopback against a stub backend:
//   W1  a wall's /track row carries wall_link_th = sha256(<payload>.<sig>)[:32] of the token in
//       its human_url, the identity dchub-backend relay_opens.token_hash stores for an open;
//   W2  behind a /u/<code> short link, wall_link_th is the hash of the LONG token the code 302s to;
//   Q1  X-DCHub-QA: 1 on a host-looking UA marks the /track row is_qa (control: absent without it);
//   N1  two session-less walls signal two distinct ids, neither 'no-session', each equal to the sid
//       baked into its own link, and each registers its own paid hit and a wl=1 claim check.
// No network (fenceNetwork), no disk writes. Qualifies for the hard gate: the only sockets are a
// 127.0.0.1 backend stub and the real express app listening on 127.0.0.1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const UA = { 'user-agent': 'Claude-User' };
const ARGS = { lat: 33.45, lon: -112.07 };
const SHORT = 'https://dchub.cloud/u/abc234';
const sha32 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const tokenOf = (url) => (String(url || '').match(/\/upgrade\/h\/([A-Za-z0-9_-]+\.[0-9a-f]{32})/) || [])[1];
const sidOf = (url) => Buffer.from(tokenOf(url).split('.')[0], 'base64url').toString().split('|')[0];

let H, fence;
let shortOn = false;
const claimQs = [];   // should-mint-claim query strings, in arrival order
const shortBodies = [];

async function settle(quietMs = 400, maxMs = 8000) {
  const t0 = Date.now();
  let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function wallCall(headers, { session = true } = {}) {
  await settle();
  const before = H.hits.length;
  let hdr = { ...UA, ...headers };
  if (session) {
    const init = await H.init('/mcp', 'claude-ai', hdr);
    const sid = init.headers.get('mcp-session-id');
    if (sid) hdr = { ...hdr, 'mcp-session-id': sid };
  }
  const r = await H.call('/mcp', 'analyze_site', ARGS, hdr);
  await settle();
  const hits = H.hits.slice(before);
  const sc = r.msg && r.msg.result && r.msg.result.structuredContent;
  return {
    sc,
    tracks: hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === 'analyze_site'),
    signals: hits.filter((h) => h.path === '/api/v1/mcp/signal-paywall' && h.body && h.body.tool === 'analyze_site'),
    paidHits: hits.filter((h) => h.path === '/api/v1/mcp/track-paid-hit' && h.body),
  };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body, u) => {
      if (p === '/api/v1/mcp/should-mint-claim') { claimQs.push(u.searchParams); return { should_mint: false, count: 1 }; }
      if (p === '/api/v1/relay/short') {
        shortBodies.push(body);
        return shortOn ? { ok: true, url: SHORT } : { ok: false };
      }
      return undefined;
    },
  });
}, 60_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('W1/W2: the wall row names the link it handed out', () => {
  it('W1 a keyless session wall: wall_link_th is the hash of the token in human_url', async () => {
    const w = await wallCall({});
    expect(w.sc && w.sc.human_url, 'control: the wall served an /upgrade/h/ link').toMatch(/\/upgrade\/h\//);
    const row = w.tracks.find((t) => t.body.status === 'pro_wall' || t.body.status === 'lp_wall');
    expect(row, 'control: the call was tracked as a wall').toBeTruthy();
    expect(row.body.wall_link_th).toBe(sha32(tokenOf(w.sc.human_url)));
    expect(row.body.wall_link_th).toMatch(/^[0-9a-f]{32}$/);
    expect(row.body.is_qa, 'not a QA call').toBeUndefined();
  }, 60_000);

  it('W2 behind a /u/ short link: the hash of the long token the code points to', async () => {
    shortOn = true;
    try {
      const n = shortBodies.length;
      const w = await wallCall({});
      expect(w.sc.human_url, 'control: the person sees the short link').toBe(SHORT);
      const long = shortBodies.slice(n).map((b) => b && b.relay_url).find(Boolean);
      expect(long, 'control: the long link was sent to the shortener').toMatch(/\/upgrade\/h\//);
      const row = w.tracks.find((t) => t.body.status === 'pro_wall' || t.body.status === 'lp_wall');
      expect(row.body.wall_link_th).toBe(sha32(tokenOf(long)));
    } finally { shortOn = false; }
  }, 60_000);

  it('a call that served no wall carries no wall_link_th', async () => {
    const w = await wallCall({ 'x-api-key': PRO_KEY });
    expect(w.tracks.length, 'control: tracked').toBeGreaterThan(0);
    for (const t of w.tracks) {
      expect(t.body.status).not.toBe('pro_wall');
      expect(t.body.wall_link_th).toBeUndefined();
    }
  }, 60_000);
});

describe('Q1: our QA marker reaches the call row', () => {
  it('X-DCHub-QA: 1 alone (host-looking UA) marks the wall row is_qa', async () => {
    const w = await wallCall({ 'x-dchub-qa': '1' });
    const row = w.tracks.find((t) => t.body.status === 'pro_wall' || t.body.status === 'lp_wall');
    expect(row, 'control: still logged as a wall (forensics keep the row)').toBeTruthy();
    expect(row.body.is_qa).toBe(true);
    expect(row.body.user_agent, 'control: the UA itself does not say QA').toBe('Claude-User');
  }, 60_000);
});

describe('N1: one id per session-less wall', () => {
  it('two session-less walls signal two distinct ids, each the sid inside its own link', async () => {
    const q0 = claimQs.length;
    const a = await wallCall({}, { session: false });
    const b = await wallCall({}, { session: false });
    for (const w of [a, b]) {
      expect(w.sc && w.sc.human_url, 'control: the session-less wall served a link').toMatch(/\/upgrade\/h\//);
      expect(w.signals.length, 'control: a paywall signal').toBe(1);
      const sid = w.signals[0].body.session_id;
      expect(sid).not.toBe('no-session');
      expect(sid).toBe(sidOf(w.sc.human_url));
      // the same id the wall publishes as request_id (#913) and the claim page keys on (be#6825)
      expect(sid).toBe(w.sc.request_id);
      expect(w.signals[0].body.message_shown).toBe('lp_wall_email');
      // the high-intent stage: its own paid hit, under the same id
      expect(w.paidHits.map((h) => h.body.session_id)).toContain(sid);
    }
    expect(a.signals[0].body.session_id).not.toBe(b.signals[0].body.session_id);
    const checks = claimQs.slice(q0);
    expect(checks.length, 'a claim check per wall').toBe(2);
    for (const qs of checks) expect(qs.get('wl')).toBe('1');
    expect(new Set(checks.map((qs) => qs.get('session_id'))).size).toBe(2);
  }, 60_000);
});

describe('_relayTokenHash / _wallLinkTokenHash (units)', () => {
  it('hashes the cleaned path token, ignores the query string, and is null for no relay link', () => {
    const tok = 'cGF5bG9hZA.' + 'a'.repeat(32);
    expect(H.S._relayTokenHash('https://dchub.cloud/upgrade/h/' + tok + '?pc=grok')).toBe(sha32(tok));
    expect(H.S._relayTokenHash('https://dchub.cloud/pricing')).toBeNull();
    expect(H.S._relayTokenHash('https://dchub.cloud/u/zzzzzz')).toBeNull();   // unknown code
    expect(H.S._wallLinkTokenHash({ structuredContent: { for_your_human: { url: 'https://dchub.cloud/upgrade/h/' + tok } } }))
      .toBe(sha32(tok));
    expect(H.S._wallLinkTokenHash({ structuredContent: { human_url: 'https://dchub.cloud/go/c/x.y' } })).toBeNull();
  });
});
