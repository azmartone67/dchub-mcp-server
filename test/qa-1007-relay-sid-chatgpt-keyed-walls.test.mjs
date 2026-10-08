// qa-1007-relay-sid-chatgpt-keyed-walls.test.mjs — QA sweep 2026-10-07 (MCP + conversion lanes)
//
// Three defects, measured live against dchub.cloud/mcp on 2026-10-07/08 and reproduced here
// through the real registered handlers under a real caller seat; only the backend is stubbed.
//
//   C2  A stateless anonymous call (no Mcp-Session-Id) minted its /upgrade/h relay token with
//       an EMPTY sid, while the same response's /go/c links carried an a- offer id. The
//       backend page then fell to an unsigned checkout with a constant client_reference_id,
//       so a payment could never be joined to the response. The token now carries the id the
//       /go/c links use (session → a- offer id → one per-request uuid, in that order).
//   C4  On the chatgpt platform the depth wall carried the long relay in structuredContent
//       only and no user_message, so the person was shown no path (13/13 chatgpt relay mints
//       in 30d counted "not delivered"). The depth wall now carries the hosted /u/<code> link
//       in user_message / for_your_human / human_url, with no stripe.com string anywhere.
//   F-1 A caller that PRESENTED a valid key was handed a fresh dch_trial_ key on every call,
//   F-5 plus retry_with_header / persist_command telling it to switch keys, and the wall said
//       "Or call `claim_free_key`". A keyed caller now mints nothing and is not told to claim.
//   F-6 A keyed Pro wall's for_your_human.url / user_message carried /go/c (a Stripe redirect)
//       while human_url carried /upgrade/h. The human fields now agree with human_url; the
//       machine field upgrade.upgrade_url keeps the key-bound /go/c.
//
// Each fix has a CONTROL in the other direction so a pass means the branch was taken, not
// that the assertion is vacuous: the anonymous seat still mints (F-1), the kill switch
// restores the empty sid (C2), and the step switched off leaves no user_message (C4).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const BASE = 'https://backend.qa-1007-relay-sid.test';
const SECRET = 'qa-1007-internal-key-not-a-real-secret';
const LIVE = 'dch_live_qa1007keyedwalltest00001';
const SHORT = 'https://dchub.cloud/u/abc234';
const sha = (k) => createHash('sha256').update(k).digest('hex');
const GO_RE = /https:\/\/dchub\.cloud\/go\/c\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/g;
const RELAY_RE = /^https:\/\/dchub\.cloud\/upgrade\/h\/([A-Za-z0-9_-]+)\.[0-9a-f]{32}/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Fields of a signed token's payload (plan|ref|sid|tool|arm for /go/c; sid|tool|tier|ts|kref for /upgrade/h). */
const goParts = (url) => Buffer.from(url.replace('https://dchub.cloud/go/c/', '').split('.')[0], 'base64url').toString().split('|');
const relayParts = (url) => {
  const m = RELAY_RE.exec(String(url || ''));
  if (!m) throw new Error('not a long relay link: ' + url);
  return Buffer.from(m[1], 'base64url').toString().split('|');
};
const text = (r) => r.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');

const QUEUE = { iso: 'PJM', as_of: '2026-10-07', project_count: 25, queued_generation_gw: 287.4,
  projects: Array.from({ length: 25 }, (_, i) => ({ project_name: 'Proj ' + i, queue_id: 'AF' + i,
    capacity_mw: 100 + i, county: 'York', state: 'PA', fuel_type: 'Gas', queue_status: 'Active' })) };
const SITE = {
  success: true, location: { lat: 39.0412345, lon: -77.4845678, state: 'VA' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, gas_pipeline_access: 71.3, fiber_connectivity: 95.4,
            market_conditions: 60.6, risk_resilience: 72.2 },
  interpretation: 'Excellent site', nearby: { substations_50km: 212, generation_capacity_mw: 5123.9 },
};
const MINT = { ok: true, api_key: 'dch_trial_qa1007mintedtrialkey0001', tier: 'IDENTIFIED', expires_at: null,
  daily_calls: 15, daily_calls_when_email_bound: 50, trial_days: 7, days_remaining: 7, reused: false };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

