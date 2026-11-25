// queue-project-mode-1125.test.mjs — get_interconnection_queue mode=project (Grok spec 2026-11-24 item 6B),
// DCHUB_QUEUE_PROJECT_MODE on. Real server.mjs over loopback, stub backend, network fenced.
//
// Pins:
//   * full access (PRO): the three PJM fixtures (a queue id and a project name served live on by-iso
//     2026-11-24, and a Loudoun point within 10 km) come back as rows with source_url and the file as_of;
//     the args reach the backend as by-iso?mode=project&...;
//   * an unknown id says "not found in PJM queue as of <date>", not an empty answer;
//   * gating is the one queue gate as before: a keyless caller gets the labelled taste with `projects`
//     withheld (no queue id, project name, MW or DCPI context in the result), the same as iso=PJM;
//   * execute_plan sends "status of queue project X" and "queue projects near <point>" to mode=project;
//   * the frozen ChatGPT profile does not list the new params.
// Flag off: test/queue-project-mode-off-1125.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { queueProjectAsk, queueProjectQuery, shapeQueueProjectBody } from '../lib/queue-project-mode.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.71' };
let anonN = 80;
const ANON = () => ({ 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': `203.0.113.${anonN++}` });
const SRC = 'https://www.pjm.com/m/ProjectTransition/GenerateExcelTransitionProjectsAll';
const row = (queue_id, project_name, county, state, mw, extra = {}) => ({
  queue_id, iso: 'PJM', project_name, capacity_mw: mw, fuel_type: 'Natural Gas', county, state,
  point_of_interconnection: null, status: 'Active', stage: null, withdrawn: false, large_load: null,
  source_url: SRC, as_of: '2026-11-24', as_of_basis: 'export_generated_on_request', ...extra });
const CTX = { nearest_market: 'Ashburn', market_slug: 'ashburn', distance_km: 7.9,
  grid_headroom: { dcpi_verdict: 'CAUTION', time_to_power_months: 51.0, as_of: '2026-11-24' },
  line: 'Nearest DC Hub market: Ashburn, 7.9 km; Data Center Power Index (DCPI) verdict CAUTION.' };
const body = (lookup, projects) => ({ mode: 'project', iso: lookup.iso || 'PJM', lookup, as_of: '2026-11-24',
  as_of_basis: 'live_feed_fetch_date', projects, project_count: projects.length, found: projects.length > 0,
  source_url: 'https://www.pjm.com/planning/m/cycle-service-request-status', dc_context: projects.length ? CTX : null,
  ...(projects.length ? {} : { message: `Queue id ${lookup.queue_id} not found in PJM queue as of 2026-11-24.` }) });
const BY_ISO = { iso: 'PJM', queued_generation_gw: 373.2, project_count: 1235, source_as_of: '2026-11-24',
  projects: [row('PJM-C01-1097', 'Homer City 345 kV', 'Indiana', 'PA', 3000)] };

const seen = [];
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ env: { DCHUB_QUEUE_PROJECT_MODE: '1' }, extraRoutes: async (p, req, b, u) => {
    if (p !== '/api/v1/interconnection-queue/by-iso') return undefined;
    const q = u.searchParams;
    seen.push(Object.fromEntries(q.entries()));
    if (q.get('mode') !== 'project') return { status: 200, body: BY_ISO };
    const lookup = Object.fromEntries(q.entries());
    delete lookup.mode;
    if (q.get('queue_id')) {
      const hit = /^(PJM-)?C01-1097$/i.test(q.get('queue_id'));
      return { status: 200, body: body({ ...lookup, iso: 'PJM' }, hit ? [row('PJM-C01-1097', 'Homer City 345 kV', 'Indiana', 'PA', 3000)] : []) };
    }
    if (q.get('name')) return { status: 200, body: body(lookup, [row('PJM-C01-1055', 'Limerick 500 kV', 'Montgomery', 'PA', 2808)]) };
    return { status: 200, body: body(lookup, [row('PJM-FIXTURE-LOUDOUN-1', 'Fixture Loudoun storage', 'Loudoun', 'VA', 150,
      { distance_km: 7.2, lat: 39.0868, lng: -77.6386, coordinate_precision: 'county_centroid' })]) };
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('mode=project, full access', () => {
  it('queue id fixture: the row with source_url and the file as_of; args reach by-iso?mode=project', async () => {
    const o = sc(await H.call('/mcp', 'get_interconnection_queue', { mode: 'project', queue_id: 'PJM-C01-1097' }, PRO));
    expect(o.mode).toBe('project');
    expect(o.projects.map((p) => p.queue_id)).toEqual(['PJM-C01-1097']);
    expect(o.projects[0].source_url).toBe(SRC);
    expect(o.projects[0].as_of).toBe('2026-11-24');
    expect(seen.some((s) => s.mode === 'project' && s.queue_id === 'PJM-C01-1097')).toBe(true);
  });
  it('name fixture', async () => {
    const o = sc(await H.call('/mcp', 'get_interconnection_queue', { mode: 'project', name: 'Limerick 500 kV', iso: 'PJM' }, PRO));
    expect(o.projects[0].queue_id).toBe('PJM-C01-1055');
    expect(o.projects[0].source_url).toBe(SRC);
    expect(o.projects[0].as_of).toBe('2026-11-24');
  });
  it('Loudoun point within 10 km, with the data-center context line', async () => {
    const o = sc(await H.call('/mcp', 'get_interconnection_queue', { mode: 'project', lat: 39.1157, lon: -77.5636, radius_km: 10 }, PRO));
    expect(o.projects[0].county).toBe('Loudoun');
    expect(o.projects[0].distance_km).toBeLessThanOrEqual(10);
    expect(o.projects[0].source_url).toBe(SRC);
    expect(o.projects[0].as_of).toBe('2026-11-24');
    expect(o.dc_context.nearest_market).toBe('Ashburn');
    expect(seen.some((s) => s.mode === 'project' && s.lat === '39.1157' && s.radius_km === '10')).toBe(true);
  });
  it('unknown id: not found in the ISO queue as of the date, never empty', async () => {
    const o = sc(await H.call('/mcp', 'get_interconnection_queue', { mode: 'project', queue_id: 'PJM-ZZ9-999' }, PRO));
    expect(o.found).toBe(false);
    expect(o.message).toBe('Queue id PJM-ZZ9-999 not found in PJM queue as of 2026-11-24.');
  });
});

describe('gating is unchanged: keyless gets the queue taste, rows withheld', () => {
  for (const [label, args] of [['queue id', { mode: 'project', queue_id: 'PJM-C01-1097' }],
    ['point', { mode: 'project', lat: 39.1157, lon: -77.5636 }]]) {
    it(label, async () => {
      const r = await H.call('/mcp', 'get_interconnection_queue', args, ANON());
      const o = sc(r);
      const all = JSON.stringify(r.msg.result);
      for (const leak of ['Homer City', 'Fixture Loudoun', '"capacity_mw":3000', '"capacity_mw":150', 'CAUTION', 'Ashburn', '7.2']) {
        expect(all, leak).not.toContain(leak);
      }
      expect(o.taste && o.taste.headline).toBeTruthy();
      expect((o.withheld || []).map((w) => w.section)).toContain('projects');
    });
  }
  it('the keyless headline describes the match: count, ISO and file date, nothing withheld', async () => {
    const hit = sc(await H.call('/mcp', 'get_interconnection_queue', { mode: 'project', queue_id: 'PJM-C01-1097' }, ANON()));
    expect(hit.taste.headline.name).toBe('matched_queue_projects');
    expect(hit.taste.headline.value).toBe(1);
    expect(hit.taste.headline.text).toBe('1 queue project matched in PJM queue as of 2026-11-24');
    expect(JSON.stringify(hit.taste.headline)).not.toMatch(/UNMEASURED|Homer|C01-1097|3000/);
    const miss = sc(await H.call('/mcp', 'get_interconnection_queue', { mode: 'project', queue_id: 'PJM-ZZ9-999' }, ANON()));
    expect(miss.taste.headline.text).toBe('0 queue projects matched in PJM queue as of 2026-11-24');
    const pt = sc(await H.call('/mcp', 'get_interconnection_queue', { mode: 'project', lat: 39.1157, lon: -77.5636 }, ANON()));
    expect(pt.taste.headline.text).toBe('1 queue project matched in PJM queue as of 2026-11-24');
  });
  it('the same rule as iso=PJM today', async () => {
    const o = sc(await H.call('/mcp', 'get_interconnection_queue', { iso: 'PJM' }, ANON()));
    expect(JSON.stringify(o)).not.toContain('Homer City');
    expect((o.withheld || []).map((w) => w.section)).toContain('projects');
  });
});

describe('execute_plan routes project asks to mode=project', () => {
  it('status of queue project <id>', async () => {
    seen.length = 0;
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'What is the status of queue project PJM-C01-1097?' }, PRO));
    expect(seen.some((s) => s.mode === 'project' && s.queue_id === 'PJM-C01-1097'), JSON.stringify({ seen, cls: o.replay && o.replay.intent_class })).toBe(true);
  });
  it('queue projects near <point>', async () => {
    seen.length = 0;
    await H.call('/mcp', 'execute_plan', { intent: 'Which interconnection queue projects are near 39.1157, -77.5636?' }, PRO);
    expect(seen.some((s) => s.mode === 'project' && Number(s.lat) === 39.1157 && Number(s.lon) === -77.5636), JSON.stringify(seen)).toBe(true);
  });
  it('a depth ask still reads the ISO summary', async () => {
    seen.length = 0;
    await H.call('/mcp', 'execute_plan', { intent: 'How deep is the PJM interconnection queue?' }, PRO);
    expect(seen.some((s) => s.mode === 'project')).toBe(false);
  });
});

