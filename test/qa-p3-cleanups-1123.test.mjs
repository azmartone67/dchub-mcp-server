// qa-p3-cleanups-1123.test.mjs — QA v2.12.63 (2026-11-23), P3 items b, c and d.
//
// b) The keyless /mcp/claude analyze_site wall carried the v14-era copy while /mcp served v15 for the same
//    wall. It now carries the same v15 human_message and copy_version; `error` stays (detectors read it).
// c) GET /mcp/claude advertised the full catalog's count (98) while its tools/list returned 69. Each path's
//    published count is now the length of that path's own tools/list (/health tools_by_path, origin GET).
// d) get_global_power's description stated "170+ countries", a figure no in-repo source supports.
//
// The real server.mjs on loopback against the claude-directory stub backend (no network).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { claudeSiteUnlock, CLAUDE_PLANS_NOTICE } from '../lib/claude-directory.mjs';
import { SITE_WALL_COPY_VERSION } from '../lib/wall-user-line.mjs';
import { gatedPreviewHumanMessage } from '../lib/gated-preview.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

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

const SHORT = 'https://dchub.cloud/u/hz254h';
const wallRaw = (tool, extra = {}) => ({
  content: [{ type: 'text', text: 'Site teaser: verdict BUILD.' }],
  structuredContent: { ok: true, error: 'plan_required', tool, _gated: true, _wall: true, copy_version: 'v14',
    human_url: SHORT, ...extra },
});
const scrubbed = (tool) => ({ content: [{ type: 'text', text: 'teaser' }, { type: 'text', text: CLAUDE_PLANS_NOTICE }],
  structuredContent: { _wall: true, error: 'plan_required', copy_version: 'v14', tool } });

describe('b) /mcp/claude analyze_site wall copy is the v15 copy', () => {
  it('pure: analyze_site gets v15 copy and copy_version; error stays; compare_sites is untouched (v14 on /mcp too)', () => {
    const a = claudeSiteUnlock(scrubbed('analyze_site'), wallRaw('analyze_site'), 'analyze_site', {});
    expect(a.structuredContent.copy_version).toBe('v15');
    expect(a.structuredContent.copy_version).toBe(SITE_WALL_COPY_VERSION);
    expect(a.structuredContent.human_message).toBe(gatedPreviewHumanMessage(SHORT));
    expect(a.structuredContent.error, 'a copy change only: detectors branch on error').toBe('plan_required');
    const c = claudeSiteUnlock(scrubbed('compare_sites'), wallRaw('compare_sites'), 'compare_sites', {});
    expect(c.structuredContent.copy_version).toBe('v14');
  });

  it('live: /mcp/claude and /mcp say the same human_message and copy_version for the same keyless wall', async () => {
    const site = { lat: 39.04, lon: -77.48 };
    const c = (await H.call('/mcp/claude', 'analyze_site', site)).msg.result.structuredContent;
    const m = (await H.call('/mcp', 'analyze_site', site)).msg.result.structuredContent;
    expect(m.copy_version, 'precondition: /mcp serves the v15 gated_preview here').toBe('v15');
    expect(c.copy_version).toBe(m.copy_version);
    expect(c.human_message).toBe(gatedPreviewHumanMessage(c.human_url));
    expect(m.human_message).toBe(gatedPreviewHumanMessage(m.human_url));
  }, 60_000);
});

describe('c) each path publishes its own tools/list count', () => {
  const paths = ['/mcp', '/mcp/claude', '/mcp/chatgpt', '/mcp/core'];
  const listed = async (p) => {
    const r = await H.list(p);
    return r.msg && r.msg.result && Array.isArray(r.msg.result.tools) ? r.msg.result.tools.length : null;
  };

  it('/health tools_by_path equals what tools/list returns on each path, and they differ', async () => {
    const seen = {};
    for (const p of paths) seen[p] = await listed(p);   // also warms the generic cache
    const h = await (await H.get('/health')).json();
    expect(h.tools_by_path, JSON.stringify(h).slice(0, 300)).toBeTruthy();
    for (const p of paths) {
      expect(seen[p], p).toBeGreaterThan(0);
      expect(h.tools_by_path[p], p).toBe(seen[p]);
    }
    expect(seen['/mcp/claude']).toBeLessThan(seen['/mcp']);
    expect(seen['/mcp/chatgpt']).toBeLessThan(seen['/mcp']);
  }, 120_000);

  it("the origin's GET description carries the path's own count", async () => {
    await listed('/mcp');
    for (const p of ['/mcp', '/mcp/claude']) {
      const g = await (await H.get(p, { accept: 'application/json' })).json();
      expect(g.tools, p).toBe(await listed(p));
    }
  }, 120_000);

  it('a cold cache publishes no count rather than a literal', () => {
    expect(H.S._servedToolCounts({ tools: [] })).toBeNull();
    expect(H.S._servedToolCounts({})).toBeNull();
  });
});

describe('d) get_global_power states no unsourced country count', () => {
  it('server.mjs and the derived manifests carry no "170+ countries" for the GEM tool', () => {
    const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const reg = src.match(/trackedTool\(srv, 'get_global_power', '([^']*)'/);
    expect(reg, 'found the registration').toBeTruthy();
    expect(reg[1]).not.toMatch(/\d+\+?\s*countries/);
    expect(src).not.toMatch(/use get_global_power \([^)]*countries/);
    for (const f of ['../mcp-server.json', '../toolspec.json']) {
      const j = JSON.parse(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
      const t = (Array.isArray(j) ? j : (j.tools || [])).find((x) => x && x.name === 'get_global_power');
      expect(t, f).toBeTruthy();
      expect(t.description, f).not.toMatch(/\d+\+?\s*countries/);
    }
  });
});
