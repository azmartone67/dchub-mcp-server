// canvas-teaser-no-plan-1117.test.mjs — site_selection_canvas's locked synthesis names no plan on /mcp
// (owner, 2026-11-17; lib/canvas-teaser-copy.mjs). The data API writes "... is the paid layer." and an unlock
// pitch "A paid DC Hub plan for agents unlocks ..."; /mcp (including ?via=chatgpt, a clean platform the keyless
// wording step skips) now serves a neutral sentence and no pitch. /mcp/chatgpt is unchanged (its scrub drops both).
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { neutralCanvasTeaser, neutralCanvasTeaserMessage } from '../lib/canvas-teaser-copy.mjs';

const TEASER = {
  locked: true,
  message: '🎯 The decision layer is locked. You can see the ranked shortlist above (3 markets) for free — but the *answer* '
    + '(which one to pick, the why, the build sequence, and the risk flags for Abilene) is the paid layer.',
  unlock: { url: 'https://dchub.cloud/upgrade?tool=site_selection_canvas',
            pitch: 'A paid DC Hub plan for agents unlocks the full Site Selection Canvas synthesis + the MCP decision tools.' },
};
const CANVAS = { matched: 3, shortlist: [{ market_slug: 'abilene', market_name: 'Abilene', verdict: 'BUILD' }], synthesis: TEASER };

let httpServer, stub, PORT;
beforeAll(async () => {
  stub = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url.startsWith('/api/v1/site-selection/canvas') ? JSON.stringify(CANVAS) : '{}');
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60000);
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
});

async function call(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'site_selection_canvas', arguments: { capacity_mw: 100, region: 'TX' } } }),
  });
  const raw = await res.text();
  const j = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return JSON.stringify(JSON.parse(j).result || {});
}

describe('canvas locked synthesis', () => {
  it.each(['/mcp', '/mcp?via=chatgpt'])('%s: no "paid layer", no plan pitch', async (path) => {
    const s = await call(path);
    expect(s).toContain('Abilene');   // the canvas answered (non-vacuous)
    expect(s).not.toMatch(/is the paid layer/);
    expect(s).not.toMatch(/A paid DC Hub plan for agents unlocks/);
    expect(s).toContain('is not included in this preview');
  });
  it('/mcp/chatgpt still carries neither (its own scrub)', async () => {
    const s = await call('/mcp/chatgpt');
    expect(s).not.toMatch(/paid layer|plan for agents/);
  });
  it('the rewrite: message neutral, pitch dropped, url kept; anything else untouched', () => {
    const out = neutralCanvasTeaser(CANVAS);
    expect(out.synthesis.message).toBe(neutralCanvasTeaserMessage('3', 'Abilene'));
    expect(out.synthesis.unlock).toEqual({ url: TEASER.unlock.url });
    expect(neutralCanvasTeaser(CANVAS, { skip: true })).toBe(CANVAS);
    expect(neutralCanvasTeaser(CANVAS, { env: { DCHUB_CANVAS_TEASER_NEUTRAL: '0' } })).toBe(CANVAS);
    const other = { synthesis: { locked: false, message: 'x' } };
    expect(neutralCanvasTeaser(other)).toBe(other);
  });
});
