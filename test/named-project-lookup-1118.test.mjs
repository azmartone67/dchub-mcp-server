// Named-project lookup (owner note 2026-11-18, feature 4). get_pipeline and search_facilities take name=, the
// planner runs that lookup first on a named-campus ask, and the answer line says what the lookup returned at the
// caller's depth. Record fixtures are trimmed from the backend lookup run read-only against production on
// 2026-11-18 (dchub-backend util/project_lookup.py).
import { describe, it, expect } from 'vitest';
import { _planQuery } from '../server.mjs';
import { namedCampus, namedCampusSequence } from '../lib/plan-entities.mjs';
import { namedLookupFacts, NAMED_WITHHELD } from '../lib/named-project-facts.mjs';
import { factsFromStep } from '../lib/plan-step-facts.mjs';
import { DIRECTORY_HELD_INPUTS } from '../lib/chatgpt-directory.mjs';

const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const args = (p, tool) => p.recommended_sequence.filter((s) => s.tool === tool).map((s) => s.args_hint);

const BEST = {
  record_type: 'facility', record_id: 11377, name: 'Stargate Abilene Phase 1',
  developer: 'Stargate (OpenAI/SoftBank/Oracle)', city: 'Abilene', county: 'Taylor County', state: 'TX',
  stated_mw: 1200.0, mw_basis: 'the MW this DC Hub row records', status: 'Under Construction',
  expected_cod: null, expected_cod_basis: 'no completion date: the source row for this project states none, and DC Hub does not estimate one',
  source_url: 'https://openai.com/index/announcing-the-stargate-project/', as_of: '2026-03-30',
};
const OTHER = { record_type: 'pipeline_project', record_id: 9, name: 'Stargate Abilene Expansion +600MW', developer: 'Oracle/OpenAI',
  state: 'TX', stated_mw: 600.0, mw_basis: 'the MW this pipeline row records', status: 'Under Construction', as_of: '2026-02-10' };
const KEYED = { success: true, name_lookup: { query: 'Stargate Abilene', matched: true, best_match_index: 0, message: null },
  data: [BEST, OTHER], count: 2 };

describe('named-campus detection', () => {
  it.each([
    ['status of Stargate Abilene', 'Stargate Abilene'],
    ["what's happening with Project X", 'Project X'],
    ['what is happening with Project Jupiter in Texas', 'Project Jupiter'],
    ["what's the latest on Crusoe Abilene", 'Crusoe Abilene'],
    ['update on Project Firecracker', 'Project Firecracker'],
    ['What is the status of Zebulon Quartzfield?', 'Zebulon Quartzfield'],
  ])('%s -> %s', (q, name) => {
    expect(namedCampus(q)).toMatchObject({ name });
  });
  it.each([
    'a 200 MW project in Texas with gas',
    'how much power does a project need',
    'status of PJM',
    'status of the interconnection queue in ERCOT',
    "what's happening with Northern Virginia",
    'status of Texas',
    'status of Dallas',
  ])('not a campus: %s', (q) => {
    expect(namedCampus(q)).toBeNull();
  });
});

describe('the planner runs the name lookup first', () => {
  it('status of Stargate Abilene: get_pipeline name= and search_facilities name= lead', () => {
    const p = _planQuery('status of Stargate Abilene', {});
    expect(p.intent_class).toBe('named_campus');
    expect(tools(p).slice(0, 2)).toEqual(['get_pipeline', 'search_facilities']);
    expect(args(p, 'get_pipeline')[0]).toEqual({ name: 'Stargate Abilene' });
    expect(args(p, 'search_facilities')[0]).toEqual({ name: 'Stargate Abilene' });
    expect(tools(p)).toContain('get_market_dcpi_rank');
  });
  it("what's happening with Project X: the lookup runs on the codename", () => {
    const p = _planQuery("what's happening with Project X", {});
    expect(p.intent_class).toBe('named_campus');
    expect(args(p, 'get_pipeline')[0]).toEqual({ name: 'Project X' });
  });
  it('the sequence never reads a market-wide pipeline for a named campus', () => {
    const seq = namedCampusSequence({ name: 'Stargate Abilene', market: { slug: 'abilene', state: 'TX' } });
    expect(seq.filter((s) => s.tool === 'get_pipeline').map((s) => s.args_hint)).toEqual([{ name: 'Stargate Abilene' }]);
  });
});

describe('the answer line', () => {
  it('keyed: the best match with developer, place, status, MW, completion, source and date', () => {
    const [f] = namedLookupFacts('get_pipeline', KEYED);
    expect(f.text).toBe('"Stargate Abilene": best match Stargate Abilene Phase 1 (developer Stargate (OpenAI/SoftBank/Oracle); '
      + 'Abilene, Taylor County, TX; status Under Construction; 1,200 MW stated; no completion date stated; '
      + 'source https://openai.com/index/announcing-the-stargate-project/) (DC Hub name lookup, record as of 2026-03-30). '
      + '1 other matching record is listed beside it.');
    expect(f.as_of).toBe('2026-03-30');
    expect(factsFromStep('get_pipeline', KEYED, { name: 'Stargate Abilene' })[0].text).toBe(f.text);
  });
  it('a preview that nulled the MW says withheld, never a figure and never "not stated"', () => {
    const trimmed = { ...KEYED, data: [{ ...BEST, stated_mw: null }] };
    const [f] = namedLookupFacts('get_pipeline', trimmed);
    expect(f.text).toContain(`MW ${NAMED_WITHHELD}`);
    expect(f.text).not.toMatch(/1,?200/);
  });
  it('the keyless facility view marks MW and completion withheld', () => {
    const free = { ...KEYED, data: [{ ...BEST, stated_mw: undefined, expected_cod: undefined, stated_mw_withheld: true, expected_cod_withheld: true }] };
    delete free.data[0].stated_mw; delete free.data[0].expected_cod;
    const [f] = namedLookupFacts('search_facilities', free);
    expect(f.text).toContain(`MW ${NAMED_WITHHELD}`);
    expect(f.text).toContain(`expected completion ${NAMED_WITHHELD}`);
    expect(f.text).toContain('status Under Construction');
  });
  it('a record that states no MW says so', () => {
    const none = { ...KEYED, data: [{ ...BEST, stated_mw: null, mw_basis: 'no MW stated: the row DC Hub holds for this project states no capacity' }] };
    expect(namedLookupFacts('get_pipeline', none)[0].text).toContain('no MW stated');
  });
  it('no match: the plain sentence', () => {
    const p = { success: true, name_lookup: { query: 'Zebulon Quartzfield', matched: false,
      message: 'No record matches "Zebulon Quartzfield" in DC Hub\'s facility registry or construction pipeline.' }, data: [] };
    expect(factsFromStep('search_facilities', p, {})[0].text)
      .toBe('No record matches "Zebulon Quartzfield" in DC Hub\'s facility registry or construction pipeline (DC Hub name lookup).');
  });
});

describe('the reviewed ChatGPT catalog is unchanged', () => {
  it('name= is held off /mcp/chatgpt on both tools', () => {
    expect(DIRECTORY_HELD_INPUTS.get_pipeline).toContain('name');
    expect(DIRECTORY_HELD_INPUTS.search_facilities).toContain('name');
  });
});
