// Item 11 (owner decision 2026-10-17): coverage-gap MEASUREMENT for execute_plan.
//   1. classifyCoverageGap: lease comps, colo pricing, vacancy/absorption, colo availability when
//      source_capacity returns no fit; null otherwise.
//   2. coverage_gap rides the LOGGED plan record only (execute_plan_steps row + the recipe_lifecycle
//      'completed' event), never the agent-facing response, a tool output or a directory profile.
//   3. The scripted "live land + power screen ~75-100 MW" prompt family is written as
//      'dchub-internal' (the existing own-test telemetry tag the backend's funnel predicates already
//      exclude), real intents are not.
// Real server.mjs on loopback, stub backend: no network, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { classifyCoverageGap, isEvalIntent, sourceCapacityNoFit, COVERAGE_GAP_TOPICS } from '../lib/coverage-gap.mjs';

describe('classifyCoverageGap', () => {
  const cases = [
    ['what are current lease comps for 5 MW in Northern Virginia', 'lease_comps'],
    ['show comparable leases for wholesale space in Dallas', 'lease_comps'],
    ['what is the asking rent per kW in Phoenix', 'lease_comps'],
    ['colocation pricing in Chicago for 500 kW', 'colo_pricing'],
    ['how much does colo cost per kW in Atlanta', 'colo_pricing'],
    ['what is market vacancy in Ashburn', 'vacancy_absorption'],
    ['net absorption for Dallas data centers last year', 'vacancy_absorption'],
  ];
  for (const [intent, topic] of cases) {
    it(`${topic}: ${intent}`, () => expect(classifyCoverageGap(intent, [])).toBe(topic));
  }
  it('the topic set is exactly the four owner topics', () => {
    expect([...COVERAGE_GAP_TOPICS].sort()).toEqual(['colo_availability_nofit', 'colo_pricing', 'lease_comps', 'vacancy_absorption']);
  });
  it('power, grid, siting and ranking asks are not gaps', () => {
    for (const i of ['rank markets for a 200 MW AI campus', 'find 100 MW near Ashburn with fiber',
      'wholesale power price risk in ERCOT', 'interconnection queue depth in PJM', 'compare Dallas vs Phoenix for 100 MW']) {
      expect(classifyCoverageGap(i, []), i).toBeNull();
    }
  });
  it('empty or junk input is null, never a throw', () => {
    for (const i of [undefined, null, '', 42, {}]) expect(classifyCoverageGap(i, [])).toBeNull();
  });

  describe('colo_availability_nofit needs a source_capacity step that ran and found nothing', () => {
    const intent = 'is there colocation space available in Reno';
    const step = (result, status = 'executed') => ({ step: 1, tool: 'source_capacity', status, result });
    it('no fit (browse, empty items)', () => expect(classifyCoverageGap(intent, [step({ items: [] })])).toBe('colo_availability_nofit'));
    it('no fit (match, empty exact and bundles, shortfall)', () => {
      expect(classifyCoverageGap(intent, [step({ exact: [], bundles: [], shortfall: { mw: 1 } })])).toBe('colo_availability_nofit');
    });
    it('reads the FULL result from fullByEntry when given', () => {
      const e = step({ items: [{ slug: 'x' }] });
      expect(classifyCoverageGap(intent, [e], new Map([[e, { items: [] }]]))).toBe('colo_availability_nofit');
    });
    it('a fit is not a gap', () => {
      expect(classifyCoverageGap(intent, [step({ items: [{ slug: 'a' }] })])).toBeNull();
      expect(classifyCoverageGap(intent, [step({ exact: [{ slug: 'a' }], bundles: [] })])).toBeNull();
    });
    it('no source_capacity step, a gated or failed step, or an unreadable shape is not a no-fit', () => {
      expect(classifyCoverageGap(intent, [])).toBeNull();
      expect(classifyCoverageGap(intent, [step({ items: [] }, 'gated_preview')])).toBeNull();
      expect(classifyCoverageGap(intent, [step({ items: [] }, 'failed')])).toBeNull();
      expect(classifyCoverageGap(intent, [step({ weird: true })])).toBeNull();
      expect(sourceCapacityNoFit('nope')).toBe(false);
    });
    it('a non-colo intent never reports it even when source_capacity is empty', () => {
      expect(classifyCoverageGap('find 100 MW of powered land in Reno', [step({ items: [] })])).toBeNull();
    });
  });
});

describe('isEvalIntent: the scripted ~75-100 MW land + power family, exactly', () => {
  const evals = [
    'live land + power screen for a new ~75–100 MW AI / hyperscale campus in Columbus / Central Ohio (AEP territory, PJM).',
    'Columbus / AEP-PJM 75-100 MW land+power',
    '~75–100 MW AI campus land+power near Phoenix (APS / Salt River Project corridor).',
  ];
  const real = [
    'rank markets for a 200 MW AI campus',
    'find data center sites near Ashburn for 100 MW',
    'Is Dallas a better place than Ashburn right now for a new 75 MW load, power-wise?',
    'Compare Dallas vs Phoenix for a 100 MW AI campus - power, queue, and fiber - using DC Hub.',
    'I need 75-100 MW of colocation in Dallas, what are the lease rates',   // range but no land
    'land prices for a 75-100 acre parcel',                                  // land, no MW range
    'what is the lease comp for 75-100 MW of power',                          // power + range, no land
    'live feed of land and power news',
    'Denver land + power for ~50\u2013100 MW',                                // different range
  ];
  for (const i of evals) it(`tagged: ${i.slice(0, 70)}`, () => expect(isEvalIntent(i)).toBe(true));
  for (const i of real) it(`NOT tagged: ${i.slice(0, 70)}`, () => expect(isEvalIntent(i)).toBe(false));
  it('junk input is false', () => { for (const i of [undefined, null, '', 7, {}]) expect(isEvalIntent(i)).toBe(false); });
});

