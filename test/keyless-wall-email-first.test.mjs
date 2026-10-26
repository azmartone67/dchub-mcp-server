// Keyless wall, email first + keyless trial offer + quota_wall_hit (owner-approved 2026-10-16).
//
//   A. a keyless land/site caller WITH a session that hits the anonymous per-IP caps gets the
//      email unlock first: ONE offer line + human_url (a /u/ short of a signed relay born
//      w-freekey, w-siteruns for analyze_site), claim_free_key as the last line, no plan, no
//      price, no checkout; remaining_this_month 0 + resets_at (next UTC month start).
//      No session, a keyed caller, or DCHUB_KEYLESS_EMAIL_FIRST=0: the earlier wall.
//   B. the keyless analyze_site email wall asks the backend's Pro-trial decide with the
//      sk-<sha256(session)> identity and trigger keyless_wall; the offer arm's link carries
//      ?offer=pro_trial_7d, the holdout's does not; no session or flag off: no ask.
//   C. every walled call POSTs one quota_wall_hit to /api/v1/mcp/funnel-event; a served call
//      does not; QA callers are sent is_qa; DCHUB_QUOTA_WALL_EVENT=0 sends none.
//
// Real server.mjs app on loopback, stub backend; no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { _resetCapWallDay } from '../lib/keyless-wall.mjs';

// Wall email option C (owner 2026-10-26): an identity's first cap wall of the UTC day carries the
// email link alone; the no-email claim_free_key exit returns from its second wall that day.
const FIRST_LINE = (link) => new RegExp('^Keep going free: show your human this link → '
  + link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\. One email unlocks \\d+ calls a day and the full answer to this question\\.$');
const NO_EMAIL_LINE = 'If the user prefers not to give an email, call `claim_free_key` (one call, no email).';
// This file pins the copy the inner wall/retention steps build; the lean step (lib/lean-response.mjs,
// agent QA A 2026-10-20) trims it to one ask on /mcp. Off here so these guards keep testing the inner
// steps; test/lean-response.test.mjs guards the default.
process.env.DCHUB_LEAN_RESPONSES = '0';

const INTERNAL = 'test-internal-key-not-a-real-secret';
const UA = { 'user-agent': 'Claude-User' };
const SHORT = 'https://dchub.cloud/u/abcdef';
const SITE = () => ({
  success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' }, overall_score: 81.8,
  scores: { power_infrastructure: 96.9, fiber_connectivity: 64.2, gas_pipeline_access: 55.1,
            market_conditions: 72.3, risk_resilience: 48.6 },
  nearby: { facilities_100km: 41, substations_50km: 12 }, source: 'DC Hub Site Intelligence',
});

let H, fence, anonCount = 0, ipN = 0, decideArm = 'offer', shortFail = false;
const shortReqs = [];
const decideReqs = [];

async function settle(quietMs = 250, maxMs = 5000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call(name, args, { session = true, key = null, extraHdr = {} } = {}) {
  const hdr = { ...UA, 'x-dc-client-ip': `198.51.100.${++ipN}`, ...(key ? { 'x-api-key': key } : {}), ...extraHdr };
  let sid = null;
  if (session) {
    const init = await H.init('/mcp', 'claude-ai', hdr);
    sid = init.headers.get('mcp-session-id');
  }
  H.S._anonUsageCounts.clear();
  const before = H.hits.length;
  const r = await H.call('/mcp', name, args, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const hits = H.hits.slice(before);
  const res = (r.msg && r.msg.result) || {};
  return {
    sid, res, sc: res.structuredContent || {},
    text: (res.content || []).map((x) => x.text || '').join('\n'),
    events: hits.filter((h) => h.path === '/api/v1/mcp/funnel-event' && h.body).map((h) => h.body),
    status: hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === name).map((h) => h.body.status),
  };
}
function relayFields(url) {
  const m = /\/upgrade\/h\/([A-Za-z0-9_-]+)\.([0-9a-f]{32})/.exec(url || '');
  if (!m) return null;
  const sig = createHmac('sha256', INTERNAL).update(m[1]).digest('hex').slice(0, 32);
  return { fields: Buffer.from(m[1], 'base64url').toString().split('|'), sigOk: sig === m[2] };
}
// Agent-facing copy rules: no plan name, no price, no "/mo", no checkout link.
function copyViolations(res) {
  const s = JSON.stringify(res);
  const out = [];
  if (/\bPro\b|Developer|Starter|Founding/.test(s)) out.push('plan name');
  if (/\$\s?\d|USD\s?\d/.test(s)) out.push('price');
  if (/\/mo\b|per month/i.test(s)) out.push('/mo');
  if (/\/go\/c\/|buy\.stripe\.com/.test(s)) out.push('checkout link');
  return out;
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_ANON_DAILY_CAP: '30', DCHUB_ANON_HARD_WALL_MULT: '10' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/mcp/anon-usage') return { ok: true, count: anonCount };
      if (p === '/api/v1/relay/short') {
        shortReqs.push(body);
        if (shortFail) return { status: 500, body: { error: 'down' } };
        return (body && body.relay_url) ? { ok: true, url: SHORT } : { status: 500, body: { error: 'no' } };
      }
      if (p === '/api/v1/mcp/pro-trial-offer/decide') {
        decideReqs.push(body);
        return { fire: true, arm: decideArm, offer: decideArm === 'offer' ? 'pro_trial_7d' : null };
      }
      if (p === '/api/site-score') return SITE();
      return undefined;
    },
  });
  H.S._readDeadline.signal = () => AbortSignal.timeout(120_000);
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => {
  anonCount = 0; decideArm = 'offer'; shortFail = false; shortReqs.length = 0; decideReqs.length = 0;
  for (const k of ['DCHUB_KEYLESS_EMAIL_FIRST', 'DCHUB_QUOTA_WALL_EVENT', 'DCHUB_PRO_TRIAL_OFFER',
                   'DCHUB_PRO_TRIAL_OFFER_KEYLESS', 'DCHUB_GATED_PREVIEW', 'DCHUB_WALL_NO_EMAIL_EXIT_DELAY',
                   'DCHUB_KEYLESS_EMAIL_FIRST_ALL']) delete process.env[k];
  _resetCapWallDay();
});

