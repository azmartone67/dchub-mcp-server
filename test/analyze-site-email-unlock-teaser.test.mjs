// analyze_site email unlock + site teaser (owner 2026-10-10).
//
// Keyless: the wall's ONE link is the signed /upgrade/h relay minted with the trailing
// marker w-siteruns (shortened to /u/<code>), the person's line is "Unlock the full site
// report free by email → <link>", and the answer carries site_teaser: the verdict band
// (scoreBand of overall_score; null stays null), the power band, and the other factors
// NAMED as locked. No score or figure anywhere. Keyed preview / spent branches get the
// same teaser and keep their paid link. DCHUB_SITE_EMAIL_UNLOCK=0 restores the old wall.
//
// Real server.mjs app on loopback, stub backend; no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const INTERNAL = 'test-internal-key-not-a-real-secret';   // the harness's DCHUB_INTERNAL_KEY
const FREE_KEY = 'dch_trial_FREEteaser0123456789abcdef';
const UA = { 'user-agent': 'Claude-User' };
const ARGS = { lat: 33.45, lon: -112.07 };
const SCORES = { power_infrastructure: 96.9, fiber_connectivity: 64.2, gas_pipeline_access: 55.1,
                 market_conditions: 72.3, risk_resilience: 48.6 };
const SITE = () => ({
  success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' }, overall_score: siteOverall,
  scores: { ...SCORES }, interpretation: 'Excellent site',
  nearby: { facilities_100km: 41, substations_50km: 12, gas_pipelines_50km: 3, power_plants_80km: 9 },
  source: 'DC Hub Site Intelligence',
});
// Every figure the fixture holds, as it could be written in prose.
const FIGURES = ['81.8', '82', '96.9', '97', '64.2', '55.1', '72.3', '48.6'];

let H, fence, siteOverall = 81.8, ipN = 0;
const shortReqs = [];

async function settle(quietMs = 250, maxMs = 5000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call(key, ip) {
  const hdr = { ...UA, 'x-dc-client-ip': ip || `203.0.113.${++ipN}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init('/mcp', 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  const before = H.hits.length;
  const r = await H.call('/mcp', 'analyze_site', ARGS, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const hits = H.hits.slice(before);
  const res = (r.msg && r.msg.result) || {};
  return {
    res, sc: res.structuredContent || {},
    text: (res.content || []).map((x) => x.text || '').join('\n'),
    signals: hits.filter((h) => h.path === '/api/v1/mcp/signal-paywall' && h.body).map((h) => h.body),
    siteHits: hits.filter((h) => h.path === '/api/site-score').length,
    status: hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === 'analyze_site').map((h) => h.body.status),
  };
}
// Every dchub.cloud page link in the response (not the bare host, not an API endpoint).
function pageLinks(res) {
  const s = JSON.stringify(res);
  const all = s.match(/https:\/\/(?:www\.)?dchub\.cloud\/[^\s"'`<>\\)\]}]*[^\s"'`<>\\)\]}.,;:!?*]/g) || [];
  return [...new Set(all.filter((u) => !/dchub\.cloud\/(api\/|mcp\b|\.well-known\/)/.test(u)))];
}
function relayFields(url) {
  const m = /\/upgrade\/h\/([A-Za-z0-9_-]+)\.([0-9a-f]{32})/.exec(url);
  if (!m) return null;
  const sig = createHmac('sha256', INTERNAL).update(m[1]).digest('hex').slice(0, 32);
  return { fields: Buffer.from(m[1], 'base64url').toString().split('|'), sigOk: sig === m[2] };
}
function numbersIn(v, path = '', out = []) {
  if (typeof v === 'number') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => numbersIn(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) numbersIn(x, path ? `${path}.${k}` : k, out);
  return out;
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        return { ok: true, allowed: false, used: 3, limit: 3, remaining: 0, resets_at: '2026-11-01T00:00:00Z' };
      }
      if (p === '/api/v1/relay/short') {
        shortReqs.push(body);
        if (body && body.relay_url) return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
        return { status: 500, body: { error: 'no' } };
      }
      if (p === '/api/site-score') return SITE();
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => {
  siteOverall = 81.8; shortReqs.length = 0;
  delete process.env.DCHUB_SITE_EMAIL_UNLOCK; delete process.env.DCHUB_LP_FREE_RUNS;
  // B2 is OFF in prod (owner, 10-04..10-18 A/B); the teaser must not depend on it.
  process.env.DCHUB_B2_SITE_HEADLINE = '0';
});
afterEach(() => { delete process.env.DCHUB_B2_SITE_HEADLINE; });

