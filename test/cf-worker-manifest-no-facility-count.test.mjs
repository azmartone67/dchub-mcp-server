// =============================================================================
// A canon-derived facility COUNT must not be baked into the CF worker manifest.
// -----------------------------------------------------------------------------
// scripts/sync_cf_worker_manifest.py rebuilds the out-of-repo `dchubapiproxy`
// worker's MCP_FALLBACK_TOOLS from the LIVE tools/list, description by
// description. Three of those descriptions — why_dchub, search_facilities,
// semantic_search — are not written as literals anywhere: dchub-backend builds
// them through canon_text("{canon_facilities}") (routes/mcp_tool_catalog.py), so
// the number is a placeholder that re-reads canon on EVERY tools/list and the
// live surface is right by construction.
//
// Baking the RENDERED text is what breaks that. worker.js imports no canon and
// ships by a manual Cloudflare dashboard paste, so a number that tracked
// upstream becomes a literal frozen for as long as the paste lasts — on the
// manifest agents and registries discover us through, which is the worst place
// in the system to freeze a number.
//
// dchub-backend #4635 removed the three by hand and fenced them in
// tests/test_wellknown_manifest_version_derived.py::
// test_fallback_tool_descriptions_carry_no_facility_count. A HAND REMOVAL DOES
// NOT SURVIVE A RE-SYNC: the very next run of this script bakes them straight
// back and turns that fence red, with no commit responsible. So the removal has
// to happen at the bake, and this file is what holds it there.
//
// ★ WHAT IT MUST NOT DO is half the subject, and it is the same rule
// cf-worker-manifest-sync.test.mjs already enforces for the "NN tools" rewrite:
// move only what goes stale. why_dchub carries "21,900+ facilities + 330,000+
// mapped power/grid/gas/fiber assets" — two magnitudes four words apart, one
// canon-derived and one hand-written prose that tracks nothing. A scrub that
// takes both is not a narrower bug than one that takes neither; it silently
// rewrites copy. So every control below asserts BOTH directions, and the
// must-keep table is longer than the must-strip one.
//
// ★ EVERY CONTROL MUST BE ABLE TO FAIL. The end-to-end block runs the real
// main() twice — once as committed, once through a COPY with the scrub call
// removed — and asserts the RED before it asserts the green, having first
// checked that the mutation landed in the source at all.
//
// ★ NO NETWORK, and no second harness. test/helpers/run_cf_manifest_sync.py
// already stubs exactly one function (`_fetch_live_tools`) and runs the shipped
// main() for everything else; this file feeds it REAL descriptions through
// SYNC_TOOLS_JSON rather than standing up a stub of its own.
// =============================================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Every write below goes through this helper. smithery-canon-guard's static
// write-scan flags any test file that so much as names the fs write functions —
// it cannot tell os.tmpdir() from the working tree — and routing through here is
// the fix, never an exemption.
import { createScratchRepo } from './helpers/repo-sandbox.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'scripts', 'sync_cf_worker_manifest.py');
const RUNNER = path.join(REPO, 'test', 'helpers', 'run_cf_manifest_sync.py');

// The backend fence's pattern, character for character. It is COPIED, not
// re-derived: this file's whole claim is that what the scrub leaves behind is
// what that fence accepts, and a paraphrase here would let the two drift into a
// scrub that runs and still ships red.
const FENCE = /\d{1,3}(?:,\d{3})+\+?\s*(?:[a-z][a-z-]*\s+){0,4}facilit\w*/;
// Any comma-grouped magnitude at all, facility or not — used to prove the
// must-keep half by counting what SURVIVED, not by eyeballing a sentence.
const MAGNITUDE = /\d{1,3}(?:,\d{3})+\+?/g;

// The one line the must-fail control removes: the bake site itself. Pinned whole
// rather than as the bare call, because the script names the scrub TWICE — once
// there and once in main() to report what it dropped — and a mutation that could
// land on either is a mutation that proves neither.
const BAKE_CALL = 'json.dumps(_scrub_facility_magnitude(t["description"])),';
const BAKE_CALL_MUTATED = 'json.dumps(t["description"]),';