describe('A. anonymous hard wall, keyless with a session: email first', () => {
  it('find_sites: one email line + human_url, claim_free_key last, no plan/price/checkout, quota fields', async () => {
    anonCount = 999;
    const ip = { 'x-dc-client-ip': '203.0.113.11' };
    // option C: the day's first wall for this IP carries the email link alone
    const f = await call('find_sites', { state: 'TX', min_mw: 50 }, { extraHdr: ip });
    expect(f.status).toEqual(['anon_hard_wall']);
    expect(f.sc.unlock_kind).toBe('email_cap');
    expect(f.sc.user_message).toMatch(FIRST_LINE(SHORT));
    expect(f.text.split('\n')[0]).toMatch(FIRST_LINE(SHORT));
    expect(f.text).not.toContain('claim_free_key');
    expect(f.sc.next_tool).toBeUndefined();
    expect(f.sc.free_key_unlock).toBeUndefined();
    expect(f.sc.next_step).toBe('human_url');
    expect(f.sc.human_url).toBe(SHORT);
    expect(copyViolations(f.res)).toEqual([]);
    // the second wall that day: the no-email exit is back, exactly as before
    shortReqs.length = 0;
    const r = await call('find_sites', { state: 'TX', min_mw: 50 }, { extraHdr: ip });
    expect(r.status).toEqual(['anon_hard_wall']);
    expect(r.sc.unlock_kind).toBe('email_cap');
    expect(r.sc.user_message).toBe('Keep going free by email → ' + SHORT);
    expect(r.sc.human_url).toBe(SHORT);
    expect(r.text.split('\n')[0]).toBe('Keep going free by email → ' + SHORT);
    // claim_free_key only as the last line, after the email ask
    expect(r.text.indexOf('claim_free_key')).toBeGreaterThan(r.text.indexOf('Keep going free by email'));
    expect(r.text.split('\n').find((l) => l.includes('claim_free_key')))
      .toBe('If the user prefers not to give an email, call `claim_free_key` (one call, no email).');
    expect(r.sc.remaining_this_month).toBe(0);
    expect(r.sc.resets_at).toMatch(/^\d{4}-\d{2}-01T00:00:00Z$/);
    expect(new Date(r.sc.resets_at) > new Date()).toBe(true);
    expect(r.sc.credits_url).toBeUndefined();
    expect(copyViolations(r.res)).toEqual([]);
    // the page link is a signed relay for THIS session, born w-freekey (the email unlock page)
    const rel = shortReqs.map((b) => relayFields(b.relay_url)).find(Boolean);
    expect(rel && rel.sigOk).toBe(true);
    expect(rel.fields[0]).toBe(r.sid);
    expect(rel.fields[1]).toBe('find_sites');
    expect(rel.fields).toContain('w-freekey');
    expect(rel.fields).not.toContain('w-capacity');
  });

  it('short-link outage: the long relay is the one link and stays w-freekey (never re-stamped capacity)', async () => {
    anonCount = 999;
    shortFail = true;
    const r = await call('find_sites', { state: 'TX' });
    expect(r.sc.unlock_kind).toBe('email_cap');
    const rel = relayFields(r.sc.human_url);
    expect(rel && rel.sigOk).toBe(true);
    expect(rel.fields).toContain('w-freekey');
    expect(rel.fields).not.toContain('w-capacity');
    expect(r.sc.user_message).toMatch(FIRST_LINE(r.sc.human_url));   // option C: the day's first wall
  });

  it('option C kill switch DCHUB_WALL_NO_EMAIL_EXIT_DELAY=0: the first wall carries the no-email exit', async () => {
    anonCount = 999;
    process.env.DCHUB_WALL_NO_EMAIL_EXIT_DELAY = '0';
    const r = await call('find_sites', { state: 'TX' });
    expect(r.sc.user_message).toBe('Keep going free by email → ' + SHORT);
    expect(r.text.split('\n').find((l) => l.includes('claim_free_key'))).toBe(NO_EMAIL_LINE);
    expect(r.sc.next_tool).toBe('claim_free_key');
  });

  it('analyze_site: the relay is born w-siteruns (its own email unlock page)', async () => {
    anonCount = 999;
    const r = await call('analyze_site', { lat: 33.45, lon: -112.07 });
    expect(r.status).toEqual(['anon_hard_wall']);
    expect(r.sc.unlock_kind).toBe('email_cap');
    const rel = shortReqs.map((b) => relayFields(b.relay_url)).find(Boolean);
    expect(rel.fields).toContain('w-siteruns');
    expect(copyViolations(r.res)).toEqual([]);
  });

  it('CONTROL: no session keeps the earlier wall (claim_free_key first, no email unlock)', async () => {
    anonCount = 999;
    const r = await call('find_sites', { state: 'TX' }, { session: false });
    expect(r.status).toEqual(['anon_hard_wall']);
    expect(r.sc.unlock_kind).toBeUndefined();
    expect(r.text).toContain('claim_free_key');
    expect(r.text).not.toContain('Keep going free by email');
  });

  it('CONTROL: a tool outside the land/site set keeps the earlier wall', async () => {
    anonCount = 999;
    const r = await call('search_facilities', { query: 'ashburn' });
    expect(r.status).toEqual(['anon_hard_wall']);
    expect(r.sc.unlock_kind).toBeUndefined();
    expect(r.text).not.toContain('Keep going free by email');
  });

  it('kill switch DCHUB_KEYLESS_EMAIL_FIRST=0 restores the earlier wall', async () => {
    anonCount = 999;
    process.env.DCHUB_KEYLESS_EMAIL_FIRST = '0';
    const r = await call('find_sites', { state: 'TX' });
    expect(r.status).toEqual(['anon_hard_wall']);
    expect(r.sc.unlock_kind).toBeUndefined();
    expect(r.text).not.toContain('Keep going free by email');
  });
});

