// Asset-class quantities must heal in the files REGISTRIES ingest, not only in
// server.mjs.
// ---------------------------------------------------------------------------
// MEASURED 2026-09-19 on c037f43. ASSET_QUANTITIES — mapped assets, transmission
// lines, fiber routes, gas pipelines, US power plants, subsea cables, cable
// landings, generating units — was applied to exactly ONE file: server.mjs. The
// COVERAGE loop, which walks smithery.yaml, README.md, the integrations/ copy
// and everything else a directory reads, ran QUANTITIES alone.
//
// So smithery.yaml's description published:
//
//     "… 22,900+ facilities across 170+ countries, 300+ markets scored daily
//      (DC Hub Power Index), 64,000 fiber routes, … 2,200+ tracked M&A deals."
//
// against canonical/mcp_facts.json `fiber_routes: "58k"` — regenerated that
// morning. A ~10% over-claim, in the sentence Smithery ingests, while
// `node scripts/sync-tools-manifest.mjs` printed
// "✓ all manifest + facts surfaces consistent".
//
// The facility, country, market and deal figures IN THE SAME SENTENCE were
// correct, because those four are in QUANTITIES. Two of three claims healed and
// the third unwatched, reported green — the shape this repo keeps finding
// (see the ★2026-08-31 --print-facilities note and the substation heal).
//
// ★ The second half of the fix is that the scan compares by VALUE. The asset
//   snapshot writes "33k"; registry prose writes "33,000 gas pipeline segments".
//   Byte equality reported five notation differences for every real drift, and a
//   guard whose output is mostly noise gets muted — which is how the one real
//   drift survived beside four false ones. Every control below therefore asserts
//   BOTH directions: a same-value/different-notation literal must stay silent
//   AND byte-identical, and a different-value literal must still be caught.
//
// ★ NO NETWORK. The script reads committed snapshots only; these tests run the
//   shipped script against a sandbox copy of the tracked tree.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Every write goes through the sandbox helper — smithery-canon-guard's static
// write-scan flags a test file that names the fs write functions directly.
import { createRepoSandbox } from './helpers/repo-sandbox.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(REPO, p), 'utf8');
const SCRIPT = 'scripts/sync-tools-manifest.mjs';

const qty = (s) => {
  const b = String(s).replace(/\+$/, '');
  return Number(b.replace(/,/g, '').replace(/k$/i, '')) * (/k$/i.test(b) ? 1000 : 1);
};
const commas = (n) => n.toLocaleString('en-US');

// Canon is READ, never restated: a test that hardcodes "58k" becomes a second
// copy of the number it exists to protect.
//
// ★2026-09-23 — and it is read from the file the script HEALS FROM, not from a
//   file that merely carries the same key. Since 2026-09-20 substations,
//   transmission lines, fiber routes and mapped assets are served ONLY from
//   canon_phrases.json (CANON_LAYERS / canonKey in the script); mcp_facts.json
//   still has its own copy, which the heal never reads. This fixture kept
//   reading mcp_facts.json, so it held only while the two snapshots agreed.
//   The daily sync refreshes canon_phrases.json from live /api/v1/canon/phrases
//   and does not touch mcp_facts.json: on 2026-09-23 live substations moved
//   127k -> 133,000+, the "already correct" fixture line still said 127,000+,
//   --fix rightly rewrote it, and the hard gate refused every sync from 05:24Z
//   — holding back the 91 -> 92 tool-count heal with it.
const FACTS = JSON.parse(read('canonical/mcp_facts.json'));
const PHRASES = JSON.parse(read('canonical/canon_phrases.json'));
// A canon layer is published in k-form as a floor, as the script's asK() does.
const FIBER = `${Math.floor(qty(PHRASES.fiber_routes) / 1000)}k`;  // e.g. "58k"
const SUBSTATIONS = PHRASES.substations;       // e.g. "133,000+"
const GAS = FACTS.numbers.gas_pipelines;       // e.g. "33k" — no canon home yet

// The line smithery.yaml actually publishes, rebuilt around one substituted
// quantity. Using the REAL sentence keeps the fixture honest: the facility and
// deal figures beside it are the ones that always healed.
const descLine = (fiber, gas = commas(qty(GAS))) =>
  `description: "Live intelligence. ${commas(qty(SUBSTATIONS))}+ substations, ` +
  `${gas} gas pipeline segments, ${fiber} fiber routes, and more."\n`;

