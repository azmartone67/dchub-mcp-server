// Guard: a Smithery description edit must not silently drop a term we rank on.
//
// WHY THIS EXISTS (2026-09-01). Measured live against
// registry.smithery.ai/servers?q=…&pageSize=20:
//
//   utility      rank 1 (2026-08-26)  ->  >20 of 162
//   electricity  rank 1 (2026-08-26)  ->   18 of 117
//
// `utility` had been removed from scripts/smithery_description.txt entirely,
// and `electricity` had been demoted from the lead sentence to a single
// mid-document mention at character 1,001. Every other measured term held #1.
//
// Nothing caught it. scripts/registry_monitor.py tracks CORE + RECLAIM + WATCH
// and `utility` was in NONE of the three, so a fall from #1 to off-page was
// invisible. rank_defense_master_shell.sh DOES check that a slipped term is
// present in the canonical text — but only for terms already flagged as
// slipped, i.e. only after the monitor notices, which for `utility` it never
// could.
//
// SCOPE — deliberately narrow. This does NOT assert that every monitored term
// appears in the description: `datacenter`, `power grid`, `grid interconnection`
// and `renewables` are all absent from it and all still rank #1, winning off
// displayName, smithery.yaml keywords and tool names. Asserting presence for
// those would encode a requirement the evidence contradicts.
//
// It asserts RECLAIM only, because registry_monitor.py defines RECLAIM as the
// set whose documented remedy IS description text ("structural gaps to reclaim
// with description text, not popularity caps"). For that set, and only that
// set, presence in the description is the stated fix.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const DESC = readFileSync('scripts/smithery_description.txt', 'utf8');
const MONITOR = readFileSync('scripts/registry_monitor.py', 'utf8');

// Smithery's list/search API truncates `description` to exactly 1000 chars —
// verified 2026-09-01: the live blurb ended mid-sentence at "Grid / ISO — live",
// one character before the word "electricity". The detail endpoint returns the
// full 2,212. So text past 1000 is absent from the search result a human reads.
const SEARCH_TRUNCATION = 1000;

function pyList(name) {
  const m = MONITOR.match(new RegExp(`^${name} = (\\[[\\s\\S]*?\\])`, 'm'));
  if (!m) throw new Error(`${name} not found in registry_monitor.py`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

describe('smithery canonical description keeps the terms we reclaim with it', () => {
  it('every RECLAIM term appears in the canonical description', () => {
    const missing = pyList('RECLAIM').filter(
      t => !DESC.toLowerCase().includes(t.toLowerCase()));
    expect(missing, `RECLAIM terms absent from scripts/smithery_description.txt: ${missing.join(', ')}`).toEqual([]);
  });

  it('utility and electricity survive the 1000-char search truncation', () => {
    // Both regressed while sitting past (or absent from) the visible window.
    const head = DESC.slice(0, SEARCH_TRUNCATION).toLowerCase();
    for (const t of ['electricity', 'utility']) {
      expect(head.includes(t), `"${t}" must appear within the first ${SEARCH_TRUNCATION} chars — Smithery's search API shows no more than that`).toBe(true);
    }
  });

  it('utility is tracked by the rank monitor at all', () => {
    // The second half of the 2026-09-01 bug: the term was in no list, so no
    // amount of monitoring could have reported the slip.
    const tracked = [...pyList('CORE'), ...pyList('RECLAIM'), ...pyList('WATCH')]
      .map(t => t.toLowerCase());
    expect(tracked).toContain('utility');
  });
});