describe('C wide: every tool\'s soft cap is email first, except where the email unlocks nothing', () => {
  it('search_facilities (not land/site) over the soft cap: email first, relay born w-freekey', async () => {
    anonCount = 50;
    const r = await call('search_facilities', { query: 'ashburn' });
    expect(r.status).toEqual(['anon_daily_cap']);
    const up = r.sc._upgrade || {};
    expect(up.unlock_kind).toBe('email_cap');
    expect(r.sc.user_message).toMatch(FIRST_LINE(SHORT));
    const rel = shortReqs.map((b) => relayFields(b.relay_url)).find(Boolean);
    expect(rel && rel.fields).toContain('w-freekey');
    expect(copyViolations({ up, line: r.sc.user_message, fyh: r.sc.for_your_human })).toEqual([]);
  });
  it('scope: email first everywhere on the soft cap except a Pro-only tool and get_market_intel', () => {
    const f = H.S._keylessEmailFirstTool;
    expect(typeof f).toBe('function');
    expect(f('search_facilities', { wide: true })).toBe(true);
    expect(f('get_grid_intelligence', { wide: true })).toBe(true);
    expect(f('get_market_intel', { wide: true })).toBe(false);     // the backend unlock refuses it
    expect(f('compare_sites', { wide: true })).toBe(false);        // Pro-only: an email unlocks nothing
    expect(f('find_sites')).toBe(true);                            // land/site: both walls, as before
    expect(f('search_facilities')).toBe(false);                    // the hard wall keeps its scope
    expect(f('search_facilities', { wide: true, env: { DCHUB_KEYLESS_EMAIL_FIRST_ALL: '0' } })).toBe(false);
  });
  it('switch DCHUB_KEYLESS_EMAIL_FIRST_ALL=0 restores the land/site-only scope', async () => {
    anonCount = 50;
    process.env.DCHUB_KEYLESS_EMAIL_FIRST_ALL = '0';
    const r = await call('search_facilities', { query: 'ashburn' });
    expect(r.status).toEqual(['anon_daily_cap']);
    expect((r.sc._upgrade || {}).unlock_kind).not.toBe('email_cap');
    expect(r.text).not.toContain('Keep going free');
  });
  it('the hard wall keeps its land/site scope (the pack buys the day, #838)', async () => {
    anonCount = 999;
    const r = await call('search_facilities', { query: 'ashburn' });
    expect(r.status).toEqual(['anon_hard_wall']);
    expect(r.sc.unlock_kind).toBeUndefined();
  });
});

