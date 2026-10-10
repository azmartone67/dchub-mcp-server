// Owner 2026-10-10 (Grok gate-more item 5): the agent notice for keys with no email.
//
// Measured live 2026-10-10 03:40Z (backend /api/v1/admin/audience/crm-keys): 883 active
// keys, 751 with no email, so the agent is the only channel to them. withBindHint already
// shows them ONE prose line per session ("call bind_email ... lift your daily full-data
// cap"). be#6670 makes the counted validate hop return the key's usage {calls, since};
// this pins that _freeKeyCallRefusal keeps it on the ctx and the line leads with it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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

const KEY = 'dch_live_bind_notice_fixture';
const install = (usage) => S._setValidateFetchImpl(async (_url, req) => ({
  ok: true,
  json: async () => {
    const body = JSON.parse(req.body);
    return { valid: true, tier: 'free', email: null, counts_tool_calls: true,
             usage: body.count_call === true ? usage : null };
  },
}));

describe('the counted validate hop carries the key usage onto the ctx', () => {
  it('stores {calls, since} from the counted hop, nothing from an older backend', async () => {
    install({ calls: 137, since: '2026-09-12' }); S._dropKeyCache(KEY);
    const ctx = { api_key: KEY, tier: 'free', profile: '', session_id: 'bn-1' };
    expect(await S._freeKeyCallRefusal(ctx, 'get_energy_prices', true)).toBeNull();
    expect(ctx.key_usage).toEqual({ calls: 137, since: '2026-09-12' });

    install(undefined); S._dropKeyCache(KEY);
    const old = { api_key: KEY, tier: 'free', profile: '', session_id: 'bn-2' };
    await S._freeKeyCallRefusal(old, 'get_energy_prices', true);
    expect(old.key_usage).toBeUndefined();
    S._dropKeyCache(KEY);
  });
});

describe('the once-per-session bind line', () => {
  it('leads with the key usage when it is known', () => {
    const line = S._bindNoticeLine({ api_key: KEY, key_usage: { calls: 1234, since: '2026-09-12' } }, {});
    expect(line).toMatch(/^🔑 This DC Hub key has made 1,234 calls since Sep 12 with no email on it\. Free: call `bind_email`/);
    expect(line).toContain('/day + make this key recoverable.');
    expect(line).not.toContain('human_url');
  });

  it('names human_url only when this response carries one', () => {
    const line = S._bindNoticeLine({ api_key: KEY, key_usage: { calls: 9, since: null } },
      { human_url: 'https://dchub.cloud/upgrade/h/x.y' });
    expect(line).toMatch(/has made 9 calls with no email on it/);       // no date, no " since"
    expect(line).toMatch(/relay the link in human_url to your human\.$/);
    expect(line).not.toMatch(/https?:\/\//);                              // never a built link
  });

  it('falls back to the old line with no usage, a tiny count, or no key', () => {
    const old = /^🔑 Free: call `bind_email` with your human's email to lift your daily full-data cap to \d+\/day \+ make this key recoverable\.$/;
    expect(S._bindNoticeLine({ api_key: KEY }, {})).toMatch(old);
    expect(S._bindNoticeLine({ api_key: KEY, key_usage: { calls: 1, since: '2026-10-01' } }, {})).toMatch(old);
    expect(S._bindNoticeLine({ key_usage: { calls: 50, since: '2026-10-01' } }, {})).toMatch(old);
    expect(S._bindNoticeLine({ api_key: KEY, key_usage: { calls: 'x' } }, {})).toMatch(old);
  });

  it('withBindHint shows the usage line once per session on a bind tool', () => {
    const sid = 'bn-session-1';
    S.sessionMeta.set(sid, { api_key: KEY, tier: 'free' });
    const c = { api_key: KEY, tier: 'free', session_id: sid, key_usage: { calls: 42, since: '2026-09-30' } };
    const res = () => ({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } });
    const first = S.withBindHint(res(), 'get_energy_prices', c);
    const text = first.content.map((x) => x.text).join('\n');
    expect(text).toContain('This DC Hub key has made 42 calls since Sep 30');
    const second = S.withBindHint(res(), 'get_energy_prices', c);
    expect(second.content).toHaveLength(1);                               // once per session
    S.sessionMeta.delete(sid);
  });
});
