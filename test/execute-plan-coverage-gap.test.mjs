// execute_plan coverage-gap counter (item 11 v1, 2026-10-17): the execute_plan_steps telemetry row names
// the topics an intent asked for that DC Hub has no data for (lib/coverage-gap.mjs), and carries is_qa
// for QA callers. Telemetry only: the agent-facing plan response must not mention it.
// Real server.mjs on loopback, stub backend: no network, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { coverageGaps, COVERAGE_GAP_TOPICS } from '../lib/coverage-gap.mjs';

describe('coverageGaps classifier', () => {
  const cases = [
    ['what are the lease comps in Ashburn for 10 MW', ['lease_comps']],
    ['asking rents for wholesale in Dallas', ['lease_comps']],
    ['colocation pricing in Dallas per kW per month', ['colo_pricing']],
    ['what is $/kW for wholesale in Phoenix', ['colo_pricing']],
    ['vacancy and absorption in Northern Virginia', ['vacancy_absorption']],
    ['available colocation space in Chicago', ['colo_availability']],
    ['2 MW data hall for lease in Reno', ['colo_availability']],
    ['lease comps and vacancy in Hillsboro', ['lease_comps', 'vacancy_absorption']],
  ];
  for (const [intent, want] of cases) {
    it(`gap: ${intent}`, () => expect(coverageGaps(intent)).toEqual(want));
  }
  // DC Hub data, or the 30-day prod intents (2026-10-17): never a gap.
  const none = [
    'energy prices in ERCOT in $/MWh',
    'LMP price per kWh in PJM',
    'rank markets for a 200 MW AI campus',
    'compare power availability in ashburn and secaucus',
    'live land + power screen for a new ~75-100 MW AI / hyperscale campus in the Phoenix metro',
    'show the biggest hyperscaler data-center deals this quarter and what is in the M&A pipeline',
    'capacity available near Phoenix for 50 MW',
    'which us grid has the most headroom right now',
    '',
  ];
  for (const intent of none) {
    it(`no gap: ${intent || '(empty)'}`, () => expect(coverageGaps(intent)).toEqual([]));
  }
  it('only returns declared topics', () => {
    for (const [intent] of cases) for (const t of coverageGaps(intent)) expect(COVERAGE_GAP_TOPICS).toContain(t);
  });
});

const UA = { 'user-agent': 'Claude-User' };
const GAP_INTENT = { intent: 'lease comps and colocation pricing in Ashburn for 10 MW' };
const PLAIN_INTENT = { intent: 'rank markets for a 200 MW AI campus' };
let H, fence, run = {};

async function settle(quietMs = 400, maxMs = 8000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
const stepsRow = (hits) => hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === 'execute_plan_steps').map((h) => h.body);

async function planRun(args, headers = {}) {
  await settle();
  const before = H.hits.length;
  const hdr = { ...UA, ...headers };
  const init = await H.init('/mcp', 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  const r = await H.call('/mcp', 'execute_plan', args, { ...hdr, 'mcp-session-id': sid });
  await settle();
  return { r, rows: stepsRow(H.hits.slice(before)) };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
  await import('../server.mjs');
  await settle();
  run.gap = await planRun(GAP_INTENT);
  run.plain = await planRun(PLAIN_INTENT);
  run.qa = await planRun(GAP_INTENT, { 'x-dchub-qa': '1' });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('execute_plan_steps row carries coverage_gaps', () => {
  it('a gap intent writes coverage_gaps on its one steps row', () => {
    expect(run.gap.rows.length).toBe(1);
    expect(run.gap.rows[0].params.coverage_gaps).toEqual(['colo_pricing', 'lease_comps']);
  });
  it('an intent DC Hub covers writes no coverage_gaps key (row otherwise unchanged)', () => {
    expect(run.plain.rows.length).toBe(1);
    expect(run.plain.rows[0].params).not.toHaveProperty('coverage_gaps');
    expect(run.plain.rows[0].params).toHaveProperty('intent_class');
  });
  it('a non-QA caller is not marked is_qa; X-DCHub-QA: 1 marks the steps row', () => {
    expect(run.gap.rows[0].is_qa).toBeUndefined();
    expect(run.qa.rows.length).toBe(1);
    expect(run.qa.rows[0].is_qa).toBe(true);
  });
  it('the agent-facing response never mentions the counter', () => {
    expect(run.gap.r.status).toBe(200);
    expect(run.gap.r.body.length).toBeGreaterThan(200);
    expect(run.gap.r.body).not.toMatch(/coverage_gap/);
  });
});
