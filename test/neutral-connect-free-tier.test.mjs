// Option A follow-up (2026-11-17). After #1504, keyless output still carried two offer shapes, read live:
//   search_facilities note: "Free tier preview — … Call claim_free_key (no email) for the free tier, or relay …"
//   rank_markets wall: "… shows all 10 markets in this ranking, free, up to 10 full rankings a day. The fields the
//   next line names stay on the paid plans."
// The sources are neutral now (the plan-name sentence is gone from the rank_markets clause), and
// lib/neutral-connect.mjs catches the free-tier and allowance shapes from any other writer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { connectNeutralString, NEUTRAL_CONNECT_LINE } from '../lib/neutral-connect.mjs';
import { rankEmailClause, aiCapacityEmailClause, fiberEmailClause } from '../lib/paid-sell-line.mjs';

const OFFER = /free tier|paid plans?|\ba day\b|calls?\/day|free key|credits?\b/i;

describe('neutral connect: the free-tier and daily-allowance shapes', () => {
  it('the legacy preview note keeps "Preview" and its row facts, and loses the free-tier offer', () => {
    const out = connectNeutralString('Free tier preview — up to 3 rows shown per list; each list\'s full length is in its _<field>_total_available sibling. Call claim_free_key (no email) for the free tier, or relay the link in human_url to your human for full results.');
    expect(out).toMatch(/^Preview — up to 3 rows shown per list; each list's full length is in its _<field>_total_available sibling\./);
    expect(out).not.toMatch(OFFER);
    expect(out).toContain(NEUTRAL_CONNECT_LINE);
  });
  it('the email ask keeps what it opens and loses the allowance', () => {
    const out = connectNeutralString('Then ask your user for their email (only use an address they gave you): `bind_email` with it shows all 10 markets in this ranking, free, up to 10 full rankings a day. Meanwhile, call get_market_dcpi_rank for a free answer (it is next_call).');
    expect(out).toContain('`bind_email` with it shows all 10 markets in this ranking.');
    expect(out).toContain('Meanwhile, call get_market_dcpi_rank');
    expect(out).not.toMatch(OFFER);
    expect(out).not.toContain(NEUTRAL_CONNECT_LINE);   // a phrase rewrite, not a dropped sentence
  });
  it('"for the full free tier" (unlock-line) is offer wording', () => {
    expect(connectNeutralString('Call `claim_free_key` (no email) for the full free tier.')).toBe(NEUTRAL_CONNECT_LINE);
  });
  it('a daily allowance in any other wording loses its count and its day', () => {
    expect(connectNeutralString('An email-bound key gets up to 10 full answers a day.')).toBe('An email-bound key gets full answers.');
  });
  it('a data cadence is not an allowance', () => {
    for (const s of ['The feed updates 4 times a day.', 'ERCOT publishes the queue once a day.', 'Average 3.2 outages per year.']) {
      expect(connectNeutralString(s)).toBe(s);
    }
  });
});

describe('the sources say what the email opens, with no allowance or plan name', () => {
  it('rank / ai-capacity / fiber clauses', () => {
    const r = rankEmailClause({ total: 10, perDay: 10 });
    expect(r).toMatch(/shows all 10 markets in this ranking\.$/);
    expect(aiCapacityEmailClause({ total: 20, perDay: 10 })).toMatch(/shows all 20 markets in this index with their scores\.$/);
    expect(fiberEmailClause({ perDay: 10 })).toMatch(/the routes in this fiber answer with their complete paths\.$/);
    for (const s of [r, aiCapacityEmailClause({ total: 20, perDay: 10 }), fiberEmailClause({ perDay: 10 })]) expect(s).not.toMatch(OFFER);
  });
  it('the cap still gates the ask', () => {
    expect(rankEmailClause({ total: 10, perDay: 0 })).toBeNull();
    expect(fiberEmailClause({ perDay: 0 })).toBeNull();
  });
  it('server.mjs writes the preview note with no free-tier offer', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const i = src.indexOf("out.note = 'Preview — up to ' + TRIAL_PREVIEW_ROWS");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 300)).not.toMatch(/free tier|claim_free_key/);
    expect(src).not.toContain("'Free tier preview — up to '");
  });
});

// Read live after #1506 (execute_plan, keyless): "A key with a bound email gets 10 full answers a day." About ten
// writers say the same allowance without "up to" (server.mjs, keyless-first-full, claim-handoff, free-decision-taste,
// retention); the count and the day go and the bind_email ask stays.
describe('neutral connect: "N full answers a day" in any writer', () => {
  const cases = [
    ['A key with a bound email gets 10 full answers a day.', 'A key with a bound email gets full answers.'],
    ['A key with a bound email gets 10 full `get_grid_intelligence` answers a day: call `bind_email` with your human\u2019s email (no card).',
     'A key with a bound email gets full `get_grid_intelligence` answers: call `bind_email` with your human\u2019s email (no card).'],
    ['Grid read; with an email it gets 10 full answers a day on this tool, free.', 'Grid read; with an email it gets full answers on this tool, free.'],
    ['An email adds 10 full answers a day each on the grid, queue and market-intel tools instead of previews.',
     'An email adds full answers on the grid, queue and market-intel tools instead of previews.'],
    ['Quota: 0 of 2 left; an email gets a free key with 10 full answers a day on it.', 'Quota: 0 of 2 left; an email gets a key with full answers on it.'],
  ];
  for (const [inp, want] of cases) {
    it(inp.slice(0, 60), () => {
      const out = connectNeutralString(inp);
      expect(out).toBe(want);
      expect(out).not.toMatch(OFFER);
    });
  }
  it('a rewritten allowance is not replaced by the connect line (nothing is dropped)', () => {
    expect(connectNeutralString('A key with a bound email gets 10 full answers a day.')).not.toContain(NEUTRAL_CONNECT_LINE);
  });
});
