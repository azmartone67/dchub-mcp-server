// Brain block 2026-10-28, items 5 and 6: an MCP wall's relay link says which wall it came from
// (?via=mcp-wall&wall=<type>). The spent analyze_site answer's link already exists (G-1015-P0-CAP); this tags it.
//
//   * lib/wall-tag.mjs: which statuses are tagged, the URL rewrite (idempotent, long relay URLs only,
//     never overrides another channel), the result walk;
//   * shortWallLinkStep: the tag goes on the LONG url BEFORE it is shortened, so the /u/ link's target carries it;
//   * end to end through the real /mcp handler: the spent analyze_site answer, a trial_used wall, the kill
//     switches, and the wall_link_th hash still joins to the token;
//   * what must NOT change: no email in any link, and nothing on the frozen /mcp/chatgpt profile.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import * as T from '../lib/wall-tag.mjs';
import { shortWallLinkStep } from '../lib/short-wall-link.mjs';

const TOK = 'c2Vzcy0xfGdldF9waXBlbGluZXxmcmVlfDE3NjE2OTUwMDA.0123456789abcdef0123456789abcdef';
const LONG = 'https://dchub.cloud/upgrade/h/' + TOK;

describe('which statuses are tagged', () => {
  it('trial_used, anon_daily_cap and the spent analyze_site run, nothing else', () => {
    expect(T.wallTypeFor('trial_used')).toBe('trial_used');
    expect(T.wallTypeFor('anon_daily_cap')).toBe('anon_daily_cap');
    expect(T.wallTypeFor('lp_free_spent')).toBe('analyze_site_spent');
    for (const s of ['pro_wall', 'lp_wall', 'anon_hard_wall', 'depth_teased', 'ok', '', undefined, null, '__proto__', 'constructor']) {
      expect(T.wallTypeFor(s), String(s)).toBeNull();
    }
  });
  it('every wall type fits the backend shape', () => {
    for (const w of Object.values(T.WALL_TYPES)) expect(w).toMatch(/^[a-z][a-z0-9_]{1,31}$/);
  });
});

describe('wallTypeForResult', () => {
  const spentBlock = { structuredContent: { free_monthly_runs: { reason: 'free_monthly_limit_reached' } } };
  it('reads a spent analyze_site answer from its own block (it is logged pro_wall)', () => {
    expect(T.wallTypeForResult('pro_wall', spentBlock)).toBe('analyze_site_spent');
    expect(T.wallTypeForResult('lp_free_spent', {})).toBe('analyze_site_spent');
  });
  it('a status wins, and nothing else is a wall type', () => {
    expect(T.wallTypeForResult('trial_used', spentBlock)).toBe('trial_used');
    expect(T.wallTypeForResult('pro_wall', {})).toBeNull();
    expect(T.wallTypeForResult('pro_wall', { structuredContent: { free_monthly_runs: { reason: 'other' } } })).toBeNull();
    expect(T.wallTypeForResult('pro_wall', null)).toBeNull();
  });
});

describe('tagRelayUrl', () => {
  it('adds the channel and the wall to a bare long relay url', () => {
    expect(T.tagRelayUrl(LONG, 'trial_used')).toBe(LONG + '?via=mcp-wall&wall=trial_used');
  });
  it('keeps an existing query and appends after it', () => {
    expect(T.tagRelayUrl(LONG + '?offer=pro_trial_7d', 'anon_daily_cap')).toBe(LONG + '?offer=pro_trial_7d&via=mcp-wall&wall=anon_daily_cap');
  });
  it('is idempotent and never overrides another channel', () => {
    const once = T.tagRelayUrl(LONG, 'trial_used');
    expect(T.tagRelayUrl(once, 'trial_used')).toBe(once);
    expect(T.tagRelayUrl(LONG + '?via=x', 'trial_used')).toBe(LONG + '?via=x');
  });
  it('leaves short links, other hosts, other paths and bad wall names alone', () => {
    for (const u of ['https://dchub.cloud/u/abc234', 'https://example.com/upgrade/h/' + TOK, 'https://dchub.cloud/pricing',
      'https://dchub.cloud/upgrade/h/' + TOK + 'x', '', undefined]) {
      expect(T.tagRelayUrl(u, 'trial_used'), String(u)).toBe(u);
    }
    for (const w of ['Trial Used', '9bad', 'x', '', undefined, 'a'.repeat(40), 'trial-used']) {
      expect(T.tagRelayUrl(LONG, w), String(w)).toBe(LONG);
    }
  });
  it('can fail: a wrong tag shape is caught by the same check', () => {
    expect(T.tagRelayUrl(LONG, 'trial_used')).not.toBe(LONG);
  });
});

