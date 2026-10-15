// The headline facility COUNT is withdrawn from every public surface.
//
// Owner decision 2026-09-27: no "24,600+ facilities" / "24,800+ data centers" /
// "facility search (24,600+)" anywhere an agent, a registry or a person reads
// us, until a corroborated "r3" count lands. The wording that replaces it is the
// r2 comparison brief's: tile "Global facility map", table cell "Global map",
// prose "a global data-center facility map".
//
// ★2026-10-15 (G-1014-33, owner): the "(corroborated count pending)" CAVEAT that
// used to ride on the prose is retired from every listing surface of this repo.
// The count stays withdrawn. canonical/mcp_facts.json is the generated mirror of
// the backend canon API and still carries the caveat, so it is the one
// allow-listed file (see the last describe).
//
// /api/v1/canon/phrases (and so canonical/canon_phrases.json) KEEPS a numeric
// `facilities`, so no check here may treat "equals canon" as a pass: every
// generator emits the pending wording whatever that field says.
//
// FROZEN FILES. server.mjs and the manifests generated from its tool
// descriptions stay byte-identical until 2026-10-02 (frz-claude-relay-wording,
// test/index-name-canon.test.mjs + test/claude-directory-catalog.test.mjs). They
// are exempt only until then: the exemption is dated and EXPIRES, so the
// follow-up PR cannot be forgotten — this test goes red on 2026-10-02 and names
// every frozen file still carrying a number.
//
// Read-only: it scans committed files and runs its must-fail controls on
// strings, never on the working tree.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findFacilityFloors, facilityCountFrozen, FACILITY_COUNT_FROZEN_FILES, FACILITY_COUNT_FROZEN_UNTIL,
  FACILITY_MAP_PROSE, FACILITY_MAP_TILE, FACILITY_MAP_CELL,
  FACILITY_PENDING_CAVEAT, plainFacilityProse,
} from '../scripts/canon-floor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every surface that publishes copy about DC Hub: READMEs, registry manifests
// and their generated twins, listing/paste copy, agent integrations, skills.
// History (docs/outreach-emails.md, submissions already sent, workflow and
// script COMMENTS quoting past figures) is out of scope, as is a line marked
// canon:frozen — the repo's existing marker for a deliberate historical line.
const PUBLIC_EXACT = new Set([
  'server.json', 'mcp-server.json', 'mcp.json', 'glama.json', 'smithery.yaml', 'toolspec.json',
  'llms.txt', 'llms-install.md', 'dxt/manifest.json', '.cursor-plugin/plugin.json',
  'REGISTRY-LISTINGS.md', 'TELEGEOGRAPHY-OUTREACH.md', 'dchub_mcp_server.py',
  'server.mjs', 'lib/claude-directory.mjs', 'submissions/cline-marketplace.md',
  'scripts/smithery_description.txt', 'scripts/claude_directory_listing.txt', 'scripts/tier3_presence.sh',
  'docs/canonical-workflows.md', 'docs/distribution-targets.md', 'docs/contextual-triggers.md',
  'docs/one-click-install.md', 'docs/contacts.md', 'docs/pilot-pack.md',
]);
const PUBLIC_PREFIX = ['canonical/', 'integrations/', 'skills/'];
// A scan that silently lost these would pass while looking at nothing.
const MUST_SCAN = ['README.md', 'smithery.yaml', 'dxt/manifest.json', 'canonical/github_description.txt',
  'integrations/chatgpt/openapi.json', 'REGISTRY-LISTINGS.md', 'server.mjs', 'mcp-server.json'];

function publicFiles() {
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  return tracked.filter((p) => /(^|\/)readme(\.[a-z]+)?$/i.test(p)
    || PUBLIC_EXACT.has(p)
    || PUBLIC_PREFIX.some((pre) => p.startsWith(pre)))
    .filter((p) => !/\.(png|jpe?g|gif|ico|dxt|zip)$/i.test(p))
    .filter((p) => fs.existsSync(path.join(ROOT, p)))
    .sort();
}

