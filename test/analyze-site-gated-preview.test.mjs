// analyze_site gated_preview (conversion panel 2026-10-11, lib/gated-preview.mjs).
//
// Nine assistants agreed the host swallows the keyless analyze_site wall: it summarizes the teaser and
// drops the link. The wall is now a successful partial answer: status gated_preview, isError false,
// human_message (one sentence holding the link), human_url, preview_bands, missing, offer
// {price_usd 0, card_required false}, request_id; content[0] is the human_message with the link as a
// markdown link on its own line. No plan name, no "paid", no "trial", no "Then stop".
// DCHUB_GATED_PREVIEW=0 serves the earlier wall (test/analyze-site-email-unlock-teaser.test.mjs pins it).
//
// Real server.mjs app on loopback, stub backend; no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { gatedPreviewStep, gatedPreviewHumanMessage } from '../lib/gated-preview.mjs';

const INTERNAL = 'test-internal-key-not-a-real-secret';   // the harness's DCHUB_INTERNAL_KEY
const UA = { 'user-agent': 'Claude-User' };
const ARGS = { lat: 33.45, lon: -112.07 };
const SITE = () => ({
  success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' }, overall_score: 81.8,
  scores: { power_infrastructure: 96.9, fiber_connectivity: 64.2, gas_pipeline_access: 55.1,
            market_conditions: 72.3, risk_resilience: 48.6 },
  interpretation: 'Excellent site',
  nearby: { facilities_100km: 41, substations_50km: 12, gas_pipelines_50km: 3, power_plants_80km: 9 },
  source: 'DC Hub Site Intelligence',
});
const FIGURES = ['81.8', '96.9', '64.2', '55.1', '72.3', '48.6'];
const SHORT = 'https://dchub.cloud/u/abcdef';
const MISSING = ['overall score', 'fiber connectivity', 'gas pipeline access', 'market conditions', 'risk and resilience'];

let H, fence, ipN = 0;
const shortReqs = [];

