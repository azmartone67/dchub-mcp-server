// C3 (owner go 2026-11-09): which offers a walled response carried, and the asks that were shown
// but never marked on the call (G8). lib/offers-shown.mjs is pure; the marks are read off the call's
// context exactly as the quota_wall_hit row reads them (lib/keyless-wall.mjs quotaWallEventBody).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { offersShown, offersShownOn, OFFER_KINDS, askedForEmailInProse, finalAskMark } from '../lib/offers-shown.mjs';
import { claimHandoffText } from '../lib/claim-handoff.mjs';
import { quotaWallEventBody, markEmailAsk } from '../lib/keyless-wall.mjs';
import { PACK_NAME } from '../lib/wall-upgrade-offer.mjs';
import { withBindHint, _bindNoticeOnceStep, _emailHintStep, _resetEmailHintState, _ctxALS } from '../server.mjs';

const R = (sc, text) => ({ content: [{ type: 'text', text: text != null ? text : JSON.stringify(sc || {}) }],
  ...(sc ? { structuredContent: sc } : {}) });

describe('offersShown: what the final result carried', () => {
  it('names each offer from the result, sorted', () => {
    expect(offersShown(R({ upgrade_options: [{ id: 'email_unlock' }, { id: 'pro' }, { id: 'metered' }] })))
      .toEqual(['credit_pack', 'email_unlock', 'pro']);
    expect(offersShown(R(null, 'call `claim_free_key` (no email)'))).toEqual(['free_key']);
    expect(offersShown(R(null, 'Ask your user for their email, then call `bind_email` with it'))).toEqual(['email_unlock']);
    expect(offersShown(R(null, 'or call subscribe_digest for the weekly digest'))).toEqual(['digest']);
    expect(offersShown(R(null, 'the ' + PACK_NAME + ' adds usage'))).toEqual(['credit_pack']);
    expect(offersShown(R({ human_url: 'https://dchub.cloud/u/dh7axt' }))).toEqual(['pro']);
    expect(offersShown(R({ pro_url: 'x' }))).toEqual(['pro']);
  });
  it('reads the call\'s ask mark: an unlock ask is email_unlock, digest_line is digest', () => {
    for (const k of ['link_exit', 'link', 'line', 'bind_field']) expect(offersShown(R({ ok: 1 }), k)).toEqual(['email_unlock']);
    expect(offersShown(R({ ok: 1 }), 'digest_line')).toEqual(['digest']);
    expect(offersShown(R({ ok: 1 }), 'no_email')).toEqual([]);
  });
  it('reference blocks are not offers (identity.means names claim_free_key on every keyed answer)', () => {
    const sc = { data: [1], identity: { means: 'Precedence is header > bearer; `claim_free_key` returns a connect_url' },
      provenance: { note: 'see https://dchub.cloud/pricing' }, evidence: { x: 'bind_email' } };
    expect(offersShown({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc })).toEqual([]);
    expect(offersShown({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: { ...sc, pro_url: 'x' } }))
      .toEqual(['pro']);
  });
  it('[] when the response offered nothing, null when there is no result', () => {
    expect(offersShown(R({ data: [{ id: 1 }], note: 'a Pro-only tool' }))).toEqual([]);   // naming Pro is not a link
    expect(offersShown(null)).toBeNull();
    expect(offersShown('x')).toBeNull();
  });
  it('every kind is one the backend stores (routes/mcp_funnel_events.OFFER_KINDS)', () => {
    expect([...OFFER_KINDS]).toEqual(['credit_pack', 'digest', 'email_unlock', 'free_key', 'oauth_signin', 'pro']);   // oauth_signin: owner 2026-11-12, mirrored in routes/mcp_funnel_events.OFFER_KINDS (dchub-backend)
  });
  it('switch DCHUB_OFFERS_SHOWN_EVENT=0', () => {
    expect(offersShownOn({})).toBe(true);
    expect(offersShownOn({ DCHUB_OFFERS_SHOWN_EVENT: '0' })).toBe(false);
  });
});

describe('G8: the claim hand-off email ask is read off the final result', () => {
  const T = (text) => ({ content: [{ type: 'text', text: '{"ok":1}' }, { type: 'text', text }] });
  it('both hand-off lines read as an email ask (a copy change here must update the matcher)', () => {
    for (const status of ['anon_daily_cap', 'anon_hard_wall', 'trial_used']) {
      expect(askedForEmailInProse(T(claimHandoffText({ status, allowance: 'x' })))).toBe(true);
    }
  });
  it('a response that never shows the line is not an ask', () => {
    expect(askedForEmailInProse(T('→ **For your human:** open https://dchub.cloud/u/abc'))).toBe(false);
    expect(askedForEmailInProse({ content: [], structuredContent: { note: 'ask your human for their email' } })).toBe(false);
    expect(askedForEmailInProse(null)).toBe(false);
  });
});