let S, TOOLS, realFetch, prevInternal, prevBase;
let mintHits = 0;
const saved = {};
const ENV = ['DCHUB_RELAY_SID_FALLBACK', 'DCHUB_CLEAN_WALL_LINE', 'DCHUB_MINT_SKIP_KEYED', 'DCHUB_ANON_ATTRIB',
  'DCHUB_PAYWALL_CONTRACT', 'DCHUB_PAYWALL_CONTRACT_GROK'];

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (p === '/api/v1/relay/short') {
      // Only the relay PAGE is shortened (body {relay_url}, _shortRelayPageLink). The /go/c
      // shortener (body {plan, ref, sid}, _shortRelayLink) fails open to the long link, as it
      // did on every keyed wall in the 2026-10-07 sweep.
      let body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch { body = {}; }
      return /\/upgrade\/h\//.test(String(body.relay_url || '')) ? json({ ok: true, code: 'abc234', url: SHORT }) : json({ ok: false });
    }
    if (p === '/api/v1/keys/auto-mint') { mintHits += 1; return json(MINT); }
    if (p === '/api/v1/keys/validate') {
      let key = '';
      try { key = JSON.parse((init && init.body) || '{}').api_key || ''; } catch { key = ''; }
      return json(key === LIVE ? { valid: true, tier: 'free', developer_id: 'dev_qa', email: 'qa@example.com' }
                               : { valid: false, tier: 'free', key_rejected: true });
    }
    if (p === '/api/v1/mcp/trial-check') return json({ trial_used: false, prior_calls: 0 });
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    if (p === '/api/site-score') return json(structuredClone(SITE));
    if (p === '/api/v1/interconnection-queue/by-iso') return json(structuredClone(QUEUE));
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});
beforeEach(() => {
  S.keyCache.clear();
  mintHits = 0;
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterAll(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

let seatN = 0;
// A keyless seat at tier 'free' lands on the depth preview (3 of 25 rows + trialHeader), the shape the
// sweep measured live; tier 'anonymous' lands on the paid_only hard wall. Both are exercised below.
const seat = (extra = {}) => ({
  tier: 'free', platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '198.51.100.' + (10 + (++seatN % 200)), session_id: 'sess-qa-1007-' + seatN, ...extra,
});
// The key arrives on the request's own header channel (identity.credential_source 'header', as measured).
const KEYED = (extra = {}) => seat({ api_key: LIVE, tier: 'free', is_trial: false, auth_source: 'header', ...extra });
async function call(name, args, s) {
  for (const m of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) if (m && m.clear) m.clear();
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const withCtx = (store, fn) => S._ctxALS.run({ ...store }, fn);

describe('C2 — the relay token carries the id the /go/c links carry', () => {
  it('keyless, sessionless: the token sid IS the a- offer id in every /go/c link of the request', () => {
    withCtx({ platform: 'claude', tier: 'anonymous' }, () => {
      const rel = S.buildHumanRelay('get_interconnection_queue', 'free', '');
      const pack = S._packCheckoutUrl('no-session');
      const sid = relayParts(rel.url)[0];
      expect(sid).toMatch(/^a-[0-9a-f]{32}$/);
      expect(goParts(pack)[1]).toBe(sid);                 // client_reference_id of the pack link
      expect(S._anonAttribRef()).toBe(sid);               // the one id this request minted
    });
  });

  it("the 'no-session' sentinel is no session", () => {
    withCtx({ session_id: 'no-session' }, () => {
      expect(relayParts(S.buildHumanRelay('rank_markets', 'free', 'no-session').url)[0]).toMatch(/^a-/);
    });
  });

  it('keyed, sessionless: one per-request uuid, in the token sid and beside the pk- ref in /go/c', () => {
    withCtx({ api_key: LIVE, tier: 'free' }, () => {
      const rel = S.buildHumanRelay('rank_markets', 'free', '');
      const parts = relayParts(rel.url);
      expect(parts[0]).toMatch(UUID_RE);
      expect(parts[4]).toBe('pk-' + sha(LIVE));             // r-relay-key-bind untouched
      const go = goParts(S._packCheckoutUrl(''));
      expect(go[1]).toBe('pk-' + sha(LIVE));
      expect(go[2]).toBe(parts[0]);                         // the same uuid, written beside the ref
      expect(S._requestFallbackSid()).toBe(parts[0]);       // memoised: a second read is the same id
    });
  });

  it('a real session is the id, byte for byte as before (no fallback fires)', () => {
    withCtx({ session_id: 'sess-real-0001' }, () => {
      expect(relayParts(S.buildHumanRelay('rank_markets', 'free').url)[0]).toBe('sess-real-0001');
      expect(S._requestFallbackSid()).toBe('');
      expect(S._goSessionFor('')).toBe('sess-real-0001');
    });
  });

  it('kill switch DCHUB_RELAY_SID_FALLBACK=0 restores the empty sid and the two-field /go/c', () => {
    process.env.DCHUB_RELAY_SID_FALLBACK = '0';
    withCtx({ api_key: LIVE, tier: 'free' }, () => {
      expect(relayParts(S.buildHumanRelay('rank_markets', 'free', '').url)[0]).toBe('');
      expect(goParts(S._packCheckoutUrl(''))).toHaveLength(2);
    });
  });

  it('off-request (no store) nothing is minted: the links stay as they were', () => {
    expect(S._requestFallbackSid()).toBe('');
    expect(relayParts(S.buildHumanRelay('rank_markets', 'free', '').url)[0]).toBe('');
  });

  it('a stateless anonymous get_interconnection_queue response: human_url sid == the id in its /go/c links', async () => {
    // Grok audit 2026-10-08 (one link per wall): the /go/c links this join reads are gone from the
    // wall by default; the property (one fallback id on every link) is pinned under the switch.
    process.env.DCHUB_WALL_ONE_LINK = '0';
    let r;
    try { r = await call('get_interconnection_queue', { iso: 'PJM' }, seat({ session_id: null })); }
    finally { delete process.env.DCHUB_WALL_ONE_LINK; }
    const sc = r.structuredContent;
    expect(sc.trial_preview === true || sc.preview_is_partial === true || Array.isArray(sc.projects), 'not the depth preview').toBe(true);
    expect(typeof sc.human_url).toBe('string');
    const sid = relayParts(sc.human_url)[0];
    expect(sid).not.toBe('');
    const links = JSON.stringify(r).match(GO_RE) || [];
    expect(links.length, 'no /go/c link in the response: the join below would be vacuous').toBeGreaterThan(0);
    for (const u of [...new Set(links)]) {
      const p = goParts(u);
      expect([p[1], p[2]], u).toContain(sid);
    }
    // for_your_human carries the same token as human_url
    expect(relayParts(sc.for_your_human.url)[0]).toBe(sid);
  });
});

describe('C4 — the chatgpt depth wall shows the person a hosted /u/ path', () => {
  const CHATGPT = (extra = {}) => seat({ platform: 'chatgpt', client_name_raw: 'openai-mcp', ...extra });

  it('user_message, for_your_human.url and human_url carry the /u/<code> link; no stripe.com anywhere', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, CHATGPT());
    const sc = r.structuredContent;
    expect(sc.user_message).toContain(SHORT);
    expect(sc.show_to_user).toBe(true);
    expect(sc.for_your_human.url).toBe(SHORT);
    expect(sc.for_your_human.text).toContain(SHORT);
    expect(sc.human_url).toBe(SHORT);
    const all = JSON.stringify(r);
    expect(all).not.toContain('stripe.com');
    expect(all).not.toContain('https://dchub.cloud/upgrade/h/');             // one link, written one way
    expect(text(r)).toContain(SHORT);                      // a text-only host sees it too
    expect(text(r).trimStart().startsWith('{')).toBe(true); // still the depth preview, data first
  });

  it('the anonymous-tier hard wall on chatgpt gets the same /u/ link (every copy of the long relay swapped)', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, CHATGPT({ tier: 'anonymous' }));
    const sc = r.structuredContent;
    expect(sc.error).toBe('paid_only');
    expect(sc.user_message).toContain(SHORT);
    expect(sc.for_your_human.url).toBe(SHORT);
    expect(sc.human_url).toBe(SHORT);
    expect(sc.upgrade && sc.upgrade.pricing && sc.upgrade.pricing.metered_url).toBe(SHORT);
    const all = JSON.stringify(r);
    expect(all).not.toContain('stripe.com');
    expect(all).not.toContain('https://dchub.cloud/upgrade/h/');
  });

  it('control: with the step off, the chatgpt depth wall carries no user_message (the step is what adds it)', async () => {
    process.env.DCHUB_CLEAN_WALL_LINE = '0';
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, CHATGPT());
    expect(r.structuredContent.user_message).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('stripe.com');  // the scrub never depended on this step
  });

  it('a non-clean platform is untouched by the step', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, seat({ platform: 'cursor', client_name_raw: 'cursor' }));
    const sc = r.structuredContent;
    expect(sc.human_url).toMatch(/\/upgrade\/h\//);
    expect(sc.human_url).not.toBe(SHORT);
  });
});

