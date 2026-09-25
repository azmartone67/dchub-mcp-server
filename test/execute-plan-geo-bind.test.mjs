// ── execute_plan v5.13: live verify of mcp#560 (Grok, 2026-09-25) ────────
//
// 1. place_scope bound NO step: "find data center sites near Ashburn for
//    100 MW" ran search_facilities {min_capacity_mw:100} and returned
//    Frankfurt and New Mexico.
// 2. the 1.2 KB JSON-prefix fallback still fired on 7 steps.
// 3. guard: the fallback dropped machine_pay, auto_trial_key, persist_command,
//    retry_*, first_call_nudge; structured slimming cut
//    machine_pay.covered_tools 13 -> 5; the canvas synthesis was dropped.
// 4. "sites in Fairfax County for 50 MW" bound nothing and minted iso ERCOT.
// 5. "Ashburn and Secaucus" hit the 100 km radius cap (needs ~175).
// 6. /mcp/chatgpt must strip commerce from slimmed step output too.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _slimStepResult, _slimStepText, _planSignals, _planCorridor, _EXEC_GEO_ARGS,
  _execInjectGeo, _execConstraintIsoSet } from '../server.mjs';
import { scrubToolResult } from '../lib/chatgpt-directory.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const SPEC = JSON.parse(readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8'));
const PROPS = Object.fromEntries(SPEC.map((t) => [t.name,
  Object.keys(((t.inputSchema || t.input_schema || {}).properties) || {})]));

describe('1. the plan geography reaches every step that accepts it', () => {
  it('_EXEC_GEO_ARGS names only arguments each tool really accepts (pinned to toolspec.json)', () => {
    for (const [tool, spec] of Object.entries(_EXEC_GEO_ARGS)) {
      expect(PROPS[tool], `${tool} is not in toolspec.json`).toBeTruthy();
      if (spec.point) {
        expect(PROPS[tool]).toContain('lat');
        expect(PROPS[tool]).toContain('lon');
      }
      if (spec.radius) expect(PROPS[tool]).toContain('radius_km');
      if (spec.state) expect(PROPS[tool]).toContain(spec.state);
    }
  });

  it('every toolspec tool with a point or state argument is either mapped or deliberately left out', () => {
    const LEFT_OUT = new Set(['execute_plan', 'save_site', 'register_standing_intent', 'generate_site_analysis']);
    for (const [tool, props] of Object.entries(PROPS)) {
      const geo = props.includes('lat') || props.includes('state');
      if (geo && !LEFT_OUT.has(tool)) expect(_EXEC_GEO_ARGS[tool], tool).toBeTruthy();
    }
  });

  it('Ashburn: search_facilities gets the state; find_sites gets the point, radius and state', () => {
    const sig = _planSignals('find data center sites near Ashburn for 100 MW');
    const a = { min_capacity_mw: 100 };
    expect(_execInjectGeo('search_facilities', a, sig)).toEqual(['state']);
    expect(a).toEqual({ min_capacity_mw: 100, state: 'VA' });
    const b = {};
    expect(_execInjectGeo('find_sites', b, sig)).toEqual(['lat', 'lon', 'radius_km', 'state']);
    expect(b).toEqual({ lat: 39.0438, lon: -77.4874, radius_km: 10, state: 'VA' });
  });

  it('never overwrites what was already bound, and leaves unmapped tools alone', () => {
    const sig = _planSignals('sites in the Loudoun–Prince William corridor');
    const a = { lat: 1, lon: 2, state: 'TX' };
    expect(_execInjectGeo('find_sites', a, sig)).toEqual([]);
    expect(a).toEqual({ lat: 1, lon: 2, state: 'TX' });
    const b = {};
    expect(_execInjectGeo('rank_markets', b, sig)).toEqual([]);
    expect(b).toEqual({});
  });

  it('execute_plan calls it on both the wave path and the retry path, and records geo_injected', () => {
    expect(SRC.match(/_execInjectGeo\(s\.tool, (args|r2\.args), _sig\)/g)).toHaveLength(2);
    expect(SRC).toContain('geo_injected: geo');
  });
});

const ROW = (i) => ({ project: 'P' + i, mw: 100 + i, notes: 'n'.repeat(300) });
const QUEUE_STEP = {
  ok: true,
  projects: Array.from({ length: 60 }, (_, i) => ROW(i)),
  machine_pay: { price_usd: 0.5, covered_tools: Array.from({ length: 13 }, (_, i) => 'tool_' + i),
    how: 'Set mpp_pay:true on the call' },
  auto_trial_key: 'dch_trial_abc123',
  persist_command: 'claude mcp add dchub --header "X-API-Key: dch_trial_abc123"',
  retry_after: 'UTC midnight',
  retry_instructions: 'retry with the key in X-API-Key',
  first_call_nudge: 'Tip: ' + 'z'.repeat(900),
  for_your_human: { line: '→ For your human: https://dchub.cloud/go/c/abc.def', url: 'https://dchub.cloud/upgrade/h/tok' },
  synthesis: { locked: true, message: 'm'.repeat(2500), unlock: { url: 'https://dchub.cloud/upgrade?tool=site_selection_canvas' } },
};
const PROTECTED = ['machine_pay', 'auto_trial_key', 'persist_command', 'retry_after', 'retry_instructions', 'for_your_human'];