// ── end to end: what is logged vs what the agent sees ────────────────────────
const UA = { 'user-agent': 'Claude-User' };
const LEASE = 'what are the current lease comps for 5 MW of wholesale space in Northern Virginia';
const EVAL = 'live land + power screen for a new ~75–100 MW AI / hyperscale campus in Metro Atlanta / North Georgia';
const PLAIN = 'rank markets for a 200 MW AI campus';
let H, fence;
const run = {};

async function settle(quietMs = 400, maxMs = 8000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
const track = (hits) => hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body).map((h) => h.body);
const stepsRow = (hits) => track(hits).find((b) => b.tool === 'execute_plan_steps');
const completed = (hits) => track(hits).find((b) => b.event === 'recipe_lifecycle' && b.phase === 'completed');
const callRow = (hits) => track(hits).find((b) => b.tool === 'execute_plan');

async function plan(path, intent, extra = {}) {
  const before = H.hits.length;
  const init = await H.init(path, 'claude-ai', { ...UA, ...extra });
  const sid = init.headers.get('mcp-session-id');
  const res = await H.call(path, 'execute_plan', { intent }, { ...UA, ...extra, 'mcp-session-id': sid });
  await settle();
  return { res, hits: H.hits.slice(before) };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
  await settle();
  run.lease = await plan('/mcp', LEASE);
  run.plain = await plan('/mcp', PLAIN);
  run.eval = await plan('/mcp', EVAL);
  run.profile = await plan('/mcp/claude', LEASE);
  run.qa = await plan('/mcp', PLAIN, { 'x-dchub-qa': '1' });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('coverage_gap is on the logged plan record', () => {
  it('control: a lease-comps intent ran a real plan', () => {
    expect(run.lease.res.raw).toMatch(/plan_execution/);
    expect(stepsRow(run.lease.hits), 'the execute_plan_steps row was written').toBeTruthy();
  });
  it('the execute_plan_steps row carries a TOP-LEVEL coverage_gap (and the params mirror)', () => {
    const row = stepsRow(run.lease.hits);
    expect(row.coverage_gap).toBe('lease_comps');
    expect(row.params.coverage_gap).toBe('lease_comps');
  });
  it('the recipe_lifecycle completed event carries it too', () => {
    expect(completed(run.lease.hits).coverage_gap).toBe('lease_comps');
  });
  it('an ordinary siting intent logs coverage_gap null (key present, so null means "classified none")', () => {
    const row = stepsRow(run.plain.hits);
    expect('coverage_gap' in row).toBe(true);
    expect(row.coverage_gap).toBeNull();
    expect('coverage_gap' in row.params).toBe(false);
    expect(completed(run.plain.hits).coverage_gap).toBeNull();
  });
});

describe('coverage_gap is NEVER agent-facing', () => {
  it('the execute_plan response body has no coverage_gap key (control: the same call logged one)', () => {
    expect(stepsRow(run.lease.hits).coverage_gap).toBe('lease_comps');
    expect(run.lease.res.raw).not.toMatch(/coverage_gap/);
    expect(JSON.stringify(run.lease.res.body)).not.toMatch(/coverage_gap/);
    expect(run.plain.res.raw).not.toMatch(/coverage_gap/);
  });
  it('a directory profile response has none either', () => {
    expect(run.profile.res.raw).not.toMatch(/coverage_gap/);
  });
  it('no tools/list surface (any profile) mentions it', async () => {
    for (const p of ['/mcp', '/mcp/claude', '/mcp/chatgpt', '/mcp/grok']) {
      const l = await H.list(p, UA);
      expect(l.raw, p).not.toMatch(/coverage_gap/);
    }
  });
});

describe('the scripted eval family is written as the existing internal tag', () => {
  it('every row the eval plan wrote (call row, steps row, lifecycle) says dchub-internal', () => {
    const rows = [callRow(run.eval.hits), stepsRow(run.eval.hits), completed(run.eval.hits)];
    for (const r of rows) {
      expect(r, 'row exists').toBeTruthy();
      expect(r.platform).toBe('dchub-internal');
    }
  });
  it('control: real intents keep their platform', () => {
    for (const r of [callRow(run.lease.hits), stepsRow(run.lease.hits), completed(run.lease.hits), callRow(run.plain.hits)]) {
      expect(r.platform).not.toBe('dchub-internal');
    }
  });
  it('the response the agent gets is not changed by the tag', () => {
    expect(run.eval.res.raw).toMatch(/plan_execution/);
    expect(run.eval.res.raw).not.toMatch(/dchub-internal|eval_intent/);
  });
});

describe('the steps row carries the QA marker (ported from the duplicate PR)', () => {
  it('a QA-marked plan writes is_qa on the steps row', () => {
    expect(stepsRow(run.qa.hits).is_qa).toBe(true);
  });
  it('control: a plain caller row is not marked', () => {
    expect(stepsRow(run.plain.hits).is_qa).toBeUndefined();
  });
});
