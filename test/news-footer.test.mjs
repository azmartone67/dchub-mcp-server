// Brain 2026-10-30: a free key's get_news answer ends with ONE line pointing at the free monthly
// full site analysis, above the Source line. Unit half: lib/news-footer.mjs. Wiring half: the real
// server.mjs app on loopback (stub backend, no network): a keyed free caller gets it; keyless, a
// paid key, a pack buyer, /mcp/claude and a clean platform (ChatGPT) do not.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withNewsFooter, NEWS_FOOTER_LINE } from '../lib/news-footer.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const J = (o) => JSON.stringify(o);
const res = (sc, extra = []) => ({ content: [{ type: 'text', text: J(sc) }, ...extra], structuredContent: sc });
const lines = (r) => r.content.filter((b) => b && b.type === 'text').map((b) => b.text);
const footers = (r) => lines(r).filter((t) => t === NEWS_FOOTER_LINE);

describe('withNewsFooter: one trailing text item, nothing else touched', () => {
  const sc = { articles: [{ title: 'x' }], total: 1 };

  it('appends exactly the owner line and leaves structuredContent and block 0 identical', () => {
    const r = res(sc);
    const out = withNewsFooter(r);
    expect(NEWS_FOOTER_LINE).toBe('Watching a site? Your free key includes one full power and queue analysis for any address.');
    expect(out.content).toHaveLength(2);
    expect(out.content[1]).toEqual({ type: 'text', text: NEWS_FOOTER_LINE });
    expect(out.content[0]).toBe(r.content[0]);
    expect(out.structuredContent).toBe(r.structuredContent);
  });

  it('is idempotent', () => {
    const once = withNewsFooter(res(sc));
    expect(withNewsFooter(once)).toBe(once);
    expect(footers(once)).toHaveLength(1);
  });

  it('leaves an error, an upstream failure, an empty result and a Source-line ending unchanged', () => {
    const err = { ...res(sc), isError: true };
    expect(withNewsFooter(err)).toBe(err);
    const up = res({ error: 'API 502' });
    expect(withNewsFooter(up)).toBe(up);
    const blockOnly = { content: [{ type: 'text', text: J({ error: 'API 500' }) }] };
    expect(withNewsFooter(blockOnly)).toBe(blockOnly);
    const empty = { content: [] };
    expect(withNewsFooter(empty)).toBe(empty);
    const sourced = res(sc, [{ type: 'text', text: 'Source: DC Hub (dchub.cloud/news), as of 2026-10-30' }]);
    expect(withNewsFooter(sourced)).toBe(sourced);
    expect(withNewsFooter(null)).toBe(null);
  });
});

// ── Wiring: the real handler chain ─────────────────────────────────────────
const FREE_KEY = 'dch_trial_NEWSFOOT0123456789abcdef';
const PACK_KEY = 'dch_trial_NEWSPACK0123456789abcdef';
const NEWS = { articles: [{ title: 'Grid operator files', source: 'DCD', published_at: '2026-10-29' }], total: 1,
  provenance: { source: 'DC Hub', as_of: '2026-10-29T09:00:00+00:00' } };
let H, fence;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && (body.api_key === FREE_KEY || body.api_key === PACK_KEY)) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/mcp/credits/balance') {
        return { credits: ((req && req.url) || '').includes(PACK_KEY) || (body && body.key === PACK_KEY) ? 5 : 0, had_pack: false };
      }
      if (p === '/api/news') return { ...NEWS };
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

async function news(path, { key, client = 'claude-ai', ua = 'Claude-User' } = {}) {
  const hdr = { 'user-agent': ua, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init(path, client, hdr);
  const sid = init.headers.get('mcp-session-id');
  const r = await H.call(path, 'get_news', { limit: 1 }, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  return r.msg && r.msg.result;
}

describe('wiring: only a keyed free caller sees the line, and the Source line still ends the answer', () => {
  it('a free key: the footer sits just above the Source line, once', async () => {
    const r = await news('/mcp', { key: FREE_KEY });
    expect(r, 'answered').toBeTruthy();
    expect(r.content[0].text, 'the answer is the news payload').toContain('Grid operator files');
    const t = lines(r);
    expect(footers(r)).toHaveLength(1);
    expect(t[t.length - 2]).toBe(NEWS_FOOTER_LINE);
    expect(t[t.length - 1]).toMatch(/^Source: DC Hub \(dchub\.cloud\/news\)/);
    expect(JSON.stringify(r.structuredContent || {})).not.toContain('Watching a site');
  });

  it('keyless gets no footer', async () => {
    const r = await news('/mcp');
    expect(r, 'answered').toBeTruthy();
    expect(footers(r)).toHaveLength(0);
  });

  it('a paid key gets no footer', async () => {
    const r = await news('/mcp', { key: PRO_KEY });
    expect(r, 'answered').toBeTruthy();
    expect(footers(r)).toHaveLength(0);
  });

  it('a pack buyer (credit balance above zero) gets no footer', async () => {
    const r = await news('/mcp', { key: PACK_KEY });
    expect(r, 'answered').toBeTruthy();
    expect(footers(r)).toHaveLength(0);
  });

  it('/mcp/claude and a clean platform (ChatGPT) get none', async () => {
    const a = await news('/mcp/claude', { key: FREE_KEY });
    expect(a, 'the directory answered').toBeTruthy();
    expect(footers(a)).toHaveLength(0);
    const b = await news('/mcp', { key: FREE_KEY, client: 'openai-mcp', ua: 'openai-mcp/1.0' });
    expect(b, 'answered').toBeTruthy();
    expect(footers(b)).toHaveLength(0);
  });

  it('kill switches DCHUB_NEWS_FOOTER=0 and DCHUB_LP_FREE_RUNS=0 turn it off', async () => {
    for (const k of ['DCHUB_NEWS_FOOTER', 'DCHUB_LP_FREE_RUNS']) {
      process.env[k] = '0';
      try {
        const r = await news('/mcp', { key: FREE_KEY });
        expect(r, 'answered').toBeTruthy();
        expect(footers(r), k).toHaveLength(0);
      } finally { delete process.env[k]; }
    }
  });
});
