// site-verdict-label.test.mjs — Grok 2026-10-18, P1-10.
// Keyless analyze_site Phoenix said "verdict BUILD" while the market's DCPI read CAUTION 41.9. The teaser
// verdict is a band of the SITE score, the DCPI verdict is the MARKET's: label the first as what it is,
// print the second beside it with its date, and add a Source line. Real server.mjs on loopback, stub backend.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { marketVerdictFromRow, marketVerdictSentence, verdictContext, sourceLine, SITE_VERDICT_LABEL, NO_MARKET_SENTENCE } from '../lib/site-verdict.mjs';
import { gatedPreviewStep, powerBandLineStep } from '../lib/gated-preview.mjs';
// This file pins the keyless analyze_site wall, which serves once a caller's daily full site runs
// are spent (DCHUB_KEYLESS_SITE_FULL, owner 2026-11-01); test/keyless-site-full-daily.test.mjs pins the runs.
process.env.DCHUB_KEYLESS_SITE_FULL = '0';

const ROW = { market_slug: 'phoenix', market_name: 'Phoenix', verdict: 'CAUTION', composite_score: 41.94,
  computed_at: '2026-10-18T18:23:48.766551+00:00', latitude: 33.45, longitude: -112.07, state: 'AZ' };
const PHX = marketVerdictFromRow(ROW, 'phoenix-az');

describe('lib/site-verdict', () => {
  it('reads the market block from a DCPI row', () => {
    expect(PHX).toEqual({ market: 'Phoenix', slug: 'phoenix', verdict: 'CAUTION', composite_score: 41.9, as_of: '2026-10-18' });
  });
  it('refuses a row with no band, an error row, or nothing', () => {
    expect(marketVerdictFromRow({ ...ROW, verdict: 'MAYBE' }, 'x')).toBeNull();
    expect(marketVerdictFromRow({ error: 'API 404' }, 'x')).toBeNull();
    expect(marketVerdictFromRow(null, 'x')).toBeNull();
  });
  it('a hostile slug never reaches the Source line', () => {
    const m = marketVerdictFromRow({ ...ROW, market_slug: 'a b</script>' }, 'also bad/..');
    expect(m.slug).toBeNull();
    expect(sourceLine(m)).toBe('Source: DC Hub site score (dchub.cloud).');
  });
  it('prints the market verdict, score, name and date', () => {
    expect(marketVerdictSentence(PHX)).toBe('Market verdict (DCPI): CAUTION (41.9) for Phoenix, as of 2026-10-18.');
    expect(verdictContext(PHX)).toBe('Market verdict (DCPI): CAUTION (41.9) for Phoenix, as of 2026-10-18. Source: DC Hub (dchub.cloud/markets/phoenix), as of 2026-10-18.');
  });
  it('without a market it says the site band is not the market verdict', () => {
    expect(verdictContext(null)).toBe(NO_MARKET_SENTENCE + ' Source: DC Hub site score (dchub.cloud).');
    expect(NO_MARKET_SENTENCE).toContain('get_market_dcpi_rank');
  });
});

describe('gatedPreviewStep text', () => {
  const wall = () => ({ isError: true, content: [{ type: 'text', text: 'wall' }], structuredContent: {
    unlock_kind: 'email', human_url: 'https://dchub.cloud/u/abcdef',
    site_teaser: { verdict: 'BUILD', power_infrastructure: 'BUILD', locked: ['overall_score'], note: 'n' } } });
  const text = (r) => r.content[0].text;
  it('labels the band, then prints the market verdict beside it', () => {
    const out = gatedPreviewStep(wall(), 'analyze_site', { analyze_site_market: PHX }, { env: {} });
    expect(text(out)).toContain('Preview: ' + SITE_VERDICT_LABEL + ' BUILD; power infrastructure BUILD.');
    expect(text(out)).toContain('Market verdict (DCPI): CAUTION (41.9) for Phoenix, as of 2026-10-18.');
    expect(text(out)).toContain('Source: DC Hub (dchub.cloud/markets/phoenix), as of 2026-10-18.');
    expect(out.structuredContent.market_verdict).toEqual(PHX);
    expect(out.structuredContent.verdict_label).toBe(SITE_VERDICT_LABEL);
    expect(out.structuredContent.preview_bands).toEqual({ verdict: 'BUILD', power_infrastructure: 'BUILD' });
  });
  it('a coordinate call (no market) carries the caveat, not a market verdict', () => {
    const out = gatedPreviewStep(wall(), 'analyze_site', {}, { env: {} });
    expect(text(out)).toContain(NO_MARKET_SENTENCE);
    expect(text(out)).not.toContain('Market verdict (DCPI)');
    expect(out.structuredContent.market_verdict).toBeUndefined();
  });
  it('a bogus market in ctx is ignored', () => {
    const out = gatedPreviewStep(wall(), 'analyze_site', { analyze_site_market: { verdict: 'GREAT' } }, { env: {} });
    expect(text(out)).toContain(NO_MARKET_SENTENCE);
  });
});

