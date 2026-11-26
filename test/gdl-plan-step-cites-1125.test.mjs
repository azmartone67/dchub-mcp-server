// gdl-plan-step-cites-1125.test.mjs — follow-up to #1768 (live QA 2026-11-25, planner 5.64): the plan's top-level
// cite_as read "Source: DC Hub (dchub.cloud), as of <day>", but in the same execute_plan answer the per-step
// citations[].cite_as still said "DC Hub, dchub.cloud — PARTIAL preview, 3 of 11 shown (as of ...)" (or an undated
// "DC Hub, dchub.cloud") and provenance.cite_as said an undated "DC Hub, dchub.cloud".
//   * each DC Hub step cite: "Source: DC Hub (dchub.cloud), as of <Phoenix day of that step's as_of>", the PARTIAL
//     wording in that entry's completeness_note, its completeness value kept ('partial_preview')
//   * a step that states no date: "Source: DC Hub (dchub.cloud)", no date clause
//   * provenance.cite_as is the plan's cite_as
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { stepCiteEntry, stampPlanCite } from '../lib/plan-cite-line.mjs';
import { stampOutreach } from '../lib/agent-outreach.mjs';
import { compactPlanObject } from '../lib/plan-compact.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const STEP_RE = /^Source: DC Hub \(dchub\.cloud\)(?:, as of \d{4}-\d{2}-\d{2})?(?:; upstream .+)?$/;
const PLAN_RE = /^Source: DC Hub \(dchub\.cloud\), as of \d{4}-\d{2}-\d{2}/;

