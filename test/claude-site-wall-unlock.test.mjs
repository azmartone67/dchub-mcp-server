// claude-site-wall-unlock.test.mjs — Grok QA v2.12.48 (2026-11-13, P1): the keyless /mcp/claude
// analyze_site and compare_sites walls carry the link the wall already minted.
//
// Before: the profile's scrub dropped human_url, the link and every unlock sentence, so the wall
// answered error plan_required with the teaser and the neutral partial notice and nothing a person
// could act on, while /mcp?via=cursor said "Unlock the full site report free" with the link.
// Now (lib/claude-directory.mjs claudeSiteUnlock): those two walls only put back human_url, a plain
// human_message and one text block with the link, before the partial notice (still last). No plan,
// price, removed tool (claim_free_key, bind_email) or relay wording comes with it, and every other
// tool on the profile is as before. DCHUB_CLAUDE_SITE_UNLOCK=0 serves the earlier wall.
//
// The real server.mjs on loopback against the claude-directory stub backend (no network).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CLAUDE_REMOVED, CLAUDE_PLANS_NOTICE, scrubClaudeToolResult, claudeSiteUnlock, claudeSiteUnlockTools,
} from '../lib/claude-directory.mjs';
import { scrubToolResult as scrubChatgptToolResult } from '../lib/chatgpt-directory.mjs';
import { startHarness, fenceNetwork, claudeProbePatterns, hitsOf } from './helpers/claude-directory-harness.mjs';

const PATTERNS = claudeProbePatterns(CLAUDE_REMOVED);
// What the link itself trips: its path (/upgrade/h here; dchub.cloud/u/<code> live), the word
// "unlock" in its label, the relay key that carries it. Everything else must stay absent.
const LINK_ONLY = new Set(['/upgrade/h', 'upgrade/unlock wording', 'pricing link', 'relay keys']);
const DIR = '/mcp/claude';
const SITE = { lat: 39.04, lon: -77.48 };
const TWO_SITES = { locations: '39.04,-77.48;33.45,-112.07' };
const LINK = /^https:\/\/dchub\.cloud\/(u\/[A-Za-z0-9_-]+|upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]+)/;

let H, fence;
const routes = (p) => (p === '/api/site-score'
  ? { status: 200, body: { overall_score: 82, scores: { power_infrastructure: 85 } } } : undefined);
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: routes });
}, 240_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});
const texts = (r) => ((r.msg && r.msg.result && r.msg.result.content) || []).map((c) => c.text || '');

describe('/mcp/claude keyless analyze_site wall carries the free unlock link', () => {
  it('human_url, human_message, unlock and one link block before the partial notice', async () => {
    const r = await H.call(DIR, 'analyze_site', SITE);
    const sc = r.msg.result.structuredContent;
    expect(sc._wall, r.raw.slice(0, 300)).toBe(true);
    expect(sc.site_teaser && sc.site_teaser.verdict).toBe('BUILD');   // the teaser is still there
    expect(sc.human_url).toMatch(LINK);
    expect(sc.unlock).toEqual({ url: sc.human_url, by: 'email', card_required: false });
    expect(sc.human_message).toBe(`The full site report is free by email (no card): ${sc.human_url}`);
    const t = texts(r);
    expect(t.at(-1)).toBe(CLAUDE_PLANS_NOTICE);                        // the notice stays last
    expect(t.at(-2)).toContain(`[Unlock the full site report free](${sc.human_url})`);
    expect(t.filter((x) => x.includes(sc.human_url))).toHaveLength(1); // one link block
  }, 60_000);

  it('the link is all it adds: no plan, price, key tool, relay or sell line', async () => {
    const r = await H.call(DIR, 'analyze_site', SITE);
    const extra = hitsOf(PATTERNS, r.raw).filter((k) => !LINK_ONLY.has(k));
    expect(extra).toEqual([]);
    expect(r.raw).not.toMatch(/claim_free_key|bind_email|X-API-Key|\$\s?\d|7-day|trial|Pro\b/);
    expect(fence.foreign).toEqual([]);
  }, 60_000);

  it('the link is the one /mcp serves for the same wall (same page kind)', async () => {
    const c = (await H.call(DIR, 'analyze_site', SITE)).msg.result.structuredContent.human_url;
    const m = (await H.call('/mcp', 'analyze_site', SITE)).msg.result.structuredContent.human_url;
    const kind = (u) => {   // the signed payload names the tool and the wall kind
      const p = /\/upgrade\/h\/([A-Za-z0-9_-]+)\./.exec(u);
      return p ? Buffer.from(p[1], 'base64url').toString('utf8').split('|').slice(1, 3).concat(
        Buffer.from(p[1], 'base64url').toString('utf8').split('|').slice(4)).join('|') : u.replace(/\/u\/.*/, '/u/');
    };
    expect(kind(c)).toBe(kind(m));
  }, 60_000);
});

