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

// ★ 2026-09-01 — THE SECOND HALF OF THE SAME MECHANISM.
//
// The fence above pins `electricity` and `utility` to the visible window because
// those two were the ones caught by hand. Measured the same day against the live
// search API, 13 of the 21 monitored terms sat PAST that window — among them
// `fiber` (character 1,932) and `interconnection queue` (1,104), which are
// exactly the two CORE terms registry_monitor.py had escalated. `fiber` held
// rank #3 for 313 consecutive 90-minute cycles — about twenty days — while the
// word sat in this file the entire time, 900+ characters past anything Smithery
// reads. #252 has the same shape: it added ERCOT/PJM to "name the ISOs we rank
// >50 for" at characters 1,154-1,161, and none of it was ever indexed.
//
// THE RULE IS NOT "every monitored term must appear". The scope note above
// explains why that would encode a requirement the evidence contradicts, and
// that reasoning still stands — `datacenter` is absent here and still ranks #1.
//
// The rule is: a term this copy ALREADY SPENDS WORDS ON must sit where those
// words are read. Invisible presence is the defect; it costs the writer's
// attention and the file's length and buys nothing. Absence is a deliberate
// choice, presence past the cut is an accident every time.
//
// WHAT IS DELIBERATELY *NOT* ASSERTED: file length. The detail endpoint returns
// the full text, so a long file is correct, and the honesty content below the
// fold (the deadman URL, the DCGI withdrawal/restoration record) belongs there.
// A cap on the FILE would delete that. Only the POSITION of ranking terms is
// fenced.
describe('a monitored term this description already carries sits inside the visible window', () => {
  const MONITORED = [...pyList('CORE'), ...pyList('RECLAIM')];
  const MARGIN = 100;

  it('parses a real term list and a real cut (otherwise everything below is vacuous)', () => {
    expect(SEARCH_TRUNCATION).toBe(1000);
    expect(MONITORED.length).toBeGreaterThan(15);
  });

  it('no monitored term is present in the file but past the truncation', () => {
    const low = DESC.toLowerCase();
    const invisible = MONITORED
      .map(t => [t, low.indexOf(t.toLowerCase())])
      .filter(([, at]) => at >= SEARCH_TRUNCATION)
      .map(([t, at]) => `${t} @${at}`);
    expect(invisible, 'present in scripts/smithery_description.txt but past the '
      + `${SEARCH_TRUNCATION}-char search truncation, so Smithery never indexes `
      + 'them — move them earlier or cut them').toEqual([]);
  });

  it('leaves headroom, because the canon healer rewrites quantities in place', () => {
    // daily-manifest-sync.yml rewrites 20,100+ / 2,000+ / 300+ / 170+ inside THIS
    // file. A term sitting at 998 is one quantity-growth away from falling off the
    // cut with no human edit at all. Fail while there is still room to fix it.
    const low = DESC.toLowerCase();
    const visible = MONITORED
      .map(t => low.indexOf(t.toLowerCase()))
      .filter(at => at >= 0 && at < SEARCH_TRUNCATION);
    const last = Math.max(...visible);
    expect(last, `the last visible monitored term sits at ${last}; keep it below `
      + `${SEARCH_TRUNCATION - MARGIN} so a canon quantity rewrite cannot push it `
      + 'past the cut').toBeLessThan(SEARCH_TRUNCATION - MARGIN);
  });
});
