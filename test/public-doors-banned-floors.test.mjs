// Public doors never publish the facility floors the owner banned
// (owner directive, 2026-09-21 PM: 20,000+, 22,100+, 22,900+, 24,400+).
//
// WHY. Agents that do not speak MCP read a README or a registry manifest once,
// as text, and cite it. This repo's READMEs are what GitHub, GitMCP and the MCP
// directories render, and its manifests (mcp-server.json, server.json,
// smithery.yaml, the integrations/packs twins, canonical/*.json) are what
// registries scrape. Measured 2026-09-22: canonical/mcp_facts.json still said
// "24,400+" until its generator re-ran (#500); nothing in this repo would have
// failed if a hand edit or a stale regeneration put a banned floor back.
//
// SCOPE is every tracked README plus the published manifests and generated
// twins. It only READS files: the must-fail controls run on strings, never on
// the working tree (vitest runs files in parallel; see test/helpers/repo-sandbox.mjs).
//
// THE CANON EXEMPTION. A banned floor equal to the canon facilities floor in
// canonical/canon_phrases.json (synced daily from /api/v1/canon/phrases) is not
// judged: if canon ever walks back to one of these values, this guard must not
// fight the canon. Matches are boundary-safe: "320,000+" is not "20,000+".
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OWNER_BANNED_FLOORS = ['20,000+', '22,100+', '22,900+', '24,400+'];
const MANIFESTS = ['mcp-server.json', 'server.json', 'mcp.json', 'glama.json', 'smithery.yaml',
  'toolspec.json', 'llms.txt', 'llms-install.md', 'dxt/manifest.json'];
const MUST_SCAN = ['README.md', 'mcp-server.json', 'canonical/mcp_facts.json', 'integrations/packs/site.json'];

export function bannedFloors(canonFacilities) {
  return OWNER_BANNED_FLOORS.filter((f) => f !== canonFacilities);
}

export function findBanned(text, floors) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const f of floors) {
      const re = new RegExp(`(?<![\\d,])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      if (re.test(line)) hits.push({ floor: f, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
  return hits;
}

function scannedFiles() {
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).split('\n');
  const set = new Set([
    ...tracked.filter((p) => /(^|\/)readme(\.[a-z]+)?$/i.test(p)),
    ...tracked.filter((p) => MANIFESTS.includes(p)),
    ...tracked.filter((p) => /^(integrations\/packs|canonical)\/[^/]+\.json$/.test(p)),
  ]);
  return [...set].filter((p) => fs.existsSync(path.join(ROOT, p))).sort();
}

function canonFacilities() {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'canonical/canon_phrases.json'), 'utf8'));
  return j.facilities;
}

describe('public doors carry no owner-banned facility floor', () => {
  it('scans a real, non-empty set that includes the files that matter', () => {
    const files = scannedFiles();
    expect(MUST_SCAN.filter((p) => !files.includes(p))).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  it('no README, manifest or generated twin states a banned floor', () => {
    const floors = bannedFloors(canonFacilities());
    expect(floors.length).toBeGreaterThan(0);
    const bad = [];
    for (const rel of scannedFiles()) {
      for (const h of findBanned(fs.readFileSync(path.join(ROOT, rel), 'utf8'), floors)) {
        bad.push(`${rel}:${h.line}: ${h.floor} -> ${h.text}`);
      }
    }
    expect(bad, `banned facility floor(s) on a public door — state the canon floor from /api/v1/canon/phrases:\n${bad.join('\n')}`).toEqual([]);
  });

  it('CONTROL: each banned floor is caught in copy', () => {
    for (const f of OWNER_BANNED_FLOORS) {
      expect(findBanned(`DC Hub tracks ${f} data center facilities.`, OWNER_BANNED_FLOORS).length).toBe(1);
    }
  });

  it('CONTROL: matching is boundary-safe', () => {
    expect(findBanned('330,000+ assets; 320,000+ before', ['20,000+'])).toEqual([]);
    expect(findBanned('124,400+ rows', ['24,400+'])).toEqual([]);
  });

  it('CONTROL: only the canon value is exempt', () => {
    expect(bannedFloors('24,400+')).toEqual(['20,000+', '22,100+', '22,900+']);
    expect(bannedFloors('24,500+')).toEqual(OWNER_BANNED_FLOORS);
  });
});