describe('A. anonymous soft cap: the preview stays, its nudge is email first', () => {
  it('site_selection_canvas over the soft cap: _upgrade leads with the email line, data still served', async () => {
    anonCount = 50;
    const ip = { 'x-dc-client-ip': '203.0.113.12' };
    const f = await call('site_selection_canvas', { state: 'TX', target_mw: 200 }, { extraHdr: ip });
    const fu = f.sc._upgrade || {};
    expect(fu.unlock_kind).toBe('email_cap');
    expect(fu.message).not.toContain('claim_free_key');            // option C: first wall, no exit
    expect(fu.next_tool).toBeUndefined();
    expect(fu.next_step).toBe('human_url');
    expect(f.sc.user_message).toMatch(FIRST_LINE(SHORT));
    const r = await call('site_selection_canvas', { state: 'TX', target_mw: 200 }, { extraHdr: ip });
    expect(r.status).toEqual(['anon_daily_cap']);
    const up = r.sc._upgrade || {};
    expect(up.unlock_kind).toBe('email_cap');
    expect(up.next_tool).toBe('claim_free_key');
    expect(up.message.endsWith(NO_EMAIL_LINE)).toBe(true);
    expect(up.message.startsWith('Keep going free by email → ' + SHORT)).toBe(true);
    expect(up.remaining_this_month).toBe(0);
    expect(r.sc.human_url).toBe(SHORT);
    // the stub's data rows plant a price and plan name on purpose (harness dataBody); the
    // copy this item writes is the nudge and the person's line
    expect(copyViolations({ up, line: r.sc.user_message, fyh: r.sc.for_your_human })).toEqual([]);
  });
});

describe('B. keyless analyze_site email wall: the trial offer decision', () => {
  it('offer arm: decide is asked with sk-<sha256(session)> + keyless_wall; the link carries ?offer=', async () => {
    process.env.DCHUB_PRO_TRIAL_OFFER = '1';
    decideArm = 'offer';
    const r = await call('analyze_site', { lat: 33.45, lon: -112.07 });
    expect(decideReqs.length).toBe(1);
    expect(decideReqs[0].identity).toBe('sk-' + createHash('sha256').update(r.sid).digest('hex'));
    expect(decideReqs[0].trigger).toBe('keyless_wall');
    expect(decideReqs[0].session_id).toBe(r.sid);
    const urls = shortReqs.map((b) => b.relay_url).filter(Boolean);
    expect(urls.some((u) => /\?offer=pro_trial_7d/.test(u))).toBe(true);
    const rel = relayFields(urls.find((u) => /\?offer=/.test(u)));
    expect(rel.sigOk).toBe(true);
    expect(rel.fields).toContain('w-siteruns');
    expect(r.sc.unlock_kind).toBe('email');
    expect(r.sc.remaining_this_month).toBe(0);
    expect(copyViolations(r.res)).toEqual([]);
  });

  it('holdout arm: the same wall, plain link', async () => {
    process.env.DCHUB_PRO_TRIAL_OFFER = '1';
    decideArm = 'holdout';
    await call('analyze_site', { lat: 33.45, lon: -112.07 });
    expect(decideReqs.length).toBe(1);
    expect(shortReqs.map((b) => b.relay_url).filter(Boolean).some((u) => /offer=/.test(u))).toBe(false);
  });

  it('no ask: offer flag off, keyless switch off, or no session', async () => {
    await call('analyze_site', { lat: 33.45, lon: -112.07 });
    process.env.DCHUB_PRO_TRIAL_OFFER = '1';
    process.env.DCHUB_PRO_TRIAL_OFFER_KEYLESS = '0';
    await call('analyze_site', { lat: 33.45, lon: -112.07 });
    delete process.env.DCHUB_PRO_TRIAL_OFFER_KEYLESS;
    await call('analyze_site', { lat: 33.45, lon: -112.07 }, { session: false });
    expect(decideReqs).toEqual([]);
  });

  it('QA callers are never assigned', async () => {
    process.env.DCHUB_PRO_TRIAL_OFFER = '1';
    // header-only QA (a normal UA): the UA form is already caught as a bot/internal context
    await call('analyze_site', { lat: 33.45, lon: -112.07 }, { extraHdr: { 'x-dchub-qa': '1' } });
    await call('analyze_site', { lat: 33.45, lon: -112.07 }, { extraHdr: { 'user-agent': 'dchub-qa-readonly/0.1' } });
    expect(decideReqs).toEqual([]);
    // CONTROL: the same call without the QA marker is asked
    await call('analyze_site', { lat: 33.45, lon: -112.07 });
    expect(decideReqs.length).toBe(1);
  });
});

