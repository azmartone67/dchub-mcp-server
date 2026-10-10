// Owner 2026-10-10 (warm-keys decisions via Grok): "Agent channel for the 751 no-email keys:
// GO. Once-per-key line." mcp#888 shows the bind notice once per MCP SESSION, on 15 tools,
// on the inner return paths only, so a client that opens a session per call sees it on every
// call and a stateless caller never does. The backend now answers bind_notice_due=true on
// exactly one counted call per key (it stamps the key in the counting UPDATE). This pins:
// the flag rides validate -> ctx, the outer step shows the line on that call only, on any
// tool, and the per-session line stands down whenever the backend speaks the flag.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';

let S, prevBase;
beforeAll(async () => {
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  S = await import('../server.mjs');
});
afterAll(() => {
  S._setValidateFetchImpl(null);
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

const KEY = 'dch_live_bind_once_fixture';
const install = (extra) => S._setValidateFetchImpl(async (_url, req) => ({
  ok: true,
  json: async () => {
    const body = JSON.parse(req.body);
    return { valid: true, tier: 'free', email: null, counts_tool_calls: true,
             usage: body.count_call === true ? { calls: 57, since: '2026-09-12' } : null, ...extra };
  },
}));
const res = (sc = { ok: true }) => ({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc });
const step = (ctx, r = res(), name = 'get_news') =>
  S._ctxALS.run({ tier: 'free', session_id: 'no-session', platform: 'cursor', ...ctx }, () => S._bindNoticeOnceStep(r, name));

describe('validate -> ctx', () => {
  it('carries bind_notice_due and marks the backend as per-key', async () => {
    install({ bind_notice_due: true }); S._dropKeyCache(KEY);
    const c = { api_key: KEY, tier: 'free', profile: '', session_id: 'x1' };
    await S._freeKeyCallRefusal(c, 'get_news', true);
    expect(c.bind_notice_per_key).toBe(true);
    expect(c.bind_notice_due).toBe(true);

    install({ bind_notice_due: false }); S._dropKeyCache(KEY);
    const c2 = { api_key: KEY, tier: 'free', profile: '', session_id: 'x2' };
    await S._freeKeyCallRefusal(c2, 'get_news', true);
    expect(c2.bind_notice_per_key).toBe(true);
    expect(c2.bind_notice_due).toBe(false);
  });
  it('an older backend (no field) leaves the per-session line in charge', async () => {
    install({}); S._dropKeyCache(KEY);
    const c = { api_key: KEY, tier: 'free', profile: '', session_id: 'x3' };
    await S._freeKeyCallRefusal(c, 'get_news', true);
    expect(c.bind_notice_per_key).toBeUndefined();
    expect(c.bind_notice_due).toBeUndefined();
    S._dropKeyCache(KEY);
  });
});

describe('_bindNoticeOnceStep', () => {
  const due = { api_key: KEY, bind_notice_per_key: true, bind_notice_due: true, key_usage: { calls: 57, since: '2026-09-12' } };

  it('appends the usage line on the due call, on a tool outside BIND_CTA_TOOLS, sessionless', () => {
    const out = step({ ...due });
    expect(out.content).toHaveLength(2);
    expect(out.content[1].text).toMatch(/^🔑 This DC Hub key has made 57 calls since Sep 12 with no email on it\. Free: call `bind_email`/);
    expect(out.content[1].text).not.toMatch(/https?:\/\//);
  });
  it('appends nothing when the backend says not due', () => {
    const r = res();
    expect(step({ ...due, bind_notice_due: false }, r)).toBe(r);
  });
  it('fires once even if the step runs twice on one call', () => {
    const ctx = { tier: 'free', session_id: 'no-session', platform: 'cursor', ...due };
    const out = S._ctxALS.run(ctx, () => S._bindNoticeOnceStep(S._bindNoticeOnceStep(res(), 'get_news'), 'get_news'));
    expect(out.content).toHaveLength(2);
  });
  it('points at human_url only when this response carries one', () => {
    const out = step({ ...due }, res({ ok: true, human_url: 'https://dchub.cloud/upgrade/h/a.b' }));
    expect(out.content[1].text).toMatch(/relay the link in human_url to your human\.$/);
  });
  it.each(['chatgpt_directory', 'claude_directory', 'core_profile'])(
    'stays off the %s profile', (profile) => {
      const r = res();
      expect(step({ ...due, profile }, r)).toBe(r);
    });
  it('stays off bound and paid callers', () => {
    const r = res();
    expect(step({ ...due, email: 'a@b.co' }, r)).toBe(r);
    expect(step({ ...due, tier: 'developer' }, r)).toBe(r);
  });
  it('does not repeat a line the inner path already added', () => {
    const r = res(); r.content.push({ type: 'text', text: '🔑 Free: call `bind_email` with your human\'s email to lift…' });
    expect(step({ ...due }, r)).toBe(r);
  });
});

describe('withBindHint stands down when the backend speaks per-key', () => {
  it('no per-session prose when bind_notice_per_key is set; the structured _bind stays', () => {
    const sid = 'bn-once-1';
    S.sessionMeta.set(sid, { api_key: KEY, tier: 'free' });
    const c = { api_key: KEY, tier: 'free', session_id: sid, bind_notice_per_key: true, bind_notice_due: false };
    const out = S.withBindHint(res(), 'get_energy_prices', c);
    expect(out.content).toHaveLength(1);
    expect(out.structuredContent._bind.next_tool).toBe('bind_email');
    S.sessionMeta.delete(sid);
  });
});

describe('wiring', () => {
  it('sits inside _flagUpstreamError, outside _emailHintStep, in the one outer chain', () => {
    const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(SRC).toContain('async (args, extra) => _flagUpstreamError(_bindNoticeOnceStep(_emailHintStep(await _partnerInboxStep(');
  });
});