describe('keyless analyze_site, switch on (default): email unlock + bands-only teaser', () => {
  it('site_teaser carries the verdict band and the power band, the rest named as locked', async () => {
    const r = await call(null);
    expect(r.sc.site_teaser).toEqual({
      verdict: 'BUILD', power_infrastructure: 'BUILD',
      locked: ['overall_score', 'fiber_connectivity', 'gas_pipeline_access', 'market_conditions', 'risk_resilience'],
      note: 'Scores and the other factor bands come with the full site report.',
      unlock_url: 'https://dchub.cloud/u/abcdef',
    });
    expect(r.text).toContain('Site teaser: verdict BUILD; power infrastructure BUILD. Locked: overall score, '
      + 'fiber connectivity, gas pipeline access, market conditions, risk and resilience.');
    expect(r.siteHits).toBe(1);
  });

  it('no score or figure anywhere: no fixture figure in text or JSON, no number in structuredContent but counts', async () => {
    const r = await call(null);
    const all = JSON.stringify(r.res);
    for (const f of FIGURES) {
      expect(all, `figure ${f} leaked`).not.toMatch(new RegExp(`(?<![\\d.])${f.replace('.', '\\.')}(?![\\d.])`));
    }
    const nums = numbersIn(r.sc);
    expect(nums, JSON.stringify(nums)).toEqual([]);
    expect(r.sc.provenance.completeness_basis).toContain('no score or figure was served');
    expect(r.sc.site_teaser.verdict).not.toBe('HOLD');
  });

  it('the one link is the email unlock: a /u/ short of a signed relay token born with w-siteruns', async () => {
    const r = await call(null);
    const link = 'https://dchub.cloud/u/abcdef';
    expect(r.sc.user_message).toBe('Unlock the full site report free by email → ' + link);
    expect(r.text.split('\n')[0]).toBe('Unlock the full site report free by email → ' + link);
    expect(r.sc.human_url).toBe(link);
    // upgrade_url is moved under `upgrade` by the site envelope; wherever it is, it is the same link.
    expect(r.sc.upgrade_url ?? link).toBe(link);
    expect(r.sc.upgrade && r.sc.upgrade.upgrade_url).toBe(link);
    expect(r.sc.for_your_human.url).toBe(link);
    expect(r.sc.for_your_human.text).toBe(r.sc.user_message);
    expect(pageLinks(r.res)).toEqual([link]);
    expect(JSON.stringify(r.res)).not.toMatch(/dchub\.cloud\/(go\/c|upgrade\/h|pricing)\b|stripe\.com/);
    const reqs = shortReqs.filter((b) => b.tool === 'analyze_site');
    expect(reqs.length).toBe(1);
    const tok = relayFields(reqs[0].relay_url);
    expect(tok.sigOk).toBe(true);
    expect(tok.fields[1]).toBe('analyze_site');
    expect(tok.fields[tok.fields.length - 1]).toBe('w-siteruns');
    expect(tok.fields.length).toBe(5);
  });

  it('status stays a paywall signal, counted as lp_wall_email; no plan name or price in the copy', async () => {
    const r = await call(null);
    expect(r.signals.map((s) => s.message_shown)).toContain('lp_wall_email');
    process.env.DCHUB_SITE_EMAIL_UNLOCK = '0';
    const off = await call(null);
    expect(r.status.length).toBeGreaterThan(0);
    expect(r.status, 'the call-log status is the one the earlier wall logs').toEqual(off.status);
    expect(r.signals.map((s) => s.message_shown)).not.toContain('lp_wall');
    expect(r.text).not.toMatch(/\$\d/);
    expect(r.text).not.toMatch(/\b(Pro|Developer|Starter|Enterprise)\b/);
    expect(String(r.sc.user_message) + String(r.sc.message)).not.toMatch(/\b(Pro|Developer|Starter|Enterprise)\b|\$\d/);
  });

  it('a null overall_score gives a null verdict, never CAUTION; the power band still shows', async () => {
    siteOverall = null;
    const r = await call(null);
    expect(r.sc.site_teaser.verdict).toBe(null);
    expect(r.sc.site_teaser.power_infrastructure).toBe('BUILD');
    expect(r.text).toContain('Site teaser: verdict not rated; power infrastructure BUILD.');
    expect(JSON.stringify(r.sc.site_teaser)).not.toContain('CAUTION');
  });

  it('past the headline rate limit: no teaser, no handler call, the email link still the one link', async () => {
    const ip = '198.51.100.77';
    while (H.S._coreHeadlineAllowed(ip)) { /* spend the hour's budget */ }
    const r = await call(null, ip);
    expect(r.siteHits).toBe(0);
    expect(r.sc.site_teaser).toBeUndefined();
    expect(r.sc.user_message).toBe('Unlock the full site report free by email → https://dchub.cloud/u/abcdef');
    expect(pageLinks(r.res)).toEqual(['https://dchub.cloud/u/abcdef']);
  });
});

