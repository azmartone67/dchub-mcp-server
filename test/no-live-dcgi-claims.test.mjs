// Current-claim copy must not sell the withdrawn DCGI as a live score.
//
// WHY (2026-08-22): the DCGI composite was withdrawn 2026-08-08 and every tool
// description says so — but the copy registries and humans actually read did
// not: the LIVE Smithery description (our #1 channel, 72.7% of external calls)
// still advertised "the DCGI (Data Center Gas Index): per-state natural-gas
// suitability for siting"; REGISTRY-LISTINGS.md (the paste-ready source for
// every listing) carried it in 6 places; SKILL.md, integrations/README.md and
// the to-be-sent TeleGeography one-pager carried "DCPI/DCGI". The quantity
// healer keeps NUMBERS current; nothing kept a withdrawn CAPABILITY out.
//
// Rule: the word may appear — an agent asking for the DCGI must find the
// honest answer — but never on a line that does not also say "withdrawn".
// Lines marked canon:frozen are history and exempt (same convention as the
// quantity healer). server.mjs is covered by its own narrower assertion: the
// tool descriptions legitimately name the DCGI many times WITH the
// withdrawal; the one sales string that did not was why_dchub.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'scripts/smithery_description.txt',
  'smithery.yaml',
  'server.json',
  'canonical/github_description.txt',
  'REGISTRY-LISTINGS.md',
  'skills/dc-hub-data-center-intelligence/SKILL.md',
  'integrations/README.md',
  'TELEGEOGRAPHY-OUTREACH.md',
];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const liveLines = (txt) => txt.split('\n').filter((l) => !/canon:frozen/.test(l));

describe('no current-claim copy names the DCGI without saying it was withdrawn', () => {
  for (const f of FILES) {
    it(f, () => {
      const bad = liveLines(read(f)).filter((l) => /\bDCGI\b/.test(l) && !/withdrawn/i.test(l));
      expect(bad, `${f}: DCGI named without "withdrawn" on the same line:\n${bad.join('\n')}`).toEqual([]);
    });
  }
  // ★★2026-08-30 — THIS ASSERTION WAS VACUOUS AND HID THE DEFECT IT NAMED.
  //
  // It read:
  //     expect(read('server.mjs').includes('DCPI + DCGI indices')).toBe(false);
  //
  // Three independent reasons it could only ever pass:
  //   1. WRONG STRING. The shipped label is "Proprietary live indices
  //      (DCPI + DCGI)". The literal 'DCPI + DCGI indices' has never existed
  //      in any file, in any repo.
  //   2. WRONG FILE. why_dchub's sales copy is not in server.mjs; this repo
  //      registers the tool name and proxies the call.
  //   3. WRONG REPO. That copy is built in
  //      dchub-backend/routes/competitive_intel.py, which this test cannot see.
  //
  // So the header above ("the one sales string that did not was why_dchub")
  // diagnosed it correctly and then guarded nothing. The live server kept
  // serving "Two proprietary indices recomputed daily … the DC Hub Gas Index
  // (DCGI) scores gas access and cost by state" — with a proof URL and a
  // citation line — until 2026-08-30, when an outside AI auditing DC Hub
  // reported it from the public side. Eight days green over a live false claim.
  //
  // Real coverage now lives where the string does:
  // dchub-backend/tests/test_why_dchub_no_stale_capability.py, which asserts
  // over the EDGES objects rather than a source literal, so a reworded claim
  // cannot slip past it the way this one did.
  //
  // No replacement assertion is added here, deliberately. The line rule the
  // FILES loop above applies works on PROSE, where every line is a claim.
  // server.mjs is code: `get_gas_index: "Gas Index (DCGI)"` is a display name,
  // `_R('methodology', …, 'DCPI / DCGI methodology')` is a resource title whose
  // body states the withdrawal, and several hits are ordinary code comments.
  // Applying the line rule here flags all of them — a fence that cannot be made
  // green without mangling identifiers, which is how fences get deleted rather
  // than fixed. server.mjs's one substantive claim is already covered by the
  // methodology assertion directly below, and the sales copy that was actually
  // wrong is covered in the repo that generates it.
  it('the methodology resource says the Gas Index was withdrawn', () => {
    const src = read('server.mjs');
    const i = src.indexOf("_R('methodology'");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 3000)).toMatch(/DCGI[^]{0,60}WITHDRAWN 2026-08-08/);
  });
});

describe('scripts/smithery_description.txt is the single origin the daily check compares', () => {
  const txt = read('scripts/smithery_description.txt');
  it('carries every canon quantity the healer owns (facilities/deals/markets/countries)', () => {
    const canon = JSON.parse(read('canonical/canon_phrases.json'));
    for (const k of ['facilities', 'deals', 'markets', 'countries']) expect(txt, k).toContain(canon[k]);
  });
  it('never states a tracked-feed COUNT (the deadman count moves; the sentence must not rot)', () => {
    expect(/\b\d+ tracked feeds\b/.test(txt)).toBe(false);
  });
  it('still leads with the liveness claim Smithery relevance-ranks on', () => {
    expect(txt).toMatch(/^DC Hub is the neutral, real-time data layer/);
    expect(txt).toContain('https://dchub.cloud/api/v1/ops/deadman');
  });
});
