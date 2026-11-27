// Funnel leak 1 (owner 2026-11-27): every walled answer that hands out a relay link records a relay mint on its
// first hit. lib/wall-relay-mint.mjs decides; server.mjs _wallOuterStep fires it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { wallRelayMintOn, wallRelayMintPlan } from '../lib/wall-relay-mint.mjs';

const base = { on: true, wall: 'pro_wall', linkIssued: true, qa: false, excluded: false, sid: 'sess-1', tool: 'analyze_site' };

describe('wallRelayMintPlan', () => {
  it('a wall that handed out its link, in a real session, mints and writes the hit', () => {
    expect(wallRelayMintPlan(base)).toEqual({ sid: 'sess-1', trackHit: true });
  });
  it('does not write the paid hit twice when the branch already wrote it this request', () => {
    expect(wallRelayMintPlan({ ...base, trackedTools: new Set(['analyze_site']) })).toEqual({ sid: 'sess-1', trackHit: false });
    expect(wallRelayMintPlan({ ...base, trackedTools: new Set(['other_tool']) })).toEqual({ sid: 'sess-1', trackHit: true });
  });
  it('records nothing for a non-wall answer, a wall with no link, QA, exclusions, no session, or the kill switch', () => {
    expect(wallRelayMintPlan({ ...base, wall: null })).toBeNull();
    expect(wallRelayMintPlan({ ...base, linkIssued: false })).toBeNull();
    expect(wallRelayMintPlan({ ...base, qa: true })).toBeNull();
    expect(wallRelayMintPlan({ ...base, excluded: true })).toBeNull();
    expect(wallRelayMintPlan({ ...base, sid: '' })).toBeNull();
    expect(wallRelayMintPlan({ ...base, sid: 'no-session' })).toBeNull();
    expect(wallRelayMintPlan({ ...base, tool: '' })).toBeNull();
    expect(wallRelayMintPlan({ ...base, on: false })).toBeNull();
  });
});

describe('wallRelayMintOn', () => {
  it('is on by default and off only for an explicit off value', () => {
    expect(wallRelayMintOn({})).toBe(true);
    expect(wallRelayMintOn({ DCHUB_WALL_RELAY_MINT: '1' })).toBe(true);
    for (const v of ['0', 'false', 'off', 'no', ' OFF ']) expect(wallRelayMintOn({ DCHUB_WALL_RELAY_MINT: v })).toBe(false);
  });
});

describe('server.mjs wiring', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const start = src.indexOf('async function _wallOuterStep(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  it('_wallOuterStep asks should-mint-claim with wallLink on the plan it computed', () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toMatch(/wallRelayMintPlan\(\{[^}]*wall: _rt\.wall[^}]*linkIssued: !!_rt\.wall && wallLinkIssued\(out\)/s);
    expect(body).toMatch(/shouldMintClaim\(_rm\.sid, name, \{ wallLink: true \}\)/);
    expect(body).toMatch(/if \(_rm\.trackHit\) await trackPaidHit\(_rm\.sid, name\)/);
    // the branch's own un-awaited hit is awaited before the ask (no timer: a late call would leak past the request)
    expect(body).toMatch(/else \{ const _p = c\._hiTrackP && c\._hiTrackP\.get\(name\); if \(_p\) await _p; \}\s*await shouldMintClaim/);
    expect(body).not.toMatch(/setTimeout/);
  });
  it('trackPaidHit keeps its in-flight write on the ctx, and notes the tool after its bot guard', () => {
    const w = src.slice(src.indexOf('function trackPaidHit('), src.indexOf('async function _trackPaidHitImpl('));
    expect(w).toMatch(/c\._hiTrackP \|\| \(c\._hiTrackP = new Map\(\)\)\)\.set\(toolName, p\)/);
    const t = src.slice(src.indexOf('async function _trackPaidHitImpl('), src.indexOf('export async function shouldMintClaim('));
    expect(t.indexOf('_hiTrackedTools')).toBeGreaterThan(t.indexOf('isBotOrInternalCtx(c)) return;'));
  });
});
