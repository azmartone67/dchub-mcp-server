/**
 * Recipe-lifecycle emission (2026-07-30, Perplexity round-5).
 *
 * execute_plan runs the whole graph server-side, so it emits BOTH lifecycle
 * events — started and completed — with one gateway-minted execution id.
 * The backend upserts them into recipe_executions; a started row that never
 * completes reads as ABANDONED at the read layer. These tests pin the four
 * properties the design leans on:
 *
 *   1. OUTCOME IS DERIVED, never asserted: completed iff ≥1 step executed
 *      or gated_preview (a gated preview IS a working result — the v2.7.1
 *      preview-as-error lesson), else failed.
 *   2. SKEW SAFETY: lifecycle payloads carry NO `tool` field, so a backend
 *      without the dispatch drops them at its missing-tool return instead
 *      of logging a phantom call into the episode metrics.
 *   3. IDENTITY comes from the session ctx (api_key/platform/client_name_raw/
 *      session_id/user_agent/client_ip) — the same fields every tracked call
 *      carries, so agent-day joins agree across tables.
 *   4. PLACEMENT: started fires before the wave loop, completed fires from
 *      the planner-quality telemetry block, and both carry the same id.
 *
 * Behavioral tests run on the exported pure helpers; placement is pinned on
 * the source (the same discipline as the starter-pack placement tests).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { _recipeOutcome, _recipeLifecyclePayload } from '../server.mjs';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

describe('outcome is derived from what ran (rule 1)', () => {
  it('completed when steps executed', () => {
    expect(_recipeOutcome({ executed: 2, failed: 1 })).toBe('completed');
  });
  it('completed on gated previews alone — previews are working results', () => {
    expect(_recipeOutcome({ gated_preview: 1, failed: 2 })).toBe('completed');
  });
  it('failed when nothing produced a result', () => {
    expect(_recipeOutcome({ failed: 3 })).toBe('failed');
    expect(_recipeOutcome({ skipped_meta: 2, not_run: 1 })).toBe('failed');
    expect(_recipeOutcome({})).toBe('failed');
    expect(_recipeOutcome(null)).toBe('failed');
  });
  it('never invents a third state — abandoned is the READER\'s verdict', () => {
    for (const counts of [{ executed: 1 }, {}, { not_run: 6 }]) {
      expect(['completed', 'failed']).toContain(_recipeOutcome(counts));
    }
  });
});

describe('payload shape (rules 2 + 3)', () => {
  const ctx = {
    platform: 'perplexity', client_name_raw: 'perplexity-desktop',
    api_key: 'dch_live_x', tier: 'identified', session_id: 'sid-1',
    user_agent: 'node', client_ip: '203.0.113.9',
  };

  it('carries event/phase/identity and NO tool field (deploy-skew safety)', () => {
    const p = _recipeLifecyclePayload('started',
      { recipe_execution_id: 'id-1', started_at: 'T0', source: 'execute_plan' }, ctx);
    expect(p.event).toBe('recipe_lifecycle');
    expect(p.phase).toBe('started');
    expect(p.recipe_execution_id).toBe('id-1');
    expect('tool' in p).toBe(false);
    expect('tool_name' in p).toBe(false);
    expect(p.api_key).toBe('dch_live_x');
    expect(p.client_name).toBe('perplexity-desktop');  // raw name wins
    expect(p.session_id).toBe('sid-1');
    expect(p.user_agent).toBe('node');
    expect(p.ip_address).toBe('203.0.113.9');
  });

  it('degrades to anonymous honestly on an empty ctx', () => {
    const p = _recipeLifecyclePayload('completed', { recipe_execution_id: 'x' }, {});
    expect(p.platform).toBe('unknown');
    expect(p.api_key).toBeNull();
    expect(p.session_id).toBeNull();
    expect('tool' in p).toBe(false);
  });

  it('fields never leak across phases — outcome only where the caller put it', () => {
    const started = _recipeLifecyclePayload('started',
      { recipe_execution_id: 'x', started_at: 'T0' }, ctx);
    expect('outcome' in started).toBe(false);
    const done = _recipeLifecyclePayload('completed',
      { recipe_execution_id: 'x', outcome: 'completed' }, ctx);
    expect(done.outcome).toBe('completed');
  });
});

describe('placement in the execute_plan handler (rule 4)', () => {
  // Source pins on load-bearing CODE strings (never comments): the same
  // discipline as the starter-pack placement tests — an emission that
  // exists but sits on the wrong side of the wave loop silently changes
  // what "started" means.
  const handlerAt = SRC.indexOf("trackedTool(srv, 'execute_plan'");
  const startedEmit = SRC.indexOf("_recipeLifecyclePayload('started'", handlerAt);
  const waveLoop = SRC.indexOf('for (const wave of waves)', handlerAt);
  const stepsTelemetry = SRC.indexOf("tool: 'execute_plan_steps'", handlerAt);
  const completedEmit = SRC.indexOf("_recipeLifecyclePayload('completed'", handlerAt);

  it('both emissions live inside the execute_plan handler', () => {
    expect(handlerAt).toBeGreaterThan(-1);
    expect(startedEmit).toBeGreaterThan(handlerAt);
    expect(completedEmit).toBeGreaterThan(handlerAt);
  });

  it('started fires BEFORE the wave loop — absence-after-start is the abandonment signal', () => {
    expect(waveLoop).toBeGreaterThan(-1);
    expect(startedEmit).toBeLessThan(waveLoop);
  });

  it('completed fires with the planner-quality telemetry, after the steps pseudo-call', () => {
    expect(completedEmit).toBeGreaterThan(stepsTelemetry);
  });

  it('both events share the one minted id', () => {
    const handlerSlice = SRC.slice(handlerAt, handlerAt + 40000);
    const mintCount = (handlerSlice.match(/randomUUID\(\)/g) || []).length;
    expect(mintCount).toBe(1);
    const idUses = (handlerSlice.match(/recipe_execution_id: _lcId/g) || []).length;
    expect(idUses).toBe(2);
  });

  it('the completed event heals a dropped started (carries started_at again)', () => {
    const completedSlice = SRC.slice(completedEmit, completedEmit + 800);
    expect(completedSlice).toContain('started_at: _lcStartedAt');
    expect(completedSlice).toContain('outcome: _recipeOutcome(counts)');
    expect(completedSlice).toContain('steps_planned: seq.length');
  });
});
