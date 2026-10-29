// G-1015-P0-CAP (2026-10-15): a free key's 4th analyze_site call (the 3-full-reports-a-month cap is
// spent) returns the preview AND ends with one plain "Full report: <link>" line holding the response's
// own key-bound relay link. Real server.mjs app on loopback, stub backend whose counter mimics
// dchub-backend routes/mcp_lp_free_runs.py (limit 3); no network, no disk writes.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
// server.mjs is imported by startHarness AFTER it sets the env its module-level consts read, so the unit
// tests below import it dynamically (same cached module), never at the top of this file.
const SPENT_CAP_LINK_LABEL = 'Full report: ';   // the copy is pinned here, independent of the export

const FREE_KEY = 'dch_trial_SPENTLINK0123456789abcdef';
const ARGS = { lat: 33.45, lon: -112.07 };
const FULL = {
  success: true, lat: 33.45, lon: -112.07, overall_score: 83.7, verdict: 'BUILD',
  factors: { power: { score: 91, verdict: 'BUILD' }, fiber: { score: 64, verdict: 'CAUTION' } },
  nearest_substations: { substations_in_radius: 7, search_radius_km: 50,
    substations: [{ name: 'Test Sub XYZ', hifld_id: 'H123', max_kv: 230, distance_km: 2.4 }] },
};
// The two client shapes the acceptance names: Claude, and ChatGPT's MCP connector.
const CLIENTS = {
  claude: { name: 'claude-ai', ua: 'Claude-User' },
  chatgpt: { name: 'openai-mcp', ua: 'openai-mcp/1.0' },
};
const LINE_RE = /^Full report: (https:\/\/dchub\.cloud\/(?:upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[a-z0-9_=&-]+)?|u\/[2-9a-hj-km-np-z]{6}))$/;

let H, fence;
let used = 0, LIMIT = 3, counterDown = false;

