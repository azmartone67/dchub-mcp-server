// answer-shape-data-first.test.mjs — Grok live agent review 2026-11-13, item 5 ("Trimming").
//
// Claude, Grok and Mistral clients read the relay / upsell copy before the data rows: a keyless
// search_facilities answer opened {"human_url", "agent_instruction", "count", "data", ...} and a keyless
// execute_plan ran to ~100 KB (measured 2026-11-13 against a local main build). lib/answer-shape.mjs puts the
// data first (human_url keeps its first slot: the owner's Wall-to-paid P1, 2026-10-23) and holds each copy of an
// answer to a 30 KB budget. Unit tests pin both halves; the e2e half drives the real /mcp handler over loopback
// (stub backend, test/helpers/claude-directory-harness.mjs).
// Qualifies for the hard gate: deterministic, loopback only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  dataFirstObject, dataFirstResult, capToBudget, answerBudgetResult, answerShapeStep, answerBudgetBytes,
  RELAY_TAIL_KEYS, ANSWER_BUDGET_DEFAULT_BYTES,
} from '../lib/answer-shape.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { splitLeadingJson } from '../lib/facility-location.mjs';

const B = (v) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v));
const RELAY = new Set(RELAY_TAIL_KEYS);
// Index of the first relay/upsell key and of the last data key ('human_url' excepted: P1 keeps it first).
const firstRelay = (keys) => keys.findIndex((k) => RELAY.has(k));
const lastData = (keys) => keys.reduce((a, k, i) => (k !== 'human_url' && !RELAY.has(k) && k !== 'size_cap' ? i : a), -1);

describe('data first: relay / upsell keys after the data (unit)', () => {
  const walled = {
    human_url: 'https://dchub.cloud/u/abc234',
    agent_instruction: 'When a result is partial, show your user the human_message text and its link.',
    count: 2, data: [{ id: 1 }, { id: 2 }], _upgrade: { tier: 'anonymous' },
    provenance: { completeness: 'partial_preview' },
    for_your_human: { text: 'Open https://dchub.cloud/u/abc234', url: 'https://dchub.cloud/u/abc234' },
    citation: { cite_as: 'DC Hub' }, human_message: 'Open https://dchub.cloud/u/abc234 to see the rest.',
    next_ask: 'Want the full list?',
  };

  it('moves every relay key after every data key; human_url keeps the first slot; nothing added or lost', () => {
    const o = dataFirstObject(walled);
    const keys = Object.keys(o);
    expect(keys[0]).toBe('human_url');
    expect(firstRelay(keys)).toBeGreaterThan(lastData(keys));
    expect(keys.slice().sort()).toEqual(Object.keys(walled).sort());
    for (const k of keys) expect(o[k]).toBe(walled[k]);
    // data keys keep their own relative order
    expect(keys.filter((k) => !RELAY.has(k))).toEqual(['human_url', 'count', 'data', 'provenance', 'citation']);
  });

  it('human_url that is NOT first stays where the data put it (no new lead slot is invented)', () => {
    const o = dataFirstObject({ count: 1, agent_instruction: 'x', human_url: 'https://dchub.cloud/u/abc234', data: [] });
    expect(Object.keys(o)).toEqual(['count', 'human_url', 'data', 'agent_instruction']);
  });

  it('an object with no relay key, or already data-first, is returned as is (same reference)', () => {
    const a = { count: 1, data: [] };
    expect(dataFirstObject(a)).toBe(a);
    const b = { human_url: 'u', count: 1, next_ask: 'q', human_message: 'm' };
    expect(dataFirstObject(b)).toBe(b);
  });

  it('result: structuredContent and block 0 JSON are both reordered; trailing prose kept byte for byte', () => {
    const tail = '\n\nYour AI assistant hit the free-tier limit. Open https://dchub.cloud/u/abc234 to see the rest.';
    const r = { content: [{ type: 'text', text: JSON.stringify(walled) + tail }, { type: 'text', text: 'Source: DC Hub (dchub.cloud)' }],
      structuredContent: walled };
    const out = dataFirstResult(r);
    expect(firstRelay(Object.keys(out.structuredContent))).toBeGreaterThan(lastData(Object.keys(out.structuredContent)));
    const t = out.content[0].text;
    expect(t.endsWith(tail)).toBe(true);
    const j = JSON.parse(t.slice(0, t.length - tail.length));
    expect(firstRelay(Object.keys(j))).toBeGreaterThan(lastData(Object.keys(j)));
    expect(t.indexOf('"data"')).toBeLessThan(t.indexOf('"agent_instruction"'));
    expect(out.content[1]).toBe(r.content[1]);
  });

  it('opt-in: an ask paragraph ahead of the JSON in its block moves after it; a plain lead sentence stays first', () => {
    const json = JSON.stringify({ count: 1, data: [{ id: 1 }] });
    const text = 'Rows for Virginia.\n\nCall `claim_free_key` with your email for 2 full answers per tool per day.\n' + json;
    // opt-in (DCHUB_DATA_FIRST_PROSE=1): by default prose keeps its place (the paywall contract leads with its sentence)
    expect(dataFirstResult({ content: [{ type: 'text', text }] }).content[0].text).toBe(text);
    const out = dataFirstResult({ content: [{ type: 'text', text }] }, { prose: true });
    const t = out.content[0].text;
    expect(t.startsWith('Rows for Virginia.')).toBe(true);
    expect(t.indexOf(json)).toBeLessThan(t.indexOf('claim_free_key'));
  });

  it('opt-in: a prose-only ask block ahead of the first JSON block moves after it (default: stays)', () => {
    const ask = { type: 'text', text: 'Open https://dchub.cloud/u/abc234 to unlock the full list.' };
    const data = { type: 'text', text: JSON.stringify({ count: 1, data: [{ id: 1 }] }) };
    expect(dataFirstResult({ content: [ask, data] }).content).toEqual([ask, data]);
    expect(dataFirstResult({ content: [ask, data] }, { prose: true }).content).toEqual([data, ask]);
  });
});

