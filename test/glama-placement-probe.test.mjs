/**
 * test/glama-placement-probe.test.mjs — this repo must measure where the Glama
 * listing RANKS, not only whether it is FRESH.
 *
 * WHAT THIS PINS
 * ──────────────
 * Every rank in registry_monitor.py was SMITHERY. `main()` does
 * `core = {t: smithery_rank(t) for t in CORE}`, and smithery_rank() queries
 * registry.smithery.ai. The three Glama helpers beside it — glama_page_tool_count,
 * glama_record, glama_build_provenance — all ask whether OUR OWN PAGE is current.
 * None ever asked where that page places in Glama's results.
 *
 * So the two facts never met. state/rank_status.json reported "energy #2,
 * fiber #3" — Smithery's numbers — while the Glama listing was off page one for
 * energy entirely. Freshness is not placement, and nothing owned placement.
 *
 * Measured 2026-09-03 via `python3 scripts/registry_monitor.py --glama`:
 * page one on 2 of 10 terms (fiber #7, and `dchub` #1 — our own name). ABSENT
 * from page one for energy, electricity, power grid, datacenter, colocation,
 * site selection, interconnection queue. `data center` #15 of 20.
 *
 * THE CONTRACT
 * ────────────
 *   G1. Placement must be MEASURED against glama.ai, not inferred from Smithery.
 *   G2. UNREADABLE must never read as ABSENT. A boolean cannot express "I could
 *       not look" — the four-state rule that registry_truth.py exists to enforce.
 *   G3. The result set comes from the JSON-LD ItemList Glama emits, NOT a scrape
 *       of every <a>. A link scrape is not a worse estimate of the same number,
 *       it is a different number: measured 2026-09-03 it reported "28 of 29" on
 *       `power grid` for a server that is not on page one at all.
 *   G4. This probe stays OBSERVATIONAL. Glama produced 10 clicks in 30 days and
 *       all ten were brand-name lookups ("dchub" 7, "Dchub" 2, "dchyb" 1 — a typo
 *       of our own name); /api/v1/reach showed 0 Glama rows in 2,274 real external
 *       calls over 7 days. Wiring a dead channel into the paging path is how a
 *       monitor teaches its owner to ignore it — the same reasoning that keeps
 *       RECLAIM terms off `reasons`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MON = path.join(REPO, 'scripts', 'registry_monitor.py');
const src = fs.readFileSync(MON, 'utf8');

/** Body of a top-level def, docstring and comments stripped — prose must never
 *  satisfy a claim about what the code does. */
function body(name) {
  const at = src.indexOf(`def ${name}(`);
  if (at === -1) return null;
  const rest = src.slice(at + 1);
  const end = rest.search(/\ndef [A-Za-z_]/);
  return (end === -1 ? rest : rest.slice(0, end))
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/^\s*#[^\n]*$/gm, ' ');
}

/** Run a snippet against the imported module. */
function py(snippet) {
  const code = [
    'import importlib.util',
    `spec = importlib.util.spec_from_file_location("rm", ${JSON.stringify(MON)})`,
    'rm = importlib.util.module_from_spec(spec); spec.loader.exec_module(rm)',
    snippet,
  ].join('\n');
  return spawnSync('python3', ['-c', code], { cwd: REPO, encoding: 'utf8' });
}

