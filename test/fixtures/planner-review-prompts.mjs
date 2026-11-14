// planner-review-prompts.mjs — regression prompts for execute_plan / plan_query, built from the
// Grok-relayed live agent reviews of 2026-11-13 (Claude, Grok and Mistral each ran DC Hub
// execute_plan). Read by test/planner-526-review-prompts.test.mjs, which is on test/hard-gate.txt,
// so every planner PR runs them.
//
// Each entry names the failure it covers and what the PLAN must look like. `expect` keys:
//   intent_class   the class the plan routes to
//   tools          tool names that must appear in recommended_sequence (any order)
//   lead           the first step's tool
//   not_tools      tool names that must NOT appear
//   per_state      { tool, key, states }: one step of `tool` per state, args_hint[key] = that state
//   steps          [{ tool, args }]: a step of `tool` whose args_hint contains `args` (toMatchObject);
//                  '$months:YYYY-MM' stands for the months from today to that month (the deadline
//                  is counted from the clock, so the fixture names the month, not a number)
//   waits_on_find_sites  tool names that read the market find_sites names (depends on that step)
//                        instead of a '<... named in the intent>' placeholder no step can fill
//   last           the last step's tool
//   state_fanout   the plan's state_fanout.states
//   place_fallback { phrase, state }
//
// The representative prompts below are written to the failures as the review summary described
// them; they are not the reviewers' words.

export const REVIEW_PROMPTS = [
  // ── item 1a: "X or Y" / a list of states -> one set of state-scoped steps per state ──────────
  { id: 'multistate-or-list', failure: 'multi_state',
    prompt: 'Where should I build a 100 MW data center: Texas, Ohio or Georgia?',
    expect: { intent_class: 'market_ranking', state_fanout: ['TX', 'OH', 'GA'],
      per_state: { tool: 'site_selection_canvas', key: 'region', states: ['TX', 'OH', 'GA'] },
      steps: [{ tool: 'site_selection_canvas', args: { capacity_mw: 100 } }] } },
  { id: 'multistate-or-pair', failure: 'multi_state',
    prompt: 'tax incentives in Texas or Ohio for a 50 MW data center',
    expect: { intent_class: 'incentives_tax', state_fanout: ['TX', 'OH'],
      per_state: { tool: 'get_tax_incentives', key: 'state', states: ['TX', 'OH'] } } },
  { id: 'multistate-codes', failure: 'multi_state',
    prompt: 'how soon can a 100 MW load get power in TX, OH or GA?',
    expect: { intent_class: 'capacity_search', state_fanout: ['TX', 'OH', 'GA'],
      per_state: { tool: 'get_refined_queue', key: 'state', states: ['TX', 'OH', 'GA'] } } },
  { id: 'multistate-west-virginia', failure: 'multi_state',
    prompt: 'rank markets for a 200 MW AI campus in Virginia or West Virginia',
    expect: { intent_class: 'market_ranking', state_fanout: ['VA', 'WV'],
      per_state: { tool: 'site_selection_canvas', key: 'region', states: ['VA', 'WV'] } } },

  // ── item 1b: 2+ named ISOs -> compare_isos (aliases, "vs", lower case) ─────────────────────
  { id: 'iso-and', failure: 'two_isos',
    prompt: 'Compare ERCOT and PJM for a 200 MW AI campus',
    expect: { intent_class: 'iso_comparison', lead: 'compare_isos',
      steps: [{ tool: 'compare_isos', args: { isos: 'ERCOT,PJM' } },
              { tool: 'get_grid_intelligence', args: { iso: 'ERCOT' } },
              { tool: 'get_grid_intelligence', args: { iso: 'PJM' } }],
      not_tools: ['get_market_dcpi_rank'] } },
  { id: 'iso-vs-queue', failure: 'two_isos',
    prompt: 'PJM vs MISO interconnection queue for 300 MW',
    expect: { intent_class: 'iso_comparison', lead: 'compare_isos',
      steps: [{ tool: 'compare_isos', args: { isos: 'PJM,MISO' } },
              { tool: 'get_interconnection_queue', args: { iso: 'PJM' } },
              { tool: 'get_interconnection_queue', args: { iso: 'MISO' } }] } },
  { id: 'iso-alias-lowercase', failure: 'two_isos',
    prompt: 'texas grid vs pjm for time to power',
    expect: { intent_class: 'iso_comparison', steps: [{ tool: 'compare_isos', args: { isos: 'ERCOT,PJM' } }] } },
  { id: 'iso-long-names', failure: 'two_isos',
    prompt: 'which is better for a GPU cluster, Southwest Power Pool or ISO New England?',
    expect: { intent_class: 'iso_comparison', steps: [{ tool: 'compare_isos', args: { isos: 'SPP,ISO-NE' } }] } },

  // ── item 1c: a town that is no tracked market -> find_sites by its state ──────────────────
  { id: 'unmatched-town-capacity', failure: 'unmatched_place',
    prompt: 'find 100 MW near Smalltown, Ohio',
    expect: { intent_class: 'capacity_search', place_fallback: { phrase: 'Smalltown', state: 'OH' },
      steps: [{ tool: 'find_sites', args: { state: 'OH' } }],
      waits_on_find_sites: ['get_market_dcpi_rank'] } },
  { id: 'unmatched-town-unknown', failure: 'unmatched_place',
    prompt: 'Is Okemah, Oklahoma any good for a data center?',
    expect: { place_fallback: { phrase: 'Okemah', state: 'OK' },
      steps: [{ tool: 'find_sites', args: { state: 'OK' } }] } },

  // ── item 1d: MW and target year reach the steps that take them ────────────────────────────
  { id: 'mw-by-year-ranking', failure: 'mw_year',
    prompt: 'rank markets in Ohio for 100 MW by Q3 2030',
    expect: { steps: [{ tool: 'site_selection_canvas', args: { region: 'OH', capacity_mw: 100, max_months: '$months:2030-09' } }] } },
  { id: 'mw-in-year-capacity', failure: 'mw_year',
    prompt: 'find 200MW in Dallas in 2030',
    expect: { intent_class: 'capacity_search',
      steps: [{ tool: 'get_retirement_headroom', args: { target_mw: 200, horizon_months: '$months:2030-12' } },
              { tool: 'get_refined_queue', args: { min_mw: 200 } }] } },
  { id: 'mw-by-year-timeline', failure: 'mw_year',
    prompt: '100 MW by 2030 in Ohio power availability',
    expect: { steps: [{ tool: 'get_power_availability_timeline', args: { state: 'OH', mw: 100 } }] } },

  // ── item 2: data-center capacity questions -> pipeline, facilities, listed capacity ───────
  { id: 'capacity-coming-online-submarket', failure: 'dc_capacity',
    prompt: 'How much data center capacity is coming online in Ashburn?',
    expect: { intent_class: 'dc_capacity', lead: 'get_pipeline',
      tools: ['get_pipeline', 'search_facilities', 'source_capacity'],
      steps: [{ tool: 'search_facilities', args: { state: 'VA', city: 'Ashburn' } }],
      last: 'source_capacity' } },
  { id: 'capacity-under-construction', failure: 'dc_capacity',
    prompt: 'What data center capacity is under construction in Dallas?',
    expect: { intent_class: 'dc_capacity', lead: 'get_pipeline',
      steps: [{ tool: 'get_pipeline', args: { country: 'US', status: 'construction' } }],
      tools: ['search_facilities', 'source_capacity'] } },
  { id: 'capacity-available', failure: 'dc_capacity',
    prompt: 'available capacity in Phoenix',
    expect: { intent_class: 'dc_capacity', tools: ['get_pipeline', 'search_facilities', 'source_capacity'] } },
  { id: 'capacity-pipeline-mw-year', failure: 'dc_capacity',
    prompt: 'data center pipeline in Texas for 100 MW by 2030',
    expect: { intent_class: 'dc_capacity',
      steps: [{ tool: 'get_pipeline', args: { expected_completion_before: '2031-01-01' } },
              { tool: 'source_capacity', args: { state: 'TX', min_mw: 100, available_by: '2030-12' } }] } },
];