// ── the pure predicate, straight out of the script ───────────────────────────
const PY_BRIDGE = [
  'import json, sys',
  'sys.path.insert(0, "scripts")',
  'from sync_cf_worker_manifest import _scrub_facility_magnitude as scrub',
  'json.dump([scrub(s) for s in json.load(sys.stdin)], sys.stdout)',
].join('\n');

const scrubAll = (inputs) => JSON.parse(execFileSync('python3', ['-c', PY_BRIDGE], {
  cwd: REPO, input: JSON.stringify(inputs), encoding: 'utf8',
}));
const scrub = (s) => scrubAll([s])[0];

// ── the three sentences as the LIVE surface renders them today ───────────────
// Quoted here rather than read out of toolspec.json on purpose: this is the
// must-strip half's non-vacuity, and a corpus later regenerated clean must not
// quietly turn it into a control over an empty set.
const LIVE = {
  search_facilities:
    'Search 21,900+ global data center facilities across 170+ countries — by location.',
  semantic_search:
    "retrieval across DC Hub's industry news, M&A deals, 21,900+ discovered facilities, and per-market DCPI deep-dive analysis narratives",
  why_dchub:
    'CC-BY-4.0 citation rights on DCPI scores & grid analysis, 21,900+ facilities + 330,000+ mapped power/grid/gas/fiber assets) each with a proof URL',
};

const MUST_STRIP = {
  ...LIVE,
  'no plus sign': 'Covers 21,900 facilities today.',
  'an approximator': 'Roughly ~21,900+ facilities are indexed.',
  'four words of distance': '12,650+ verified global data center facilities.',
  // The reason the scrub runs to a FIXED POINT. The fence looks four words back,
  // so removing the second magnitude pulls the first inside its reach and a
  // single pass would leave a string the fence still calls red.
  'a magnitude dragged into reach by the removal':
    'Ledger of 1,234+ audits and 21,900+ facilities in one clause.',
};

const MUST_KEEP = [
  // Every non-facility magnitude on the live surface today, tool by tool.
  ['list_transactions', '2,200+ tracked deals (2019-present), each with its disclosed value'],
  ['why_dchub (the assets half)', '330,000+ mapped power/grid/gas/fiber assets'],
  ['get_global_power', '182,000+ geolocated units across 170+ countries'],
  ['get_hosting_capacity', '278,799 published records across 18 utilities'],
  ['get_refined_queue', 'the US ISO interconnection queue (~5,300 projects, 7 ISOs, ~1,744 GW)'],
  ['get_gas_index', 'scored ~0 for every state (122 -> 17,571 segments now counted)'],
  ['unlock_more_data', 'Cheapest start: $10 one-time = 1,000 API credits (no subscription)'],
  ['claim_free_key', '2,586 redemptions from only 169 distinct agents'],
  // A facility noun with no magnitude in front of it is not a count.
  ['the noun alone', 'corpus subset of news_articles,deals,discovered_facilities,market_narratives'],
  ['an ungrouped number', 'Search facilities across 170+ countries'],
  // A magnitude five words away is outside the fence, so it is outside the
  // scrub. The two boundaries are the same boundary, or this file is wrong.
  ['five words away', '1,000 of the newly added and verified global data center facilities'],
];

