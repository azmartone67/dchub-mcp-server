// ── get_refined_queue takes a state (execute_plan 5.15) ─────────────────────
//
// Live 2026-11-05, after 5.14: anonymous execute_plan "find 75-100 MW of
// buildable land with power in Southern Nevada" still returned 0 Nevada queue
// rows. The tool took only an ISO, CAISO holds 53 Nevada and 26 Arizona
// projects, and the keyless preview is 3 rows, so the after-the-call NV cut
// kept 0 of 1. The backend now filters by the project's own state
// (dchub-backend, routes/interconnection_queues.py); this side passes it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _planSignals, _execInjectGeo, _EXEC_GEO_ARGS } from '../server.mjs';
import { cutResultToState } from '../lib/siting-scope.mjs';
import { DIRECTORY_HELD_INPUTS } from '../lib/chatgpt-directory.mjs';

const SNV = 'find 75-100 MW of buildable land with power in Southern Nevada';
const SPEC = JSON.parse(readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8'));
const FROZEN = JSON.parse(readFileSync(new URL('./fixtures/chatgpt-toolset.frozen.json', import.meta.url), 'utf8'));

const nvRow = { project_name: 'A', iso: 'CAISO', state: 'NV' };
const azRow = { project_name: 'B', iso: 'CAISO', state: 'AZ' };

describe('the tool declares state; the reviewed ChatGPT catalog does not', () => {
  it('toolspec.json lists state on get_refined_queue', () => {
    const t = SPEC.find((x) => x.name === 'get_refined_queue');
    expect(Object.keys(t.inputSchema.properties)).toContain('state');
  });

  it('state is held off /mcp/chatgpt with developer', () => {
    expect(DIRECTORY_HELD_INPUTS.get_refined_queue).toEqual(['developer', 'state']);
    const tools = Array.isArray(FROZEN) ? FROZEN : (FROZEN.tools || []);
    const f = tools.find((x) => x.name === 'get_refined_queue');
    expect(f).toBeTruthy();
    expect(Object.keys((f.inputSchema || {}).properties || {})).not.toContain('state');
  });
});

describe('execute_plan passes the plan state to the queue', () => {
  it('a Southern Nevada intent sets state=NV', () => {
    expect(_EXEC_GEO_ARGS.get_refined_queue).toEqual({ state: 'state' });
    const a = { min_mw: 100, geocoded_only: true };
    expect(_execInjectGeo('get_refined_queue', a, _planSignals(SNV))).toEqual(['state']);
    expect(a).toEqual({ min_mw: 100, geocoded_only: true, state: 'NV' });
  });

  it('never overwrites a state already bound, and adds none without one', () => {
    const a = { state: 'AZ' };
    expect(_execInjectGeo('get_refined_queue', a, _planSignals(SNV))).toEqual([]);
    expect(a.state).toBe('AZ');
    const b = {};
    expect(_execInjectGeo('get_refined_queue', b, _planSignals('show me 1 GW+ gas projects in the queue'))).toEqual([]);
    expect(b).toEqual({});
  });
});

describe('the after-the-call state cut stands down when the backend filtered', () => {
  it('filters_applied.state = the plan state: rows and totals pass through', () => {
    const res = { results: [nvRow], count_returned: 1, count_total_matching: 53, total_queued_mw: 9000,
      filters_applied: { state: 'NV' } };
    const { result, scope } = cutResultToState('get_refined_queue', res, 'NV');
    expect(result).toBe(res);
    expect(result.count_total_matching).toBe(53);
    expect(scope).toMatchObject({ state: 'NV', kept: 1, filtered_server_side: true });
    expect(scope.basis).not.toMatch(/takes no state/);
  });

  it('a backend that ignored state (no filters_applied.state) is still cut', () => {
    const res = { results: [nvRow, azRow], count_returned: 2, count_total_matching: 200,
      filters_applied: { state: null } };
    const { result, scope } = cutResultToState('get_refined_queue', res, 'NV');
    expect(result.results).toEqual([nvRow]);
    expect(result.count_total_matching).toBeNull();
    expect(scope.filtered_server_side).toBeUndefined();
    expect(scope.basis).toMatch(/takes no state/);
  });

  it('a wider server-side state union is still cut to the plan state', () => {
    const res = { results: [nvRow, azRow], count_returned: 2, filters_applied: { state: 'NV,AZ' } };
    const { result, scope } = cutResultToState('get_refined_queue', res, 'NV');
    expect(result.results).toEqual([nvRow]);
    expect(scope.filtered_server_side).toBeUndefined();
  });
});
