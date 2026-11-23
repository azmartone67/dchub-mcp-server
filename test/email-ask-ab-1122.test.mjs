// email-ask-ab-1122.test.mjs — F4 "Email-ask A/B" (lib/email-ask-ab.mjs, server.mjs _emailAskAbStep /
// _emailAskAbCaptured / _quotaWallEventFor). DRAFT, flag DCHUB_EMAIL_ASK_AB default OFF.
//
//   E1  flag off: an unlock-ask wall comes back byte-identical (and the same object); no row, no arm.
//   E2  flag on: the arm is the shared one (fixed vectors = dchub-backend tests/test_email_ask_ab.py), sticky per
//       identity, 50 +/- 3% over 2,000 synthetic identities.
//   E3  arm B with a market / ISO names it; without one it shows arm A's text; neither arm carries a banned word.
//   E4  the arm rides the quota_wall_hit body (email_ask_ab), the exposure row carries the backend's arm, and an email
//       entry posts email_captured.
//   E5  a result already carrying another step's email_ask (mcp#1677 wall to key) passes through unchanged, no exposure.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as EAB from '../lib/email-ask-ab.mjs';
import * as MX from '../lib/monetization-experiments.mjs';
import { keylessCapEmailResult, keylessSoftCapEmailUpgrade } from '../lib/keyless-wall.mjs';
import { _emailAskAbStep, _emailAskAbCaptured, _quotaWallEventFor } from '../server.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';

const LINK = 'https://dchub.cloud/u/AbCdEf12';
// Guardrails for agent-facing copy: no prices, plan names, "free", credits, trial, calls-per-day or tool counts.
const BANNED = /\$|\bper month\b|\/mo\b|\b(?:pro|developer|starter|enterprise|team|plan|plans|trial|credits?|free)\b|\/day\b|\bper day\b|\bcalls? (?:a|per) day\b|\b\d+\s+tools\b/i;

const hardWall = (name = 'get_market_intel', opts = {}) => keylessCapEmailResult({
  name, link: LINK, exitShown: false, perDay: 10, market: '', emailOpens: true, wallKind: 'anon_hard_wall',
  base: { error: 'anon_hard_wall', current_tier: 'free', binding_limit: 'anon_ip_daily_hard' }, ...opts });
const softWall = (name = 'get_market_intel') => {
  const em = keylessSoftCapEmailUpgrade({ data: [1, 2], _upgrade: { remaining_today: 0 } },
    { name, link: LINK, exitShown: true, perDay: 10, emailOpens: true });
  return { content: [{ type: 'text', text: JSON.stringify(em) }], structuredContent: em };
};
// A client IP whose identity lands in the wanted arm (found, not hard-coded, so the IP format stays realistic).
function ipInArm(letter) {
  for (let n = 1; n < 500; n++) {
    const ip = '203.0.113.' + n;
    if (EAB.armLetter(MX.identityOf({ client_ip: ip })) === letter) return ip;
  }
  throw new Error('no ip for arm ' + letter);
}
const ctxFor = (ip, ask = 'link') => ({ client_ip: ip, session_id: 'sess-f4-' + ip.split('.').pop(), platform: 'claude-code', _emailAsk: ask });

let saved;
beforeEach(() => { saved = process.env.DCHUB_EMAIL_ASK_AB; EAB._resetForTests(); MX._resetForTests(); });
afterEach(() => { if (saved === undefined) delete process.env.DCHUB_EMAIL_ASK_AB; else process.env.DCHUB_EMAIL_ASK_AB = saved; });

describe('E1 flag off: byte-identical', () => {
  it('hard and soft unlock-ask walls pass through untouched, nothing posted, no arm', () => {
    delete process.env.DCHUB_EMAIL_ASK_AB;
    for (const [w, name] of [[hardWall(), 'get_market_intel'], [softWall(), 'get_market_intel'],
                             [hardWall('get_interconnection_queue'), 'get_interconnection_queue']]) {
      const before = JSON.stringify(w);
      const posts = [];
      const c = ctxFor(ipInArm(EAB.ARM_B));
      const out = _emailAskAbStep(w, name, { market: 'dallas', iso: 'ERCOT' }, c, { post: (p, b) => posts.push(b) });
      expect(out).toBe(w);
      expect(JSON.stringify(out)).toBe(before);
      expect(posts).toEqual([]);
      expect(c._emailAskAbArm).toBeUndefined();
      expect(_quotaWallEventFor(c, name, 'anon_hard_wall')).not.toHaveProperty('email_ask_ab');
    }
  });
  it('an explicit 0 is off too', () => {
    process.env.DCHUB_EMAIL_ASK_AB = '0';
    const w = hardWall();
    expect(_emailAskAbStep(w, 'get_market_intel', { market: 'dallas' }, ctxFor(ipInArm(EAB.ARM_B)), { post: () => {} })).toBe(w);
  });
});