describe('glama placement probe — rank is measured, not assumed', () => {
  // ── G0: must-fail control ────────────────────────────────────────────────
  it('G0 the harness locates the probe (else every check below is vacuous)', () => {
    expect(src.length).toBeGreaterThan(5000);
    expect(body('glama_rank'), 'glama_rank() not found').toBeTruthy();
    expect(body('_glama_search_html'), '_glama_search_html() not found').toBeTruthy();
    expect(body('glama_placement_report'), 'glama_placement_report() not found').toBeTruthy();
    expect(body('glama_rank').length).toBeGreaterThan(100);
  });

  // ── G1: measured against Glama, and the Smithery split stays explicit ────
  it('G1 placement is fetched from glama.ai, not inferred from Smithery', () => {
    expect(body('_glama_search_html')).toMatch(/glama\.ai\/mcp\/servers/);
    expect(body('_glama_search_html')).toMatch(/query/);
    // the function this one mirrors must still be the SMITHERY one — if these two
    // ever point at the same host, one of them is measuring the wrong directory.
    expect(body('smithery_rank')).toMatch(/registry\.smithery\.ai/);
    expect(body('glama_rank')).not.toMatch(/smithery/i);
  });

  // ── G2: unreadable is not absent ─────────────────────────────────────────
  it('G2 an unreadable page never reads as absent', () => {
    const r = py([
      'rm._glama_search_html = lambda t: (None, "URLError: simulated outage")',
      'unreadable = rm.glama_rank("energy")',
      'page = \'"position":1,"url":"https://glama.ai/mcp/servers/rival/one"\'',
      'rm._glama_search_html = lambda t: (page, None)',
      'absent = rm.glama_rank("energy")',
      'page2 = page + \' "position":2,"url":"https://glama.ai/mcp/servers/azmartone67/dchub-mcp-server"\'',
      'rm._glama_search_html = lambda t: (page2, None)',
      'present = rm.glama_rank("energy")',
      'print(repr((unreadable, absent, present)))',
    ].join('\n'));
    expect(r.error, `could not run python3: ${r.error?.message}`).toBeFalsy();
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const out = r.stdout.trim();
    // could-not-look
    expect(out).toMatch(/\(None, None, None\)/);
    // read fine and we are not on it — MUST carry the size and leader, so it is
    // distinguishable from the line above
    expect(out).toMatch(/\(None, 1, 'rival\/one'\)/);
    // present
    expect(out).toMatch(/\(2, 2, 'rival\/one'\)/);
  });

  // ── G3: the ItemList, not a link scrape ──────────────────────────────────
  it('G3 results come from the JSON-LD ItemList and exclude page chrome', () => {
    expect(src).toMatch(/_GLAMA_ITEM\s*=\s*re\.compile/);
    expect(body('glama_rank')).toMatch(/_GLAMA_ITEM/);
    const r = py([
      "chrome = '\"position\":1,\"url\":\"https://glama.ai/feeds/recent-servers.xml\"'",
      "real = ' \"position\":2,\"url\":\"https://glama.ai/mcp/servers/rival/one\"'",
      'rm._glama_search_html = lambda t: (chrome + real, None)',
      'print(rm.glama_rank("x")[1])',
    ].join('\n'));
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    // the feeds/*.xml entry must NOT be counted as a search result
    expect(r.stdout.trim()).toBe('1');
  });

  // ── G4: observational — must not reach the paging path ───────────────────
  it('G4 the probe never feeds reasons/escalation on a channel that delivers ~0', () => {
    const main = body('main');
    expect(main, 'main() not found').toBeTruthy();
    expect(main, 'glama_rank must not be wired into main()\'s paging path')
      .not.toMatch(/glama_rank\s*\(/);
    const report = body('glama_placement_report');
    expect(report).not.toMatch(/reasons|escalat|_update_streaks|_write_status/);
  });

  // ── G5: the keyless path, and page one only ──────────────────────────────
  it('G5 reads HTML with a browser UA (the JSON API 401s) and does not paginate', () => {
    const b = body('_glama_search_html');
    expect(b).toMatch(/User-Agent/);
    // the /api/mcp/v1 endpoint needs a key since 2026-09-01 — this path must stay keyless
    expect(b).not.toMatch(/api\/mcp\/v1/);
    expect(b).not.toMatch(/Authorization|api_key|apiKey/);
    // Page one is the surface a human reads; paginating turns it into a vanity
    // number. Assert the REQUEST carries only the query — banning the substring
    // "page=" would instead flag `def glama_rank(term, page=None)`, a denylist
    // matching the code it was meant to protect.
    expect(b).toMatch(/urlencode\(\{"query": term\}\)/);
    expect(b).not.toMatch(/pageSize|"page"|'page'/);
    // and nothing may loop to fetch further pages
    expect(body('glama_rank')).not.toMatch(/while |_glama_search_html\([^)]*\+/);
  });
});