describe('tagResultLinks', () => {
  const r = {
    content: [{ type: 'text', text: '{"human_url":"' + LONG + '"}\n\nOpen ' + LONG + ' — then ask again. Short: https://dchub.cloud/u/abc234.' }],
    structuredContent: { human_url: LONG, for_your_human: { url: LONG, markdown: '[x](' + LONG + ')' }, n: 3, nested: [{ u: LONG }] },
  };
  it('tags every long relay url in text and structuredContent, and only those', () => {
    const out = T.tagResultLinks(r, 'trial_used');
    const tagged = LONG + '?via=mcp-wall&wall=trial_used';
    expect(out.content[0].text.split(tagged).length - 1).toBe(2);
    expect(out.content[0].text).toContain('https://dchub.cloud/u/abc234.');
    expect(out.structuredContent.human_url).toBe(tagged);
    expect(out.structuredContent.for_your_human.url).toBe(tagged);
    expect(out.structuredContent.for_your_human.markdown).toBe('[x](' + tagged + ')');
    expect(out.structuredContent.nested[0].u).toBe(tagged);
    expect(out.structuredContent.n).toBe(3);
    expect(r.structuredContent.human_url, 'the input is not mutated').toBe(LONG);
  });
  it('is a no-op on junk and on a bad wall', () => {
    expect(T.tagResultLinks(null, 'trial_used')).toBeNull();
    expect(T.tagResultLinks(r, 'Bad Wall')).toBe(r);
    expect(T.tagResultLinks({ content: 'x' }, 'trial_used')).toEqual({ content: 'x' });
  });
});

describe('shortWallLinkStep tags the long url before it is minted', () => {
  const res = () => ({ content: [{ type: 'text', text: JSON.stringify({ human_url: LONG + '?buy=1' }) }],
    structuredContent: { human_url: LONG + '?buy=1', for_your_human: { url: LONG + '?buy=1' } } });
  it('mints the tagged target (buy=1 still dropped)', async () => {
    const seen = [];
    const out = await shortWallLinkStep(res(), { mint: async (u) => { seen.push(u); return 'https://dchub.cloud/u/abc234'; }, wall: 'trial_used' });
    expect(seen).toEqual([LONG + '?via=mcp-wall&wall=trial_used']);
    expect(out.structuredContent.human_url).toBe('https://dchub.cloud/u/abc234');
  });
  it('a failed mint falls back to the TAGGED long link', async () => {
    const out = await shortWallLinkStep(res(), { mint: async () => { throw new Error('down'); }, wall: 'anon_daily_cap' });
    expect(out.structuredContent.human_url).toBe(LONG + '?via=mcp-wall&wall=anon_daily_cap');
  });
  it('with no wall the target is exactly what it was', async () => {
    const seen = [];
    await shortWallLinkStep(res(), { mint: async (u) => { seen.push(u); return u; } });
    expect(seen).toEqual([LONG]);
  });
});

// ── end to end ────────────────────────────────────────────────────────────
const FREE_KEY = 'dch_trial_FREEmonthly0123456789abcdef';
const UA = { 'user-agent': 'Claude-User' };
const ARGS = { lat: 33.45, lon: -112.07 };
const FULL = { success: true, lat: 33.45, lon: -112.07, overall_score: 83.7, verdict: 'BUILD',
  factors: { power: { score: 91, verdict: 'BUILD' } }, nearest_substations: { substations_in_radius: 7, search_radius_km: 50, substations: [] } };
let H, fence, used = 0;
const LIMIT = 3;

