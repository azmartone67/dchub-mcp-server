// site-owner-handoff.test.mjs — owner 2026-11-10 ("build 1 and 2", move 1).
//
// analyze_site had 1,107 users in 30 days (/api/v1/mcp/funnel paid_tool_demand_30d, read 2026-11-10) and its
// only offer was the email unlock. A BUILD or CAUTION point-level answer now tells the human who OWNS the site
// that DC Hub can list it free or have Martone Advisors (disclosed) bring it to market: once per caller per day,
// never on AVOID, a market-level call, a failure, a clean platform or a directory / core / Claude profile.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _ctxALS, _withSiteOwnerHandoff, _resetSiteOwnerMemoForTest } from '../server.mjs';
import * as L from '../lib/site-owner-handoff.mjs';
import { CLAUDE_PROFILE } from '../lib/claude-directory.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
import { CORE_PROFILE } from '../lib/core-profile.mjs';

const SEAT = { session_id: 'sess-owner-1', tier: 'free', platform: 'cursor', client_ip: '203.0.113.10' };
const POINT = { lat: 44.0786, lon: -103.2116, capacity_mw: 50 };
// A served site answer that is not a wall (a keyed answer, a free monthly report or a keyless daily run).
const siteAnswer = (verdict = 'BUILD') => {
  const sc = { _entity: 'site', ok: true, tool: 'analyze_site', overall_score: 72, verdict };
  return { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
};
// The keyless email-unlock wall as served live 2026-11-10 (trimmed): a relay wall, one link.
const liveRelayWall = () => {
  const sc = { _entity: 'site', ok: true, tool: 'analyze_site', _gated: true, _wall: true, status: 'gated_preview',
    site_teaser: { verdict: 'BUILD', power_infrastructure: 'BUILD' }, preview_bands: { verdict: 'BUILD', power_infrastructure: 'BUILD' },
    human_url: 'https://dchub.cloud/u/ruspzt',
    for_your_human: { message: 'This is a preview, not the full site report.', url: 'https://dchub.cloud/u/ruspzt' } };
  return { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
};
const run = (seat, result, name = 'analyze_site', args = POINT) =>
  _ctxALS.run(seat, () => _withSiteOwnerHandoff(result, name, args, undefined));
const ownerLines = (r) => (r.content || []).filter((c) => typeof c.text === 'string' && c.text.startsWith('**If your human owns'));
const blockOf = (r) => (r.structuredContent && r.structuredContent.site_owner) || (r._meta && r._meta['cloud.dchub/site_owner']) || null;

beforeEach(() => { _resetSiteOwnerMemoForTest(); delete process.env.DCHUB_SITE_OWNER_HANDOFF; });
afterEach(() => { delete process.env.DCHUB_SITE_OWNER_HANDOFF; });

describe('site-owner hand-off on analyze_site', () => {
  it('a BUILD point answer gets the line and the block: list free + disclosed advisory, tracked links, no price', () => {
    const r = run(SEAT, siteAnswer('BUILD'));
    expect(ownerLines(r)).toHaveLength(1);
    const line = ownerLines(r)[0].text;
    expect(line).toContain('List it free on Capacity Source (a fee only if a deal closes): https://dchub.cloud/listings?utm_source=dchub-mcp&utm_medium=site_owner&utm_campaign=analyze_site&mw=50#list-capacity');
    expect(line).toContain('Martone Advisors, the advisory firm behind DC Hub');
    expect(line).toContain('https://dchub.cloud/advisory?utm_source=dchub-mcp&utm_medium=site_owner&utm_campaign=analyze_site');
    expect(line).toContain('Skip this if your human is screening sites to buy or lease.');
    // owner rule 2026-10-10: agent-facing text names no price or plan
    expect(line).not.toMatch(/\$|\d+\s*%|\bPro\b|Developer/);
    const b = blockOf(r);
    expect(b.advisory.disclosure).toBe('Martone Advisors is the advisory firm behind DC Hub, led by its founder.');
    expect(b.list_free.url).toContain('#list-capacity');
    // additive: the original blocks are untouched and come first
    expect(r.content[0]).toEqual(siteAnswer('BUILD').content[0]);
  });

  it('CAUTION gets it too; AVOID and an unrated answer do not', () => {
    expect(ownerLines(run(SEAT, siteAnswer('CAUTION')))).toHaveLength(1);
    _resetSiteOwnerMemoForTest();
    expect(ownerLines(run(SEAT, siteAnswer('AVOID')))).toHaveLength(0);
    expect(ownerLines(run(SEAT, siteAnswer('')))).toHaveLength(0);
  });

  it('once per caller per day: the second site in the same session hears nothing; another caller does', () => {
    expect(ownerLines(run(SEAT, siteAnswer()))).toHaveLength(1);
    expect(ownerLines(run(SEAT, siteAnswer(), 'analyze_site', { lat: 32.8, lon: -96.8 }))).toHaveLength(0);
    expect(ownerLines(run({ ...SEAT, session_id: 'sess-owner-2', client_ip: '203.0.113.11' }, siteAnswer()))).toHaveLength(1);
  });

  it('a market-level call (location=<market>) is not a site anyone owns', () => {
    expect(ownerLines(run(SEAT, siteAnswer(), 'analyze_site', { location: 'dallas' }))).toHaveLength(0);
    expect(ownerLines(run(SEAT, siteAnswer(), 'analyze_site', { candidate_id: 'cand_abc' }))).toHaveLength(1);
  });

  it('analyze_parcel is in scope; other tools are not', () => {
    expect(ownerLines(run(SEAT, siteAnswer(), 'analyze_parcel', { geometry: {} }))).toHaveLength(1);
    _resetSiteOwnerMemoForTest();
    expect(ownerLines(run(SEAT, siteAnswer(), 'find_sites', POINT))).toHaveLength(0);
  });

  it('skipped on the Claude, ChatGPT-directory and core profiles, on clean platforms, and on a failure', () => {
    for (const profile of [CLAUDE_PROFILE, DIRECTORY_PROFILE, CORE_PROFILE]) {
      _resetSiteOwnerMemoForTest();
      const r = run({ ...SEAT, profile }, siteAnswer());
      expect(ownerLines(r), profile).toHaveLength(0);
    }
    _resetSiteOwnerMemoForTest();
    expect(ownerLines(run({ ...SEAT, platform: 'chatgpt' }, siteAnswer()))).toHaveLength(0);
    const fail = { isError: true, content: [{ type: 'text', text: '{"error":"API 502"}' }],
      structuredContent: { error: 'API 502', _error_mitigation: { retry: true }, verdict: 'BUILD' } };
    expect(ownerLines(run(SEAT, fail))).toHaveLength(0);
    const noData = { content: [{ type: 'text', text: '{"source_unavailable":true,"verdict":"BUILD"}' }] };
    expect(ownerLines(run(SEAT, noData))).toHaveLength(0);
  });

  it('a relay wall (one link) carries no hand-off: its two links would be rewritten into the upgrade link', () => {
    const r = run(SEAT, liveRelayWall());
    expect(ownerLines(r)).toHaveLength(0);
    expect(blockOf(r)).toBeNull();
    // the once-per-day memo was not spent on the wall: the next real answer still gets it
    expect(ownerLines(run(SEAT, siteAnswer()))).toHaveLength(1);
  });

  it('kill switch DCHUB_SITE_OWNER_HANDOFF=0', () => {
    process.env.DCHUB_SITE_OWNER_HANDOFF = '0';
    expect(ownerLines(run(SEAT, siteAnswer()))).toHaveLength(0);
  });

  it('reads the band from the keyed headline and from a JSON text block with no structuredContent', () => {
    expect(L.siteBand({ structuredContent: { verdict: 'BUILD', composite_score: 71 } })).toBe('BUILD');
    expect(L.siteBand({ content: [{ type: 'text', text: '{"verdict":"caution"}' }] })).toBe('CAUTION');
    expect(L.siteBand({ structuredContent: { verdict: 'Excellent site' } })).toBeNull();
  });
});

describe('listing prefill link (2026-11-11)', () => {
  it('carries the analyzed MW and documents the form parameters', () => {
    const b = L.siteOwnerBlock('analyze_site', { capacity_mw: 49.9 });
    expect(b.list_free.url).toBe('https://dchub.cloud/listings?utm_source=dchub-mcp&utm_medium=site_owner&utm_campaign=analyze_site&mw=49.9#list-capacity');
    expect(Object.keys(b.list_free.prefill.params)).toEqual(['company', 'city', 'state', 'country', 'mw', 'available', 'utility', 'type']);
    // never ask an agent to put the human's email or data room in a URL
    expect(JSON.stringify(b.list_free.prefill)).not.toMatch(/email|data_room/i);
  });
  it('drops an unusable MW and keeps the plain link', () => {
    for (const a of [{}, { capacity_mw: 0 }, { capacity_mw: -5 }, { capacity_mw: 'abc' }, { capacity_mw: 20000 }, { capacity_mw: null }, undefined]) {
      expect(L.siteOwnerBlock('analyze_parcel', a).list_free.url).toBe('https://dchub.cloud/listings?utm_source=dchub-mcp&utm_medium=site_owner&utm_campaign=analyze_parcel#list-capacity');
    }
  });
  it('the agent line explains the parameters and still names no price', () => {
    const line = L.siteOwnerLine(L.siteOwnerBlock('analyze_site', { capacity_mw: 50 }));
    expect(line).toContain('add company, city, state, mw, available (YYYY-MM), utility and type');
    expect(line).not.toMatch(/\$|\d+\s*%|\bPro\b|Developer/);
    expect(line.length).toBeLessThan(900);
  });
});