/** The facility floors a file states, ignoring canon:frozen lines. Whole-text,
 *  so a claim wrapped across a line break ("24,600+\nfacilities") is seen. */
export function floorsIn(text) {
  const live = String(text).split('\n').map((l) => (/canon:frozen/.test(l) ? '' : l)).join('\n');
  return findFacilityFloors(live);
}

export function offenders(files, today = new Date().toISOString().slice(0, 10), read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')) {
  const out = [];
  for (const f of files) {
    if (facilityCountFrozen(f, today)) continue;
    const hits = floorsIn(read(f));
    if (hits.length) out.push(`${f}: ${hits.join(' | ')}`);
  }
  return out;
}

describe('facility count withdrawn (owner decision 2026-09-27)', () => {
  const FILES = publicFiles();

  it('the scan covers the surfaces that matter (else it passes on nothing)', () => {
    for (const f of MUST_SCAN) expect(FILES, `${f} is not scanned`).toContain(f);
    expect(FILES.length).toBeGreaterThan(40);
  });

  it('no public surface outside the dated freeze states a facility number', () => {
    expect(offenders(FILES)).toEqual([]);
  });

  it('the replacement wording is the r2 comparison brief\'s', () => {
    expect(FACILITY_MAP_TILE).toBe('Global facility map');
    expect(FACILITY_MAP_CELL).toBe('Global map');
    expect(FACILITY_MAP_PROSE).toBe('a global data-center facility map');
  });

  it('the public copy says the map instead (a deletion alone would also pass the scan)', () => {
    for (const f of ['README.md', 'dxt/manifest.json', 'integrations/chatgpt/openapi.json',
      'scripts/claude_directory_listing.txt', 'REGISTRY-LISTINGS.md', 'lib/claude-directory.mjs']) {
      expect(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).toMatch(/global (data-center )?facility map/i);
    }
  });

  it('canonical/mcp_facts.json carries the pending block beside the numeric floor', () => {
    const facts = JSON.parse(fs.readFileSync(path.join(ROOT, 'canonical', 'mcp_facts.json'), 'utf8'));
    expect(facts.facility_count.status).toBe('corroboration_pending');
    // The mirror keeps the backend's sentence; this repo's wording is that
    // sentence with the caveat removed (never the other way round).
    expect(plainFacilityProse(facts.facility_count.prose)).toBe(FACILITY_MAP_PROSE);
  });
});

describe('the freeze exemption is dated, narrow, and not dead', () => {
  it(`exempts only the frz-claude-relay-wording files, and only before ${FACILITY_COUNT_FROZEN_UNTIL}`, () => {
    expect(FACILITY_COUNT_FROZEN_UNTIL).toBe('2026-10-02');
    // mcp#612 reworded the frozen files and emptied the list: nothing is exempt.
    expect(FACILITY_COUNT_FROZEN_FILES).toEqual([]);
    expect(facilityCountFrozen('server.mjs', '2026-10-01')).toBe(false);
    expect(facilityCountFrozen('server.mjs', '2026-10-02')).toBe(false);
    expect(facilityCountFrozen('README.md', '2026-09-27')).toBe(false);
  });

  it('CONTROL: a server.mjs carrying a number is reported, before and after 2026-10-02', () => {
    const read = () => 'Search 24,600+ global data center facilities across 170+ countries';
    expect(offenders(['server.mjs'], '2026-10-01', read)).toHaveLength(1);
    expect(offenders(['server.mjs'], '2026-10-02', read)).toHaveLength(1);
  });

  it('every frozen file still carries a number while the freeze holds (no dead entries)', () => {
    // When the frozen files are reworded, the list must be emptied with them.
    const today = new Date().toISOString().slice(0, 10);
    if (today >= FACILITY_COUNT_FROZEN_UNTIL) return;
    const dead = FACILITY_COUNT_FROZEN_FILES
      .filter((f) => floorsIn(fs.readFileSync(path.join(ROOT, f), 'utf8')).length === 0);
    expect(dead).toEqual([]);
  });
});

