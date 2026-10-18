// ranked_answer / intent_answer must not ride the directory and core profiles (found live 2026-10-18:
// /mcp/chatgpt, /mcp/claude and /mcp/grok returned both blocks to any client that did not identify as
// ChatGPT, because _isCleanPlatform() keys on the CLIENT, not the URL). Real server, stub backend.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const UA = { 'user-agent': 'generic-agent' };
const row = (market, rank, city, state, dep, score) => ({ market, rank, city, state, score,
  deployable_mw: { value: dep }, ai_ready_mw: { value: 100 }, hyperscale_ready: true });
const MARKETS = [row('ashburn-va', 1, 'Ashburn', 'VA', 500, 450), row('columbus-oh', 2, 'Columbus', 'OH', 400, 300)];
const INTENTS = { ranked: 'rank markets for a 200 MW AI campus', timing: 'how soon can I get 100 MW of power in ERCOT' };
const PATHS = ['/mcp', '/mcp/chatgpt', '/mcp/claude', '/mcp/grok'];

let H, fence; const out = {};
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => {
    if (p === '/api/v1/ai-capacity-index') return { ok: true, index_name: 'AI Compute Capacity Index', markets: MARKETS };
    const m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p);
    if (m) return { ok: true, market_slug: m[1], verdict: 'BUILD', composite_score: 70 };
    return undefined;
  } });
  for (const path of [...PATHS, '/mcp/oauth']) {
    // /mcp/oauth challenges a credential-less caller, so it is driven with a (stub-valid) key.
    const hdr = path === '/mcp/oauth' ? { ...UA, 'x-api-key': PRO_KEY } : UA;
    const init = await H.init(path, 'generic-agent', hdr);
    const sid = init.headers.get('mcp-session-id');
    for (const [k, intent] of Object.entries(INTENTS)) {
      const res = await H.call(path, 'execute_plan', { intent }, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
      out[`${path}|${k}`] = res.raw;
    }
  }
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('controls: the full /mcp profile still carries the blocks', () => {
  it('/mcp/oauth (credentialed) carries them too', () => {
    expect(out['/mcp/oauth|timing']).toMatch(/intent_answer/);
    expect(out['/mcp/oauth|ranked']).toMatch(/ranked_answer/);
  });
  it('/mcp ranked intent -> ranked_answer', () => { expect(out['/mcp|ranked']).toMatch(/ranked_answer/); });
  it('/mcp timing intent -> intent_answer', () => { expect(out['/mcp|timing']).toMatch(/intent_answer/); });
  it('every call actually ran a plan (no vacuous absence)', () => {
    for (const [k, raw] of Object.entries(out)) expect(raw, k).toMatch(/plan_execution/);
  });
});

describe('directory profiles carry neither block, for a client that is not ChatGPT-identified', () => {
  for (const path of PATHS.filter((p) => p !== '/mcp')) {
    for (const k of Object.keys(INTENTS)) {
      it(`${path} (${k})`, () => {
        expect(out[`${path}|${k}`]).not.toMatch(/ranked_answer/);
        expect(out[`${path}|${k}`]).not.toMatch(/intent_answer/);
      });
    }
  }
});