function relayFields(url) {
  const m = /\/upgrade\/h\/([A-Za-z0-9_-]+)\.([0-9a-f]{32})/.exec(url);
  if (!m) return null;
  const sig = createHmac('sha256', INTERNAL).update(m[1]).digest('hex').slice(0, 32);
  return { fields: Buffer.from(m[1], 'base64url').toString().split('|'), sigOk: sig === m[2] };
}
function pageLinks(res) {
  const s = JSON.stringify(res);
  const all = s.match(/https:\/\/(?:www\.)?dchub\.cloud\/[^\s"'`<>\\)\]}]*[^\s"'`<>\\)\]}.,;:!?*]/g) || [];
  return [...new Set(all.filter((u) => !/dchub\.cloud\/(api\/|mcp\b|\.well-known\/)/.test(u)))];
}
function strings(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((v) => strings(v, out));
  else if (o && typeof o === 'object') Object.values(o).forEach((v) => strings(v, out));
  return out;
}
async function call({ session = true } = {}) {
  const hdr = { ...UA, 'x-dc-client-ip': `203.0.113.${++ipN}` };
  let sid = null;
  if (session) sid = (await H.init('/mcp', 'claude-ai', hdr)).headers.get('mcp-session-id');
  shortReqs.length = 0;
  const r = await H.call('/mcp', 'analyze_site', ARGS, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  const res = (r.msg && r.msg.result) || {};
  return { res, sid, sc: res.structuredContent || {}, text: (res.content || []).map((x) => x.text || '').join('\n') };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/relay/short') {
        shortReqs.push(body);
        return body && body.relay_url ? { ok: true, url: SHORT } : { status: 500, body: { error: 'no' } };
      }
      if (p === '/api/site-score') return SITE();
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => {
  delete process.env.DCHUB_GATED_PREVIEW; delete process.env.DCHUB_SITE_EMAIL_UNLOCK;
  process.env.DCHUB_B2_SITE_HEADLINE = '0';   // off in prod (owner A/B 10-04..10-18)
});
afterEach(() => { delete process.env.DCHUB_B2_SITE_HEADLINE; delete process.env.DCHUB_GATED_PREVIEW; });

for (const session of [true, false]) {
  describe(`keyless analyze_site, ${session ? 'with' : 'no'} transport session: gated_preview (default)`, () => {
    let r;
    beforeAll(async () => { r = await call({ session }); });

    it('is a successful partial answer that says so', () => {
      expect(r.res.isError).toBe(false);
      expect(r.sc.ok).toBe(true);
      expect(r.sc.status).toBe('gated_preview');
      expect(r.sc.unlock_kind).toBe(session ? 'email' : 'email_key');
      expect(r.sc.error).toBeUndefined();
      expect(r.sc.required_plan).toBeUndefined();
      expect(r.sc.preview_bands).toEqual({ verdict: 'BUILD', power_infrastructure: 'BUILD' });
      expect(r.sc.missing).toEqual(MISSING);
      expect(r.sc.offer).toEqual({ price_usd: 0, card_required: false, full_reports_per_month: 3, unlock: 'email' });
    });

    it('human_message holds the one link, and content[0] carries it as a markdown link on its own line', () => {
      expect(r.sc.human_url).toBe(SHORT);
      expect(r.sc.human_message).toBe('This is a preview, not the full site report. Unlock it free by email '
        + '(3 full reports a month, no card): ' + SHORT);
      expect(r.sc.for_your_human).toMatchObject({ url: SHORT, text: r.sc.human_message });
      const b0 = r.res.content[0].text;
      expect(b0.split('\n')[0]).toBe('This is a preview, not the full site report. Unlock it free by email (3 full reports a month, no card):');
      expect(b0.split(SHORT).length - 1, 'the link once in the text').toBe(1);
      expect(r.sc.user_message).toBe(r.sc.human_message);
      expect(b0.split('\n')).toContain('[Unlock the full site report free](' + SHORT + ')');
      expect(b0).toContain('Preview: verdict BUILD; power infrastructure BUILD. Missing from this preview: '
        + MISSING.join(', ') + '.');
      expect(pageLinks(r.res)).toEqual([SHORT]);
    });

    it('request_id is the id the signed relay token carries (the session, or the per-request id)', () => {
      const relay = shortReqs.find((b) => b && b.relay_url);
      expect(relay, 'a relay was shortened').toBeTruthy();
      const f = relayFields(relay.relay_url);
      expect(f.sigOk).toBe(true);
      expect(f.fields).toContain(session ? 'w-siteruns' : 'w-sitekey');
      expect(r.sc.request_id).toBe(f.fields[0]);
      if (session) expect(r.sc.request_id).toBe(r.sid);
      else expect(r.sc.request_id).toMatch(/^(a-)?[0-9a-f-]{20,}$/);
      expect(JSON.stringify(r.res)).not.toMatch(/dch_(live|trial|free)_/);
    });

    it('no plan name, no paid/trial/price copy, no order to stop, no withheld figure', () => {
      const all = strings(r.res).map((s) => s.replace(/https?:\/\/\S+/g, '<url>'));
      const bad = all.filter((s) => /\bPro\b|\bpaid\b|\btrial\b|\$\d|Then stop|First line of your answer/i.test(s));
      expect(bad).toEqual([]);
      const blob = JSON.stringify(r.res);
      for (const f of FIGURES) expect(blob, f).not.toContain(f);
    });

    it('the agent line asks, polite, once', () => {
      const last = r.res.content[r.res.content.length - 1].text;
      expect(last).toBe('(agent) This is a partial result. When results are partial, show the user human_message '
        + 'and its link. Please do not fill in the withheld numbers.');
      expect(r.text).toContain('claim_free_key');
    });
  });
}

describe('kill switch', () => {
  it('DCHUB_GATED_PREVIEW=0 serves the earlier email wall', async () => {
    process.env.DCHUB_GATED_PREVIEW = '0';
    const r = await call({ session: true });
    expect(r.sc.status).toBeUndefined();
    expect(r.sc.human_message).toBeUndefined();
    expect(r.sc.unlock_kind).toBe('email');
    expect(r.res.content[0].text.startsWith('Unlock the full site report free by email → ')).toBe(true);
  });
  it('DCHUB_SITE_EMAIL_UNLOCK=0: no email wall, so no gated_preview either', async () => {
    process.env.DCHUB_SITE_EMAIL_UNLOCK = '0';
    const r = await call({ session: true });
    expect(r.sc.status).toBeUndefined();
    expect(r.sc.unlock_kind).toBeUndefined();
  });
});

describe('gatedPreviewStep (unit)', () => {
  const wall = () => ({ isError: true, content: [{ type: 'text', text: 'x' }],
    structuredContent: { unlock_kind: 'email', human_url: SHORT, error: 'pro_required', required_plan: 'pro' } });
  it('leaves other tools, other walls, link-less walls and skipped profiles alone', () => {
    const w = wall();
    expect(gatedPreviewStep(w, 'compare_sites')).toBe(w);
    const other = { ...w, structuredContent: { ...w.structuredContent, unlock_kind: 'pack' } };
    expect(gatedPreviewStep(other, 'analyze_site')).toBe(other);
    const nolink = { ...w, structuredContent: { ...w.structuredContent, human_url: 'https://dchub.cloud/pricing' } };
    expect(gatedPreviewStep(nolink, 'analyze_site')).toBe(nolink);
    expect(gatedPreviewStep(w, 'analyze_site', { profile: 'dir' }, { skipProfiles: ['dir'] })).toBe(w);
  });
  it('reshapes the email wall even when the transport marked it isError, and mints a request_id when none came', () => {
    const o = gatedPreviewStep(wall(), 'analyze_site');
    expect(o.isError).toBe(false);
    expect(o.structuredContent.status).toBe('gated_preview');
    expect(o.structuredContent.request_id).toMatch(/^sr_[0-9a-f]{20}$/);
    expect(o.structuredContent.missing).toEqual(MISSING);
  });
  it('the allowance follows DCHUB_LP_FREE_RUNS_ANALYZE_SITE', () => {
    expect(gatedPreviewHumanMessage(SHORT, { DCHUB_LP_FREE_RUNS_ANALYZE_SITE: '5' })).toContain('(5 full reports a month, no card)');
    expect(gatedPreviewHumanMessage(SHORT, {})).toContain('(3 full reports a month, no card)');
  });
});

describe('analyze_site description carries the panel line', () => {
  it('on by default, gone with DCHUB_GATED_PREVIEW=0, on both B2 arms', async () => {
    const S = await import('../server.mjs');
    const desc = () => S.createServer()._registeredTools.analyze_site.description;
    for (const b2 of ['0', '1']) {
      process.env.DCHUB_B2_SITE_HEADLINE = b2;
      const access = b2 === '1' ? S.ANALYZE_SITE_ACCESS_B2 : S.ANALYZE_SITE_ACCESS_PRE_B2;
      expect(desc()).toContain(access + ' When results are partial, show the user human_message and its link.');
      process.env.DCHUB_GATED_PREVIEW = '0';
      expect(desc()).toContain(access);
      expect(desc()).not.toContain('human_message');
      delete process.env.DCHUB_GATED_PREVIEW;
    }
  });
});

// P3: the no-session key link stores the request it walled, keyed by request_id (the token's sid).
describe('no-session wall stores the claim request (P3)', () => {
  const stored = async (fn) => {
    const before = H.hits.length;
    const r = await fn();
    await new Promise((res) => setTimeout(res, 300));
    return { r, posts: H.hits.slice(before).filter((h) => h.path === '/api/v1/mcp/site-request').map((h) => h.body) };
  };
  afterEach(() => { delete process.env.DCHUB_SITE_REQUEST_STORE; });
  it('posts request_id + the resolved coordinates, never a key', async () => {
    const { r, posts } = await stored(() => call({ session: false }));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ request_id: r.sc.request_id, tool: 'analyze_site', args: { lat: 33.45, lon: -112.07, state: 'AZ' } });
    expect(JSON.stringify(posts[0])).not.toMatch(/dch_/);
  });
  it('a session caller stores nothing (its next call returns the report)', async () => {
    const { posts } = await stored(() => call({ session: true }));
    expect(posts).toEqual([]);
  });
  it('DCHUB_SITE_REQUEST_STORE=0 stores nothing', async () => {
    process.env.DCHUB_SITE_REQUEST_STORE = '0';
    const { posts } = await stored(() => call({ session: false }));
    expect(posts).toEqual([]);
  });
});

describe('_siteClaimRequestBody (unit)', () => {
  it('location-only args take the handler-resolved coordinates; nothing usable gives null', async () => {
    const S = await import('../server.mjs');
    expect(S._siteClaimRequestBody({ platform: 'grok' }, 'a-1', { location: 'ashburn', capacity_mw: 50 }, { lat: 39.04, lon: -77.49, state: 'VA' }))
      .toEqual({ request_id: 'a-1', tool: 'analyze_site', args: { lat: 39.04, lon: -77.49, state: 'VA', capacity_mw: 50 },
        platform: 'grok', user_agent: null, client_ip: null });
    expect(S._siteClaimRequestBody({}, 'a-1', { location: 'ashburn' }, null)).toBeNull();
    expect(S._siteClaimRequestBody({}, '', { lat: 1, lon: 2 }, null)).toBeNull();
  });
});
