// r-discovery-coverage (2026-08-02): discover_tools is the meta-tool an agent
// calls to learn what DC Hub can do — and at least one platform documented
// "call discover_tools OR tools/list at session start" as its capability-map
// binding rule. On 2026-08-02 those two branches disagreed badly: tools/list
// served 82 tools, the family navigator covered 50, and the 32 it omitted
// included execute_plan (the front door), get_changes (the refresh path),
// the whole composite/hazard/climate layer, and all eleven saved-work tools.
// An agent binding from the wrong branch would silently never see them.
//
// This is the third recurrence of registered-but-unreachable (get_hosting_capacity
// in _PLAN_CLASSES + this table, incentives_tax in _PLAN_CLASSES). The guard
// below is the version that does not depend on anyone remembering: a newly
// registered tool must join a family or claim a written exemption, or the
// build fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _TOOL_FAMILIES_TABLE, _DISCOVERY_EXEMPT } from '../server.mjs';

// The registration call IS the inventory — read the source rather than
// transcribing a list that would drift the same way the table did.
const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const REGISTERED = [...SRC.matchAll(/^\s*trackedTool\(srv, '([a-z_0-9]+)'/gm)].map(m => m[1]);
const familyTools = _TOOL_FAMILIES_TABLE.flatMap(f => f.tools);
const covered = new Set([...familyTools, ...Object.keys(_DISCOVERY_EXEMPT)]);

describe('discover_tools navigation coverage', () => {
  it('reads a plausible registration inventory (guard against a broken regex)', () => {
    // A regex that silently matches nothing would make every assertion below
    // pass vacuously — the empty-parse-passes-all trap.
    expect(REGISTERED.length).toBeGreaterThan(70);
    expect(REGISTERED).toContain('execute_plan');
    expect(REGISTERED).toContain('discover_tools');
    expect(new Set(REGISTERED).size).toBe(REGISTERED.length); // no dup registrations
  });

  it('every registered tool is reachable from a family or holds a written exemption', () => {
    const orphans = REGISTERED.filter(t => !covered.has(t));
    expect(orphans, `registered but undiscoverable — add to a family in _TOOL_FAMILIES_TABLE or document in _DISCOVERY_EXEMPT: ${orphans.join(', ')}`).toEqual([]);
  });

  it('never advertises a tool that is not registered', () => {
    const reg = new Set(REGISTERED);
    const ghosts = [...familyTools, ...Object.keys(_DISCOVERY_EXEMPT)].filter(t => !reg.has(t));
    expect(ghosts, `navigator points at tools that do not exist: ${ghosts.join(', ')}`).toEqual([]);
  });

  it('exemptions state a reason — an exemption is a decision, not a dumping ground', () => {
    for (const [tool, why] of Object.entries(_DISCOVERY_EXEMPT)) {
      expect(typeof why, `${tool} exemption must be a string reason`).toBe('string');
      expect(why.length, `${tool} exemption reason is too thin to review`).toBeGreaterThan(40);
    }
    // Keep the escape hatch small enough that adding to it is conspicuous.
    expect(Object.keys(_DISCOVERY_EXEMPT).length).toBeLessThanOrEqual(8);
  });

  it('the front door is exempt BECAUSE the envelope surfaces it — not because it was forgotten', () => {
    expect(_DISCOVERY_EXEMPT.execute_plan).toBeTruthy();
    expect(_DISCOVERY_EXEMPT.get_changes).toBeTruthy();
    // The envelope must actually carry them, or the exemption is a lie.
    const env = SRC.slice(SRC.indexOf("_entity: 'tool_families'"), SRC.indexOf("_entity: 'tool_families'") + 2200);
    expect(env).toContain('front_door:');
    expect(env).toContain("tool: 'execute_plan'");
    expect(env).toContain("refresh: 'get_changes'");
  });

  it('families are well-formed and carry no duplicate tool across the table', () => {
    for (const f of _TOOL_FAMILIES_TABLE) {
      expect(typeof f.family).toBe('string');
      expect(f.when.length, `${f.family} needs a real when-to-use note`).toBeGreaterThan(20);
      expect(Array.isArray(f.tools) && f.tools.length > 0, `${f.family} has no tools`).toBe(true);
      expect(Array.isArray(f.keywords) && f.keywords.length > 0, `${f.family} has no keywords`).toBe(true);
    }
    const dups = familyTools.filter((t, i) => familyTools.indexOf(t) !== i);
    expect(dups, `same tool listed in two families: ${dups.join(', ')}`).toEqual([]);
  });

  it('the saved-work surface is navigable (it was entirely invisible before)', () => {
    const saved = _TOOL_FAMILIES_TABLE.find(f => f.family === 'saved_work');
    expect(saved, 'saved_work family missing').toBeTruthy();
    for (const t of ['save_site', 'get_shortlist', 'set_site_alert', 'standing_intent', 'subscribe_digest']) {
      expect(saved.tools).toContain(t);
    }
  });

  it('the capabilities partners bind as defaults are all navigable', () => {
    // The 2026-08-02 partner defaults profile bound these by name; each was
    // absent from the navigator when it was written.
    for (const t of ['get_composite_site_score', 'get_disaster_risk', 'get_climate_intel',
                     'get_facility_risk_delta', 'get_market_context', 'predict_market_trajectory',
                     'get_metro_fiber', 'get_pipeline']) {
      expect(covered.has(t), `${t} is bound by partner defaults but unreachable from discover_tools`).toBe(true);
    }
  });

  it('the description no longer carries a hardcoded catalog size', () => {
    const d = SRC.slice(SRC.indexOf("trackedTool(srv, 'discover_tools'"), SRC.indexOf("trackedTool(srv, 'discover_tools'") + 1400);
    // "60+ tools" sat here while the catalog grew to 82 — a number in a
    // description is a number nobody heals.
    expect(/\d+\+?\s*tools/i.test(d), 'discover_tools description hardcodes a tool count again').toBe(false);
  });
});