describe('the scrub drops a facility count and nothing else', () => {
  it('has a runnable python and a reachable predicate (not a skip)', () => {
    // "python3 was missing" and "the predicate agreed" are different facts, and
    // only one of them is evidence.
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(() => execFileSync('python3', ['--version'], { stdio: 'ignore' })).not.toThrow();
    expect(scrub('untouched'), 'the bridge did not reach the real function').toBe('untouched');
  });

  it('the fence really fires on every must-strip input (non-vacuity)', () => {
    // Without this, "gone after" below would pass on strings the fence never
    // objected to in the first place.
    for (const [label, text] of Object.entries(MUST_STRIP)) {
      expect(FENCE.test(text),
        `${label}: the fence does not object to this, so scrubbing it proves nothing`).toBe(true);
    }
  });

  it.each(Object.entries(MUST_STRIP))('strips the count but keeps the noun: %s', (label, text) => {
    const out = scrub(text);
    expect(FENCE.test(out),
      `${label}: the fence still reads a facility count in ${JSON.stringify(out)}`).toBe(false);
    expect(out, `${label}: the facility noun was deleted along with the number`).toMatch(/facilit/);
    expect(out.length, `${label}: nothing was removed at all`).toBeLessThan(text.length);
  });

  it.each(MUST_KEEP)('leaves a non-facility magnitude byte-identical: %s', (label, text) => {
    expect(scrub(text),
      `${label}: this magnitude tracks nothing upstream — rewriting it is the script inventing copy`)
      .toBe(text);
  });

  it('keeps the assets magnitude that sits FOUR WORDS from the facility one', () => {
    // The sharpest case in the corpus, called out on its own because a blunter
    // scrub passes every other control in this file and fails here.
    const out = scrub(LIVE.why_dchub);
    expect(out).toContain('330,000+ mapped power/grid/gas/fiber assets');
    expect(out).not.toContain('21,900');
    expect(out).toContain('facilities + 330,000+');
  });

  it('is idempotent — a second pass changes nothing', () => {
    // The script is documented "safe to re-run", and a scrub that nibbled on
    // each run would walk copy off over successive pastes.
    const once = scrubAll(Object.values(MUST_STRIP));
    expect(scrubAll(once)).toEqual(once);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The committed toolspec.json is what refresh-toolspec.mjs last read off the
// LIVE tools/list, so it is the closest thing in this repo to the corpus this
// script will actually bake. The claim is a DIFFERENCE, not a count: the only
// magnitudes that move are the ones the fence objects to.
// ─────────────────────────────────────────────────────────────────────────────
describe('against the committed live tool surface', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(REPO, 'toolspec.json'), 'utf8'));
  const before = spec.map((t) => t.description || '');
  const after = scrubAll(before);

  it('read a corpus with magnitudes in it (non-vacuity)', () => {
    expect(spec.length).toBeGreaterThan(50);
    const nonFacility = before.filter((d) => MAGNITUDE.test(d) && !FENCE.test(d));
    expect(nonFacility.length,
      'no NON-facility magnitude left in the corpus — the must-keep claim here is about nothing')
      .toBeGreaterThan(3);
  });

  it('moves a description only when the fence objects to it', () => {
    const moved = spec.filter((t, i) => after[i] !== before[i]).map((t) => t.name).sort();
    const objected = spec.filter((t) => FENCE.test(t.description || '')).map((t) => t.name).sort();
    expect(moved).toEqual(objected);
  });

  it('leaves every surviving description clean of a facility count', () => {
    expect(spec.filter((t, i) => FENCE.test(after[i])).map((t) => t.name)).toEqual([]);
  });

  it('removes nothing but facility counts, across the whole corpus', () => {
    // Counted, not read: every comma-grouped magnitude is either still there
    // afterwards, or it belonged to a description the fence objected to.
    for (let i = 0; i < spec.length; i++) {
      const had = before[i].match(MAGNITUDE) || [];
      const has = after[i].match(MAGNITUDE) || [];
      if (!FENCE.test(before[i])) {
        expect(has, `${spec[i].name}: a magnitude moved with no facility count to explain it`)
          .toEqual(had);
      } else {
        expect(has.length, `${spec[i].name}: the fence objected but nothing was removed`)
          .toBeLessThan(had.length);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// END TO END, through the shipped main(): a real worker on stdin, the real
// comment-aware scan, the real bake. A unit test of the predicate cannot see the
// bake — and the bake is the thing that has been putting the literals back.
// ─────────────────────────────────────────────────────────────────────────────
describe('the rebuilt worker carries no baked facility count', () => {
  let box, source, synced, unscrubbed, served;

  // Two synthetic tools ride along with the real corpus so this block stays
  // non-vacuous whatever toolspec.json is regenerated to later.
  const HAZARD = {
    name: 'zz_chained_magnitudes',
    description: 'Ledger of 1,234+ audits and 21,900+ facilities in one clause.',
    inputSchema: { type: 'object', properties: {} },
  };
  const KEEPER = {
    name: 'zz_keeps_its_numbers',
    description: 'Covers 2,200+ tracked deals, 330,000+ mapped power/grid/gas/fiber assets and 1,000 API credits.',
    inputSchema: { type: 'object', properties: {} },
  };

  // ── the fixture worker ──────────────────────────────────────────────────────
  // HISTORY is a COMMENT and carries a facility magnitude: #435 established that
  // counts in comments are the worker's record of what was true on a date, and
  // this scrub does not get to edit that either. SERVED is a hand-written string
  // the worker hands to clients: its "83 tools" is rewritten (that is #435's
  // job, unchanged) and its "2,200+ tracked deals" is not (that is this file's).
  const HISTORY = " * v4.4.2: /.well-known/mcp.json returned 12,650+ facilities across 72 tools.";
  const SERVED = "  description: 'DC Hub — 83 tools, 2,200+ tracked deals, 12,650+ facilities.',";
  const WORKER = [
    '/**',
    HISTORY,
    ' */',
    "const WORKER_VERSION = '4.9.68-capacity-terms';",
    'const MCP_SERVER_INFO = {',
    "  name: 'DC Hub',",
    SERVED,
    '};',
    "// ★ Keep this array's length in step with the count above — that branch's",
    '//   fallback is what registries read when the origin is down.',
    'const MCP_FALLBACK_TOOLS = [',
    '  { name: "stale_tool", description: "Search 12,650+ global data center facilities.", inputSchema: {"type":"object"} }',
    ']',
    'export default { async fetch(req, env) { return new Response("ok"); } };',
    '',
  ].join('\n');

  /** Run the shipped main() over the fixture; {exit, out, err}. */
  const runSync = (scriptPath) => {
    const r = spawnSync('python3', [RUNNER, String(served.length), '--version', '9.9.9-scrub-test'], {
      cwd: REPO, input: WORKER, encoding: 'utf8',
      env: {
        ...process.env,
        SYNC_TOOLS_JSON: path.join(box.root, 'tools.json'),
        ...(scriptPath ? { SYNC_SCRIPT: scriptPath } : {}),
      },
    });
    if (r.status !== 0) throw new Error(`runner did not run: ${r.stderr || r.stdout}`);
    return JSON.parse(r.stdout);
  };

  /** The baked descriptions, decoded — exactly as _build_array_js emits them. */
  const baked = (worker) => [...worker.matchAll(
    /\{ name: ("(?:[^"\\]|\\.)*"), description: ("(?:[^"\\]|\\.)*"), inputSchema: /g,
  )].map((m) => ({ name: JSON.parse(m[1]), description: JSON.parse(m[2]) }));

  beforeAll(() => {
    const spec = JSON.parse(fs.readFileSync(path.join(REPO, 'toolspec.json'), 'utf8'));
    served = [...spec, HAZARD, KEEPER];
    box = createScratchRepo('cf-worker-scrub', { git: false });
    box.write('tools.json', JSON.stringify(served));

    // The mutation, and the proof it applied. Both runs happen ONCE, here, so
    // every control below reads the same two outputs.
    source = fs.readFileSync(SCRIPT, 'utf8');
    box.write('unscrubbed.py', source.replace(BAKE_CALL, BAKE_CALL_MUTATED));
    unscrubbed = runSync(path.join(box.root, 'unscrubbed.py'));
    synced = runSync(null);
  });

  afterAll(() => box?.cleanup());

  it('ran the real script over the real corpus (non-vacuity)', () => {
    expect(synced.exit, synced.err).toBe(0);
    expect(unscrubbed.exit, unscrubbed.err).toBe(0);
    expect(source.split(BAKE_CALL).length - 1,
      `the bake no longer reads ${BAKE_CALL}; the must-fail control targets a line that moved`)
      .toBe(1);
    const mutant = fs.readFileSync(path.join(box.root, 'unscrubbed.py'), 'utf8');
    expect(mutant, 'the mutated copy is identical to the committed script').not.toBe(source);
    expect(mutant).toContain(BAKE_CALL_MUTATED);
    // The array really came from SYNC_TOOLS_JSON and not from the fixture.
    expect(baked(synced.out).map((t) => t.name)).toEqual(served.map((t) => t.name));
    expect(synced.out).not.toContain('stale_tool');
  });

  it('THE DEFECT: with the scrub removed, the rebuild ships the literals', () => {
    // The must-fail control. Without it every assertion here could be passing on
    // a harness that cannot produce a red at all.
    const red = baked(unscrubbed.out).filter((t) => FENCE.test(t.description)).map((t) => t.name);
    expect(red).toContain('why_dchub');
    expect(red).toContain('search_facilities');
    expect(red).toContain('semantic_search');
    // ★ 2026-09-16: this was pinned to the literal '21,900+ …'. Canon moved to
    //   22,100+, the heal correctly rewrote toolspec.json, and this control — the
    //   only assertion in this block reading rendered TEXT rather than the decoded
    //   array — failed the hard gate, so daily-manifest-sync stayed red for a day
    //   (run 35142511932) and every registry kept serving the old floor. The
    //   invariant is "the count the corpus carries survives once the scrub is
    //   removed", never "the count is 21,900+". Derive it from the same corpus this
    //   run consumed. Non-vacuity is asserted, not assumed: a toolspec regenerated
    //   clean leaves nothing to carry, and that has to fail loudly rather than pass
    //   as a control over an empty set.
    const carried = (() => {
      const d = served.find((t) => t.name === 'search_facilities')?.description || '';
      return (/[\d,]+\+ global data center facilities/.exec(d) || [])[0];
    })();
    expect(carried,
      'the corpus carries no facility count on search_facilities, so this control proves nothing')
      .toBeTruthy();
    expect(unscrubbed.out).toContain(carried);
  });

  it('as committed, not one baked description carries a facility count', () => {
    const red = baked(synced.out).filter((t) => FENCE.test(t.description)).map((t) => t.name);
    expect(red, 'these baked descriptions still carry a frozen facility count').toEqual([]);
    // …and it told the human doing the paste which ones it touched.
    expect(synced.err).toMatch(/facility count dropped from \d+ description\(s\)/);
    expect(synced.err).toMatch(/why_dchub/);
  });

  it('bakes every other magnitude through untouched', () => {
    const by = new Map(baked(synced.out).map((t) => [t.name, t.description]));
    expect(by.get(KEEPER.name)).toBe(KEEPER.description);
    // The deal floor walks (2,200+ -> 1,600+ on 2026-09-21): read it the way the
    // heal does instead of typing it, or every walk turns this red.
    const deals = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),
      '..', 'canonical', 'canon_phrases.json'), 'utf8')).deals;
    expect(by.get('list_transactions')).toContain(`${deals} tracked deals`);
    expect(by.get('why_dchub')).toContain('330,000+ mapped power/grid/gas/fiber assets');
    expect(by.get(HAZARD.name)).toMatch(/facilities in one clause/);
    expect(FENCE.test(by.get(HAZARD.name))).toBe(false);
  });

  it('does not reach outside the bake — comments and served prose stand', () => {
    // The scrub belongs to the descriptions being baked. The worker's own
    // changelog is history (#435) and its hand-written served string is copy
    // nobody asked this script to rewrite; both carry facility magnitudes and
    // both must come through byte-identical.
    expect(synced.out, 'the changelog comment was edited — that is #435 all over again')
      .toContain(HISTORY);
    expect(synced.out).toContain('2,200+ tracked deals, 12,650+ facilities.');
    // …while the served TOOL COUNT in that same string still moves, as it must.
    expect(synced.out).toContain(`DC Hub — ${served.length} tools,`);
    expect(synced.out).toContain("const WORKER_VERSION = '9.9.9-scrub-test';");
  });
});