describe('F-1 / F-5 / F-6 — a caller that presented a valid key', () => {
  it('get_interconnection_queue: no auto_trial_key / retry_with_header / persist_command, no mint call, no claim_free_key', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, KEYED());
    const all = JSON.stringify(r);
    expect(mintHits).toBe(0);
    for (const k of ['auto_trial_key', 'retry_with_header', 'persist_command', 'dch_trial_']) expect(all).not.toContain(k);
    expect(text(r)).not.toContain('claim_free_key');
    expect(r.structuredContent.trial_preview === true || Array.isArray(r.structuredContent.projects), 'not the depth preview').toBe(true);
    const fy = r.structuredContent.for_your_human;
    expect(typeof fy.url).toBe('string');
    expect(fy.url.startsWith('https://dchub.cloud/upgrade/h/') || fy.url.startsWith('https://dchub.cloud/u/'), fy.url).toBe(true);
    expect(r.structuredContent.human_url).toBe(fy.url);
  });

  it('control: the truly anonymous caller still gets the inline trial (one mint, auto_trial_key present)', async () => {
    const r = await call('get_interconnection_queue', { iso: 'PJM' }, seat());
    expect(mintHits).toBe(1);
    expect(r.structuredContent.auto_trial_key).toBe(MINT.api_key);
    expect(text(r)).toContain('claim_free_key');            // the keyless wall keeps its free rung
  });

  it('a key the session RESTORED (not presented on this request) keeps the inline-trial ack path', async () => {
    // The gate is "presented": an auto-bound / session-restored key arrived on no channel, and
    // test/relay-cap-one-human-line pins that seat's one ACK line. Same mint as before here.
    await call('get_interconnection_queue', { iso: 'PJM' }, KEYED({ auth_source: 'session_restore' }));
    expect(mintHits).toBe(1);
    expect(S._keyPresentedOnRequest({ api_key: LIVE, auth_source: 'session_restore' })).toBe(false);
    for (const ch of ['header', 'bearer', 'query', 'inline_argument']) {
      expect(S._keyPresentedOnRequest({ api_key: LIVE, auth_source: ch }), ch).toBe(true);
    }
    expect(S._keyPresentedOnRequest({ api_key: null, auth_source: 'header' })).toBe(false);
  });

  it('kill switch DCHUB_MINT_SKIP_KEYED=0 restores the keyed mint (proves the gate is the branch taken)', async () => {
    process.env.DCHUB_MINT_SKIP_KEYED = '0';
    await call('get_interconnection_queue', { iso: 'PJM' }, KEYED());
    expect(mintHits).toBe(1);
  });

  it('F-6 keyed analyze_site: for_your_human.url, user_message and upgrade.upgrade_url all agree with human_url (one link, 2026-10-08)', async () => {
    const r = await call('analyze_site', { lat: 39.0412345, lon: -77.4845678 }, KEYED());
    const sc = r.structuredContent;
    expect(sc._wall).toBe(true);
    expect(typeof sc.human_url).toBe('string');
    expect(sc.human_url).toMatch(/^https:\/\/dchub\.cloud\/(upgrade\/h\/|u\/)/);
    expect(sc.for_your_human.url).toBe(sc.human_url);
    expect(sc.user_message).toContain(sc.human_url);
    expect(sc.user_message).not.toContain('/go/c/');
    expect(sc.for_your_human.text).not.toContain('/go/c/');
    // Grok audit 2026-10-08 (one link per wall): the machine field points at the same page; the
    // payer-key binding rides the token's pk- (below), which routes/human_relay binds Pro to.
    expect(sc.upgrade && sc.upgrade.upgrade_url).toBe(sc.human_url);
    expect(JSON.stringify(r)).not.toMatch(/dchub\.cloud\/go\/c\//);
    // the keyed relay token binds the same key
    expect(relayParts(sc.human_url)[4]).toBe('pk-' + sha(LIVE));
  });
});