// Neighbours that must NOT move: the old route is the right one for these.
export const STAY_PROMPTS = [
  { id: 'one-iso-stays-grid', prompt: 'how soon can a 100 MW load get power in ERCOT', expect: { intent_class: 'grid_headroom' } },
  { id: 'two-markets-stay-markets', prompt: 'compare Dallas, Texas vs Phoenix, Arizona', expect: { intent_class: 'market_comparison' } },
  { id: 'power-coming-online-stays-power', prompt: 'where is new power generation coming online in Virginia', expect: { intent_class: 'power_timeline' } },
  { id: 'one-state-no-fanout', prompt: 'rank markets for a 200 MW AI campus in Texas', expect: { intent_class: 'market_ranking', state_fanout: null } },
  // Power coming online is not data-center supply: dc_capacity's patterns match these, and only
  // the no-data-center-noun guard in _planQuery keeps them on the power classes.
  { id: 'generation-capacity-stays-power', prompt: 'how much new generation capacity is coming online in Texas', expect: { intent_class: 'power_timeline' } },
  { id: 'power-capacity-construction-stays-grid', prompt: 'how much power capacity is under construction in Ohio', expect: { intent_class: 'grid_headroom' } },
  { id: 'solar-coming-online-stays-power', prompt: 'solar projects coming online in Arizona', expect: { intent_class: 'power_timeline' } },
  { id: 'gas-plants-construction-stays', prompt: 'gas plants under construction in Texas', expect: { intent_class: 'facility_search' } },
];

// ── SLOT: the three verbatim Nov 13 review prompts (Claude, Grok, Mistral) ─────────────────
// Not available when this file was written (2026-11-14). When they arrive, add one entry per
// reviewer here, prompt copied VERBATIM, with the `expect` the fixed plan must meet. The test
// runs every entry of this array exactly like REVIEW_PROMPTS; an empty array runs nothing.
export const VERBATIM_REVIEW_PROMPTS = [
  // { id: 'verbatim-claude-1113',  failure: '...', prompt: '<verbatim Claude prompt>',  expect: { ... } },
  // { id: 'verbatim-grok-1113',    failure: '...', prompt: '<verbatim Grok prompt>',    expect: { ... } },
  // { id: 'verbatim-mistral-1113', failure: '...', prompt: '<verbatim Mistral prompt>', expect: { ... } },
];
