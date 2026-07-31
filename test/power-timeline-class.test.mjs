// Shell 2026-07-30 — power_timeline: registered AND routable, and honest.
//
// The register≠routable class has now bitten three times (incentives_tax was
// the third): a tool the planner cannot route to is dead on arrival. These
// tests pin (1) temporal intents actually route here, (2) the published
// anchor intents did NOT move (pattern theft is the failure mode of adding a
// class), and (3) the description keeps the honesty line — supply-side
// signals, never an energize-by promise.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { _PLAN_CLASSES, _STARTER_PACK, _planQuery } from '../server.mjs';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

const cls = _PLAN_CLASSES.find((c) => c.id === 'power_timeline');

function topClass(intent) {
  return _planQuery(intent, {}).intent_class;
}

describe('power_timeline — routable', () => {
  it('class exists and leads with the timeline tool', () => {
    expect(cls).toBeTruthy();
    const seq = cls.sequence({});
    expect(seq[0].tool).toBe('get_power_availability_timeline');
  });

  it('temporal intents route to the class', () => {
    for (const intent of [
      'when can I energize 200 MW in Ohio',
      'timeline for new power coming online in Georgia',
      'how long until there is enough power in Columbus, by 2027?',
    ]) {
      expect(topClass(intent), intent).toBe('power_timeline');
    }
  });

  it('state and mw signals thread into args, never invented', () => {
    const seq = cls.sequence({ state: 'OH', mw: 200 });
    expect(seq[0].args_hint.state).toBe('OH');
    expect(seq[0].args_hint.mw).toBe(200);
    const bare = cls.sequence({});
    expect(String(bare[0].args_hint.state)).toContain('<');
  });
});

describe('power_timeline — no anchor theft', () => {
  it('every published starter-pack anchor keeps its declared routing', () => {
    // The anchor CONTRACT suite covers this in depth; this is the local
    // tripwire: none of the anchors may now score power_timeline on top.
    for (const a of _STARTER_PACK) {
      const intent = a.intent || a.example || a.query;
      if (!intent) continue;
      expect(topClass(intent), intent).not.toBe('power_timeline');
    }
  });

  it('non-temporal grid questions stay with the grid classes', () => {
    for (const intent of [
      'power availability in ERCOT',
      'how much power is available in ERCOT for a 100 MW data center',
      'grid headroom in PJM',
    ]) {
      expect(topClass(intent), intent).not.toBe('power_timeline');
    }
  });
});

describe('power_timeline — honesty line', () => {
  function toolDescription() {
    const at = SRC.indexOf("trackedTool(srv, 'get_power_availability_timeline'");
    const open = SRC.indexOf("'", at + "trackedTool(srv, 'get_power_availability_timeline'".length + 1);
    let i = open + 1, out = '';
    while (i < SRC.length) {
      if (SRC[i] === '\\') { out += SRC[i + 1]; i += 2; continue; }
      if (SRC[i] === "'") break;
      out += SRC[i]; i += 1;
    }
    return out;
  }

  it('description declares signals, never an energize-by promise', () => {
    const d = toolDescription().toLowerCase();
    expect(d).toContain('supply-side signals');
    expect(d).toContain('generation ≠ deliverable load');
    expect(d).toContain('never blended');
    expect(d).not.toContain('guarantee');
    expect(d).not.toMatch(/energize by/);
  });

  it('sequence tools all exist in the catalog', () => {
    // Free-var realness: a sequence naming an unregistered tool is a plan
    // that can never run (the ast-extract lesson, MCP edition).
    const names = new Set(
      [...SRC.matchAll(/trackedTool\(srv, '([a-z_0-9]+)'/g)].map((m) => m[1]));
    for (const s of cls.sequence({ state: 'OH' })) {
      expect(names.has(s.tool), s.tool).toBe(true);
    }
  });

  it('class rationale carries the honesty frame', () => {
    const r = typeof cls.rationale === 'function' ? cls.rationale({}) : cls.rationale;
    expect(String(r).toLowerCase()).toContain('not deliverable load');
  });
});

describe('r-planner-v5.8: reversed-order timing vocabulary (Grok state batch, 2026-07-31)', () => {
  // "timeline for power availability in Virginia for a 100 MW campus" scored
  // power_timeline 2.5 vs grid_headroom 3 and led get_grid_scoreboard{} with
  // a resolvable state sitting in the intent — the forward-order pattern
  // ("power availability timeline") missed the reversed phrasing. Reproduced
  // by probe before fixing.
  it('state-phrased reversed order routes to the timeline with the state resolved', () => {
    const p = _planQuery('timeline for power availability in Virginia for a 100 MW campus');
    expect(p.intent_class).toBe('power_timeline');
    const s1 = p.recommended_sequence[0];
    expect(s1.tool).toBe('get_power_availability_timeline');
    expect(s1.args_hint.state).toBe('VA');
  });

  it('operator-phrased reversed order STAYS on grid_headroom — the ISO boost is the guard', () => {
    // Same reversed vocabulary, but a named OPERATOR: the +1.5 iso context
    // boost keeps grid_headroom ahead (5.5 vs 4.5). This is the by-design
    // rule from the class comment holding WITHOUT a special-case guard here.
    const p = _planQuery('timeline for power delivery in ERCOT for a 100 MW campus');
    expect(p.intent_class).toBe('grid_headroom');
    expect(JSON.stringify(p.recommended_sequence[0])).toContain('ERCOT');
  });

  it('the state-phrased successes from the same batch keep routing here', () => {
    expect(_planQuery('when is new capacity landing in Ohio').intent_class).toBe('power_timeline');
    expect(_planQuery('when can a data center get power in Georgia').intent_class).toBe('power_timeline');
  });
});