async function settle(quietMs = 300, maxMs = 6000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function callTool(name, args, { key, path = '/mcp' } = {}) {
  const hdr = { ...UA, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init(path, 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  const before = H.hits.length;
  const r = await H.call(path, name, args, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const hits = H.hits.slice(before);
  const res = r.msg && r.msg.result;
  return {
    sc: (res && res.structuredContent) || {},
    text: ((res && res.content) || []).map((x) => x.text || '').join('\n'),
    tracks: hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === name).map((h) => h.body),
  };
}
const spent = async () => { used = LIMIT; return callTool('analyze_site', ARGS, { key: FREE_KEY }); };

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: 'someone@example.com', tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        const allowed = used < LIMIT && body.op === 'consume'; if (allowed) used += 1;
        return { ok: true, allowed, used, limit: LIMIT, remaining: Math.max(0, LIMIT - used), resets_at: '2026-11-01T00:00:00Z', email_bound: true };
      }
      if (p === '/api/site-score') return { ...FULL };
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { used = 0; delete process.env.DCHUB_WALL_TAG; });

describe('analyze_site, free runs spent', () => {
  it('the spent answer\'s own link is tagged as the spent wall, with no email in it', async () => {
    const r = await spent();
    expect(r.sc.free_monthly_runs, 'it is the spent preview').toMatchObject({ reason: 'free_monthly_limit_reached' });
    const url = (r.sc.for_your_human && r.sc.for_your_human.url) || r.sc.human_url;
    expect(url, 'a relay link is on the answer').toMatch(/^https:\/\/dchub\.cloud\/(upgrade\/h\/|u\/)/);
    if (url.includes('/upgrade/h/')) expect(url.split('?')[1] || '', url).toMatch(/(^|&)via=mcp-wall&wall=analyze_site_spent(&|$)/);
    expect(r.text).toContain(url);
    expect(r.text, 'the existing Full report line holds the same tagged link').toContain('Full report: ' + url);
    expect(r.text + JSON.stringify(r.sc)).not.toMatch(/someone@example\.com|prefilled_email|%40/);
  });
  it('the wall_link_th hash still joins to the token of the tagged link', async () => {
    const r = await spent();
    const row = r.tracks.find((t) => t.wall_link_th);   // this call is logged pro_wall
    expect(row, 'the wall row names the link it handed out').toBeTruthy();
    const url = (r.sc.for_your_human && r.sc.for_your_human.url) || r.sc.human_url || '';
    const S = await import('../server.mjs');
    expect(url).toContain('/upgrade/h/');
    expect(row.wall_link_th).toBe(S._relayTokenHash(url));
  });
  it('DCHUB_WALL_TAG=0 restores the earlier answer', async () => {
    process.env.DCHUB_WALL_TAG = '0';
    const r = await spent();
    expect(r.text + JSON.stringify(r.sc)).not.toContain('mcp-wall');
  });
  it('a full run (allowance left) carries no wall link and no tag', async () => {
    const r = await callTool('analyze_site', ARGS, { key: FREE_KEY });
    expect(r.sc.overall_score).toBe(83.7);
    expect(r.text + JSON.stringify(r.sc)).not.toContain('mcp-wall');
  });
});

describe('trial_used and anon_daily_cap walls', () => {
  it('a keyless trial_used wall tags its relay link with the wall type', async () => {
    const r = await callTool('get_pipeline', { country: 'US' });
    const row = r.tracks.find((t) => t.status === 'trial_used');
    expect(row, 'the call was logged trial_used').toBeTruthy();
    const links = r.text.match(/https:\/\/dchub\.cloud\/(?:upgrade\/h\/[^\s"')\]]+|u\/[a-z0-9]+)/g) || [];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links.filter((x) => x.includes('/upgrade/h/'))) expect(l).toMatch(/via=mcp-wall&wall=trial_used/);
  });
  it('DCHUB_WALL_TAG=0 leaves the link as it was', async () => {
    process.env.DCHUB_WALL_TAG = '0';
    const r = await callTool('get_pipeline', { country: 'US' });
    expect(r.text + JSON.stringify(r.sc)).not.toContain('mcp-wall');
  });
});

describe('the frozen ChatGPT profile is untouched', () => {
  it('a wall on /mcp/chatgpt carries no mcp-wall tag', async () => {
    const r = await callTool('get_pipeline', { country: 'US' }, { path: '/mcp/chatgpt' });
    expect(r.text + JSON.stringify(r.sc)).not.toContain('mcp-wall');
  });
});
