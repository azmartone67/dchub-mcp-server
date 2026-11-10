// unlock-research-request.test.mjs — owner 2026-11-10 ("build 1 and 2", move 2).
//
// Live 2026-11-10: an agent that called unlock_more_data on purpose got a relay saying it "hit DC Hub's
// free-tier limit on unlock_more_data", and nothing saying what it had been held back on. unlock_more_data now
// carries research_request (the tools that walled this caller, the public sources their full answers join) and
// one sentence of it in the human message; the relay says the agent asked.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _ctxALS, _unlockMoreDataEnvelope, _noteSessionWallForTest, _sessionWallsFor, _parkQuotaWallHit } from '../server.mjs';
import { RELAY_ASK_MESSAGE, buildResearchRequest, createSessionWallLog } from '../lib/research-request.mjs';

let saved;
beforeEach(() => {
  saved = { k: process.env.DCHUB_INTERNAL_KEY, d: process.env.DCHUB_WALL_HIT_DEFER };
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  delete process.env.DCHUB_RESEARCH_REQUEST;
});
afterEach(() => {
  for (const [k, v] of [['DCHUB_INTERNAL_KEY', saved.k], ['DCHUB_WALL_HIT_DEFER', saved.d]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  delete process.env.DCHUB_RESEARCH_REQUEST;
});

const seat = (sid, ip) => ({ session_id: sid, tier: 'free', platform: 'cursor', client_ip: ip });
const run = (c, args) => _ctxALS.run(c, () => _unlockMoreDataEnvelope(args));

describe('unlock_more_data research request', () => {
  it('names the tools that walled this session (newest first) and the sources their full answers join', () => {
    const c = seat('sess-rr-1', '198.51.100.1');
    _noteSessionWallForTest(c, 'analyze_site');
    _noteSessionWallForTest(c, 'get_interconnection_queue');
    const r = run(c, { reason: '50 MW powered land in SPP for a developer' });
    const rr = r.structuredContent.research_request;
    expect(rr.asked_for).toBe('50 MW powered land in SPP for a developer');
    expect(rr.previews_this_session).toEqual(['get_interconnection_queue', 'analyze_site']);
    expect(rr.full_answer_joins).toContain('FEMA flood maps (NFHL)');
    expect(rr.full_answer_joins[0]).toMatch(/^ISO interconnection-queue exports/);
    const m = r.structuredContent.human_message;
    expect(m).toContain('**What DC Hub held back this session:** previews only on `get_interconnection_queue`, `analyze_site`.');
    expect(m).toMatch(/The full answer joins 13 public sources you would otherwise pull and match by hand: /);
    expect(m).toContain('and 7 more.');
    // owner rule 2026-10-10 and the existing unlock contract: no amount, no plan name, no "unlock"
    expect(m).not.toContain('$');
    expect(m).not.toMatch(/\bPro\b/);
    expect(m.split('What DC Hub held back')[1]).not.toMatch(/\bunlock/i);
    // the text block carries the same sentence
    expect(r.content[0].text).toContain('What DC Hub held back this session');
  });

  it('a tool with no fixed source list is still named, and no sources are claimed for it', () => {
    const c = seat('sess-rr-2', '198.51.100.2');
    _noteSessionWallForTest(c, 'rank_markets');
    const r = run(c, {});
    expect(r.structuredContent.research_request.previews_this_session).toEqual(['rank_markets']);
    expect(r.structuredContent.research_request.full_answer_joins).toEqual([]);
    const m = r.structuredContent.human_message;
    expect(m).toContain('previews only on `rank_markets`.');
    expect(m).not.toContain('full answer joins');
  });

  it('nothing walled and no reason: no block, no sentence; reason alone: block, no sentence', () => {
    const r0 = run(seat('sess-rr-3', '198.51.100.3'), {});
    expect(r0.structuredContent.research_request).toBeUndefined();
    expect(r0.structuredContent.human_message).not.toContain('held back this session');
    const r1 = run(seat('sess-rr-4', '198.51.100.4'), { reason: 'compare two Texas sites' });
    expect(r1.structuredContent.research_request).toMatchObject({ asked_for: 'compare two Texas sites', previews_this_session: [] });
    expect(r1.structuredContent.human_message).not.toContain('held back this session');
  });

  it("another caller's walls never leak into this answer", () => {
    _noteSessionWallForTest(seat('sess-rr-other', '198.51.100.9'), 'analyze_site');
    const r = run(seat('sess-rr-5', '198.51.100.5'), {});
    expect(r.structuredContent.research_request).toBeUndefined();
  });

  it('a real wall hit is recorded through the wall-event path (statuses only; unlock_more_data itself never)', () => {
    process.env.DCHUB_WALL_HIT_DEFER = '0';
    const c = seat('sess-rr-6', '198.51.100.6');
    _parkQuotaWallHit(c, 'analyze_site', 'lp_wall');
    _parkQuotaWallHit(c, 'get_grid_data', 'ok');                 // not a wall status: not noted
    _parkQuotaWallHit(c, 'unlock_more_data', 'anon_daily_cap');  // asking is not being walled
    expect(_sessionWallsFor(c)).toEqual(['analyze_site']);
  });

  it('kill switch DCHUB_RESEARCH_REQUEST=0 removes block and sentence', () => {
    process.env.DCHUB_RESEARCH_REQUEST = '0';
    const c = seat('sess-rr-7', '198.51.100.7');
    _noteSessionWallForTest(c, 'analyze_site');
    const r = run(c, { reason: 'x'.repeat(20) });
    expect(r.structuredContent.research_request).toBeUndefined();
    expect(r.structuredContent.human_message).not.toContain('held back this session');
  });

  it('the relay says the agent asked; it no longer claims a limit was hit', () => {
    const r = run(seat('sess-rr-8', '198.51.100.8'), { reason: 'need the full queue' });
    const fyh = r.structuredContent.for_your_human;
    expect(fyh.message).toBe(RELAY_ASK_MESSAGE);
    expect(fyh.message).not.toMatch(/hit DC Hub/);
  });

  it('the log keeps 6 tools, newest first, one entry per tool, and expires after 24 h', () => {
    let t = 0;
    const log = createSessionWallLog({ now: () => t });
    const c = seat('s', '');
    for (const tool of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'a']) { t += 1; log.note(c, tool); }
    expect(log.get(c)).toEqual(['a', 'g', 'f', 'e', 'd', 'c']);
    t += 24 * 60 * 60 * 1000 + 10;
    expect(log.get(c)).toEqual([]);
    expect(buildResearchRequest('', [])).toBeNull();
  });
});
