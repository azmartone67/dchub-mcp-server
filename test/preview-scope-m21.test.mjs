// preview-scope-m21.test.mjs — Grok free-to-paid note, M2.1 (owner 2026-11-18): a preview / walled answer says how much
// of its list it shows and which fields it withholds, in one neutral line plus structuredContent.preview_scope
// (lib/preview-scope.mjs).
//
//   * fixtures (the shapes the server hands an agent, measured through the real handler 2026-11-19):
//     get_interconnection_queue, list_transactions, get_market_dcpi_rank -> the right counts and nouns;
//   * a full answer gets no line; a preview with no total states no count (never a guess);
//   * the line names no plan, price or offer: /free|pro\b|upgrade|unlock|\$/i finds nothing;
//   * end to end, keyless on /mcp: one line per answer, right after the data block; /mcp/chatgpt byte-identical with
//     the switch on and off; DCHUB_PREVIEW_SCOPE=0 is the answer without the line and without preview_scope.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { previewScope, scopeLine, previewScopeStep, FIELD_NOUNS } from '../lib/preview-scope.mjs';
import { PREVIEW_FOOTER } from '../lib/dchub-identity.mjs';

const GREP = /free|pro\b|upgrade|unlock|\$/i;

// The structuredContent shapes, trimmed to what the step reads.
const QUEUE_ROWS = { preview_is_partial: true, iso: 'PJM', projects: [{ name: 'Q0', capacity_mw: null, lat: null, lng: null }, { name: 'Q1' }, { name: 'Q2' }],
  _projects_total_available: 5469, _locked_fields: ['capacity_mw', 'lat', 'lng'],
  provenance: { completeness: 'partial_preview', preview: { shown: 3, total: 5469, withheld_fields: ['projects'], reasons: ['projects: 3 of 5469 shown'] } } };
const QUEUE_TASTE = { free_preview_only: true, preview_is_partial: true, withheld: [{ section: 'projects', count: 12 }], withheld_total: 12,
  _projects_withheld: true, provenance: { preview: { withheld_fields: ['projects'] } } };
const DEALS = { preview_is_partial: true, total_count: null, deals: [{ id: 0, value_usd: null }, { id: 1 }, { id: 2 }], _deals_total_available: 15,
  _locked_fields: ['value_usd', 'deal_value'], provenance: { completeness: 'partial_preview',
    preview: { shown: 3, total: 15, withheld_fields: ['deals'], reasons: ['deals: 3 of 15 shown'] } } };
const DCPI = { market_slug: 'ashburn', verdict: 'CAUTION', composite_score: 61.2, excess_power_score: null, constraint_score: null,
  _locked_fields: ['excess_power_score', 'constraint_score'], total_markets: 312, estimated_ttp_months: null };