describe('E2 assignment: shared, sticky, 50/50', () => {
  it('fixed vectors from the shared hash (sha256(identity + test)[:16] % 100, < 50 = B)', () => {
    expect(MX.bucketFor('ip-' + 'b'.repeat(64), MX.EMAIL_ASK_AB)).toBe(33);
    expect(MX.bucketFor('pk-' + 'a'.repeat(64), MX.EMAIL_ASK_AB)).toBe(21);
    expect(MX.bucketFor('ip-' + '1'.padStart(64, '0'), MX.EMAIL_ASK_AB)).toBe(71);
    expect(MX.bucketFor('ip-' + '9'.padStart(64, '0'), MX.EMAIL_ASK_AB)).toBe(1);
    expect(EAB.armLetter('ip-' + 'b'.repeat(64))).toBe(EAB.ARM_B);
    expect(EAB.armLetter('ip-' + '1'.padStart(64, '0'))).toBe(EAB.ARM_A);
    expect(EAB.armLetter('ip-' + '8'.padStart(64, '0'))).toBe(EAB.ARM_A);   // bucket 74
    expect(MX.armFor('ip-' + '1'.padStart(64, '0'), MX.EMAIL_ASK_AB)).toBe(MX.HOLDOUT);
    expect(MX.armFor('ip-' + 'b'.repeat(64), MX.EMAIL_ASK_AB)).toBe(MX.TREATMENT);
    // The other tests keep 80/20: bucket 71 is treatment there.
    expect(MX.armFor('ip-' + '1'.padStart(64, '0'), MX.UPGRADE_BLOCK)).toBe(MX.bucketFor('ip-' + '1'.padStart(64, '0'), MX.UPGRADE_BLOCK) < 80 ? MX.TREATMENT : MX.HOLDOUT);
  });
  it('2,000 identities split 50 +/- 3%, and each keeps its arm', () => {
    const ids = Array.from({ length: 2000 }, (_, n) => 'ip-' + (n * 7919).toString(16).padStart(64, '0'));
    const arms = ids.map((i) => EAB.armLetter(i));
    expect(ids.map((i) => EAB.armLetter(i))).toEqual(arms);
    const share = arms.filter((a) => a === EAB.ARM_B).length / ids.length;
    expect(share).toBeGreaterThanOrEqual(0.47);
    expect(share).toBeLessThanOrEqual(0.53);
  });
  it('through the step: the same caller gets the same arm on repeated calls', () => {
    process.env.DCHUB_EMAIL_ASK_AB = '1';
    for (const letter of [EAB.ARM_A, EAB.ARM_B]) {
      const ip = ipInArm(letter);
      const seen = [];
      for (let k = 0; k < 5; k++) {
        const c = ctxFor(ip);
        _emailAskAbStep(hardWall(), 'get_market_intel', { market: 'dallas' }, c, { post: () => {} });
        seen.push(c._emailAskAbArm);
      }
      expect(new Set(seen)).toEqual(new Set([letter]));
    }
  });
});