describe('/mcp/claude keyless compare_sites wall carries its link too', () => {
  it('per-site verdicts stay, the link block sits before the notice', async () => {
    const r = await H.call(DIR, 'compare_sites', TWO_SITES);
    const sc = r.msg.result.structuredContent;
    expect(sc._wall).toBe(true);
    expect(sc.human_url).toMatch(LINK);
    expect(sc.unlock).toEqual({ url: sc.human_url });
    const t = texts(r);
    expect(t.join('\n')).toMatch(/site 1 verdict BUILD, power infrastructure BUILD/);
    expect(t.at(-1)).toBe(CLAUDE_PLANS_NOTICE);
    expect(t.at(-2)).toContain(`[See the full comparison](${sc.human_url})`);
    expect(hitsOf(PATTERNS, r.raw).filter((k) => !LINK_ONLY.has(k))).toEqual([]);
    expect(r.raw).not.toMatch(/claim_free_key|bind_email|\$\s?\d|7-day|trial/);
  }, 60_000);
});

// Pure: the hook on synthetic results (no server).
const wallRaw = (tool, url, extra = {}) => {
  const sc = { ok: true, error: 'plan_required', tool, _gated: true, _wall: true,
    site_teaser: { verdict: 'BUILD', power_infrastructure: 'BUILD', unlock_url: url },
    human_url: url, show_to_user: true, ...extra };
  return { content: [{ type: 'text', text: 'Site teaser: verdict BUILD.' }], structuredContent: sc };
};
const SHORT = 'https://dchub.cloud/u/hz254h';

describe('claudeSiteUnlock (pure)', () => {
  it('analyze_site and compare_sites only; any other walled tool gets no link', () => {
    for (const tool of ['analyze_site', 'compare_sites']) {
      expect(scrubClaudeToolResult(wallRaw(tool, SHORT), tool).structuredContent.human_url, tool).toBe(SHORT);
    }
    for (const tool of ['get_composite_site_score', 'generate_site_analysis', 'get_market_intel', 'find_sites']) {
      const r = scrubClaudeToolResult(wallRaw(tool, SHORT), tool);
      expect(JSON.stringify(r), tool).not.toContain(SHORT);
      expect(r.structuredContent.human_url, tool).toBeUndefined();
    }
  });
  it('only a DC Hub hand-off link is carried; anything else is dropped as before', () => {
    for (const bad of ['https://evil.example/u/abc', 'https://dchub.cloud/pricing', 'https://dchub.cloud/u/abc def',
      'http://dchub.cloud/u/hz254h', 'https://buy.stripe.com/abc', 'https://dchub.cloud/go/c/xyz']) {
      const r = scrubClaudeToolResult(wallRaw('analyze_site', bad), 'analyze_site');
      expect(r.structuredContent.human_url, bad).toBeUndefined();
      expect(JSON.stringify(r), bad).not.toContain(bad);
    }
  });
  it('a result that is not the wall (no _wall) is untouched: the full report adds nothing', () => {
    const raw = wallRaw('analyze_site', SHORT, { _wall: false, _gated: false });
    const r = scrubClaudeToolResult(raw, 'analyze_site');
    expect(r.structuredContent.human_url).toBeUndefined();
  });
  it('DCHUB_CLAUDE_SITE_UNLOCK: 0/off = neither, a list = those, unset/1 = both', () => {
    expect([...claudeSiteUnlockTools({})].sort()).toEqual(['analyze_site', 'compare_sites']);
    expect([...claudeSiteUnlockTools({ DCHUB_CLAUDE_SITE_UNLOCK: '1' })].sort()).toEqual(['analyze_site', 'compare_sites']);
    expect(claudeSiteUnlockTools({ DCHUB_CLAUDE_SITE_UNLOCK: '0' }).size).toBe(0);
    expect(claudeSiteUnlockTools({ DCHUB_CLAUDE_SITE_UNLOCK: 'off' }).size).toBe(0);
    expect([...claudeSiteUnlockTools({ DCHUB_CLAUDE_SITE_UNLOCK: 'analyze_site' })]).toEqual(['analyze_site']);
    expect(claudeSiteUnlockTools({ DCHUB_CLAUDE_SITE_UNLOCK: 'get_market_intel' }).size).toBe(0);
    const out = { content: [{ type: 'text', text: CLAUDE_PLANS_NOTICE }], structuredContent: { _wall: true } };
    expect(claudeSiteUnlock(out, wallRaw('analyze_site', SHORT), 'analyze_site', { DCHUB_CLAUDE_SITE_UNLOCK: '0' })).toBe(out);
    expect(claudeSiteUnlock(out, wallRaw('compare_sites', SHORT), 'compare_sites', { DCHUB_CLAUDE_SITE_UNLOCK: 'analyze_site' })).toBe(out);
    expect(claudeSiteUnlock(out, wallRaw('analyze_site', SHORT), 'analyze_site', { DCHUB_CLAUDE_SITE_UNLOCK: 'analyze_site' }).structuredContent.human_url).toBe(SHORT);
  });
  it('CONTROL: /mcp/chatgpt (frozen) still drops the link on the same wall', () => {
    const r = scrubChatgptToolResult(wallRaw('analyze_site', SHORT), 'analyze_site');
    expect(JSON.stringify(r)).not.toContain(SHORT);
  });
});