describe('stepCiteEntry: one citations[] entry', () => {
  it('a partial step: owner line with its own Phoenix day, the PARTIAL wording in completeness_note, the enum kept', () => {
    const c = stepCiteEntry({ step: 2, tool: 'find_sites', as_of: '2026-11-26T00:44:35Z', completeness: 'partial_preview',
      cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 11 shown (as of 2026-11-25)' });
    expect(c.cite_as).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-25');
    expect(c.completeness).toBe('partial_preview');
    expect(c.completeness_note).toBe('partial preview, 3 of 11 shown');
    expect(c.step).toBe(2);
  });
  it('the scope-only PARTIAL wording and a timestamp in the cite (no as_of field) are read too', () => {
    const c = stepCiteEntry({ cite_as: 'DC Hub, dchub.cloud — PARTIAL preview (not the full dataset) (as of 2026-11-26T03:00:00Z)' });
    expect(c.cite_as).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-25');
    expect(c.completeness_note).toBe('partial preview (not the full dataset)');
  });
  it('an undated step cite gets its as_of day; a step with no date at all gets no date clause', () => {
    expect(stepCiteEntry({ cite_as: 'DC Hub, dchub.cloud', as_of: '2026-11-20' }).cite_as).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-20');
    const none = stepCiteEntry({ cite_as: 'DC Hub, dchub.cloud' });
    expect(none.cite_as).toBe('Source: DC Hub (dchub.cloud)');
    expect(none).not.toHaveProperty('completeness_note');
  });
  it('an upstream is kept; a cite that is not DC Hub\'s is left as it is', () => {
    expect(stepCiteEntry({ cite_as: 'DC Hub, dchub.cloud; upstream EPA Green Book (as of 2026-10-01)' }).cite_as)
      .toBe('Source: DC Hub (dchub.cloud), as of 2026-10-01; upstream EPA Green Book');
    const other = { cite_as: 'EIA-930 hourly' };
    expect(stepCiteEntry(other)).toBe(other);
  });
});

describe('stampPlanCite / stampOutreach: siblings carry the same form', () => {
  it('provenance.cite_as is the plan line; every citations[] entry is restated', () => {
    const r = stampOutreach({ content: [{ type: 'text', text: 'x' }], structuredContent: {
      intent_answer: { as_of: '2026-11-20' },
      citation: { cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 8 shown (as of 2026-11-20)', completeness: 'partial_preview' },
      provenance: { cite_as: 'DC Hub, dchub.cloud', completeness: 'partial_preview' },
      citations: [{ step: 1, tool: 'get_market_intel', as_of: '2026-11-03T21:06:18', completeness: 'partial_preview',
        cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 11 shown (as of 2026-11-03)' }, { step: 2, tool: 'x', cite_as: 'DC Hub, dchub.cloud' }],
    } }, 'execute_plan', {});
    const sc = r.structuredContent;
    expect(sc.cite_as).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-20');
    expect(sc.provenance.cite_as).toBe(sc.cite_as);
    expect(sc.provenance.completeness).toBe('partial_preview');
    expect(sc.citations.map((c) => c.cite_as)).toEqual(['Source: DC Hub (dchub.cloud), as of 2026-11-03', 'Source: DC Hub (dchub.cloud)']);
    expect(sc.citations[0].completeness).toBe('partial_preview');
    expect(sc.citations[0].completeness_note).toBe('partial preview, 3 of 11 shown');
    expect(JSON.stringify(sc.citations)).not.toMatch(/PARTIAL|dchub\.cloud —/);
  });
  it('another tool\'s citations are not touched', () => {
    const sc = { citations: [{ cite_as: 'DC Hub, dchub.cloud' }] };
    const r = stampOutreach({ content: [], structuredContent: sc }, 'get_market_intel', {});
    expect(r.structuredContent.citations[0].cite_as).toBe('DC Hub, dchub.cloud');
    expect(stampPlanCite(null)).toBe(null);
  });
});

describe('compactPlanObject: the citations[] it builds and the provenance it keeps', () => {
  const plan = {
    _entity: 'plan_execution', cite_as: 'Source: DC Hub (dchub.cloud), as of 2026-11-25',
    provenance: { source: 'DC Hub', cite_as: 'DC Hub, dchub.cloud', completeness: 'partial_preview' },
    executed: [
      { step: 1, tool: 'find_sites', status: 'executed', result: { as_of: '2026-11-26T00:44:35Z',
        citation: { cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 11 shown (as of 2026-11-25)', completeness: 'partial_preview', license: 'CC-BY-4.0' } } },
      { step: 2, tool: 'get_permitting_intel', status: 'executed', result: { citation: { cite_as: 'DC Hub, dchub.cloud' } } },
    ],
  };
  it('each row: the owner line, its own Phoenix day, the PARTIAL wording in completeness_note, the enum kept', () => {
    const c = compactPlanObject(plan);
    expect(c.citations[0]).toMatchObject({ step: 1, tool: 'find_sites', completeness: 'partial_preview',
      cite_as: 'Source: DC Hub (dchub.cloud), as of 2026-11-25', completeness_note: 'partial preview, 3 of 11 shown' });
    expect(c.citations[1].cite_as).toBe('Source: DC Hub (dchub.cloud)');
    expect(c.licences).toEqual([{ license: 'CC-BY-4.0', steps: [1] }]);
  });
  it('provenance.cite_as is the plan line, its completeness enum kept', () => {
    const c = compactPlanObject(plan);
    expect(c.provenance.cite_as).toBe(plan.cite_as);
    expect(c.provenance.completeness).toBe('partial_preview');
  });
});

// A real server.mjs with a stub backend (no network): the live probe's shape, keyless and keyed.
const ANON = { 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.52' };
const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.51' };
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({}); }, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('execute_plan on a real server: no sibling keeps the old cite form', () => {
  const ASKS = ['land for 100 MW in Ohio with any local restrictions', 'interconnection queue in PJM', 'Is Phoenix a good place to build a data center?'];
  for (const [who, hdr] of [['keyless', ANON], ['pro', PRO]]) {
    for (const ask of ASKS) {
      for (const detail of ['compact', 'full']) {
        it(`${who} ${detail}: ${ask}`, async () => {
          const full = sc(await H.call('/mcp', 'execute_plan', { intent: ask, detail }, hdr));
          expect(full._entity).toBe('plan_execution');
          // the compact form (what a keyless caller is served live) is built from the answer as served
          const o = detail === 'compact' && Array.isArray(full.executed) && !full.detail ? compactPlanObject(full) : full;
          expect(o.cite_as).toMatch(PLAN_RE);
          if (o.provenance && typeof o.provenance.cite_as === 'string') expect(o.provenance.cite_as).toBe(o.cite_as);
          for (const c of Array.isArray(o.citations) ? o.citations : []) {
            if (typeof c.cite_as !== 'string' || !/^(?:Source: )?DC Hub/.test(c.cite_as)) continue;
            expect(c.cite_as).toMatch(STEP_RE);
            if (c.completeness === 'partial_preview' && c.completeness_note) expect(c.completeness_note).toMatch(/^partial/);
          }
          const cites = [...(Array.isArray(o.citations) ? o.citations : []).map((c) => c.cite_as), o.provenance && o.provenance.cite_as];
          expect(cites.filter((c) => typeof c === 'string' && /^DC Hub, dchub\.cloud|PARTIAL/.test(c))).toEqual([]);
          if (detail === 'compact') expect((o.citations || []).length).toBeGreaterThan(0);
        }, 120_000);
      }
    }
  }
});
