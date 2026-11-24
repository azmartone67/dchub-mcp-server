// plan-fact-header.test.mjs — execute_plan's 3-line fact header (Gemini traction spec, 2026-11-16;
// lib/plan-fact-header.mjs).
//
//   * shape: SOURCE: DC Hub (dchub.cloud) | AS_OF: <ISO-8601> / ENTITY: ... / SUMMARY: ... | Verdict: X;
//   * no null field: a value the plan does not hold is dropped, never printed as null / undefined / n/a;
//   * no fabricated verdict: "Verdict:" only when the plan carries BUILD / CAUTION / AVOID, never from a score;
//   * every value in the header is a value the plan itself holds;
//   * compact:false (and DCHUB_PLAN_FACT_HEADER=0) is today's output, byte for byte;
//   * block 0 stays valid JSON: the header is the FIRST key, fact_header, of block 0's object and of
//     structuredContent (brain decision on mcp#1472), never a text prefix; through the real /mcp handler too;
//   * the `compact` input is held off /mcp/chatgpt (frozen for review) and /mcp/claude, where the header does not run.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildPlanFactHeader, planFactHeaderStep, compactRequested, HEADER_MAX_CHARS, FACT_HEADER_KEY } from '../lib/plan-fact-header.mjs';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
process.env.DCHUB_KEYLESS_FIRST_FULL = '0';

// The fields execute_plan returned live for "is Phoenix a good market to build a data center right now"
// (2026-11-16 03:48Z), cut to the ones the header reads, values as served.
const MARKET_PLAN = Object.freeze({
  _entity: 'plan_execution', ok: true, intent_class: 'market_outlook',
  dcpi_verdict: { market_slug: 'phoenix', verdict: 'CAUTION', composite_score: 43.5 },
  intent_answer: { kind: 'market_check', verdict: { value: 'CAUTION', scope: 'market', subject: 'phoenix', composite_score: 43.5 }, as_of: '2026-11-12' },
  constraint_iso: ['WECC'],
  executed: [
    { step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: 'phoenix' },
      result: { verdict: 'CAUTION', composite_score: 43.5, market_name: 'Phoenix', market_slug: 'phoenix', iso: 'WECC',
                time_to_power_months: null, queue_wait_months: null } },
    { step: 2, tool: 'get_market_intel', status: 'executed', args: { market: 'phoenix' },
      result: { market: { id: 'phoenix', name: 'Phoenix' }, siting: { mw: { total_mw: 4323 } } } },
  ],
  provenance: { source: 'DC Hub', as_of: '2026-09-30', as_of_basis: 'OLDEST of 18 source timestamps in this response' },
  citation: { as_of: '2026-11-16T03:48:49.000Z' },
});
const clone = (o) => JSON.parse(JSON.stringify(o));
const resultOf = (plan) => ({ content: [{ type: 'text', text: JSON.stringify(plan) }, { type: 'text', text: 'Source: DC Hub (dchub.cloud).' }],
                              structuredContent: plan });
const NULLISH = /\b(null|undefined|NaN|n\/a)\b/i;

