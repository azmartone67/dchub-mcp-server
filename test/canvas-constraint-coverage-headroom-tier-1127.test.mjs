// QA 2026-11-27 (P2): keyless site_selection_canvas {region:OH, capacity_mw:300, max_months:24} led
// "Withheld here: max months" and returned constraint_coverage.max_months null with
// _max_months_withheld true. The backend sends {applied:false, status:'locked', reason}: DC Hub saying
// the buyer's deadline was NOT applied. Cause: DCHUB_GRID_HEADROOM_TIER (on in production) gates every
// key matching `_months$`. The flag is read at module load, so it is set before the import.
// The fixture is the live keyless backend body, 2026-11-27.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';

// queue_wait_months is planted as DC Hub data the same gate must still null (non-vacuity: the flag is on).
const BODY = JSON.stringify({
  ...JSON.parse(fs.readFileSync(new URL('./fixtures/canvas-oh-keyless-1127.json', import.meta.url), 'utf8')),
  queue_wait_months: 14,
});
let httpServer, stub, PORT, prevFlag;
beforeAll(async () => {
  stub = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url.startsWith('/api/v1/site-selection/canvas') ? BODY : '{}');
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const prevBase = process.env.DCHUB_API_BASE;
  prevFlag = process.env.DCHUB_GRID_HEADROOM_TIER;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_GRID_HEADROOM_TIER = '1';
  const S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60000);
afterAll(async () => {
  if (prevFlag === undefined) delete process.env.DCHUB_GRID_HEADROOM_TIER; else process.env.DCHUB_GRID_HEADROOM_TIER = prevFlag;
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
});

async function canvas() {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-forwarded-for': '203.0.113.77' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'site_selection_canvas', arguments: { capacity_mw: 300, region: 'OH', max_months: 24 } } }),
  });
  const raw = await res.text();
  const j = JSON.parse(raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw);
  const r = j.result;
  const sc = r.structuredContent || JSON.parse(r.content.find((c) => /^\s*\{/.test(c.text)).text);
  return { sc, text: r.content.map((c) => c.text).join('\n') };
}

describe('site_selection_canvas constraint_coverage with the headroom tier on', () => {
  it('keeps constraint_coverage.max_months as "not applied", with no withheld marker', async () => {
    const { sc } = await canvas();
    expect(sc.constraint_coverage.max_months).toMatchObject({ applied: false, status: 'locked' });
    expect(sc.constraint_coverage.max_months.reason).toMatch(/not applied/);
    expect(sc.constraint_coverage).not.toHaveProperty('_max_months_withheld');
    expect(sc.constraint_coverage).not.toHaveProperty('_max_months_in_pro');
  });

  it('does not name max months as withheld anywhere in the answer', async () => {
    const { text } = await canvas();
    expect(text).not.toMatch(/Withheld here:[^\n]*max months/i);
  });

  it('still withholds DC Hub figures in the same answer (non-vacuous: the gate is on)', async () => {
    const { sc } = await canvas();
    expect(sc.queue_wait_months).toBeNull();
    expect(sc._queue_wait_months_withheld ?? sc._queue_wait_months_in_pro).toBe(true);
  });
});
