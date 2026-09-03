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
//
// ★★★ 2026-09-03 — THE PREMISE ABOVE IS REFUTED FOR TWO OF THOSE TERMS, and the
// fix was to shrink the set, not the fence. #301 restored `utility` and
// `electricity`; the owner paste landed (the live Smithery blurb is now
// BYTE-IDENTICAL to scripts/smithery_description.txt). Positions in that text:
// electricity 48, utility 65, site selection 786 — all inside the 1,000-char
// window. Two days later, measured live: utility >100 of 162, site selection
// >100 of 187, electricity 14 of 117. Presence was restored; rank was not.
//
// What text CANNOT do, measured three ways:
//   1. `colocation` ranks #1 with ZERO occurrences anywhere in the description.
//   2. Every top-6 winner on `utility` and `site selection` has zero occurrences
//      of the term in BOTH displayName and description — "Developer Utilities"
//      wins utility; netlify and recreation-gov win site selection.
//   3. Smithery's `score` is reciprocal rank fusion over two lists, k=30
//      (fitted 231/240 observations). We do not appear in the fused top-100 for
//      either term, so there is no list position to improve.
//
// So `utility` and `site selection` moved RECLAIM -> WATCH. Leaving them in
// RECLAIM emits a remedy that costs a HUMAN PASTE every time it fires and has
// been measured not to work. The test below pins that they stay out.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

  it('electricity survives the 1000-char search truncation', () => {
    // Was ['electricity', 'utility']. `utility` left RECLAIM on 2026-09-03 — see the
    // header: its rank is not reachable from this file, so pinning its POSITION here
    // would assert that moving the word matters, which is the claim we refuted. It is
    // still IN the description and still tracked (WATCH); it is just no longer fenced
    // as though copy were its remedy. `electricity` stays: still RECLAIM, still the one
    // of the three holding a decodable list position.
    const head = DESC.slice(0, SEARCH_TRUNCATION).toLowerCase();
    for (const t of ['electricity']) {
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

// ★ 2026-09-01 — the LIVE half. Everything above fences this repo against
// itself; nothing fenced it against what Smithery actually SERVES, and those
// have never matched (measured that day, BEFORE any paste: live detail endpoint
// 2,212 chars vs this file's 2,383). The blurb is owner-authored in the UI and
// no repo path writes it, which is why 20 days of `fiber` at #3 went unexplained.
//
// smithery_visible_terms() in registry_monitor.py closes it. These assertions
// pin the two decisions that make it worth having, because both are one token
// away from being silently inverted.
describe('the live term-visibility check keeps its severities straight', () => {
  const FN = MONITOR.slice(MONITOR.indexOf('def smithery_visible_terms('));

  it('exists and is wired into main()', () => {
    expect(MONITOR).toMatch(/def smithery_visible_terms\(/);
    // wiring, not just definition — a helper nothing calls is not a fence.
    expect(MONITOR).toMatch(/_vis_reg,\s*_vis_notes\s*=\s*smithery_visible_terms\(core\)/);
    expect(MONITOR).toMatch(/reasons\.extend\(_vis_reg\)/);
    expect(MONITOR).toMatch(/notes\s*=\s*list\(_prov_notes\)\s*\+\s*list\(_vis_notes\)/);
  });

  // ROUTING, not text. Flipping either append target leaves every string in
  // place and every behavioural check green while destroying the meaning:
  // a slipped-and-unindexed term would stop paging, or a merely-pending paste
  // would start. Assert the SINK.
  //
  // ⚠️ If this is ever refactored to build the message into a variable first
  // (`msg = "…"; regressions.append(msg)`), these regexes FAIL — the safe
  // direction. The correct repair is to keep asserting the SINK (parse the call
  // and check the append target), NEVER to relax back to matching message text.
  it('a slipped AND unindexed term PAGES; a merely-pending paste does not', () => {
    expect(FN).toMatch(/regressions\.append\(\s*\n?\s*f?"Smithery indexes a blurb that never says/);
    expect(FN).toMatch(/notes\.append\(f?"repo->live paste PENDING/);
    expect(FN).toMatch(/notes\.append\(f?"absent from the live window but holding #1/);
  });

  it('an unreadable blurb is an UNKNOWN, never a clean pass', () => {
    // The failure this whole module exists to prevent, one level up: if the
    // live read fails and we return no finding, the surface reads healthy.
    expect(FN).toMatch(/notes\.append\(\s*"Smithery blurb UNREADABLE/);
    expect(FN).toMatch(/blurb is None/);
  });

  it('pins the truncation it reasons about', () => {
    expect(MONITOR).toMatch(/^SMITHERY_SEARCH_CHARS = 1000$/m);
  });
});


// ★★★ 2026-09-03 — KEEP THE REFUTED REMEDY RETIRED.
//
// RECLAIM is not a wish list, it is a promise about a REMEDY: registry_monitor.py
// emits "paste the canonical listing into smithery.ai → Edit" for these terms, and
// that remedy costs a human action every time it fires. `utility` and `site
// selection` were measured unreachable by description text (header). Putting them
// back restarts a paste treadmill against evidence, and it would look like a fix.
describe('terms measured unreachable by copy stay out of the copy-remedy tier', () => {
  const RECLAIM = pyList('RECLAIM').map(t => t.toLowerCase());
  const TRACKED = [...pyList('CORE'), ...pyList('RECLAIM'), ...pyList('WATCH')]
    .map(t => t.toLowerCase());

  it('parses real lists (otherwise every assertion here is vacuous)', () => {
    expect(RECLAIM.length).toBeGreaterThan(3);
    expect(RECLAIM).toContain('electricity');   // the one that DID stay
    expect(TRACKED.length).toBeGreaterThan(20);
  });

  for (const t of ['utility', 'site selection']) {
    it(`${t} is NOT in RECLAIM — copy is not its lever (measured 2026-09-03)`, () => {
      expect(RECLAIM,
        `"${t}" is back in RECLAIM, whose remedy is an owner paste. Measured `
        + '2026-09-03: the paste landed, the term sat inside the indexed window, and '
        + 'rank did not move — while every winner on that query has zero occurrences '
        + 'of it. Re-adding it re-arms a remedy proven not to work.').not.toContain(t);
    });

    it(`${t} is still TRACKED, just not as a copy problem`, () => {
      // Demoting must not become deleting — the 2026-09-01 bug was an UNTRACKED term.
      expect(TRACKED).toContain(t);
    });
  }
});

// ★★★ The ranking model itself, pinned behaviourally.
//
// The 2026-07-12 Spearman model ("score 0.61-0.88 drives rank") sat in this repo
// until 2026-09-03 describing a scoring function that no longer existed — the live
// column now runs 0.014-0.065. Nothing noticed, because nothing ever asserted what
// a score MEANS. These run the real Python against real measured scores.
describe('rrf_decode inverts real Smithery scores', () => {
  const decode = (expr) => execFileSync('python3', ['-c',
    'import importlib.util\n'
    + "spec=importlib.util.spec_from_file_location('rm','scripts/registry_monitor.py')\n"
    + 'm=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n'
    + `print(m.rrf_decode(${expr}))`], { encoding: 'utf8' }).trim();

  // Every value below was READ OFF registry.smithery.ai on 2026-09-03, not constructed.
  it('#1 in both lists (our "data center" score)', () => {
    expect(decode('0.06451612903225806')).toBe('(1, 1)');
  });
  it('#2 and #5 (our "power" score)', () => {
    expect(decode('0.05982142857142857')).toBe('(2, 5)');
  });
  it('ONE list at #16, absent from the other (our "electricity" score)', () => {
    // The finding that retired the copy remedy: a single-list hit cannot be
    // walked up by adding words to a description.
    expect(decode('0.021739130434782608')).toBe('(16,)');
  });
  it('ONE list at #1 (our "colocation" score — a term absent from our copy)', () => {
    expect(decode('0.03225806451612903')).toBe('(1,)');
  });
  it('refuses to decode a score the fusion cannot produce', () => {
    // The tripwire for "the model changed again": silence here is the bug.
    expect(decode('0.5')).toBe('None');
    expect(decode('None')).toBe('None');
    // True is int 1 in Python and reaches the search loops; it decodes to None
    // because 1.0 is not producible by the fusion, NOT because of a type guard —
    // an explicit isinstance(bool) check here was removed after mutation testing
    // showed deleting it changed no behaviour. A guard nothing can violate is not
    // a guard, and a test implying otherwise is worse than no test.
    expect(decode('True')).toBe('None');
  });
  it('pins k, because every decode above is meaningless at another k', () => {
    expect(MONITOR).toMatch(/^RRF_K = 30\b/m);
  });
});