describe('B2 on (its own switch): its headline is kept, the teaser and the one email link ride with it', () => {
  it('weakest factor + counts from B2, site_teaser bands, no figure, one link', async () => {
    delete process.env.DCHUB_B2_SITE_HEADLINE;
    const r = await call(null);
    expect(r.siteHits).toBe(1);
    expect(r.sc.limiting_factor && r.sc.limiting_factor.factor).toBe('risk and resilience');
    expect(r.sc.site_teaser).toMatchObject({ verdict: 'BUILD', power_infrastructure: 'BUILD' });
    const nums = numbersIn(r.sc).filter(([p]) => !/^site_counts\./.test(p));
    expect(nums, JSON.stringify(nums)).toEqual([]);
    const all = JSON.stringify(r.res);
    for (const f of FIGURES) expect(all).not.toMatch(new RegExp(`(?<![\\d.])${f.replace('.', '\\.')}(?![\\d.])`));
    expect(pageLinks(r.res)).toEqual(['https://dchub.cloud/u/abcdef']);
  });
});

describe('paywall-contract arm on (DCHUB_PAYWALL_CONTRACT=on): the contract rewrite keeps the email line and one link', () => {
  afterEach(() => { delete process.env.DCHUB_PAYWALL_CONTRACT; });
  it('line first, teaser, one link, the token tagged with the arm and born with w-siteruns', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    const r = await call(null);
    const link = 'https://dchub.cloud/u/abcdef';
    expect(r.text.split('\n')[0]).toBe('Unlock the full site report free by email → ' + link);
    expect(r.sc.user_message).toBe('Unlock the full site report free by email → ' + link);
    expect(r.sc.site_teaser).toMatchObject({ verdict: 'BUILD', power_infrastructure: 'BUILD' });
    // Live 10-10 (arm v2): the contract rewrote the agent line to "after your user starts a paid
    // DC Hub plan, retry" and replaced the teaser line with "Free headline: ...". The email wall
    // is left as built: only its links carry the arm.
    expect(r.text).toContain('Site teaser: verdict BUILD; power infrastructure BUILD.');
    expect(r.text).not.toMatch(/starts a paid|Free headline/);
    expect(r.sc.agent_hints).toBeUndefined();
    expect(pageLinks(r.res)).toEqual([link]);
    const all = JSON.stringify(r.res);
    for (const f of FIGURES) expect(all).not.toMatch(new RegExp(`(?<![\\d.])${f.replace('.', '\\.')}(?![\\d.])`));
    const req = shortReqs.find((b) => b.tool === 'analyze_site');
    expect(req.relay_url).toMatch(/[?&]pc=v2\b/);
    expect(relayFields(req.relay_url).fields.at(-1)).toBe('w-siteruns');
  });
});

