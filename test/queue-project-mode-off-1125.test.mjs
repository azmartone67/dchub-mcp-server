// queue-project-mode-off-1125.test.mjs — DCHUB_QUEUE_PROJECT_MODE unset (the default): get_interconnection_queue is
// exactly what it was. The schema lists only iso, the description has no mode=project sentence, a stray
// mode=project argument never reaches the backend, and execute_plan does not route a project ask to it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.72' };
const seen = [];
let H, fence;

beforeAll(async () => {
  delete process.env.DCHUB_QUEUE_PROJECT_MODE;
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, b, u) => {
    if (p !== '/api/v1/interconnection-queue/by-iso') return undefined;
    seen.push(Object.fromEntries(u.searchParams.entries()));
    return { status: 200, body: { iso: 'PJM', queued_generation_gw: 373.2, project_count: 1235, projects: [] } };
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('flag off', () => {
  it('schema and description are unchanged', async () => {
    const r = await H.list('/mcp', PRO);
    const t = r.msg.result.tools.find((x) => x.name === 'get_interconnection_queue');
    expect(Object.keys(t.inputSchema.properties)).toEqual(['iso']);
    expect(t.description).not.toContain('mode=project');
  });
  it('a stray mode=project never reaches the backend', async () => {
    seen.length = 0;
    await H.call('/mcp', 'get_interconnection_queue', { iso: 'PJM', mode: 'project', queue_id: 'PJM-C01-1097' }, PRO);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((s) => 'mode' in s || 'queue_id' in s)).toBe(false);
  });
  it('execute_plan does not route a project ask to mode=project', async () => {
    seen.length = 0;
    await H.call('/mcp', 'execute_plan', { intent: 'What is the status of queue project PJM-C01-1097?' }, PRO);
    expect(seen.some((s) => s.mode === 'project')).toBe(false);
  });
});