describe('frozen ChatGPT profile', () => {
  it('lists no mode=project params', async () => {
    const r = await H.list('/mcp/chatgpt', { 'user-agent': 'dchub-qa-readonly' });
    const t = ((r.msg && r.msg.result && r.msg.result.tools) || []).find((x) => x.name === 'get_interconnection_queue');
    expect(t).toBeTruthy();
    expect(Object.keys(t.inputSchema.properties)).toEqual(['iso']);
  });
  it('/mcp lists them', async () => {
    const r = await H.list('/mcp', PRO);
    const t = r.msg.result.tools.find((x) => x.name === 'get_interconnection_queue');
    expect(Object.keys(t.inputSchema.properties)).toEqual(expect.arrayContaining(['iso', 'mode', 'queue_id', 'name', 'lat', 'lon', 'radius_km']));
  });
});

describe('pure helpers', () => {
  it('queueProjectAsk', () => {
    expect(queueProjectAsk('status of queue project PJM-C01-1097')).toEqual({ queue_id: 'PJM-C01-1097' });
    expect(queueProjectAsk('where is AH1-570 in the PJM queue')).toEqual({ queue_id: 'AH1-570' });
    expect(queueProjectAsk('queue project "Homer City 345 kV" status')).toEqual({ name: 'Homer City 345 kV' });
    expect(queueProjectAsk('queue projects within 5 miles of here', { lat: 39, lon: -77 })).toEqual({ lat: 39, lon: -77, radius_km: 8 });
    expect(queueProjectAsk('data center projects near here', { lat: 39, lon: -77 })).toBe(null);
    expect(queueProjectAsk('How deep is the PJM interconnection queue?')).toBe(null);
    expect(queueProjectAsk('rank markets for a 200 MW AI campus')).toBe(null);
  });
  it('queueProjectQuery and shape', () => {
    expect(queueProjectQuery({ iso: 'PJM' })).toBe(null);
    expect(queueProjectQuery({ mode: 'project', queue_id: 'X', lat: undefined })).toEqual({ mode: 'project', queue_id: 'X' });
    expect(shapeQueueProjectBody({ iso: 'PJM', projects: [{ queue_id: 'x' }] }).error).toBe('project_mode_unavailable');
    const s = shapeQueueProjectBody({ mode: 'project', projects: 'x' });
    expect(s.iso).toBe('ALL');
    expect(s.projects).toEqual([]);
  });
});