describe('fixtures: the line and preview_scope', () => {
  it('get_interconnection_queue (rows shown): counts and nouns', () => {
    expect(previewScope(QUEUE_ROWS)).toEqual({ shown: 3, total: 5469, withheld_fields: ['capacity', 'location'], list: 'projects' });
    expect(scopeLine(previewScope(QUEUE_ROWS))).toBe('3 of 5,469 projects shown; capacity and location withheld.');
  });
  it('get_interconnection_queue (taste: the section withheld whole, with its count)', () => {
    expect(scopeLine(previewScope(QUEUE_TASTE))).toBe('0 of 12 projects shown.');
  });
  it('list_transactions', () => {
    expect(scopeLine(previewScope(DEALS))).toBe('3 of 15 deals shown; deal value withheld.');
  });
  it('get_market_dcpi_rank (one row, no list): only what it withheld; total_markets is not a count of rows shown', () => {
    expect(previewScope(DCPI)).toEqual({ shown: null, total: null, withheld_fields: ['DCPI sub-scores'] });
    expect(scopeLine(previewScope(DCPI))).toBe('DCPI sub-scores withheld.');
  });
  it('the nouns Grok listed', () => {
    expect(FIELD_NOUNS).toMatchObject({ capacity_mw: 'capacity', lat: 'location', lng: 'location', representative_point: 'location',
      estimated_ttp_months: 'time to power', excess_power_score: 'DCPI sub-scores', constraint_score: 'DCPI sub-scores', deal_value: 'deal value' });
  });
  it('a full answer: no scope, no line', () => {
    for (const full of [{ iso: 'PJM', total_projects: 5469, projects: [{ name: 'Q0', capacity_mw: 100 }] },
      { deals: [{ id: 1 }], total_count: 1834 }, { market_slug: 'ashburn', excess_power_score: 55.1 }]) {
      expect(previewScope(full)).toBeNull();
    }
  });
  it('total missing: no count is said (never a guess); nothing withheld either: no line at all', () => {
    const noTotal = { preview_is_partial: true, deals: [{ id: 1 }], provenance: { preview: { withheld_fields: ['deals'] } } };
    expect(previewScope(noTotal)).toBeNull();
    const noTotalLocked = { ...noTotal, _locked_fields: ['deal_value'] };
    expect(scopeLine(previewScope(noTotalLocked))).toBe('Deal value withheld.');
  });
  it('no line names a plan, price or offer, whatever field names arrive', () => {
    const odd = { preview_is_partial: true, _locked_fields: ['free_tier_rows', 'pro_score', 'price_usd', 'upgrade_url', 'unlock_hint', '$x'] };
    const line = scopeLine(previewScope(odd));
    expect(line === null || !GREP.test(line), String(line)).toBe(true);
    for (const f of [QUEUE_ROWS, QUEUE_TASTE, DEALS, DCPI]) expect(scopeLine(previewScope(f))).not.toMatch(GREP);
  });
  it('the step: one line after the data block, preview_scope before the relay keys, once per answer', () => {
    const sc = { ...DEALS, _upgrade: { url: 'https://dchub.cloud/connect' }, human_message: 'x' };
    const r = { content: [{ type: 'text', text: JSON.stringify(sc) }, { type: 'text', text: 'Source: DC Hub' }, { type: 'text', text: PREVIEW_FOOTER }],
      structuredContent: sc };
    const out = previewScopeStep(r, { env: {} });
    expect(out.content.map((b) => b.text).slice(1)).toEqual(['3 of 15 deals shown; deal value withheld.', 'Source: DC Hub', PREVIEW_FOOTER]);
    expect(out.structuredContent.preview_scope).toEqual({ shown: 3, total: 15, withheld_fields: ['deal value'] });
    const keys = Object.keys(out.structuredContent);
    expect(keys.indexOf('preview_scope')).toBe(keys.indexOf('_upgrade') - 1);
    expect(previewScopeStep(out, { env: {} })).toBe(out);
    expect(previewScopeStep(r, { env: { DCHUB_PREVIEW_SCOPE: '0' } })).toBe(r);
    expect(previewScopeStep(r, { env: {}, skip: true })).toBe(r);
  });
  it('the ask in block 0 (only closing lines after it): no text line; the scope rides in block 0\'s JSON', () => {
    const sc = { ...DEALS, user_message: 'Deal values are not in this preview.', human_url: 'https://dchub.cloud/connect' };
    const r = { content: [{ type: 'text', text: JSON.stringify(sc) }, { type: 'text', text: 'Source: DC Hub (dchub.cloud/deals)' }, { type: 'text', text: PREVIEW_FOOTER }],
      structuredContent: sc };
    const out = previewScopeStep(r, { env: {} });
    expect(out.content.slice(1)).toEqual(r.content.slice(1));
    expect(JSON.parse(out.content[0].text).preview_scope).toEqual({ shown: 3, total: 15, withheld_fields: ['deal value'] });
    expect(out.structuredContent.preview_scope).toEqual(JSON.parse(out.content[0].text).preview_scope);
  });
  it('a notice before the data block: the line goes after the JSON block, not after the notice', () => {
    const r = { content: [{ type: 'text', text: 'Notice: that key was not recognised.' }, { type: 'text', text: JSON.stringify(DEALS) },
      { type: 'text', text: 'Rows above are a preview.' }], structuredContent: DEALS };
    expect(previewScopeStep(r, { env: {} }).content.map((b) => b.text.slice(0, 8)))
      .toEqual(['Notice: ', '{"previe', '3 of 15 ', 'Rows abo']);
  });
  it('the line names the plain nouns and counts the rest; preview_scope lists them all', () => {
    const sc = { preview_is_partial: true, _locked_fields: ['excess_power_score', 'build_rate_pct', 'market_count'] };
    expect(previewScope(sc).withheld_fields).toEqual(['DCPI sub-scores', 'build rate pct', 'market count']);
    expect(scopeLine(previewScope(sc))).toBe('DCPI sub-scores and 2 other fields withheld.');
    expect(scopeLine(previewScope({ preview_is_partial: true, _locked_fields: ['build_rate_pct'] }))).toBe('1 field withheld.');
  });
});

// End to end: the real handler, keyless, outside peer; the backend serves the shapes it masks for an anonymous caller.
const QUEUE = { iso: 'PJM', total_projects: 5469, total_gw: 300, as_of: '2026-11-14', _locked_fields: ['capacity_mw', 'lat', 'lng'],
  projects: Array.from({ length: 12 }, (_, i) => ({ name: `Q${i}`, capacity_mw: null, fuel: 'solar', status: 'active', state: 'VA', lat: null, lng: null })) };
const DEALS_API = { success: true, total_count: 1834, as_of: '2026-11-14', _locked_fields: ['value_usd', 'deal_value'],
  deals: Array.from({ length: 15 }, (_, i) => ({ id: i, buyer: 'B' + i, seller: 'S' + i, value_usd: null, deal_value: null, date: '2026-10-01', market: 'ashburn' })) };
const DCPI_API = { success: true, market_slug: 'ashburn', market: 'Ashburn', name: 'Ashburn, VA', verdict: 'CAUTION', composite_score: 61.2,
  excess_power_score: null, constraint_score: null, _locked_fields: ['excess_power_score', 'constraint_score'], rank: 7, total_markets: 312, as_of: '2026-11-14' };
