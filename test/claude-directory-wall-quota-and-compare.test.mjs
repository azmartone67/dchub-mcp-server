// claude-directory-wall-quota-and-compare.test.mjs — two /mcp/claude keyless walls (2026-11-11).
//
// The real server.mjs on loopback against the claude-directory stub backend, with
// /api/site-score answering a BUILD site (lat > 38) and an AVOID site.
//
// (b) analyze_site: the keyless email wall was stamped with keylessWallQuota(), a CONSTANT
//     remaining_this_month: 0 + resets_at. The profile's scrub drops quota_basis (it names
//     "keyless") and kept the bare 0, so a caller's FIRST call read "0 left this month".
//     /mcp/claude carries no quota stamp at all; /mcp keeps it.
// (c) compare_sites: the per-site teaser shared one content block with COMPARE_FREE_KEY_LINE.
//     The scrub drops any later block naming claim_free_key (lib/chatgpt-directory.mjs,
//     scrubToolResult), so the verdicts went with it and the text was the partial notice
//     alone. The teaser is its own block now; the key line is still dropped on /mcp/claude.
// The profile still carries no ask or plan (lib/claude-directory.mjs): asserted below with the
// probe patterns and the sell-line BANNED list. 2026-11-13 (Grok QA v2.12.48, owner decision on
// merge): these two walls now carry the link the wall minted (test/claude-site-wall-unlock.test.mjs),
// so the link's own probe hits and its human_url key are excepted here and nothing else.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CLAUDE_REMOVED, CLAUDE_PLANS_NOTICE } from '../lib/claude-directory.mjs';
import { startHarness, fenceNetwork, claudeProbePatterns, hitsOf } from './helpers/claude-directory-harness.mjs';

// The same list as test/claude-directory-sell-line.test.mjs (a test file is not importable
// without re-registering its suites).
const BANNED = /after they pay|show your user|free preview|human_url|show_to_user|contract plans|\/enterprise\b/i;
const PATTERNS = claudeProbePatterns(CLAUDE_REMOVED);
// The site-wall link (human_url) and what it trips by itself; see claude-site-wall-unlock.test.mjs.
const LINK_ONLY = new Set(['/upgrade/h', 'upgrade/unlock wording', 'pricing link', 'relay keys']);
const nonLinkHits = (raw) => hitsOf(PATTERNS, raw).filter((k) => !LINK_ONLY.has(k));
const withoutLink = (raw) => raw.replace(/"human_url":"[^"]*",?/g, '');
const DIR = '/mcp/claude';
const TWO_SITES = { locations: '39.04,-77.48;33.45,-112.07' };

let H, fence;
const routes = (p, req, body, u) => {
  if (p !== '/api/site-score') return undefined;
  const lat = Number(u.searchParams.get('lat') || (body && body.lat));
  return { status: 200, body: lat > 38
    ? { overall_score: 82, scores: { power_infrastructure: 85 } }
    : { overall_score: 30, scores: { power_infrastructure: 25 } } };
};
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: routes });
}, 240_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});
const texts = (r) => ((r.msg && r.msg.result && r.msg.result.content) || []).map((c) => c.text || '');

describe('/mcp/claude keyless analyze_site wall: no constant "0 left this month"', () => {
  it('carries no remaining_this_month or resets_at, and still no ask or plan (the link only)', async () => {
    const r = await H.call(DIR, 'analyze_site', { lat: 39.04, lon: -77.48 });
    const sc = r.msg.result.structuredContent;
    expect(sc._wall, r.raw.slice(0, 300)).toBe(true);           // really the keyless wall
    expect(sc.site_teaser && sc.site_teaser.verdict).toBe('BUILD');   // really the email-wall path
    expect('remaining_this_month' in sc).toBe(false);
    expect('resets_at' in sc).toBe(false);
    expect(r.raw).not.toMatch(/remaining_this_month/);
    expect(texts(r).at(-1)).toBe(CLAUDE_PLANS_NOTICE);
    expect(nonLinkHits(r.raw)).toEqual([]);
    expect(withoutLink(r.raw)).not.toMatch(BANNED);
    expect(fence.foreign).toEqual([]);
  }, 60_000);

  it('control: the same wall on /mcp still carries the quota fields', async () => {
    const r = await H.call('/mcp', 'analyze_site', { lat: 39.04, lon: -77.48 });
    const sc = r.msg.result.structuredContent;
    expect(sc._wall).toBe(true);
    expect(sc.remaining_this_month).toBe(0);
    expect(sc.resets_at).toMatch(/^\d{4}-\d{2}-01T00:00:00Z$/);
  }, 60_000);
});

describe('/mcp/claude keyless compare_sites wall: the per-site verdicts survive the scrub', () => {
  it('the text names each site\'s verdict and power band, and no ask, key line or plan (the link only)', async () => {
    const r = await H.call(DIR, 'compare_sites', TWO_SITES);
    const all = texts(r).join('\n');
    expect(r.msg.result.structuredContent._wall).toBe(true);
    expect(all).toMatch(/site 1 verdict BUILD, power infrastructure BUILD/);
    expect(all).toMatch(/site 2 verdict AVOID, power infrastructure AVOID/);
    expect(texts(r).at(-1)).toBe(CLAUDE_PLANS_NOTICE);
    expect(all).not.toMatch(/claim_free_key|X-API-Key/);
    expect(nonLinkHits(r.raw)).toEqual([]);
    expect(withoutLink(r.raw)).not.toMatch(BANNED);
  }, 60_000);

  it('control: /mcp keeps the teaser and the free-key line, now in separate blocks', async () => {
    const r = await H.call('/mcp', 'compare_sites', TWO_SITES);
    const t = texts(r);
    const teaserAt = t.findIndex((x) => /^Comparison teaser: site 1 verdict BUILD/.test(x));
    const keyAt = t.findIndex((x) => x.startsWith('Free preview: call `claim_free_key`'));
    expect(teaserAt).toBeGreaterThan(0);
    expect(keyAt).toBe(teaserAt + 1);
    expect(t[teaserAt]).not.toMatch(/claim_free_key/);
  }, 60_000);
});