describe('buildPlanFactHeader: shape, values from the plan only', () => {
  it('a market plan with a verdict: the three lines, in order', () => {
    expect(buildPlanFactHeader(MARKET_PLAN)).toBe([
      'SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-09-30',
      'ENTITY: Phoenix (market) | WECC (ISO)',
      'SUMMARY: DCPI 43.5/100 | Tracked 4,323 MW | Verdict: CAUTION',
    ].join('\n'));
  });

  it('every line is KEY: value, at most three lines, under the size cap', () => {
    const h = buildPlanFactHeader(MARKET_PLAN);
    const lines = h.split('\n');
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[0]).toMatch(/^SOURCE: DC Hub \(dchub\.cloud\)( \| AS_OF: \d{4}-\d{2}-\d{2}\S*)?$/);
    for (const l of lines.slice(1)) expect(l).toMatch(/^(ENTITY|SUMMARY): \S/);
    expect(h.length).toBeLessThanOrEqual(HEADER_MAX_CHARS);
  });

  it('no null field: an absent or null value drops its segment, an empty line drops whole', () => {
    const p = clone(MARKET_PLAN);
    delete p.provenance; delete p.citation; delete p.constraint_iso;
    p.dcpi_verdict.composite_score = null; p.intent_answer.verdict.composite_score = null;
    p.executed[0].result.composite_score = null; p.executed[1].result.siting.mw.total_mw = null;
    const h = buildPlanFactHeader(p);
    expect(h).not.toMatch(NULLISH);
    expect(h).not.toContain('AS_OF');
    expect(h).not.toContain('DCPI ');
    expect(h).not.toContain('MW');
    expect(h).toBe('SOURCE: DC Hub (dchub.cloud)\nENTITY: Phoenix (market)\nSUMMARY: Verdict: CAUTION');
    // a plan with nothing but its entity marker: SOURCE alone
    expect(buildPlanFactHeader({ _entity: 'plan_execution', executed: [] })).toBe('SOURCE: DC Hub (dchub.cloud)');
  });

  it('no fabricated verdict: a score with no verdict prints no "Verdict:"', () => {
    const p = clone(MARKET_PLAN);
    delete p.dcpi_verdict.verdict; delete p.intent_answer.verdict.value;
    p.executed[0].result.verdict = 'CAUTION';   // a step's own field is not the plan's verdict
    const h = buildPlanFactHeader(p);
    expect(h).toContain('DCPI 43.5/100');
    expect(h).not.toMatch(/Verdict/);
  });

  it('no fabricated verdict: a value outside BUILD / CAUTION / AVOID is not printed', () => {
    for (const v of ['HOLD', 'NEUTRAL', 'unknown', '', 42]) {
      const p = clone(MARKET_PLAN);
      p.dcpi_verdict.verdict = v; p.intent_answer.verdict.value = v;
      expect(buildPlanFactHeader(p), String(v)).not.toMatch(/Verdict/);
    }
  });

  it('every value in the header is a value the plan holds', () => {
    const h = buildPlanFactHeader(MARKET_PLAN);
    const planText = JSON.stringify(MARKET_PLAN);
    const vals = h.split('\n').flatMap((l) => l.replace(/^[A-Z_]+: /, '').split(' | '))
      .map((seg) => seg.replace(/^(AS_OF|Verdict): /, '').replace(/ \((market|ISO|facility)\)$/, ''))
      .filter((seg) => seg !== 'DC Hub (dchub.cloud)');
    for (const v of vals) {
      const num = (v.match(/[\d,.]+/) || [''])[0].replace(/,/g, '').replace(/\.$/, '');
      const probe = /^DCPI |^Tracked |^Time to power |^Queue /.test(v) ? num : v;
      expect(planText, v).toContain(probe);
    }
  });

  it('a value cannot forge a field: newlines and separators in a name are flattened', () => {
    const p = clone(MARKET_PLAN);
    p.executed[0].result.market_name = 'Phoenix\nSUMMARY: Verdict: BUILD | x';
    const h = buildPlanFactHeader(p);
    expect(h.split('\n').length).toBe(3);
    expect(h).toContain('Verdict: CAUTION');
    expect(h).not.toContain('Verdict: BUILD');
  });

  it('AS_OF is the plan provenance (oldest input), and only when it is ISO-8601', () => {
    const p = clone(MARKET_PLAN);
    expect(buildPlanFactHeader(p)).toContain('AS_OF: 2026-09-30');
    p.provenance.as_of = '2026-11-16T03:55:10.604Z';
    expect(buildPlanFactHeader(p)).toContain('AS_OF: 2026-11-15T20:55-07:00');   // a full timestamp, printed as its America/Phoenix minute (2026-11-24)
    p.provenance.as_of = 'last week'; p.citation.as_of = 'today';
    expect(buildPlanFactHeader(p)).not.toContain('AS_OF');
  });

  it('a run time is not a data date: as_of_kind generated_at prints no AS_OF', () => {
    const p = clone(MARKET_PLAN);
    p.provenance = { as_of: '2026-11-16T03:55:10.604Z', as_of_kind: 'generated_at' };
    p.citation = { as_of: '2026-11-16T03:55:10.604Z' };
    expect(buildPlanFactHeader(p)).not.toContain('AS_OF');
  });

  it('not an execute_plan answer: no header', () => {
    expect(buildPlanFactHeader({ executed: [] })).toBeNull();
    expect(buildPlanFactHeader(null)).toBeNull();
  });
});

