// kff-plan-preview-says-what-was-held-back.test.mjs — Grok proof run 2026-11-16, item 9.
//
// Live on the public connector, keyless: the first execute_plan of the session was a full answer, and the next
// ERCOT and compare plans came back as previews. That is the owner-approved rule (the first call each UTC day to
// each core energy tool is a full answer; after that, previews: lib/keyless-first-full.mjs). What was wrong is
// what the preview SAID: its closing line was "This answer is partial; the full answer is at <link>", the human
// line "3 returned previews at your access level", and nothing said that today's full plan answer had been used
// or which fields each step held back (they were only in per-step `withheld` / `_<field>_withheld` markers).
//
// Now a keyless plan that is the preview because the day's full plan answer was used carries
// `first_full_answer_used` (block 0's JSON and structuredContent): why, when it resets, and per step what was
// held back, and its `line` is the closing sentence. No plan name, price or upgrade wording (Note F; the
// keyless guard's own regexes). Real server on a real port, every step a real loopback.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { planStepsHeldBack, firstFullUsedBlock, withFirstFullUsedBlock } from '../lib/keyless-first-full.mjs';
import { BANNED_WORDING, PLAN_NAME, PRICE } from '../lib/keyless-plan-wording.mjs';
import { humanLine } from '../lib/lean-response.mjs';

const SECRET = 'kff-plan-preview-heldback-internal-key-not-real';
const ROW = { iso: 'ERCOT', market_count: 12, avg_constraint: 41.2, avg_excess: 63.5, avg_time_to_power_months: 30,
  avg_queue_wait_months: 44, avg_kwh_cents: 8.1, sum_emergency_30d: 2 };
const LOCKED = { iso: 'ERCOT', market_count: 12, locked: true, avg_constraint: null, avg_excess: null,
  avg_time_to_power_months: null, avg_queue_wait_months: null, avg_kwh_cents: null, sum_emergency_30d: null };
const FIELDS = { constraint_score: 41.2, excess_power_score: 63.5, avg_time_to_power_months: 30,
  avg_queue_wait_months: 44, retail_price_cents_kwh: 8.1, grid_emergencies_30d: 2 };
const PLAN = { intent: 'how soon can a 100 MW load get power in ERCOT' };

let S, stub, httpServer, PORT;
const heard = [];
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://stub').pathname;
      const tier = String(req.headers['x-dchub-caller-tier'] || '');
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (p === '/api/v1/dcpi/iso-comparison') {
        heard.push(tier);
        return send({ isos: [['pro', 'enterprise', 'admin'].includes(tier) ? ROW : LOCKED] });
      }
      if (p.startsWith('/api/v1/grid/intelligence/')) {
        return send({ iso: 'ERCOT', demand_mw: 52000, as_of: '2026-11-16T00:00:00Z', generation_mix: { NG: { mw: 27000 } } });
      }
      if (p.startsWith('/api/v1/interconnection-queue/')) return send({ iso: 'ERCOT', total_projects: 10, total_gw: 400, projects: [] });
      if (p.startsWith('/api/v1/mcp/full-cap/')) return send({ ok: false });
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  // execute_plan's steps loop back to 127.0.0.1:PORT, read once at import.
  process.env.PORT = String(await freePort());
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  delete process.env.DCHUB_KEYLESS_FIRST_FULL;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'Mozilla/5.0', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}
let rpc = 10;
async function session(ip) {
  const h0 = { 'x-forwarded-for': ip };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return async (args = PLAN, extraHeaders = {}) => {
    const { body } = await post({ ...h, ...extraHeaders }, { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name: 'execute_plan', arguments: args } });
    return JSON.parse(body).result;
  };
}

const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');
// execute_plan's block 0 is a plain-language lead since 2026-11-17 (lib/plan-lead-text.mjs) and its JSON is block 1;
// every other tool's block 0 is still JSON. So: the first block that parses.
const block0 = (r) => { for (const b of (r && r.content) || []) { try { return JSON.parse(b.text); } catch (_) { /* the lead */ } } return null; };