const CLIENT = new Set();
const _peer = net.Socket.prototype._getpeername;
let H, fence;
beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (H && this.server && this.localPort === H.PORT && p && CLIENT.has(p.port)) return { ...p, address: '203.0.113.8' };
    return p;
  };
  fence = fenceNetwork();
  H = await startHarness({ env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_KEYLESS_FIRST_FULL: '0' },
    extraRoutes: (p, req) => {
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      // a paid key gets the full row from the backend: no _locked_fields, values filled in
      const full = req.headers['x-api-key'] === PRO_KEY;
      if (p.includes('queue')) return structuredClone(QUEUE);
      if (p === '/api/v1/deals') return full ? { ...structuredClone(DEALS_API), _locked_fields: undefined,
        deals: DEALS_API.deals.map((d, i) => ({ ...d, value_usd: 1e6 * (i + 1), deal_value: 1e6 * (i + 1) })) } : structuredClone(DEALS_API);
      if (p.startsWith('/api/v1/dcpi/')) return structuredClone(DCPI_API);
      return undefined;
    } });
}, 120_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop();
  if (fence) fence.restore();
});
let rid = 1, ipN = 1;
function call(p, name, args, headers = {}) {
  const data = JSON.stringify({ jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: H.PORT, path: p, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'cursor/1.0',
        'x-dc-client-ip': `198.51.95.${ipN++}`, 'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        try { resolve(JSON.parse(b).result); } catch (e) { reject(e); }
      });
    });
    req.on('socket', (s) => {
      const note = () => { const lp = s.localPort; CLIENT.add(lp); s.once('close', () => CLIENT.delete(lp)); };
      if (s.localPort) note(); else s.once('connect', note);
    });
    req.on('error', reject);
    req.end(data);
  });
}
const norm = (r) => JSON.stringify(r)
  .replace(/https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[^"\s\\]*)?/g, 'RELAY')
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'TS')
  .replace(/(\\?")(ms|elapsed_ms|duration_ms)(\\?"):\d+/g, '$1$2$3:0');
// 'line': a text block of its own right after block 0; 'json': the ask is in block 0 (only closing lines follow), so
// the scope rides in block 0's JSON and no text block is added.
const CALLS = [['get_interconnection_queue', { iso: 'PJM' }, '0 of 12 projects shown.', 'line'],
  ['list_transactions', {}, '3 of 15 deals shown; deal value withheld.', 'line'],
  ['get_market_dcpi_rank', { market_slug: 'ashburn' }, 'DCPI sub-scores withheld.', 'json']];

describe('through the real /mcp handler (keyless)', () => {
  it.each(CALLS)('%s: the scope in its placement (line or block-0 JSON); switch off = the same answer without it', async (name, args, line, mode) => {
    const on = await call('/mcp', name, args);
    const texts = on.content.map((b) => b.text);
    expect(on.structuredContent.preview_scope).toBeTruthy();
    expect(line).not.toMatch(GREP);
    let content = on.content;
    if (mode === 'line') {
      expect(texts.filter((t) => t === line)).toHaveLength(1);
      expect(texts.indexOf(line)).toBe(1);
      content = on.content.filter((b) => b.text !== line);
    } else {
      expect(texts).not.toContain(line);
      const { preview_scope: p0, ...b0 } = JSON.parse(texts[0]);
      expect(p0).toEqual(on.structuredContent.preview_scope);
      content = [{ ...on.content[0], text: JSON.stringify(b0) }, ...on.content.slice(1)];
    }
    process.env.DCHUB_PREVIEW_SCOPE = '0';
    let off;
    try { off = await call('/mcp', name, args); } finally { delete process.env.DCHUB_PREVIEW_SCOPE; }
    const { preview_scope: _p, ...sc } = on.structuredContent;
    expect(norm({ ...on, content, structuredContent: sc })).toBe(norm(off));
  }, 120_000);

  it('a paid caller\'s full answer carries no line and no preview_scope', async () => {
    const r = await call('/mcp', 'list_transactions', {}, { 'x-api-key': PRO_KEY });
    expect(r.structuredContent.preview_scope).toBeUndefined();
    expect(r.content.map((b) => b.text).join('\n')).not.toMatch(/ shown;| shown\.$| withheld\.$/m);
  }, 120_000);

  it.each(CALLS)('/mcp/chatgpt %s: byte-identical with the switch on and off', async (name, args) => {
    const on = await call('/mcp/chatgpt', name, args);
    process.env.DCHUB_PREVIEW_SCOPE = '0';
    let off;
    try { off = await call('/mcp/chatgpt', name, args); } finally { delete process.env.DCHUB_PREVIEW_SCOPE; }
    expect(norm(on)).toBe(norm(off));
    expect(on.structuredContent && on.structuredContent.preview_scope).toBeUndefined();
  }, 120_000);
});