async function settle(quietMs = 300, maxMs = 6000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call(key, client = CLIENTS.claude) {
  const hdr = { 'user-agent': client.ua, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init('/mcp', client.name, hdr);
  const sid = init.headers.get('mcp-session-id');
  const r = await H.call('/mcp', 'analyze_site', ARGS, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const res = r.msg && r.msg.result;
  const blocks = ((res && res.content) || []).map((x) => x.text || '');
  return { res, sc: (res && res.structuredContent) || {}, blocks, text: blocks.join('\n') };
}
const lineOf = (r) => r.blocks.filter((b) => LINE_RE.test(b));

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        if (counterDown) return { status: 500, body: { error: 'boom' } };
        if (body.op === 'consume') {
          const allowed = used < LIMIT; if (allowed) used += 1;
          return { ok: true, allowed, used, limit: LIMIT, remaining: Math.max(0, LIMIT - used),
                   resets_at: '2026-11-01T00:00:00Z', email_bound: false };
        }
        if (body.op === 'release') { used = Math.max(0, used - 1); return { ok: true, allowed: false, used, limit: LIMIT }; }
        return { ok: true, allowed: used < LIMIT, used, limit: LIMIT };
      }
      if (p === '/api/site-score') return { ...FULL };
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { used = 0; counterDown = false; delete process.env.DCHUB_SPENT_LINK_LINE; delete process.env.DCHUB_LP_FREE_RUNS; });

describe.each(Object.entries(CLIENTS))('%s: 3 full reports, then the preview ends in a checkout link', (_n, client) => {
  it('runs 1-3 are full answers with no link line; run 4 is the preview whose LAST block is the line', async () => {
    for (let i = 1; i <= 3; i++) {
      const r = await call(FREE_KEY, client);
      expect(r.sc.overall_score, `run ${i}: the score is served`).toBe(83.7);
      expect(lineOf(r), `run ${i}: a full answer carries no checkout line`).toEqual([]);
      expect(r.text, `run ${i}`).not.toContain(SPENT_CAP_LINK_LABEL);
    }
    const r4 = await call(FREE_KEY, client);
    expect(r4.sc.free_monthly_runs, 'the cap is spent').toMatchObject({ reason: 'free_monthly_limit_reached', used: 3, limit: 3 });
    expect(r4.sc.overall_score ?? null, 'the score is withheld').toBe(null);
    const lines = lineOf(r4);
    expect(lines, 'exactly one plain Full report line').toHaveLength(1);
    // Item 8 (owner 2026-10-16): a free answer closes with one citable Source line and the link line
    // is the last thing before it. Clean platforms (ChatGPT) get no Source line, so the link stays last.
    const SRC_RE = /^Source: DC Hub \(dchub\.cloud[^)]*\)/;
    if (client === CLIENTS.chatgpt) {
      expect(r4.blocks.some((b) => SRC_RE.test(b)), 'no Source line on a clean platform').toBe(false);
      expect(r4.blocks[r4.blocks.length - 1], 'and it is the last thing the agent reads').toBe(lines[0]);
    } else {
      expect(r4.blocks[r4.blocks.length - 1], 'the citable source line closes the answer').toMatch(SRC_RE);
      expect(r4.blocks[r4.blocks.length - 2], 'and the link line is the last thing before it').toBe(lines[0]);
    }
    const url = LINE_RE.exec(lines[0])[1];
    expect(url, 'the line carries the response\'s own human_url').toBe(r4.sc.human_url);
  });

  it('one link only: every dchub.cloud link in the response is that same relay link', async () => {
    for (let i = 0; i < 3; i++) await call(FREE_KEY, client);
    const r4 = await call(FREE_KEY, client);
    const url = r4.sc.human_url;
    const all = (r4.text.match(/https:\/\/dchub\.cloud\/[^\s"'\\)\]}>]+/g) || []);
    // provenance / citation carry the bare site root; a checkout or relay link is anything with a path.
    const withPath = all.filter((u) => !/^https:\/\/dchub\.cloud\/?$/.test(u));
    expect([...new Set(withPath)]).toEqual([url]);
  });

  it('the link is key-bound (the relay token carries the key hash) and the line names no plan or price', async () => {
    for (let i = 0; i < 3; i++) await call(FREE_KEY, client);
    const r4 = await call(FREE_KEY, client);
    const token = /\/upgrade\/h\/([A-Za-z0-9_-]+)\./.exec(r4.sc.human_url);
    expect(token, 'the long relay link (a /u/ short link would resolve to the same token server-side)').not.toBeNull();
    const decoded = Buffer.from(token[1], 'base64url').toString('utf8');
    expect(decoded).toContain('pk-' + createHash('sha256').update(FREE_KEY).digest('hex'));
    expect(decoded).toContain('analyze_site');
    const line = lineOf(r4)[0];
    expect(line).not.toMatch(/\$\s?\d/);
    expect(line).not.toMatch(/\b(Pro|Developer|Starter|Enterprise|Business|plan|trial)\b/i);
  });
});

describe('scope: what the line is not added to', () => {
  it('kill switch DCHUB_SPENT_LINK_LINE=0 returns the earlier response (no line)', async () => {
    process.env.DCHUB_SPENT_LINK_LINE = '0';
    for (let i = 0; i < 3; i++) await call(FREE_KEY);
    const r4 = await call(FREE_KEY);
    expect(r4.sc.free_monthly_runs).toMatchObject({ reason: 'free_monthly_limit_reached' });
    expect(lineOf(r4)).toEqual([]);
    expect(r4.text).not.toContain(SPENT_CAP_LINK_LABEL);
    expect(r4.sc.human_url, 'the JSON still carries the link, as before').toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\//);
  });

  it('a counter outage fails closed to a keyed preview, and that preview carries the line too', async () => {
    counterDown = true;
    const r = await call(FREE_KEY);
    expect(r.sc._preview_only).toBe(true);
    expect(r.sc.overall_score ?? null).toBe(null);
    expect(lineOf(r)).toHaveLength(1);
  });

  it('a keyless caller keeps the gated_preview link; no Full report line is added', async () => {
    const r = await call(null);
    expect(r.sc.human_url, 'precondition: the keyless wall did hand out a relay link').toMatch(/^https:\/\/dchub\.cloud\/(upgrade\/h|u)\//);
    expect(r.text).not.toContain(SPENT_CAP_LINK_LABEL);
  });
});

describe('_spentCapLinkLineStep (unit, ctx injected so every branch is reached)', () => {
  const URL_ = 'https://dchub.cloud/upgrade/h/' + 'a'.repeat(40) + '.' + 'b'.repeat(32);
  const SHORT = 'https://dchub.cloud/u/abcdef';
  const KEYED = { api_key: 'dch_trial_unit', tier: 'free' };
  const mk = (over = {}, content) => ({
    content: content || [{ type: 'text', text: JSON.stringify({ human_url: URL_ }) }, { type: 'text', text: 'a line' }],
    structuredContent: { _preview_only: true, human_url: URL_, free_monthly_runs: { reason: 'free_monthly_limit_reached' }, ...over },
  });
  let step, profiles;
  beforeAll(async () => {
    ({ _spentCapLinkLineStep: step } = await import('../server.mjs'));
    const [d, c, k] = await Promise.all([import('../lib/chatgpt-directory.mjs'), import('../lib/claude-directory.mjs'), import('../lib/core-profile.mjs')]);
    profiles = [d.DIRECTORY_PROFILE, c.CLAUDE_PROFILE, k.CORE_PROFILE];
  });
  it('the positive case appends exactly one block, last, and does not mutate its input', () => {
    const r = mk(); const before = JSON.stringify(r);
    const out = step(r, 'analyze_site', KEYED, {});
    expect(out.content).toHaveLength(3);
    expect(out.content[2]).toEqual({ type: 'text', text: 'Full report: ' + URL_ });
    expect(JSON.stringify(r)).toBe(before);
    expect(out.structuredContent).toBe(r.structuredContent);
  });
  it('a /u/ short link is handed over the same way, and for_your_human.url is the fallback source', () => {
    expect(step(mk({ human_url: SHORT }), 'analyze_site', KEYED, {}).content[2].text).toBe('Full report: ' + SHORT);
    const o = step(mk({ human_url: undefined, for_your_human: { url: URL_ } }), 'analyze_site', KEYED, {});
    expect(o.content[2].text).toBe('Full report: ' + URL_);
  });
  it('inert (same object back) for every reason it must be: tool, preview flag, keyless, profile, no link, kill switch', () => {
    const r = mk();
    expect(step(r, 'compare_sites', KEYED, {})).toBe(r);
    const notPreview = mk({ _preview_only: false });
    expect(step(notPreview, 'analyze_site', KEYED, {})).toBe(notPreview);
    expect(step(r, 'analyze_site', {}, {})).toBe(r);                       // keyless
    for (const profile of profiles) expect(step(r, 'analyze_site', { ...KEYED, profile }, {})).toBe(r);
    const noLink = mk({ human_url: undefined });
    expect(step(noLink, 'analyze_site', KEYED, {})).toBe(noLink);
    const pricing = mk({ human_url: 'https://dchub.cloud/pricing' });      // a pricing page is never "the report link"
    expect(step(pricing, 'analyze_site', KEYED, {})).toBe(pricing);
    expect(step(r, 'analyze_site', KEYED, { DCHUB_SPENT_LINK_LINE: '0' })).toBe(r);
  });
  it('idempotent: a prose block that already carries the link is left alone; a copy inside block 0 JSON does not count', () => {
    const withProse = mk({}, [{ type: 'text', text: JSON.stringify({ human_url: URL_ }) },
      { type: 'text', text: 'Open ' + URL_ + ' for the full report.' }]);
    expect(step(withProse, 'analyze_site', KEYED, {})).toBe(withProse);
    const jsonOnly = mk({}, [{ type: 'text', text: JSON.stringify({ human_url: URL_, user_message: 'go ' + URL_ }) }]);
    expect(step(jsonOnly, 'analyze_site', KEYED, {}).content).toHaveLength(2);
  });
  it('is on by default and off for 0/false/no/off', async () => {
    const { _spentCapLinkLineOn, SPENT_CAP_LINK_LABEL: exported } = await import('../server.mjs');
    expect(exported).toBe(SPENT_CAP_LINK_LABEL);
    expect(_spentCapLinkLineOn({})).toBe(true);
    for (const v of ['0', 'false', 'no', 'off', 'OFF']) expect(_spentCapLinkLineOn({ DCHUB_SPENT_LINK_LINE: v })).toBe(false);
  });
});

describe('wiring', () => {
  const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  it('_gatedPreviewStep runs the line step outermost, so no later step can drop or reorder it', () => {
    expect(SRC).toMatch(/export function _gatedPreviewStep\(result, name\) \{[\s\S]{0,700}return _spentCapLinkLineStep\(_watchLineStep\(/);
  });
});