describe('E3 copy', () => {
  beforeEach(() => { process.env.DCHUB_EMAIL_ASK_AB = '1'; });
  const textOf = (r) => r.content.map((b) => b.text).join('\n');
  it('arm B names the market from the call', () => {
    const w = hardWall();
    const out = _emailAskAbStep(w, 'get_market_intel', { market: 'Dallas' }, ctxFor(ipInArm(EAB.ARM_B)), { post: () => {} });
    const want = 'Add an email to get the full Dallas answer: ' + LINK;
    expect(out.structuredContent.user_message).toBe(want);
    expect(textOf(out)).toContain(want);
    expect(textOf(out)).not.toContain(w.structuredContent.user_message);
    expect(out.structuredContent.for_your_human.text).toBe(want);
    expect(out.structuredContent.human_url).toBe(LINK);   // link and enforcement facts unchanged
    expect(out.structuredContent.error).toBe('anon_hard_wall');
    expect(out.isError).toBe(w.isError);
  });
  it('arm B names the ISO, and "queue" on the queue tools', () => {
    const c = ctxFor(ipInArm(EAB.ARM_B));
    const q = _emailAskAbStep(hardWall('get_interconnection_queue'), 'get_interconnection_queue', { iso: 'ercot' }, c, { post: () => {} });
    expect(q.structuredContent.user_message).toBe('Add an email to get the full ERCOT queue: ' + LINK);
    const g = _emailAskAbStep(hardWall('get_grid_intelligence'), 'get_grid_intelligence', { iso: 'iso-ne' }, ctxFor(ipInArm(EAB.ARM_B)), { post: () => {} });
    expect(g.structuredContent.user_message).toBe('Add an email to get the full ISO-NE answer: ' + LINK);
  });
  it('arm B on the soft cap rewrites the line in the JSON text, user_message and _upgrade.message', () => {
    const w = softWall();
    const old = w.structuredContent.user_message;
    const out = _emailAskAbStep(w, 'get_market_intel', { market: 'phoenix' }, ctxFor(ipInArm(EAB.ARM_B), 'link_exit'), { post: () => {} });
    const want = 'Add an email to get the full Phoenix answer: ' + LINK;
    expect(out.structuredContent.user_message).toBe(want);
    expect(out.structuredContent._upgrade.message.startsWith(want)).toBe(true);
    expect(JSON.parse(out.content[0].text).user_message).toBe(want);
    expect(JSON.stringify(out)).not.toContain(old);
  });
  it('arm B without a market or ISO falls back to arm A text but is recorded as B', () => {
    const w = hardWall();
    const posts = [];
    const c = ctxFor(ipInArm(EAB.ARM_B));
    const out = _emailAskAbStep(w, 'get_market_intel', { iso: 'XYZ', market: '!!' }, c, { post: (p, b) => posts.push(b) });
    expect(JSON.stringify(out)).toBe(JSON.stringify(w));
    expect(c._emailAskAbArm).toBe(EAB.ARM_B);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ test: MX.EMAIL_ASK_AB, arm: MX.TREATMENT, event: 'exposure' });
  });
  it('arm A is untouched even with a market', () => {
    const w = hardWall();
    const c = ctxFor(ipInArm(EAB.ARM_A));
    const out = _emailAskAbStep(w, 'get_market_intel', { market: 'dallas' }, c, { post: () => {} });
    expect(out).toBe(w);
    expect(c._emailAskAbArm).toBe(EAB.ARM_A);
  });
  it('arm B does not promise the full answer where an email does not open it', () => {
    expect(EAB.armBLine({ subject: { kind: 'market', label: 'Dallas' }, link: LINK, emailOpens: false })).toBe('');
  });
  it('neither arm carries a banned word (every subject kind, every unlock-ask wall)', () => {
    const lines = [];
    for (const [letter, args, name] of [[EAB.ARM_A, { market: 'dallas' }, 'get_market_intel'],
      [EAB.ARM_B, { market: 'dallas' }, 'get_market_intel'], [EAB.ARM_B, { iso: 'PJM' }, 'get_interconnection_queue'],
      [EAB.ARM_B, { iso: 'CAISO' }, 'get_grid_intelligence'], [EAB.ARM_B, {}, 'get_market_intel']]) {
      for (const w of [hardWall(name), softWall(name)]) {
        const out = _emailAskAbStep(w, name, args, ctxFor(ipInArm(letter)), { post: () => {} });
        lines.push(out.structuredContent.user_message);
      }
    }
    for (const l of lines) expect(BANNED.test(l), l).toBe(false);
    // The arm B template itself, on every ISO it can name.
    for (const iso of ['ERCOT', 'PJM', 'CAISO', 'MISO', 'SPP', 'NYISO', 'ISONE']) {
      for (const tool of ['get_interconnection_queue', 'get_grid_intelligence']) {
        const l = EAB.armBLine({ subject: EAB.askSubject({ iso }), link: LINK, tool });
        expect(l).toMatch(/^Add an email to get the full /);
        expect(BANNED.test(l), l).toBe(false);
      }
    }
    expect(BANNED.test('Add an email to get the full Pro answer')).toBe(true);   // the guard can fail
  });
  it('not an unlock-ask wall: untouched, nothing recorded', () => {
    const w = hardWall();
    const posts = [];
    for (const ask of ['line', 'bind_field', 'digest_line', 'key_line', '']) {
      const c = ctxFor(ipInArm(EAB.ARM_B), ask);
      expect(_emailAskAbStep(w, 'get_market_intel', { market: 'dallas' }, c, { post: (p, b) => posts.push(b) })).toBe(w);
      expect(c._emailAskAbArm).toBeUndefined();
    }
    expect(posts).toEqual([]);
  });
  it('never on /mcp/chatgpt clients, the directory profile or a plan step', () => {
    const w = hardWall();
    for (const extra of [{ platform: 'chatgpt' }, { profile: DIRECTORY_PROFILE }, { loopback_step: true }]) {
      const c = { ...ctxFor(ipInArm(EAB.ARM_B)), ...extra };
      expect(_emailAskAbStep(w, 'get_market_intel', { market: 'dallas' }, c, { post: () => {} })).toBe(w);
    }
  });
});

