// find-sites-min-mw.test.mjs
//
// Grok QA 2026-11-06 (item 10): find_sites {state:"OH", min_mw:150} answered as if no size had been
// asked: the inputSchema has no min_mw, zod strips it before the handler, and the filter echo and
// unapplied_constraints said nothing (live, Pro key and keyless). A candidate is a substation search
// area with no deliverable-MW figure (anchor capacity_mva empty on 0 of 25 Texas rows, 11-06), so the
// floor cannot be applied; the answer must say it was ignored. The schema is NOT widened: the
// /mcp/chatgpt catalog is frozen and tools/list is size-guarded (same rule as target_mw).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { annotateFindSites } from '../lib/siting-scope.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const P = () => ({ success: true, candidates: [{ lat: 40, lon: -83, anchor: { name: 'A', voltage_kv: 345 } }],
  filter: { state: 'OH', min_voltage_kv: 115 }, unapplied_constraints: [] });
const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });

// server.mjs is loaded by the harness, AFTER it points DCHUB_API_BASE at the stub (a static import here
// would load it first, against the real base).
let H, fence;
const seen = [];
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p, _req, _body, u) => {
    if (p === '/api/v1/sites/find') {
      seen.push(Object.fromEntries((u && u.searchParams) ? u.searchParams.entries() : []));
      return P();
    }
    return undefined;
  } });
}, 60_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
const _sitesRawHint = (b) => H.S._sitesRawHint(b);

describe('the raw hint parks min_mw under its own name', () => {
  it('reads min_mw, number or numeric string', () => {
    expect(_sitesRawHint(call('find_sites', { state: 'OH', min_mw: 150 }))).toEqual({ min_mw: 150 });
    expect(_sitesRawHint(call('find_sites', { min_mw: '150' }))).toEqual({ min_mw: 150 });
    expect(_sitesRawHint(call('find_sites', { min_mw: 150, target_mw: 100 }))).toEqual({ min_mw: 150, target_mw: 100 });
  });
  it('CONTROL: no figure, a non-figure, or another tool parks nothing', () => {
    expect(_sitesRawHint(call('find_sites', { state: 'OH' }))).toBeNull();
    expect(_sitesRawHint(call('find_sites', { min_mw: 'big' }))).toBeNull();
    expect(_sitesRawHint(call('get_refined_queue', { min_mw: 150 }))).toBeNull();
  });
});

describe('annotateFindSites says min_mw was ignored', () => {
  it('names it in unapplied_constraints, the filter echo and a note', () => {
    const o = annotateFindSites(P(), { state: 'OH', min_mw: 150 });
    expect(o.unapplied_constraints).toEqual(['min_mw']);
    expect(o.min_mw_note).toMatch(/^min_mw=150 ignored: /);
    expect(o.filter.min_mw).toBeNull();
    expect(o.filter._min_mw_not_applied).toBe(o.min_mw_note);
    expect(o.unapplied_constraints_warning).toMatch(/min_mw was not applied/);
  });
  it('CONTROL: no min_mw leaves the answer as it was', () => {
    const o = annotateFindSites(P(), { state: 'OH' });
    expect(o.unapplied_constraints).toEqual([]);
    expect(o).not.toHaveProperty('min_mw_note');
    expect(o.filter).not.toHaveProperty('_min_mw_not_applied');
  });
  it('beside target_mw both are named, once each', () => {
    const o = annotateFindSites({ ...P(), unapplied_constraints: ['min_mw'] }, { target_mw: 100, min_mw: 150 });
    expect(o.unapplied_constraints).toEqual(['min_mw', 'target_mw']);
    expect(o.target_mw_note).toMatch(/100/);
    expect(o.min_mw_note).toMatch(/150/);
  });
});

describe('find_sites min_mw=150 through the app', () => {
  const run = async (args) => {
    const init = await H.init('/mcp', 'claude-ai', { 'user-agent': 'Claude-User' });
    seen.length = 0;
    const res = await H.call('/mcp', 'find_sites', args, { 'user-agent': 'Claude-User', 'mcp-session-id': init.headers.get('mcp-session-id') });
    const line = res.raw.split('\n').find((l) => l.startsWith('data:')) || res.raw;
    const r = JSON.parse(line.replace(/^data:\s*/, '')).result || {};
    const text = (r.content || []).map((c) => c.text || '').join('');
    return { text, upstream: seen.slice() };
  };

  it('the answer names min_mw as ignored', async () => {
    const out = await run({ state: 'OH', min_mw: 150 });
    expect(out.upstream.length, 'the backend was never asked').toBe(1);
    expect(out.text).toContain('min_mw=150 ignored');
    expect(out.text).toContain('"_min_mw_not_applied"');
  });
  it('CONTROL: without min_mw the answer carries no such note', async () => {
    const out = await run({ state: 'OH' });
    expect(out.upstream.length).toBe(1);
    expect(out.text).not.toContain('min_mw=');
  });
});
