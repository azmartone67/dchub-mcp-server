// planner-531-e2e.test.mjs — planner 5.31 (Grok Note V item 3, 2026-11-16) on a real server.mjs with a stub
// backend. No static import of server.mjs: the harness sets the backend base before importing it.
// Pure planner cases: test/planner-531-non-us-region.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { US_ONLY_TOOLS } from '../lib/country-scope.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const EU_ASK = 'Which European markets have grid capacity for a 40 MW data center by 2028?';
const US_ISO = /\b(CAISO|PJM|ERCOT|MISO|SPP|NYISO|ISO-?NE)\b/;
const usSteps = (seq) => seq.filter((s) => US_ONLY_TOOLS.has(s.tool)
  && !(s.tool === 'rank_markets' && s.args_hint && ['eu', 'apac', 'canada'].includes(s.args_hint.region)));

describe('execute_plan end to end: the Note V intent runs no US step and mints no US ISO', () => {
  let H, fence;
  const US_PATHS = /interconnection|retirement|grid\/intel|grid-intel|scoreboard|refined|power-pipeline|power_pipeline|availability-timeline/i;
  beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({}); }, 240_000);
  afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

  it(EU_ASK, async () => {
    const before = H.hits.length;
    const r = await H.call('/mcp', 'execute_plan', { intent: EU_ASK }, { 'user-agent': 'test-client' });
    const sc = r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
    const ran = sc.executed.map((e) => e.tool);
    expect(ran.length, 'nothing ran: the assertions below would be vacuous').toBeGreaterThan(0);
    expect(usSteps(sc.executed.map((e) => ({ tool: e.tool, args_hint: e.args })))).toEqual([]);
    expect(JSON.stringify({ minted: sc.minted || null, constraint_iso: sc.constraint_iso || null,
      args: sc.executed.map((e) => e.args) })).not.toMatch(US_ISO);
    expect(H.hits.slice(before).map((h) => h.path).filter((p) => US_PATHS.test(p))).toEqual([]);
    expect(sc.answer_guide).toMatch(/GEOGRAPHY — Europe is outside DC Hub's US grid and queue coverage/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
