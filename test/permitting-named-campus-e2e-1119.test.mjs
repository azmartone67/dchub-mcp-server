// permitting-named-campus-e2e-1119.test.mjs — planner 5.42 on a real server.mjs with a stub backend: the LAND L3
// moratorium ask runs get_permitting_intel (moratorium, legislation, zoning) and leads with the count and named
// jurisdictions; a named-campus plan whose backend ignored name= says no record matched and names no other project.
// Pure tests: test/permitting-named-campus-1119.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.37' };
const REC = (j, st, up) => ({ class: 'moratorium', jurisdiction: j, state: st, stage: 'enacted', scope: 'local', effective_date: null, updated_at: up });
const MOR = { ok: true, class: 'moratorium', count: 54, records: [
  REC('Colfax County', 'NM', '2026-10-24 17:08:31+00'), REC('West Seneca', 'NY', '2026-10-24 17:08:30+00'),
  REC('Madison County', 'AR', '2026-10-24 17:08:29+00'), REC("Prince George's County", 'MD', '2026-10-24 17:08:28+00'),
  REC('Howell Township', 'MI', '2026-10-24 17:08:26+00'), REC('Town of Beloit', 'WI', '2026-10-24 17:08:25+00')] };
const IGNORED = { success: true, count: 2, data: [{ name: 'Louisiana AI Campus', developer: 'Meta', state: 'LA' }, { name: 'Colossus 2 Expansion', developer: 'xAI', state: 'TN' }] };
const seen = [];
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, body, u) => {
    seen.push(p + (u && u.search ? u.search : ''));
    if (p === '/api/v1/permitting/intel') {
      const cls = u && u.searchParams ? u.searchParams.get('class') : null;
      if (cls === 'moratorium') return { status: 200, body: MOR };
      if (cls === 'legislation') return { status: 200, body: { ok: true, class: 'legislation', loaded: false, count: null, bills: [] } };
      return { status: 200, body: { ok: true, count: 0, records: [] } };
    }
    if (p === '/api/v1/pipeline' || p === '/api/v1/facilities/search' || p === '/api/v1/facilities') return { status: 200, body: IGNORED };
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('execute_plan 5.42 (real server.mjs, stub backend)', () => {
  it('LAND L3: the moratorium ask runs get_permitting_intel and the lead names five jurisdictions with stage and date', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Which US states, counties or cities have data center moratoriums or restrictive land-use rules right now?' }, PRO));
    expect(o.intent_class).toBe('permitting');
    const pi = o.executed.filter((e) => e.tool === 'get_permitting_intel');
    expect(pi.map((e) => e.args.class)).toEqual(['moratorium', 'legislation', 'zoning']);
    expect(pi.every((e) => e.status === 'executed')).toBe(true);
    expect(o.executed.some((e) => e.tool === 'discover_tools')).toBe(false);
    const lead = planLeadText(o);
    expect(lead).toMatch(/^54 data-center moratorium records on record/);
    expect((lead.match(/\(enacted, record updated 2026-10-24\)/g) || []).length).toBe(5);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
  it('a named campus whose lookup did not read by name says no record matched and names no other project', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'status and power plan of the Stargate Abilene data center campus' }, PRO));
    expect(o.intent_class).toBe('named_campus');
    const lead = planLeadText(o);
    expect(lead).toMatch(/^No DC Hub record matched "Stargate Abilene" in this read\./);
    expect(lead).not.toMatch(/Louisiana|Colossus|Meta|xAI/);
  }, 120_000);
});
