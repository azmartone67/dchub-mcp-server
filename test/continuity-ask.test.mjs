// Grok -> Brain 2026-11-17 (MCP funnel conversion gap): the email ask in plain words, as continuity.
// lib/continuity-ask.mjs holds the lines; lib/retention.mjs and server.mjs _returnNudgeStep place them.
// The real-server half (claim line, wall lines, the return line at the end of the answer, asked once) is in
// test/retention-email-ask.test.mjs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as CA from '../lib/continuity-ask.mjs';
import * as R from '../lib/retention.mjs';

const URL1 = 'https://dchub.cloud/u/abc234';
const LINES = [CA.continuityWallLineText(URL1), CA.continuityFreekeyLineText(URL1), CA.continuityClaimText(),
  CA.continuityReturnLine(), CA.continuityReturnLine('Phoenix'), CA.CONTINUITY_RETURN_AGENT];

describe('the continuity lines', () => {
  it('carry no price, plan, free-tier, credits, trial or per-day wording (note F / option A)', () => {
    for (const l of LINES) expect(l, l).not.toMatch(CA.NOTE_F_WORDS);
  });
  it('the check is not vacuous: every line it replaced fails it', () => {
    const off = { DCHUB_CONTINUITY_ASK: '0' };
    for (const old of [R.wallEmailLineText(URL1, off), R.wallEmailFreekeyLineText(URL1, off), R.claimBenefitText(10, off)]) {
      expect(old, old).toMatch(CA.NOTE_F_WORDS);
    }
    for (const bad of ['$10 pack', 'the Pro plan', '50 calls/day', '10 calls a day', '1,000 API credits', 'a 7-day trial', 'see pricing']) {
      expect(bad).toMatch(CA.NOTE_F_WORDS);
    }
  });
  it('say what an email keeps, and the ask and return lines end on the neutral /connect line', () => {
    for (const l of LINES.slice(0, 5)) expect(l).toMatch(/saved shortlists, alerts and the changes you track/);
    expect(CA.continuityClaimText().endsWith(CA.CONNECT_LINE)).toBe(true);
    expect(CA.continuityReturnLine('Phoenix')).toBe('Tell the user: "Welcome back. Want this to carry over to your next chat? '
      + 'Tell me your email and DC Hub keeps this key, your saved shortlists, alerts and the changes you track with it, '
      + 'and can tell you when Phoenix changes. More detail is available at dchub.cloud/connect."');
  });
  it('every tool the promise rests on is on /mcp (toolspec.json)', () => {
    const spec = JSON.parse(fs.readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8'));
    const names = new Set((Array.isArray(spec) ? spec : spec.tools).map((t) => t.name));
    for (const t of ['save_to_shortlist', 'set_market_alert', 'set_shortlist_alert', 'get_changes', 'recover_my_key', 'bind_email']) {
      expect(names.has(t), t).toBe(true);
    }
  });
  it('kill switch DCHUB_CONTINUITY_ASK=0 (and off / false / no), read per call', () => {
    expect(CA.continuityAskOn({})).toBe(true);
    for (const v of ['0', 'off', 'false', 'no', ' OFF ']) expect(CA.continuityAskOn({ DCHUB_CONTINUITY_ASK: v }), v).toBe(false);
    expect(R.wallEmailLineText(URL1, { DCHUB_CONTINUITY_ASK: '0' })).toMatch(/unlock the full data free/);
  });
});

describe('asked once a week', () => {
  it('one take per key per 7 days; another key is its own', () => {
    let t = Date.parse('2026-11-17T10:00:00Z');
    const once = CA.createOncePerWeek({ now: () => t });
    expect(once.take('k1')).toBe(true);
    t += 86400000;
    expect(once.take('k1')).toBe(false);
    expect(once.take('k2')).toBe(true);
    t += 6 * 86400000;
    expect(once.take('k1')).toBe(true);
    expect(once.take('')).toBe(false);
  });
});

describe('appendTailLine', () => {
  it('ends the last text block with the line, leaves the input alone', () => {
    const r = { content: [{ type: 'text', text: 'data' }, { type: 'image', data: 'x' }, { type: 'text', text: 'more' }] };
    const out = CA.appendTailLine(r, 'ASK');
    expect(out.content.map((b) => b.text)).toEqual(['data', undefined, 'more\n\nASK']);
    expect(r.content[2].text).toBe('more');
    expect(CA.appendTailLine({ content: [] }, 'ASK').content).toEqual([{ type: 'text', text: 'ASK' }]);
    expect(CA.appendTailLine(r, '')).toBe(r);
  });
});