describe('finalAskMark: a step\'s ask counts only if the final result still carries it', () => {
  const T = (text, sc) => ({ content: [{ type: 'text', text: '{"ok":1}' }, ...(text ? [{ type: 'text', text }] : [])],
    ...(sc ? { structuredContent: sc } : {}) });
  const line = claimHandoffText({ status: 'trial_used' });
  it('an existing mark is never replaced', () => {
    expect(finalAskMark({ emailAsk: 'link_exit', gap: { kind: 'line' }, result: T(line) })).toBeNull();
  });
  it('a gap counts while its ask survived, and is dropped with it (the lean step cuts asks)', () => {
    expect(finalAskMark({ gap: { kind: 'bind_field' }, result: T(null, { _bind: { tool: 'bind_email' } }) })).toBe('bind_field');
    expect(finalAskMark({ gap: { kind: 'bind_field' }, result: T(null, { data: [1] }) })).toBeNull();
    expect(finalAskMark({ gap: { kind: 'line' }, result: T('call `bind_email` with your human\'s email') })).toBe('line');
  });
  it('a link gap counts only while that link is in the result', () => {
    const url = 'https://dchub.cloud/u/em41l';
    expect(finalAskMark({ gap: { kind: 'link', url }, result: T('open ' + url) })).toBe('link');
    expect(finalAskMark({ gap: { kind: 'link', url }, result: T('open https://dchub.cloud/u/other') })).toBeNull();
  });
  it('no gap: the claim hand-off line on the result is a line ask; nothing else is', () => {
    expect(finalAskMark({ result: T(line) })).toBe('line');
    expect(finalAskMark({ result: T('call `bind_email`') })).toBeNull();   // only a step's own gap reads bind_email
    expect(finalAskMark({ result: null })).toBeNull();
  });
});

describe('quota_wall_hit carries offers_shown only when it is known', () => {
  const base = { name: 'find_sites', status: 'anon_hard_wall' };
  it('absent = unknown (the backend stores NULL), [] = offered nothing', () => {
    expect('offers_shown' in quotaWallEventBody({ ...base, c: {} })).toBe(false);
    expect(quotaWallEventBody({ ...base, c: { _offersShown: [] } }).offers_shown).toEqual([]);
    expect(quotaWallEventBody({ ...base, c: { _offersShown: ['email_unlock', 'pro'] } }).offers_shown)
      .toEqual(['email_unlock', 'pro']);
  });
});

describe('G8: the steps that add an ask hold it for the final result (c._askGap), never over a mark', () => {
  let saved;
  beforeEach(() => { saved = process.env.DCHUB_OFFERS_SHOWN_EVENT; delete process.env.DCHUB_OFFERS_SHOWN_EVENT; });
  afterEach(() => { if (saved === undefined) delete process.env.DCHUB_OFFERS_SHOWN_EVENT; else process.env.DCHUB_OFFERS_SHOWN_EVENT = saved; });
  const shape = () => ({ content: [{ type: 'text', text: JSON.stringify({ data: [{ id: 1 }], success: true }) }] });
  const free = () => ({ tier: 'free', email: null, session_id: null });

  it('withBindHint: its _bind ask is marked', () => {
    const c = free();
    const out = withBindHint(shape(), 'search_facilities', c);
    expect(out.structuredContent && out.structuredContent._bind).toBeTruthy();
    expect(c._askGap).toEqual({ kind: 'bind_field' });
    expect(c._emailAsk || '').toBe('');
  });
  it('a stronger mark already on the call stays', () => {
    const c = free();
    markEmailAsk(c, 'link_exit');
    withBindHint(shape(), 'search_facilities', c);
    expect(c._emailAsk).toBe('link_exit');
    expect(c._askGap).toBeUndefined();
  });
  it('switch off: no new mark', () => {
    process.env.DCHUB_OFFERS_SHOWN_EVENT = '0';
    const c = free();
    withBindHint(shape(), 'search_facilities', c);
    expect(c._askGap).toBeUndefined();
  });
  it('the once-per-key bind notice is marked', () => {
    const ctx = { tier: 'free', session_id: 'no-session', platform: 'cursor', api_key: 'dch_c3_test',
      bind_notice_per_key: true, bind_notice_due: true, key_usage: { calls: 5, since: '2026-11-01' } };
    const r = { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } };
    const out = _ctxALS.run(ctx, () => _bindNoticeOnceStep(r, 'get_news'));
    expect(out.content).toHaveLength(2);
    expect(ctx._askGap).toEqual({ kind: 'line' });
  });
  it('the save-offer email hint is marked', () => {
    const prev = process.env.DCHUB_EMAIL_HINT_V1;
    process.env.DCHUB_EMAIL_HINT_V1 = '1';
    _resetEmailHintState();
    try {
      const sc = { data: [{ id: 1 }], trial_preview: true, human_url: 'https://dchub.cloud/u/dh7axt' };
      const ctx = { tier: 'free', session_id: 'sid-c3-hint', platform: 'claude' };
      const out = _ctxALS.run(ctx, () => _emailHintStep({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc }, 'get_market_intel'));
      expect(out.content.length).toBe(2);
      expect(ctx._askGap).toEqual({ kind: 'line' });
    } finally {
      if (prev === undefined) delete process.env.DCHUB_EMAIL_HINT_V1; else process.env.DCHUB_EMAIL_HINT_V1 = prev;
      _resetEmailHintState();
    }
  });
});
