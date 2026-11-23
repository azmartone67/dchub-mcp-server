// email-nudge-shared-1123.test.mjs — the get_api_key nudge once per session ACROSS replicas (QA 2026-11-23 follow-up).
// Live 2026-11-23: two MCP replicas, each with its own memo, so one session read the nudge on calls 1 and 2 (once per
// replica). nudgeOnceShared asks the durable daily counter the first time a replica sees an identity: n === 1 keeps
// the sentence, n > 1 strips it. Counter failure: the replica's own memo decides, as before. Pure: no network.
import { describe, it, expect } from 'vitest';
import { EMAIL_ASK_LEAD } from '../lib/wall-identity-v2.mjs';
import { createNudgeMemo, nudgeOnceShared, sharedNudgeKey, PAIR_TTL_MS, NUDGE_BUCKET } from '../lib/email-nudge-once.mjs';

const LINE = EMAIL_ASK_LEAD + ' and get a daily change note.';
const RES = () => ({ content: [{ type: 'text', text: 'Answer. ' + LINE }],
  structuredContent: { email_ask: { tool: 'get_api_key', arguments: { email: 'x' }, copy: LINE } } });
const has = (r) => JSON.stringify(r).includes(EMAIL_ASK_LEAD);
// The backend counter: an atomic upsert per key, returning n after the increment.
const counter = () => { const m = new Map(); const calls = []; return { calls,
  consume: async (k) => { calls.push(k); const n = (m.get(k) || 0) + 1; m.set(k, n); return n; } }; };

describe('nudgeOnceShared', () => {
  it('two replicas, one session, six calls alternating: the nudge shows exactly once', async () => {
    const C = counter();
    const replicas = [createNudgeMemo(), createNudgeMemo()];
    const shown = [];
    for (let i = 0; i < 6; i++) shown.push(has(await nudgeOnceShared(RES(), 'sid:s1', replicas[i % 2], C.consume)));
    expect(shown).toEqual([true, false, false, false, false, false]);
    expect(C.calls.length, 'one counter call per replica, then the local memo answers').toBe(2);
  });
  it('a second session gets its own nudge', async () => {
    const C = counter(); const a = createNudgeMemo(); const b = createNudgeMemo();
    expect(has(await nudgeOnceShared(RES(), 'sid:s1', a, C.consume))).toBe(true);
    expect(has(await nudgeOnceShared(RES(), 'sid:s2', b, C.consume))).toBe(true);
  });
  it('counter down, slow or malformed: the local memo decides (first kept, later stripped)', async () => {
    for (const bad of [async () => null, async () => { throw new Error('x'); }, async () => 'two', undefined]) {
      const m = createNudgeMemo();
      expect(has(await nudgeOnceShared(RES(), 'sid:s1', m, bad))).toBe(true);
      expect(has(await nudgeOnceShared(RES(), 'sid:s1', m, bad))).toBe(false);
    }
  });
  it('kill switch, no identity, no sentence: unchanged and no counter call', async () => {
    const C = counter(); const m = createNudgeMemo();
    const r1 = RES();
    expect(await nudgeOnceShared(r1, 'sid:s1', m, C.consume, { DCHUB_EMAIL_NUDGE_ONCE: '0' })).toBe(r1);
    const r2 = RES();
    expect(await nudgeOnceShared(r2, '', m, C.consume)).toBe(r2);
    const r3 = { content: [{ type: 'text', text: 'plain' }] };
    expect(await nudgeOnceShared(r3, 'sid:s9', m, C.consume)).toBe(r3);
    expect(C.calls).toEqual([]);
  });
  it('sharedNudgeKey: hashed, under the counter limit, the pair key carries its 30-minute window', () => {
    const k = sharedNudgeKey('sid:a-very-long-session-id-' + 'x'.repeat(300));
    expect(k).toMatch(/^nudge:[0-9a-f]{32}$/);
    expect(k.length).toBeLessThanOrEqual(200);
    const t = 10 * PAIR_TTL_MS;
    expect(sharedNudgeKey('pair:p', t)).toBe(sharedNudgeKey('pair:p', t + PAIR_TTL_MS - 1));
    expect(sharedNudgeKey('pair:p', t)).not.toBe(sharedNudgeKey('pair:p', t + PAIR_TTL_MS));
    expect(sharedNudgeKey('sid:s', t)).toBe(sharedNudgeKey('sid:s', t + 5 * PAIR_TTL_MS));
    expect(sharedNudgeKey('')).toBe('');
    expect(NUDGE_BUCKET).toBe('email_nudge');
  });
});