describe('2 + 3. always structured; protected fields never cut or dropped', () => {
  it('no preview string, rows_total always present', () => {
    const s = _slimStepResult(QUEUE_STEP, 'get_interconnection_queue');
    expect(s.preview).toBeUndefined();
    expect(s.truncation.basis).toBe('structured');
    expect(s.truncation.rows_total).toBeDefined();
    expect(s.truncation.rows_total.projects).toBe(60);
    expect(s.projects.length).toBeLessThanOrEqual(5);
  });

  it('every protected field is byte-identical', () => {
    const s = _slimStepResult(QUEUE_STEP, 'get_interconnection_queue');
    for (const k of PROTECTED) expect(JSON.stringify(s[k]), k).toBe(JSON.stringify(QUEUE_STEP[k]));
    expect(s.machine_pay.covered_tools).toHaveLength(13);
    expect(JSON.stringify(s.synthesis.unlock)).toBe(JSON.stringify(QUEUE_STEP.synthesis.unlock));
    expect(s.synthesis.locked).toBe(true);                  // the canvas synthesis is not dropped
    expect(s.first_call_nudge).toBeDefined();               // kept (cut, not dropped)
  });

  it('a payload too big for any structured pass still comes back structured, flagged', () => {
    const giant = { ok: true, a: Array.from({ length: 400 }, (_, i) => ({ k: i, v: 'x'.repeat(90) })),
      b: Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['f' + i, 'y'.repeat(99)])) };
    const s = _slimStepResult(giant, 'x');
    expect(s.preview).toBeUndefined();
    expect(s.truncation.basis).toBe('structured');
    expect(s.truncation.over_budget).toBe(true);
    expect(Array.isArray(s.a)).toBe(true);
  });

  it('the fallback code path is gone', () => {
    expect(SRC).not.toMatch(/JSON\.stringify\(rest\)\.slice\(0, previewChars\)/);
  });
});

describe('4 + 5. counties bind; the radius covers far-apart places', () => {
  it('"sites in Fairfax County for 50 MW" binds VA and cannot mint ERCOT', () => {
    const sig = _planSignals('sites in Fairfax County for 50 MW');
    expect(sig.placeScope.places).toEqual(['Fairfax County, VA']);
    expect(sig.stateFromPlace).toBe('VA');
    expect(_execConstraintIsoSet('sites in Fairfax County for 50 MW', {}, sig)).not.toContain('ERCOT');
  });

  it('Hudson County binds NJ; Middlesex County only beside New Jersey', () => {
    expect(_planCorridor('Hudson County data centers').state).toBe('NJ');
    expect(_planCorridor('Middlesex County, Massachusetts land')).toBeNull();
    expect(_planCorridor('Middlesex County, New Jersey land').places).toEqual(['Middlesex County, NJ']);
    expect(_planCorridor('Piscataway and Middlesex County').places)
      .toEqual(['Piscataway, NJ', 'Middlesex County, NJ']);
  });

  it('"Ashburn and Secaucus" gets a radius that reaches both (~175 km, not capped at 100)', () => {
    const c = _planCorridor('compare sites in Ashburn and Secaucus');
    expect(c.radius_km).toBeGreaterThan(150);
    expect(c.radius_km).toBeLessThanOrEqual(300);
  });
});

describe('6. /mcp/chatgpt strips commerce out of slimmed step output', () => {
  it('no /go, /upgrade/h, machine_pay, auto_trial_key, persist_command or key reaches the directory', () => {
    const slim = _slimStepResult(QUEUE_STEP, 'get_interconnection_queue');
    const text = _slimStepText(Array.from({ length: 300 }, (_, i) => 'row ' + i + ' ' + 'p'.repeat(40)).join('\n')
      + '\n→ **For your human:** open https://dchub.cloud/go/c/cHJv.abc — unlock it');
    const envelope = { ok: true, executed: [
      { step: 1, tool: 'get_interconnection_queue', status: 'executed', result: slim },
      { step: 2, tool: 'site_selection_canvas', status: 'gated_preview', result: text },
      // Key-level rule on its own: values the text scrub would not catch.
      { step: 3, tool: 'get_facility', status: 'executed', result: { name: 'X',
        persist_command: 'claude mcp add dchub https://dchub.cloud/mcp',
        machine_pay: { covered_tools: ['get_facility'] }, auto_trial_key: 'abc' } },
    ] };
    const out = scrubToolResult({ content: [{ type: 'text', text: JSON.stringify(envelope) }],
                                  structuredContent: envelope });
    const all = JSON.stringify(out);
    for (const bad of ['/go/c/', '/upgrade/h/', 'machine_pay', 'auto_trial_key', 'persist_command',
                       'dch_trial_', 'for_your_human', 'For your human', 'X-API-Key', 'retry_instructions'])
      expect(all, bad).not.toContain(bad);
    // …and the data survived
    expect(all).toContain('"project":"P0"');
  });
});
