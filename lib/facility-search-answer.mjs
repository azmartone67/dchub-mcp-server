// facility-search-answer.mjs -- planner 5.62: a facility search leads with its facilities.
//
// WHY. Grok answer-quality note (2026-11-23, P4): "Which data center facilities are in the Ashburn market?" ran
// search_facilities, but the answer led with PJM grid figures (queue GW, capacity auction, demand) and named no
// facility: search_facilities had no fact extractor, so the lead fell to the pairing step.
//
// WHAT. buildFacilitySearchAnswer(ctx, executed, fullByEntry): for intent_class facility_search (no named facility, no
// pipeline-status ask: those have their own answers), the headline is the facility line from searchFacilitiesFacts:
// the count kept in the place, up to five facilities with their operators, dated by the newest row date. The place's
// power is one dated sentence after it, said as context, never ahead of the facilities.
// Pure; nothing here throws.

import { factsFromStep, publicFact } from './plan-step-facts.mjs';
import { facilityLeadOn } from './plan-facility-lead.mjs';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const ran = (e) => !!e && (e.status === 'executed' || e.status === 'gated_preview');

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}

export const FACILITY_SEARCH_KIND = 'facility_search';
const POWER_TOOLS = ['get_grid_intelligence', 'get_power_availability_timeline', 'get_energy_prices'];

export function buildFacilitySearchAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'facility_search') return null;
    const ex = Array.isArray(executed) ? executed : [];
    const full = (e) => parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    const search = ex.find((e) => e && e.tool === 'search_facilities' && ran(e));
    if (!search) return null;
    const args = { ...(search.args || {}), ...(ctx.place_label ? { place_label: ctx.place_label } : {}) };
    const f = factsFromStep('search_facilities', full(search) || {}, args)[0];
    if (!f || !f.text) return null;
    const facts = [{ ...f, step: search.step }];
    let powerLine = '';
    const power = ex.find((e) => e && ran(e) && POWER_TOOLS.includes(e.tool));
    if (power) {
      const pf = factsFromStep(power.tool, full(power) || {}, power.args || {})[0];
      if (pf && pf.text) {
        const grid = (power.args && (power.args.iso || power.args.state)) || '';
        powerLine = `Power context${grid ? ` (${grid})` : ''}, not these facilities' own supply: ${pf.text}`;
        facts.push({ ...pf, step: power.step });
      }
    }
    return {
      kind: FACILITY_SEARCH_KIND, requested_mw: null, geography: f.entity || null, verdict: null,
      headline: powerLine ? `${f.text} ${powerLine}` : f.text,
      evidence: facts.map((x) => x.text), not_established: [], as_of: f.as_of || null, relay: null,
      facts: facts.map(publicFact),
      // DCHUB_PLAN_FACILITY_LEAD_V1 (off): the dated citation line every other answer kind carries.
      ...(facilityLeadOn() && f.as_of ? { source: `Source: DC Hub (dchub.cloud), as of ${f.as_of}` } : {}),
    };
  } catch (_e) { return null; }
}