describe('pure: what a preview plan held back', () => {
  const executed = [
    { step: 1, tool: 'get_grid_intelligence', status: 'gated_preview',
      result: { withheld: [{ section: 'dcpi_scores', count: 1 }, { section: 'generation_mix_detail', count: 2 }],
                _market_count_withheld: true, _generation_mix_mw_withheld: true } },
    { step: 2, tool: 'get_interconnection_queue', status: 'gated_preview', result: { withheld: [] } },
    { step: 3, tool: 'get_refined_queue', status: 'executed', depth: 'preview', result: {} },
    { step: 4, tool: 'rank_markets', status: 'executed', result: { _score_withheld: true } },
  ];
  it('names each preview step and its withheld sections and fields; full steps are not named', () => {
    expect(planStepsHeldBack(executed)).toEqual([
      { step: 1, tool: 'get_grid_intelligence', fields: ['dcpi_scores', 'generation_mix_detail', 'market_count', 'generation_mix_mw'] },
      { step: 2, tool: 'get_interconnection_queue', fields: [] },
      { step: 3, tool: 'get_refined_queue', fields: [] },
    ]);
  });
  it('the line says why, what, and when it resets, with no plan, price or upgrade wording', () => {
    const b = firstFullUsedBlock(executed, 1);
    expect(b).toMatchObject({ used: 1, limit: 1, resets: '00:00 UTC' });
    expect(b.line).toMatch(/today’s full `execute_plan` answer without a key .* was used/);
    expect(b.line).toContain('step 1 get_grid_intelligence (dcpi_scores, generation_mix_detail, market_count, generation_mix_mw)');
    expect(b.line).toContain('step 2 get_interconnection_queue (rows and figures cut to a preview)');
    expect(b.line).toContain('after 00:00 UTC');
    const all = JSON.stringify(b);
    expect(all).not.toMatch(BANNED_WORDING);
    expect(all).not.toMatch(PLAN_NAME);
    expect(all).not.toMatch(PRICE);
    expect(all).not.toMatch(/higher limit/i);
  });
  it('no preview step: no block (a full plan never says it was held back)', () => {
    expect(firstFullUsedBlock([{ step: 1, tool: 'get_grid_data', status: 'executed', result: {} }])).toBeNull();
    const r = { content: [{ type: 'text', text: '{"executed":[]}' }], structuredContent: { executed: [] } };
    expect(withFirstFullUsedBlock(r)).toBe(r);
  });
  it('lean prints the held-back line as the closing line, with the one link', () => {
    expect(humanLine('https://dchub.cloud/connect', null, 'Held back: x.')).toBe('Held back: x. The full answer is at https://dchub.cloud/connect');
    expect(humanLine('https://dchub.cloud/connect', null)).toBe('This answer is partial; the full answer is at https://dchub.cloud/connect');
  });
});

describe('real loopback: the second keyless plan of the day says what it held back and why', () => {
  it('call 1 is the full answer and carries no held-back block', async () => {
    const run = await session('198.18.92.10');
    const r1 = await run();
    expect(r1.structuredContent.first_full_answer).toMatchObject({ used: 1, limit: 1 });
    expect(r1.structuredContent.first_full_answer_used).toBeUndefined();
    expect(textOf(r1)).not.toMatch(/Held back:/);
  }, 120_000);

  it('call 2 (same session) and a compare plan: the block, in both copies, and the closing line', async () => {
    const run = await session('198.18.92.11');
    await run();
    for (const args of [PLAN, { intent: 'compare ERCOT vs PJM for a 200 MW AI campus' }]) {
      const r = await run(args);
      const sc = r.structuredContent;
      expect(sc.first_full_answer).toBeUndefined();
      const b = sc.first_full_answer_used;
      expect(b, 'structuredContent.first_full_answer_used').toBeTruthy();
      expect(block0(r) && block0(r).first_full_answer_used).toEqual(b);
      expect(b.held_back.length).toBeGreaterThan(0);
      const grid = b.held_back.find((h) => h.tool === 'get_grid_intelligence');
      expect(grid && grid.fields.length, 'the grid step names its withheld fields').toBeGreaterThan(0);
      // Every step the plan returned as a preview is named.
      const previews = (sc.executed || []).filter((e) => e.status === 'gated_preview' || e.depth === 'preview').map((e) => e.tool);
      expect(b.held_back.map((h) => h.tool)).toEqual(previews);
      // The closing line is the held-back sentence, not the bare "This answer is partial; ..." line.
      const t = textOf(r);
      expect(t).toContain(b.line);
      expect(t).not.toMatch(/This answer is partial; the full answer is at/);
      for (const s of [JSON.stringify(b), b.line]) {
        expect(s).not.toMatch(BANNED_WORDING);
        expect(s).not.toMatch(PLAN_NAME);
        expect(s).not.toMatch(PRICE);
      }
    }
  }, 180_000);

  it('a call that sends a key never carries it', async () => {
    const run = await session('198.18.92.12');
    const r = await run(PLAN, { 'x-api-key': 'dch_live_notavalidkey_heldback_000000' });
    expect(r.structuredContent && r.structuredContent.first_full_answer_used).toBeUndefined();
  }, 120_000);

  it('lane off: the keyless preview is today\'s, byte for byte in this respect (no block)', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
    try {
      const run = await session('198.18.92.13');
      await run();
      const r = await run();
      expect(r.structuredContent.first_full_answer_used).toBeUndefined();
      expect(textOf(r)).not.toMatch(/Held back:/);
    } finally { delete process.env.DCHUB_KEYLESS_FIRST_FULL; }
  }, 180_000);
});