let box;
// box.write() takes a path it can prove is inside the sandbox copy; every write
// below is a sandbox write, never one to the shared working tree.
const w = (rel, content) => box.write(path.join(box.root, rel), content);
const boxRead = (rel) => readFileSync(path.join(box.root, rel), 'utf8');
const runScript = (args = [], root = box.root) => {
  const r = spawnSync('node', [path.join(root, SCRIPT), ...args],
    { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

beforeAll(() => {
  box = createRepoSandbox(REPO, 'asset-coverage');
  const g = (...a) => execFileSync('git', a,
    { cwd: box.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'g@example.com');
  g('config', 'user.name', 'asset-coverage');
  g('add', '-A'); g('commit', '-q', '-m', 'sandbox baseline');
});
afterAll(() => box?.cleanup?.());

describe('the registry-facing loop scans asset quantities', () => {
  it('reports a fiber-route count that differs in VALUE', () => {
    const wrong = commas(qty(FIBER) + 6000);          // the 64,000-vs-58k shape
    w('smithery.yaml', descLine(wrong));
    const { out } = runScript();
    expect(out, 'a registry-ingested asset count drifted and the scan stayed green')
      .toMatch(/smithery\.yaml:.*fiber-route count/);
    expect(out).toContain(wrong);
  });

  it('heals it, keeping the published notation', () => {
    w('smithery.yaml', descLine(commas(qty(FIBER) + 6000)));
    runScript(['--fix']);
    const healed = boxRead('smithery.yaml');
    expect(healed).toContain(`${commas(qty(FIBER))} fiber routes`);
    // comma prose must not acquire the snapshot's "k" form
    expect(healed).not.toContain(`${FIBER} fiber routes`);
  });

  it('keeps a trailing "+" when the copy had one', () => {
    w('smithery.yaml', descLine(`${commas(qty(FIBER) + 6000)}+`));
    runScript(['--fix']);
    expect(boxRead('smithery.yaml'))
      .toContain(`${commas(qty(FIBER))}+ fiber routes`);
  });

  it('keeps k-form when the copy was in k-form', () => {
    w('smithery.yaml', descLine(`${qty(FIBER) / 1000 + 6}k`));
    runScript(['--fix']);
    expect(boxRead('smithery.yaml'))
      .toContain(`${FIBER} fiber routes`);
  });
});

describe('notation is not drift', () => {
  it('a same-value literal in the other notation is neither reported nor rewritten', () => {
    const line = descLine(commas(qty(FIBER)), commas(qty(GAS)));  // "33,000" vs canon "33k"
    w('smithery.yaml', line);
    const { out } = runScript();
    expect(out).not.toMatch(/gas-pipeline count/);
    runScript(['--fix']);
    expect(boxRead('smithery.yaml'),
      'a notation difference was rewritten as if it were a stale number')
      .toBe(line);
  });

  it('control — a genuinely wrong gas figure in that same slot IS caught', () => {
    w('smithery.yaml', descLine(commas(qty(FIBER)), commas(qty(GAS) - 2000)));
    expect(runScript().out).toMatch(/smithery\.yaml:.*gas-pipeline count/);
  });
});

describe('substations are ruled once, not twice', () => {
  // QUANTITIES owns the substation noun for README-class prose, from
  // canon_phrases.json; ASSET_QUANTITIES carries the same noun (k-form, and
  // since 2026-09-20 from canon_phrases.json too — it once read mcp_facts.json).
  // Today both rules publish the same VALUE, so the conflict is
  // invisible — which is precisely why this test forces them apart. Let both
  // rules loose on one noun with the owners disagreeing and --fix stops being a
  // fixed point: each run rewrites what the previous one wrote, and the file
  // flips on every sync forever.
  it('--fix is a fixed point even when the two owners disagree', () => {
    const snap = JSON.parse(read('canonical/canon_phrases.json'));
    const bumped = `${commas(qty(SUBSTATIONS) + 1000)}+`;
    expect(qty(bumped), 'the fixture no longer makes the owners disagree')
      .not.toBe(qty(SUBSTATIONS));
    w('canonical/canon_phrases.json',
      `${JSON.stringify({ ...snap, substations: bumped }, null, 2)}\n`);
    // smithery.yaml keeps the PRE-bump figure, so the canon owner can only be
    // seen winning if --fix actually rewrites it. Seeded with the bumped value
    // (as this test once was), "canon won" held with the registry-copy
    // substation rule deleted outright — mutation-tested 2026-09-23.
    w('smithery.yaml', descLine(commas(qty(FIBER))));

    runScript(['--fix']);
    const once = boxRead('smithery.yaml');
    runScript(['--fix']);
    expect(boxRead('smithery.yaml'), 'two rules are fighting over one noun — --fix oscillates')
      .toBe(once);
    // and the canon_phrases owner is the one that won
    expect(once).toContain(`${bumped} substations`);

    w('canonical/canon_phrases.json', read('canonical/canon_phrases.json'));
  });
});

describe('the controls above can fail', () => {
  // RED-before-green: the same fixture through a copy of the script with the
  // COVERAGE_ASSETS pass removed must go UNREPORTED — and the mutation has to be
  // shown to have landed in the source at all, or a no-op edit reads as a pass.
  it('removing the COVERAGE_ASSETS pass makes the drift invisible again', () => {
    const src = read(SCRIPT);
    const CALL = 'healed = applyQuantities(f, healed, COVERAGE_ASSETS, false);';
    expect(src, 'the pass this suite fences is no longer in the script under its known shape')
      .toContain(CALL);
    const mutated = src.replace(CALL, '// removed by mutation');
    expect(mutated, 'the mutation did not land').not.toBe(src);

    const wrong = commas(qty(FIBER) + 6000);
    w('smithery.yaml', descLine(wrong));
    w(SCRIPT, mutated);
    const { out } = runScript();
    w(SCRIPT, src);                      // restore before anything else runs
    expect(out).not.toMatch(/fiber-route count/);
  });
});
