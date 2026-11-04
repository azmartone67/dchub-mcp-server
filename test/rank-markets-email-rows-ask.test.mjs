// rank-markets-email-rows-ask.test.mjs: owner 2026-11-04 "honest rows ask". The keyless rank_markets
// wall asks the agent for the user's email, promising rows (all N markets) and never the fields the
// plans line names (score, total MW stay Pro). Kill switch DCHUB_RANK_EMAIL_ASK=0.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { rankEmailClause } from '../lib/paid-sell-line.mjs';

const fx = (n) => JSON.parse(readFileSync(new URL('./fixtures/paid-sell/' + n + '.json', import.meta.url), 'utf8'));
const mk = (n) => { const f = fx(n); return { content: [{ type: 'text', text: f.text }, { type: 'text', text: '🧭 **Next:** execute_plan' }], structuredContent: f.sc }; };
const text = (r) => r.content.map((c) => c.text).join('\n');
const setEnv = (k, v) => { const p = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; return () => { if (p === undefined) delete process.env[k]; else process.env[k] = p; }; };

describe('rankEmailClause (pure)', () => {
  it('names every market and the daily cap, never a hidden field', () => {
    expect(rankEmailClause({ total: 10, perDay: 10 })).toBe('Then ask your user for their email (only use an address they gave you): `bind_email` with it shows all 10 markets in this ranking, free, up to 10 full rankings a day. The fields the next line names stay on the paid plans.');
    expect(rankEmailClause({ total: 10, perDay: 10 })).not.toMatch(/score|MW|claim_free_key/);
  });
  it('nothing honest to say: null', () => {
    expect(rankEmailClause({ total: 0, perDay: 10 })).toBeNull();
    expect(rankEmailClause({ total: 10, perDay: 0 })).toBeNull();
  });
});

describe('_paidSellStep: rank_markets keyless wall', () => {
  let S;
  beforeAll(async () => { S = await import('../server.mjs'); }, 60_000);
  const run = (r, name, ctx) => S._ctxALS.run(ctx, () => S._gridSellStep(r, name));
  const ctx = (o = {}) => ({ tier: 'free', session_id: 's-rank-email', ...o });
  const on = () => { const a = setEnv('DCHUB_PAID_SELL_LINE', '1'), b = setEnv('DCHUB_RANK_EMAIL_ASK', undefined); return () => { b(); a(); }; };

  it('first wall: the agent line asks for the email, the human line is the 10-04 sentence, the row is tagged', () => {
    const restore = on();
    try {
      const c = ctx();
      const r = run(mk('rank_markets'), 'rank_markets', c), t = text(r), sc = r.structuredContent;
      expect(t).toContain('`bind_email` with it shows all 10 markets in this ranking, free, up to ');
      expect(t.indexOf('bind_email')).toBeLessThan(t.indexOf('After they pay'));
      expect(sc.user_message).not.toMatch(/email/);                  // human sentence unchanged
      expect(t).not.toMatch(/claim_free_key/);
      expect(c._emailAsk).toBe('line');
    } finally { restore(); }
  });
  it('switch off: no ask, no tag', () => {
    const restore = on(); const k = setEnv('DCHUB_RANK_EMAIL_ASK', '0');
    try {
      const c = ctx();
      const t = text(run(mk('rank_markets'), 'rank_markets', c));
      expect(t).not.toMatch(/bind_email/);
      expect(c._emailAsk).toBeUndefined();
    } finally { k(); restore(); }
  });
  it.each([['grok', { platform: 'grok' }], ['claude profile', { profile: 'claude_directory' }]])('%s: no ask', (_n, o) => {
    const restore = on();
    try {
      const c = ctx(o);
      expect(text(run(mk('rank_markets'), 'rank_markets', c))).not.toMatch(/bind_email/);
      expect(c._emailAsk).toBeUndefined();
    } finally { restore(); }
  });
  it('other paid-sell tools carry no rows ask', () => {
    const restore = on();
    try {
      for (const n of ['get_market_intel', 'compare_isos']) {
        const c = ctx();
        expect(text(run(mk(n), n, c))).not.toMatch(/shows all \d+ markets/);
      }
    } finally { restore(); }
  });
});