describe('kill switch DCHUB_SITE_EMAIL_UNLOCK=0: the earlier wall', () => {
  it('no teaser, no email copy, no w-siteruns token, signal lp_wall, no handler call', async () => {
    process.env.DCHUB_SITE_EMAIL_UNLOCK = '0';
    const r = await call(null);
    expect(r.sc.site_teaser).toBeUndefined();
    expect(r.sc.unlock_kind).toBeUndefined();
    expect(r.text).not.toContain('free by email');
    expect(r.sc.user_message).toMatch(/^DC Hub's paid plan has the full site analysis for this location.*Start a 7-day trial: /);
    expect(r.signals.map((s) => s.message_shown)).toContain('lp_wall');
    expect(r.signals.map((s) => s.message_shown)).not.toContain('lp_wall_email');
    expect(r.siteHits).toBe(0);
    for (const b of shortReqs) {
      const tok = b.relay_url ? relayFields(b.relay_url) : null;
      expect(tok && tok.fields.includes('w-siteruns')).toBeFalsy();
    }
  });
});

describe('keyed analyze_site below Pro: preview / spent get the teaser and keep their own link', () => {
  it('lp_free_spent: site_teaser (no unlock_url), the spent block, no score; link is not the email unlock', async () => {
    const r = await call(FREE_KEY);
    expect(r.sc.free_monthly_runs).toMatchObject({ reason: 'free_monthly_limit_reached' });
    expect(r.sc.site_teaser).toEqual({
      verdict: 'BUILD', power_infrastructure: 'BUILD',
      locked: ['overall_score', 'fiber_connectivity', 'gas_pipeline_access', 'market_conditions', 'risk_resilience'],
      note: 'Scores and the other factor bands come with the full site report.',
    });
    expect(r.sc.overall_score ?? null).toBe(null);
    expect(r.text).toContain('Site teaser: verdict BUILD; power infrastructure BUILD.');
    expect(r.text).not.toContain('free by email');
    expect(shortReqs.some((b) => b.relay_url && relayFields(b.relay_url).fields.includes('w-siteruns'))).toBe(false);
    expect(r.signals.map((s) => s.message_shown)).toContain('lp_free_spent');
    expect(r.sc.human_url || r.sc.upgrade_url).toBeTruthy();
  });

  it('lp_preview (monthly runs off): site_teaser in structuredContent and in block 0 JSON', async () => {
    process.env.DCHUB_LP_FREE_RUNS = '0';
    siteOverall = 52;
    const r = await call(FREE_KEY);
    expect(r.sc._preview_only).toBe(true);
    expect(r.sc.site_teaser).toMatchObject({ verdict: 'CAUTION', power_infrastructure: 'BUILD' });
    const b0 = JSON.parse(r.res.content[0].text);
    expect(b0.site_teaser).toMatchObject({ verdict: 'CAUTION', power_infrastructure: 'BUILD' });
    expect(r.text).not.toContain('free by email');
  });

  it('switch off: the keyed preview has no teaser', async () => {
    process.env.DCHUB_SITE_EMAIL_UNLOCK = '0';
    process.env.DCHUB_LP_FREE_RUNS = '0';
    const r = await call(FREE_KEY);
    expect(r.sc.site_teaser).toBeUndefined();
    expect(r.text).not.toContain('Site teaser');
  });
});

describe('_siteTeaser (unit)', () => {
  it('bands only; a missing or non-numeric score stays null; nothing to band is null', () => {
    const t = H.S._siteTeaser;
    expect(t({ overall_score: 30, scores: { power_infrastructure: 45 } })).toMatchObject({ verdict: 'AVOID', power_infrastructure: 'CAUTION' });
    expect(t({ overall_score: 'n/a', scores: { power_infrastructure: 70 } })).toMatchObject({ verdict: null, power_infrastructure: 'BUILD' });
    expect(t({ overall_score: null, scores: {} })).toBe(null);
    expect(t({ success: false, overall_score: 90 })).toBe(null);
  });
});