// ── end to end: the handler parks the market, the wall prints it ─────────────
const UA = { 'user-agent': 'Claude-User' };
const SITE = { success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' }, overall_score: 81.8,
  scores: { power_infrastructure: 96.9, fiber_connectivity: 64.2, gas_pipeline_access: 55.1, market_conditions: 72.3, risk_resilience: 48.6 },
  interpretation: 'Excellent site', source: 'DC Hub Site Intelligence' };
let H, fence, ipN = 0;
async function call(args) {
  const hdr = { ...UA, 'x-dc-client-ip': `203.0.113.${++ipN + 100}` };
  const sid = (await H.init('/mcp', 'claude-ai', hdr)).headers.get('mcp-session-id');
  const r = await H.call('/mcp', 'analyze_site', args, { ...hdr, 'mcp-session-id': sid });
  const res = (r.msg && r.msg.result) || {};
  return { sc: res.structuredContent || {}, text: (res.content || []).map((x) => x.text || '').join('\n') };
}
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p, req, body) => {
    if (p === '/api/v1/relay/short') return body && body.relay_url ? { ok: true, url: 'https://dchub.cloud/u/abcdef' } : { status: 500, body: { error: 'no' } };
    if (p === '/api/site-score') return SITE;
    if (p === '/api/v1/dcpi/scores/phoenix') return ROW;
    return undefined;
  } });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { delete process.env.DCHUB_GATED_PREVIEW; delete process.env.DCHUB_SITE_EMAIL_UNLOCK; delete process.env.DCHUB_B2_SITE_HEADLINE; });

describe('keyed Site teaser line', () => {
  const _siteTeaserLine = (...a) => H.S._siteTeaserLine(...a);   // H.S: the server the harness loaded (module imported AFTER its env)
  const T = { verdict: 'BUILD', power_infrastructure: 'BUILD', locked: ['overall_score'], note: 'Scores come with the full site report.' };
  it('is labelled, carries the market verdict and a Source line', () => {
    const line = _siteTeaserLine(T, PHX);
    expect(line).toContain('Site teaser: ' + SITE_VERDICT_LABEL + ' BUILD; power infrastructure BUILD.');
    expect(line).toContain('Market verdict (DCPI): CAUTION (41.9) for Phoenix');
    expect(line).toContain('Source: DC Hub (dchub.cloud/markets/phoenix)');
  });
  it('with no market (explicit null) it carries the caveat', () => {
    expect(_siteTeaserLine(T, null)).toContain(NO_MARKET_SENTENCE);
  });
  it('the power-band sentence step still finds the relabelled line, once', () => {
    const res = { content: [{ type: 'text', text: _siteTeaserLine(T, PHX) }] };
    const once = powerBandLineStep(res, 'analyze_site', { profile: 'mcp' }, { skipProfiles: [] });
    expect(once.content[0].text).toContain('Power infrastructure BUILD means strong existing power infrastructure nearby');
    expect(powerBandLineStep(once, 'analyze_site', { profile: 'mcp' }, { skipProfiles: [] })).toBe(once);
  });
});


describe('analyze_site over real /mcp', () => {
  it('location=phoenix: the wall shows the site verdict AND the market verdict', async () => {
    const r = await call({ location: 'phoenix' });
    expect(r.text).toContain('site infrastructure verdict BUILD');
    expect(r.text).toContain('Market verdict (DCPI): CAUTION (41.9) for Phoenix, as of 2026-10-18.');
    expect(r.text).toContain('Source: DC Hub (dchub.cloud/markets/phoenix)');
    expect(r.sc.market_verdict).toMatchObject({ verdict: 'CAUTION', composite_score: 41.9 });
  });
  it('lat/lon: the wall says the band is site-level and prints no market verdict', async () => {
    const r = await call({ lat: 33.45, lon: -112.07 });
    expect(r.text).toContain('site infrastructure verdict BUILD');
    expect(r.text).toContain(NO_MARKET_SENTENCE);
    expect(r.text).not.toContain('Market verdict (DCPI)');
  });
  it('the market of one call does not leak into the next', async () => {
    await call({ location: 'phoenix' });
    const r = await call({ lat: 33.45, lon: -112.07 });
    expect(r.text).not.toContain('Market verdict (DCPI)');
  });
});
