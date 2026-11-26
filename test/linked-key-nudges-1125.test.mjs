// linked-key-nudges-1125.test.mjs: a handoff-linked keyless caller (no key on the connection, linked to a paid
// plan through the agent handoff) is not told it was served anonymously or to claim a key (2026-11-25, live audit).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
process.env.DCHUB_QUOTA_HINT = '1';   // read at load; on in production
process.env.DCHUB_INCONTEXT_CLAIM = '1';   // read at load (the in-context claim block on get_grid_intelligence)
let S;
beforeAll(async () => { S = await import('../server.mjs'); });
afterEach(() => { delete process.env.DCHUB_PLAN_HANDOFF_LINK; });
const TOKEN = 'dchl1.x1' + 'A'.repeat(40) + '.' + 'a'.repeat(32);
const linked = () => ({ session_id: 'sess-linked-1125', tier: 'pro', handoff_linked: true, linked_token: TOKEN, auth_source: 'none' });
const anon = () => ({ session_id: 'sess-anon-1125', tier: 'free', auth_source: 'none' });

describe('quota stamp', () => {
  it('linked: no "claim a key to open the budget" line; a plain anonymous seat keeps it', () => {
    const q = S._ctxALS.run(linked(), () => S._buildQuotaHint('get_grid_intelligence'));
    expect(q.full_answers_unavailable_reason).toBeUndefined();
    expect(q.full_answers_basis).toMatch(/linked DC Hub access \(agent handoff\)/);
    expect(q.tier).toBe('pro');
    const a = S._ctxALS.run(anon(), () => S._buildQuotaHint('get_grid_intelligence'));
    expect(JSON.stringify(a)).not.toMatch(/linked DC Hub access/);
  });
  it('a link without a token: no claim-a-key line either, and the basis says fields may be a preview', () => {
    const q = S._ctxALS.run({ ...linked(), linked_token: '' }, () => S._buildQuotaHint('get_grid_intelligence'));
    expect(q.full_answers_unavailable_reason).toBeUndefined();
    expect(q.full_answers_basis).toMatch(/linked to a DC Hub plan \(agent handoff\).*may still come back as a preview/);
  });
  it('kill switch DCHUB_PLAN_HANDOFF_LINK=0: the linked branch is off', () => {
    process.env.DCHUB_PLAN_HANDOFF_LINK = '0';
    const q = S._ctxALS.run(linked(), () => S._buildQuotaHint('get_grid_intelligence'));
    expect(JSON.stringify(q)).not.toMatch(/linked DC Hub access/);
  });
});

describe('identity.means', () => {
  it('linked: linked_access, no "served ANONYMOUSLY", no claim-a-key advice', () => {
    const id = S._identitySource(linked());
    expect(id.credential_source).toBe('none');
    expect(id.linked_access).toBe(true);
    expect(id.means).toMatch(/linked DC Hub access \(agent handoff\)/);
    expect(id.means).not.toMatch(/ANONYMOUSLY|claim_free_key|get_api_key/);
  });
  it('a plain anonymous caller keeps the anonymous wording', () => {
    expect(S._identitySource(anon()).means).toMatch(/ANONYMOUSLY/);
    expect(S._identitySource(anon()).linked_tier_only).toBeUndefined();
  });
  it('a link without a token: not anonymous, no claim-a-key advice, says fields may still be a preview', () => {
    const id = S._identitySource({ ...linked(), linked_token: '' });
    expect(id.linked_access).toBeUndefined();
    expect(id.linked_tier_only).toBe(true);
    expect(id.means).toMatch(/linked to a DC Hub plan \(agent handoff\)/);
    expect(id.means).toMatch(/may still come back as a preview/);
    expect(id.means).not.toMatch(/ANONYMOUSLY|claim_free_key|get_api_key/);
    process.env.DCHUB_PLAN_HANDOFF_LINK = '0';
    expect(S._identitySource({ ...linked(), linked_token: '' }).means).toMatch(/ANONYMOUSLY/);
  });
});

describe('in-context claim block (get_grid_intelligence)', () => {
  // The claim path reads the backend (trackPaidHit, shouldMintClaim); a skipped caller makes no read at all.
  const SID = '0f5c2a1e-7b3d-4c9a-9e21-5a6b7c8d9e01';
  const res = () => ({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } });
  const reads = async (c) => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"mint":false}', { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      const out = await S._ctxALS.run(c, () => S._maybeEmbedValueClaim(res(), 'get_grid_intelligence', c));
      await new Promise((r) => setTimeout(r, 20));
      return { n: spy.mock.calls.filter((a) => /should-mint-claim|paid-hit|track-paid/.test(String(a[0]))).length, out };
    } finally { spy.mockRestore(); }
  };
  const seat = (o) => ({ session_id: SID, auth_source: 'none', platform: 'claude', user_agent: 'claude-code/2.0.1', client_name: 'claude-code', ...o });
  it('an unlinked keyless seat reaches the claim lookup (control)', async () => {
    expect((await reads(seat({ tier: 'free' }))).n).toBeGreaterThan(0);
  });
  it('a linked seat, with or without the backend token, skips it; the kill switch restores it', async () => {
    expect((await reads(seat({ tier: 'pro', handoff_linked: true, linked_token: TOKEN }))).n).toBe(0);
    expect((await reads(seat({ tier: 'pro', handoff_linked: true, linked_token: '' }))).n).toBe(0);
    process.env.DCHUB_PLAN_HANDOFF_LINK = '0';
    expect((await reads(seat({ tier: 'pro', handoff_linked: true, linked_token: '' }))).n).toBeGreaterThan(0);
  });
});