describe('E4 recording', () => {
  beforeEach(() => { process.env.DCHUB_EMAIL_ASK_AB = '1'; });
  it('the wall row carries the arm letter, the exposure row the backend arm; once per identity per day', () => {
    for (const letter of [EAB.ARM_A, EAB.ARM_B]) {
      EAB._resetForTests();
      const ip = ipInArm(letter);
      const posts = [];
      const post = (p, b) => { posts.push({ p, b }); return Promise.resolve(null); };
      const c = ctxFor(ip);
      _emailAskAbStep(hardWall(), 'get_market_intel', { market: 'dallas' }, c, { post });
      const row = _quotaWallEventFor(c, 'get_market_intel', 'anon_hard_wall');
      expect(row.email_ask_ab).toBe(letter);
      expect(posts).toHaveLength(1);
      expect(posts[0].p).toBe(MX.EXPOSURE_PATH);
      expect(posts[0].b).toMatchObject({ test: 'exp_email_ask_ab', event: 'exposure', tool: 'get_market_intel',
                                         arm: letter === EAB.ARM_B ? 'treatment' : 'holdout' });
      expect(posts[0].b.identity).toBe(MX.identityOf({ client_ip: ip }));
      expect(JSON.stringify(posts[0].b)).not.toContain(ip);   // hashed identity only, never the IP
      // a second wall the same day: arm on the row again, no second exposure row
      const c2 = ctxFor(ip);
      _emailAskAbStep(hardWall(), 'get_market_intel', { market: 'dallas' }, c2, { post });
      expect(_quotaWallEventFor(c2, 'get_market_intel', 'anon_hard_wall').email_ask_ab).toBe(letter);
      expect(posts).toHaveLength(1);
    }
  });
  it('an email entry posts email_captured for the keyless and keyed identity, no email or key in it', () => {
    const posts = [];
    const c = { client_ip: '203.0.113.7', session_id: 's-cap', api_key: 'dch_live_abcdefghijklmnop' };
    const rows = _emailAskAbCaptured(c, 'claim_free_key', { post: (p, b) => { posts.push(b); return Promise.resolve(null); } });
    expect(rows.map((r) => r.event)).toEqual(['email_captured', 'email_captured']);
    expect(posts.map((b) => b.identity)).toEqual([MX.identityOf({ client_ip: '203.0.113.7' }), MX.identityOf({ api_key: c.api_key })]);
    for (const b of posts) {
      expect(b.test).toBe('exp_email_ask_ab');
      expect(b.arm).toBe(MX.armFor(b.identity, MX.EMAIL_ASK_AB));
      expect(JSON.stringify(b)).not.toContain('dch_live_');
    }
    delete process.env.DCHUB_EMAIL_ASK_AB;
    expect(_emailAskAbCaptured(c, 'claim_free_key', { post: () => { throw new Error('posted'); } })).toEqual([]);
  });
});

describe('E5 another step already asked (wall to key)', () => {
  beforeEach(() => { process.env.DCHUB_EMAIL_ASK_AB = '1'; });
  // mcp#1677 lib/wall-to-key.mjs EMAIL_ASK, merged into structuredContent by its withEmailAskAll.
  const W2K_ASK = { tool: 'get_api_key', arguments: { email: "<your human's email>" } };
  it('passes through unchanged with no exposure and no arm, in both arms, hard and soft cap', () => {
    for (const letter of [EAB.ARM_A, EAB.ARM_B]) {
      for (const base of [hardWall(), softWall()]) {
        const w = { ...base, structuredContent: { ...base.structuredContent, email_ask: W2K_ASK, human_message: 'x' } };
        const before = JSON.stringify(w);
        const posts = [];
        const c = ctxFor(ipInArm(letter));
        const out = _emailAskAbStep(w, 'get_market_intel', { market: 'dallas' }, c, { post: (p, b) => posts.push(b) });
        expect(out).toBe(w);
        expect(JSON.stringify(out)).toBe(before);
        expect(posts).toEqual([]);
        expect(c._emailAskAbArm).toBeUndefined();
        expect(_quotaWallEventFor(c, 'get_market_intel', 'anon_hard_wall')).not.toHaveProperty('email_ask_ab');
      }
    }
  });
  it('the cap wall\'s own email_ask (daily-habit copy) does not count as another ask', () => {
    const w = hardWall();
    expect(EAB.foreignEmailAsk(w.structuredContent)).toBe(false);
    expect(EAB.foreignEmailAsk({ ...w.structuredContent, email_ask: W2K_ASK })).toBe(true);
    expect(EAB.foreignEmailAsk({ _upgrade: { email_ask: W2K_ASK } })).toBe(true);
  });
});
