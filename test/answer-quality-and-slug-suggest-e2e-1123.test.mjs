// Brain 2026-11-23 items 5 and 6 through the REAL /mcp handler: a facility slug that 404s comes back with the 3
// closest slugs, and every call's track row carries the answer-quality marks (params._aq) with its wall time.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

fenceNetwork();
const ROWS = [
  { slug: 'equinix-dc1-ashburn', name: 'Equinix DC1', city: 'Ashburn' },
  { slug: 'equinix-dc2-ashburn', name: 'Equinix DC2', city: 'Ashburn' },
  { slug: 'equinix-dc11-ashburn', name: 'Equinix DC11', city: 'Ashburn' },
  { slug: 'qts-richmond', name: 'QTS Richmond', city: 'Richmond' },
];
let H;
beforeAll(async () => {
  H = await startHarness({
    extraRoutes: (p, req, body, u) => {
      if (p === '/api/v1/facilities/equinix-ashburn-dc-nonexistent' || p === '/api/v1/facility/equinix-ashburn-dc-nonexistent') {
        return { status: 404, body: { success: false, error: 'Facility not found', id: 'equinix-ashburn-dc-nonexistent' } };
      }
      if (p === '/api/v1/facilities') {
        const q = (u.searchParams.get('query') || '').toLowerCase();
        return { data: ROWS.filter((r) => q.split(' ').some((w) => r.slug.includes(w))) };
      }
      return undefined;
    },
  });
}, 60000);
afterAll(async () => { if (H) await H.stop(); });

const parse = (r) => JSON.parse(r.msg.result.content[0].text);
const tracks = (tool) => H.hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === tool);
const settle = () => new Promise((r) => setTimeout(r, 300));

describe('get_facility on a slug that is not on file', () => {
  it('names the 3 closest slugs', async () => {
    const r = await H.call('/mcp', 'get_facility', { slug: 'equinix-ashburn-dc-nonexistent' }, { 'x-api-key': PRO_KEY });
    const out = parse(r);
    expect(out.suggestions).toHaveLength(3);
    expect(out.suggestions).not.toContain('qts-richmond');
    expect(out._error_mitigation.deterministic_hint).toContain(out.suggestions[0]);
  }, 30000);
});

// The track rows of a localhost caller are execute_plan loopback steps (server.mjs _isLoopbackPeer), which are sent at
// once and never held, so the held-row path is checked with the real hold / flush functions below.
describe('answer-quality marks survive the held-row flush', () => {
  it('marks, then the next_ask mark, then one send', async () => {
    const { holdTrackRow, flushTrackRows } = await import('../lib/agent-outreach.mjs');
    const { answerQualityMarks, markHeldRows } = await import('../lib/answer-quality.mjs');
    const sent = [];
    const c = {};
    holdTrackRow(c, { tool: 'get_news', status: 'ok', params: { q: 'x' } }, (p) => { sent.push(p); return Promise.resolve(); });
    const result = { content: [{ type: 'text', text: '{}' }], structuredContent: { cite_as: 'DC Hub (dchub.cloud), as of 2026-11-20', rows: [] } };
    expect(markHeldRows(c, 'get_news', answerQualityMarks('get_news', result, { startedAt: Date.now() - 40 }))).toBe(1);
    expect(flushTrackRows(c, 'get_news', result)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].params.q).toBe('x');
    expect(sent[0].params._aq).toMatchObject({ empty: true, dated_cite: true });
    expect(sent[0].params._aq.wall_ms).toBeGreaterThanOrEqual(40);
  });
  it('the server marks before it flushes, on the outer wrapper', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const mark = src.indexOf('_aqMarkHeldRows(c, name, _aqMarks(name, _final, { startedAt: _aqT0 }))');
    const flush = src.indexOf('_flushTrackRows(c, name, _final);');
    expect(mark).toBeGreaterThan(0);
    expect(flush).toBeGreaterThan(mark);
    expect(src.slice(mark - 2000, mark)).toContain('_fdFlushRow');
  });
});