describe('C. quota_wall_hit', () => {
  it('one event per walled call, with the wall status and the session; none for a served call', async () => {
    anonCount = 999;
    const w = await call('find_sites', { state: 'TX' });
    expect(w.events.length).toBe(1);
    expect(w.events[0]).toMatchObject({ event: 'quota_wall_hit', tool: 'find_sites', wall_status: 'anon_hard_wall',
                                        session_id: w.sid, is_qa: false });
    anonCount = 0;
    const ok = await call('search_facilities', { query: 'ashburn' });
    expect(ok.status).toEqual(['ok']);
    expect(ok.events).toEqual([]);
  });

  it('the keyless analyze_site wall writes one (pro_wall or lp_wall), flagged is_qa for a QA caller', async () => {
    const r = await call('analyze_site', { lat: 33.45, lon: -112.07 });
    expect(r.events.length).toBe(1);
    expect(['pro_wall', 'lp_wall']).toContain(r.events[0].wall_status);
    expect(r.events[0].paid_blocked).toBe(true);
    const q = await call('analyze_site', { lat: 33.45, lon: -112.07 }, { extraHdr: { 'x-dchub-qa': '1' } });
    expect(q.events.length).toBe(1);
    expect(q.events[0].is_qa).toBe(true);
  });

  // Wall email option E (owner 2026-10-26): the event names the email ask the wall showed.
  it('option E: the email-first wall reports link (first wall) then link_exit; a wall with no email link reports none', async () => {
    anonCount = 999;
    const ip = { 'x-dc-client-ip': '203.0.113.13' };
    const f = await call('find_sites', { state: 'TX' }, { extraHdr: ip });
    expect(f.events.length).toBe(1);
    expect(f.events[0].email_ask).toBe('link');
    const w = await call('find_sites', { state: 'TX' }, { extraHdr: ip });
    expect(w.events.length).toBe(1);
    expect(w.events[0].email_ask).toBe('link_exit');
    const n = await call('search_facilities', { query: 'ashburn' });
    expect(n.status).toEqual(['anon_hard_wall']);
    expect(n.events.length).toBe(1);
    expect(n.events[0]).not.toHaveProperty('email_ask');
  });

  // Option E fix (2026-10-26): the event leaves after the outer response steps, so an ask they add
  // is on it. Live before this, every wall read email_ask none: the grid/queue email line is written
  // by _wallEmailLineStep, which runs after the handler that used to send the event.
  it('option E: a grid / queue wall reports the email line its outer step wrote (line), once', async () => {
    for (const t of ['get_grid_intelligence', 'get_interconnection_queue']) {
      const r = await call(t, { iso: 'PJM' });
      expect(r.status).toEqual(['trial_used']);
      expect(r.events.length).toBe(1);
      expect(r.events[0]).toMatchObject({ event: 'quota_wall_hit', tool: t, wall_status: 'trial_used', email_ask: 'line' });
    }
  });

  it('option E: DCHUB_WALL_HIT_DEFER=0 sends from the handler again (the line is not on it yet)', async () => {
    process.env.DCHUB_WALL_HIT_DEFER = '0';
    try {
      const r = await call('get_grid_intelligence', { iso: 'PJM' });
      expect(r.events.length).toBe(1);
      expect(r.events[0]).not.toHaveProperty('email_ask');
    } finally { delete process.env.DCHUB_WALL_HIT_DEFER; }
  });

  it('kill switch DCHUB_QUOTA_WALL_EVENT=0 sends none', async () => {
    process.env.DCHUB_QUOTA_WALL_EVENT = '0';
    anonCount = 999;
    const w = await call('find_sites', { state: 'TX' });
    expect(w.status).toEqual(['anon_hard_wall']);
    expect(w.events).toEqual([]);
  });
});