describe('the detector: must-fail and must-pass controls', () => {
  const FLAG = [
    '92 tools over 24,600+ data-center facilities (170+ countries)',
    'Search 24,600+ global data center facilities',
    'the 24,600+ discovered facilities',
    '- **24,600+ data center facilities** across 170+ countries',
    'facility search (24,600+)',
    '**Facilities:** 24,600+ across 170+ countries',
    'PulseMCP: 20K+ facilities',
    'covering 24.6k+ data centers',
    'Counts: 92 tools / 24,600+\nfacilities / 1,600+ deals',
  ];
  for (const s of FLAG) {
    it(`flags: ${JSON.stringify(s)}`, () => expect(floorsIn(s).length).toBeGreaterThan(0));
  }
  const PASS = [
    FACILITY_MAP_PROSE,
    FACILITY_MAP_CELL,
    'a global data-center facility map (corroborated count pending)',   // the backend's own spelling carries no number
    'how much power is available in ERCOT for a 100 MW data center',
    'a 1,000+ MW data center campus',
    '330,000+ mapped power/grid/gas/fiber assets, 134k substations',
    '300+ markets scored by the DCPI',
    '1,600+ tracked M&A deals',
    'was 21,000+ facilities  # canon:frozen: historical',
  ];
  for (const s of PASS) {
    it(`passes: ${JSON.stringify(s)}`, () => expect(floorsIn(s)).toEqual([]));
  }
});

// ★2026-10-15 (G-1014-33): the caveat is retired, and stays retired.
describe('the "(corroborated count pending)" caveat is retired from this repo (owner decision 2026-10-15)', () => {
  const CAVEAT_RX = /corroborated count pending/i;
  // Files that may still spell it, each for a reason a reader can check:
  //   scripts/canon-floor.mjs        names the retired string so it is never emitted
  //   scripts/refresh-canon-phrases.mjs  comment quoting the API's own `facilities` value
  // canonical/mcp_facts.json LEFT this list on 2026-10-15 (G-1014-42): the backend
  // canon API's `facilities_public` / exporter prose no longer carry the caveat, so
  // the regenerated mirror is clean and the no-dead-entry check below demanded it.
  // test/ is not scanned: fixtures there quote the backend API value on purpose.
  const ALLOWED = new Set([
    'scripts/canon-floor.mjs',
    'scripts/refresh-canon-phrases.mjs',
  ]);
  const scanned = () => execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((p) => !p.startsWith('test/'))
    .filter((p) => !/\.(png|jpe?g|gif|ico|dxt|zip|woff2?|pdf)$/i.test(p))
    .filter((p) => fs.existsSync(path.join(ROOT, p)));
  const hitsIn = (files, read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')) =>
    files.filter((f) => !ALLOWED.has(f)).filter((f) => CAVEAT_RX.test(read(f)));

  it('no file outside the allow-list carries the caveat (a scan of NOTHING would pass: size-checked)', () => {
    const files = scanned();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('README.md');
    expect(files).toContain('smithery.yaml');
    expect(files).toContain('server.mjs');
    expect(hitsIn(files)).toEqual([]);
  });

  it('CONTROL: the scan goes red on a file that brings the caveat back', () => {
    const planted = (f) => (f === 'README.md' ? 'a global data-center facility map (corroborated count pending)' : 'clean');
    expect(hitsIn(['README.md', 'smithery.yaml'], planted)).toEqual(['README.md']);
    expect(hitsIn(['server.mjs'], () => 'search the facility map (170+ countries; Corroborated Count Pending)')).toEqual(['server.mjs']);
  });

  it('the allow-list has no dead entries: each file still carries the string it is excused for', () => {
    for (const f of ALLOWED) {
      expect(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).toMatch(CAVEAT_RX);
    }
  });

  it('the constant that names the retired string is the one the backend still publishes', () => {
    expect(FACILITY_PENDING_CAVEAT).toBe('(corroborated count pending)');
    expect(plainFacilityProse('a global data-center facility map (corroborated count pending)')).toBe('a global data-center facility map');
    expect(plainFacilityProse('a global data-center facility map')).toBe('a global data-center facility map');
  });
});