describe('size budget (unit)', () => {
  const rows = (n, pad = 200) => Array.from({ length: n }, (_, i) => ({ id: i, name: `Facility ${i}`, note: 'x'.repeat(pad) }));

  it('default budget is 30,000 bytes; 0 / off disables; a number sets it', () => {
    expect(ANSWER_BUDGET_DEFAULT_BYTES).toBe(30_000);
    expect(answerBudgetBytes({})).toBe(30_000);
    expect(answerBudgetBytes({ DCHUB_ANSWER_BUDGET_BYTES: '0' })).toBe(0);
    expect(answerBudgetBytes({ DCHUB_ANSWER_BUDGET_BYTES: 'off' })).toBe(0);
    expect(answerBudgetBytes({ DCHUB_ANSWER_BUDGET_BYTES: '12000' })).toBe(12_000);
  });

  it('under the budget: untouched (same reference)', () => {
    const v = { data: rows(10) };
    expect(capToBudget(v, 30_000).value).toBe(v);
  });

  it('over the budget: the big row list is cut to a prefix, in order, and size_cap says so', () => {
    const v = { as_of: '2026-11-13', data: rows(400), provenance: { withheld_fields: ['a', 'b', 'c'] } };
    expect(B(v)).toBeGreaterThan(30_000);
    const { value, cut } = capToBudget(v, 30_000);
    expect(B(value)).toBeLessThanOrEqual(30_000);
    expect(cut).toEqual([{ field: 'data', shown: value.data.length, of: 400 }]);
    expect(value.data).toEqual(v.data.slice(0, value.data.length));
    expect(value.size_cap.note).toMatch(/narrower request/);
    // a short metadata list is never nibbled
    expect(value.provenance.withheld_fields).toEqual(['a', 'b', 'c']);
    expect(v.data.length).toBe(400);   // input not mutated
  });

  it('execute_plan shape: whole steps are never dropped; rows inside a step are cut; nested relay prose goes first', () => {
    const step = (i) => ({ step: i, tool: `t${i}`, status: 'executed',
      result: { items: rows(60), _upgrade: { message: 'u'.repeat(800) }, human_message: 'h'.repeat(300), human_url: 'https://dchub.cloud/u/abc234' } });
    const v = { human_url: 'https://dchub.cloud/u/abc234', executed: [step(1), step(2), step(3), step(4)], human_message: 'top' };
    const { value } = capToBudget(v, 30_000);
    expect(value.executed.map((s) => s.step)).toEqual([1, 2, 3, 4]);
    expect(B(value)).toBeLessThanOrEqual(30_000);
    for (const s of value.executed) {
      expect(s.result._upgrade).toBeUndefined();
      expect(s.result.human_message).toBeUndefined();
      expect(s.result.human_url).toBe('https://dchub.cloud/u/abc234');   // a link is not prose
    }
    expect(value.human_message).toBe('top');   // the top-level relay line stays
    expect(value.size_cap.nested_relay_copy_dropped).toBe(8);
  });

  it('nothing cuttable: stays over budget and says by how much (never drops a record)', () => {
    const reasons = ['step result truncated', 'tier preview', 'withheld: score', 'withheld: rank', 'withheld: mw'];
    const v = { executed: [{ step: 1, result: { blob: 'z'.repeat(40_000) } }, { step: 2, result: { blob: 'z'.repeat(5_000) } }],
      provenance: { preview: { reasons } } };
    const { value, cut } = capToBudget(v, 30_000);
    expect(value.executed.length).toBe(2);
    expect(cut === null || cut.length === 0).toBe(true);
    expect(value.provenance.preview.reasons).toEqual(reasons);   // a short metadata list is not nibbled
  });

  it('a [lon, lat] tuple is never cut', () => {
    const v = { features: Array.from({ length: 3 }, () => ({ geometry: { coordinates: Array.from({ length: 800 }, () => [-77.48123, 39.04123]) } })) };
    const { value } = capToBudget(v, 30_000);
    const flat = value.features.flatMap((f) => f.geometry.coordinates);
    expect(flat.every((c) => c.length === 2)).toBe(true);
  });

  it('result: structuredContent and block 0 JSON cut alike; an error result passes', () => {
    const sc = { data: rows(400) };
    const r = { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
    const out = answerBudgetResult(r, 30_000);
    expect(B(out.structuredContent)).toBeLessThanOrEqual(30_000);
    expect(B(out.content[0].text)).toBeLessThanOrEqual(30_000);
    expect(JSON.parse(out.content[0].text).data.length).toBe(out.structuredContent.data.length);
    const err = { ...r, isError: true };
    expect(answerBudgetResult(err, 30_000)).toBe(err);
  });

  it('answerShapeStep: skip passes the result through; kill switches turn each half off', () => {
    const sc = { agent_instruction: 'x', data: rows(400) };
    const r = { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
    expect(answerShapeStep(r, { skip: true })).toBe(r);
    const prev = { a: process.env.DCHUB_DATA_FIRST, b: process.env.DCHUB_ANSWER_BUDGET_BYTES };
    try {
      process.env.DCHUB_DATA_FIRST = '0'; process.env.DCHUB_ANSWER_BUDGET_BYTES = '0';
      expect(answerShapeStep(r)).toBe(r);
      delete process.env.DCHUB_DATA_FIRST; delete process.env.DCHUB_ANSWER_BUDGET_BYTES;
      const out = answerShapeStep(r);
      expect(Object.keys(out.structuredContent)[0]).toBe('data');
      expect(B(out.structuredContent)).toBeLessThanOrEqual(30_000);
    } finally {
      for (const [k, v] of [['DCHUB_DATA_FIRST', prev.a], ['DCHUB_ANSWER_BUDGET_BYTES', prev.b]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});

describe('paid answers are exempt from the budget (owner 11-14, OWNER DECISION 6)', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `Campus ${i}`, note: 'n'.repeat(120) }));
  it('answerShapeStep budget:false: every row, no size_cap; data-first still applies', () => {
    const sc = { agent_instruction: 'x', data: rows(600) };
    const r = { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
    expect(B(sc), 'control: over the budget').toBeGreaterThan(30_000);
    const paid = answerShapeStep(r, { budget: false });
    expect(paid.structuredContent.data.length).toBe(600);
    expect(paid.structuredContent.size_cap).toBeUndefined();
    expect(splitLeadingJson(paid.content[0].text).json.data.length).toBe(600);
    expect(Object.keys(paid.structuredContent)[0], 'data first for every tier').toBe('data');
    const free = answerShapeStep(r, { budget: true });
    expect(free.structuredContent.size_cap, 'control: the same answer is capped for a free caller').toBeTruthy();
    expect(free.structuredContent.data.length).toBeLessThan(600);
  });
});

describe('/mcp e2e (real server.mjs, stub backend)', () => {
  let H, fence;
  const BIG_ROWS = 600;
  const big = () => ({ success: true, count: BIG_ROWS, total: BIG_ROWS, as_of: '2026-11-13',
    data: Array.from({ length: BIG_ROWS }, (_, i) => ({ id: i, name: `Campus ${i}`, market: 'northern-virginia',
      state: 'VA', capacity_mw: 10 + (i % 90), status: 'operational', note: 'n'.repeat(120) })) });
  const PRO = { 'x-api-key': PRO_KEY };
  // A valid FREE key (bound email, so no bind wall): the stub answers it the same 600 rows as Pro.
  const FREE_KEY = 'dch_live_FREEbudgetkey0123456789abcdef';
  const FREE = { 'x-api-key': FREE_KEY };
  const KEYLESS = {};
  // One fresh caller (own IP, own session) per call. A sessionless loopback request is an execute_plan step
  // (server.mjs _isLoopbackPeer), which the step skips by design; a session from a forwarded IP is a caller.
  let ipN = 40;
  async function callAs(headers, name, args) {
    const h0 = { 'x-forwarded-for': `203.0.113.${ipN++}`, 'user-agent': 'test-client', ...headers };
    const init = await H.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } }, h0);
    const sid = init.headers.get('mcp-session-id');
    expect(sid, 'control: a session').toBeTruthy();
    const h = { ...h0, 'mcp-session-id': sid };
    await H.post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
    return H.post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, h);
  }
  const parse = (r) => {
    const res = r.msg && r.msg.result;
    const b0 = res && res.content && res.content[0] && res.content[0].text;
    const sp = b0 ? splitLeadingJson(b0) : null;
    const j = sp ? sp.json : null;
    return { res, sc: res && res.structuredContent, b0, j };
  };

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { status: 200, body: { valid: true, tier: 'free', developer_id: 'dev_free_budget', email: 'free@example.com',
          tier_detail: { users_plan: 'free' } } };
      }
      if (req.headers['x-api-key'] !== PRO_KEY && req.headers['x-api-key'] !== FREE_KEY) return undefined;   // keyless: the harness's walled bodies
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      return { status: 200, body: big() };
    } });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('keyless walled search_facilities: the data rows come before every relay / upsell key', async () => {
    const { sc } = parse(await callAs(KEYLESS, 'search_facilities', { state: 'VA' }));
    expect(sc, 'control: structuredContent').toBeTruthy();
    const keys = Object.keys(sc);
    expect(firstRelay(keys), 'control: the walled answer carries relay keys').toBeGreaterThanOrEqual(0);
    expect(keys.indexOf('data'), 'control: a data key').toBeGreaterThanOrEqual(0);
    expect(firstRelay(keys), `relay key before data: ${keys.join(',')}`).toBeGreaterThan(lastData(keys));
  }, 60_000);

  it('Pro big search_facilities (600 rows): every row in both copies, no size_cap (owner 11-14)', async () => {
    const { sc, j } = parse(await callAs(PRO, 'search_facilities', { state: 'VA' }));
    expect(sc && Array.isArray(sc.data), 'control: rows came back').toBe(true);
    expect(sc.size_cap).toBeUndefined();
    expect(sc.data.length).toBe(BIG_ROWS);
    expect(B(sc), 'control: the whole answer is over the budget').toBeGreaterThan(30_000);
    expect(j && j.size_cap).toBeUndefined();
    expect(j && j.data && j.data.length).toBe(BIG_ROWS);
  }, 60_000);

  it('free-key big search_facilities: each copy within 30 KB, rows cut in order with size_cap, and no tier wall', async () => {
    const { res, sc, b0 } = parse(await callAs(FREE, 'search_facilities', { state: 'VA' }));
    expect(sc && Array.isArray(sc.data), 'control: rows came back').toBe(true);
    expect(B(sc)).toBeLessThanOrEqual(30_000);
    expect(B(b0)).toBeLessThanOrEqual(30_000);
    expect(sc.size_cap && sc.size_cap.cut.map((c) => c.field)).toContain('data');
    expect(sc.data.length).toBeLessThan(BIG_ROWS);
    expect(sc.data.map((r) => r.id)).toEqual(Array.from({ length: sc.data.length }, (_, i) => i));
    // A size cut is not tier gating: the size_cap block carries no link and no partial_preview stamp is added.
    // (A free key's answer carries the free tier's own one relay link; that is the wall step's, not this one's.
    // The unit tests pin that capToBudget adds no wall marker, relay link or _upgrade.)
    expect(res.isError).not.toBe(true);
    expect(JSON.stringify(sc.size_cap)).not.toMatch(/https?:\/\//);
    expect(sc.provenance && sc.provenance.completeness).not.toBe('partial_preview');
  }, 60_000);

  // server.mjs is imported here, after beforeAll pointed it at the stub backend.
  it('the budget applies only to a caller KNOWN to be free; paid, trial, admin and unknown tiers get every row', async () => {
    const { _answerBudgetAppliesTo } = await import('../server.mjs');
    for (const tier of ['free', 'anonymous', 'anon', 'identified', 'FREE']) {
      expect(_answerBudgetAppliesTo({ tier }), tier).toBe(true);
    }
    for (const tier of ['starter', 'developer', 'paid', 'pro', 'founding', 'team', 'metered', 'enterprise',
      'research_seed', 'admin', 'internal', 'trial', 'pro_trial', '', undefined, null, 'something-new']) {
      expect(_answerBudgetAppliesTo({ tier }), String(tier)).toBe(false);
    }
    expect(_answerBudgetAppliesTo(null), 'no request context').toBe(false);
    expect(_answerBudgetAppliesTo({}), 'no tier on the context').toBe(false);
  });
});