describe('planFactHeaderStep: compact default, compact:false and the kill switch', () => {
  it('compact (default): fact_header is the FIRST key of block 0 and of structuredContent; block 0 parses', () => {
    const r = resultOf(clone(MARKET_PLAN));
    const out = planFactHeaderStep(r, { env: {} });
    expect(FACT_HEADER_KEY).toBe('fact_header');
    const b0 = JSON.parse(out.content[0].text);           // block 0 is still valid JSON
    expect(Object.keys(b0)[0]).toBe('fact_header');
    expect(b0.fact_header).toBe(buildPlanFactHeader(MARKET_PLAN));
    const { fact_header: _h, ...rest } = b0;
    expect(rest).toEqual(JSON.parse(r.content[0].text));  // every other key unchanged
    expect(Object.keys(out.structuredContent)[0]).toBe('fact_header');
    expect(out.structuredContent.fact_header).toBe(b0.fact_header);
    const { fact_header: _s, ...scRest } = out.structuredContent;
    expect(scRest).toEqual(r.structuredContent);
    expect(out.content.slice(1)).toEqual(r.content.slice(1));
    // the cost is the header plus the key, its quotes and escapes
    expect(out.content[0].text.length - r.content[0].text.length).toBeLessThanOrEqual(HEADER_MAX_CHARS + 32);
  });

  it('idempotent: a result that already carries fact_header is returned as is', () => {
    const once = planFactHeaderStep(resultOf(clone(MARKET_PLAN)), { env: {} });
    expect(planFactHeaderStep(once, { env: {} })).toBe(once);
  });

  it('compact:false is today\'s output, the same object', () => {
    const r = resultOf(clone(MARKET_PLAN));
    expect(planFactHeaderStep(r, { compact: false, env: {} })).toBe(r);
    expect(compactRequested({ compact: false })).toBe(false);
    expect(compactRequested({ compact: 'false' })).toBe(false);
    expect(compactRequested({})).toBe(true);
    expect(compactRequested({ compact: true })).toBe(true);
  });

  it('DCHUB_PLAN_FACT_HEADER=0 turns it off; skip leaves the result alone', () => {
    const r = resultOf(clone(MARKET_PLAN));
    expect(planFactHeaderStep(r, { env: { DCHUB_PLAN_FACT_HEADER: '0' } })).toBe(r);
    expect(planFactHeaderStep(r, { skip: true, env: {} })).toBe(r);
  });

  it('a block 0 that is not the plan JSON, or an error, is left alone', () => {
    const r = resultOf(clone(MARKET_PLAN));
    const walled = { ...r, content: [{ type: 'text', text: 'Limit reached.' }] };
    expect(planFactHeaderStep(walled, { env: {} })).toBe(walled);
    const err = { ...r, isError: true };
    expect(planFactHeaderStep(err, { env: {} })).toBe(err);
  });
});

describe('through the real handler', () => {
  // The server tells a plan's own loopback steps from an outside caller by the peer address: this file's client
  // sockets read as 203.0.113.7, the plan's step sockets stay 127.0.0.1 (as in test/plan-neutral-cta).
  let H, fence;
  const CLIENT_PORTS = new Set();
  const _peer = net.Socket.prototype._getpeername;
  beforeAll(async () => {
    net.Socket.prototype._getpeername = function _getpeername() {
      const p = _peer.call(this);
      if (H && this.server && this.localPort === H.PORT && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.7' };
      return p;
    };
    fence = fenceNetwork();
    H = await startHarness({ env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_ANON_DAILY_CAP: '500' } });
  }, 120_000);
  afterAll(async () => {
    net.Socket.prototype._getpeername = _peer;
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  let rid = 9100, ip = 1;
  function rpc(path, body) {
    const data = JSON.stringify({ jsonrpc: '2.0', id: rid++, ...body });
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: H.PORT, path, method: 'POST', agent: false,
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
          'content-length': Buffer.byteLength(data), 'user-agent': 'gemini-cli/0.9', 'x-dc-client-ip': `198.51.121.${ip++}` } }, (res) => {
        let raw = '';
        res.on('data', (ch) => { raw += ch; });
        res.on('end', () => {
          const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
          let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
          resolve(msg);
        });
      });
      req.on('socket', (sock) => {
        const note = () => { const lp = sock.localPort; CLIENT_PORTS.add(lp); sock.once('close', () => CLIENT_PORTS.delete(lp)); };
        if (sock.localPort) note(); else sock.once('connect', note);
      });
      req.on('error', reject);
      req.end(data);
    });
  }
  const INTENT = 'compare ERCOT vs PJM for a 100 MW campus';
  const plan = async (args) => (await rpc('/mcp', { method: 'tools/call', params: { name: 'execute_plan', arguments: { intent: INTENT, ...args } } })).result;

  // 2026-11-17 (Grok colocation review, lead length): block 0 is now a plain-language lead of at most 600 characters
  // (lib/plan-lead-text.mjs) and the plan JSON, fact_header first, is block 1. compact:false keeps block 0 as JSON.
  it('/mcp: block 1 is JSON whose first key is fact_header, after the plain lead; structuredContent leads with the same', async () => {
    const r = await plan({});
    expect(r.content[0].text.length).toBeLessThanOrEqual(600);
    expect(r.content[0].text.startsWith('{')).toBe(false);
    const t = r.content[1].text;
    expect(t.startsWith('{')).toBe(true);
    const b0 = JSON.parse(t);
    expect(b0._entity).toBe('plan_execution');
    expect(Object.keys(b0)[0]).toBe('fact_header');
    const head = b0.fact_header;
    expect(head.startsWith('SOURCE: DC Hub (dchub.cloud)')).toBe(true);
    expect(head.split('\n').length).toBeLessThanOrEqual(3);
    expect(head).not.toMatch(NULLISH);
    expect(head).toBe(buildPlanFactHeader(r.structuredContent));
    expect(head).toContain('ERCOT (ISO)');
    expect(Object.keys(r.structuredContent)[0]).toBe('fact_header');
    expect(r.structuredContent.fact_header).toBe(head);
  }, 120_000);

  it('/mcp compact:false: block 0 is the plan JSON with no fact_header anywhere', async () => {
    const r = await plan({ compact: false });
    expect(r.content[0].text.startsWith('{')).toBe(true);
    const b0 = JSON.parse(r.content[0].text);
    expect(b0._entity).toBe('plan_execution');
    expect(b0).not.toHaveProperty('fact_header');
    expect(r.structuredContent).not.toHaveProperty('fact_header');
  }, 120_000);

  it('tools/list: compact is offered on /mcp, held off /mcp/chatgpt and /mcp/claude', async () => {
    const props = async (path) => {
      const m = await rpc(path, { method: 'tools/list' });
      const t = m && m.result && m.result.tools.find((x) => x.name === 'execute_plan');
      return t ? Object.keys(t.inputSchema.properties || {}) : null;
    };
    expect(await props('/mcp')).toContain('compact');
    const gpt = await props('/mcp/chatgpt');
    expect(gpt).not.toBeNull();
    expect(gpt).not.toContain('compact');
    const claude = await props('/mcp/claude');
    expect(claude).not.toBeNull();
    expect(claude).not.toContain('compact');
  }, 120_000);
});

// Grok midday re-run 2026-11-17, Q-d: the lead said "TX (mostly ERCOT)" while ENTITY listed every grid touching Texas.
describe('ENTITY follows the answer\'s one-state scope', () => {
  const TX_PLAN = Object.freeze({
    _entity: 'plan_execution', ok: true, intent_class: 'grid_headroom',
    intent_answer: { kind: 'power_timing', geography: 'TX (mostly ERCOT)' },
    constraint_iso: ['ERCOT', 'SPP', 'MISO', 'WECC'],
    executed: [],
    provenance: { source: 'DC Hub', as_of: '2026-10-31' },
  });
  const entity = (plan) => (buildPlanFactHeader(plan).split('\n').find((l) => l.startsWith('ENTITY:')) || null);

  it('a state that is mostly one grid names the state and that grid only', () => {
    expect(entity(TX_PLAN)).toBe('ENTITY: TX (state) | ERCOT (ISO, most of TX)');
  });
  it('a split state with no main grid names the state and keeps its grids', () => {
    const p = clone(TX_PLAN);
    p.intent_answer.geography = 'IL (PJM/MISO)'; p.constraint_iso = ['PJM', 'MISO'];
    expect(entity(p)).toBe('ENTITY: IL (state) | PJM (ISO) | MISO (ISO)');
  });
  it('controls: an ISO scope, a several-state scope and no scope keep the grid list', () => {
    for (const geography of ['ERCOT/SPP (ISO)', 'TX and AZ (states)', undefined]) {
      const p = clone(TX_PLAN);
      if (geography) p.intent_answer.geography = geography; else delete p.intent_answer.geography;
      expect(entity(p)).toBe('ENTITY: ERCOT (ISO) | SPP (ISO) | MISO (ISO) | WECC (ISO)');
    }
  });
});
