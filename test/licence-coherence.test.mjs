/**
 * licence-coherence.test.mjs (2026-08-29)
 *
 * The backend fixed a real defect on 2026-08-10: `provenance.license` stamped a
 * flat "CC-BY-4.0" on the facilities corpus, ~7,844 rows of which are
 * OpenStreetMap — ODbL 1.0, share-alike. ODbL forbids re-licensing derived data
 * as CC-BY, so the response asserted a grant DC Hub does not hold. Five licence
 * strings were live at once; four emitters plus /terms were reconciled and
 * fenced by tests/test_licence_coherence.py in the backend repo.
 *
 * ★ That fence never reached THIS repo, and this repo publishes a SIXTH surface:
 * server.json is pushed to registry.modelcontextprotocol.io, where it is the
 * licence line every MCP client sees when it discovers DC Hub. It still said a
 * flat "CC-BY-4.0" — the exact retired over-claim — until this change.
 *
 * What is and is not an over-claim:
 *   CORRECT   DCPI scores, verdicts, band thresholds, methodology, and DC Hub's
 *             own grid/site analysis are CC-BY-4.0 — they are our derived work.
 *             Tool descriptions saying "quote with attribution (CC-BY-4.0)"
 *             about those layers are right and are NOT touched here.
 *   OVER-CLAIM  Any single licence string covering the WHOLE service, because
 *             the facility inventory and third-party physical layers are
 *             composites whose upstream terms we cannot waive.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
const publisher = manifest._meta['io.modelcontextprotocol.registry/publisher-provided'];

describe('registry manifest licence', () => {
  it('is not a flat licence over the whole service', () => {
    // The retired answer. Its reappearance is drift, not a new decision.
    expect(publisher.license).not.toBe('CC-BY-4.0');
    expect(publisher.license).not.toBe('Proprietary');
    expect(publisher.license).not.toBe('MIT');
  });

  it('names CC-BY-4.0 for the layers that actually carry it', () => {
    expect(publisher.license).toMatch(/CC-BY-4\.0/);
    expect(publisher.license).toMatch(/DCPI/);
  });

  it('points at the per-layer statement for everything else', () => {
    // Without this pointer the string is just a shorter over-claim.
    expect(publisher.license).toMatch(/https:\/\/dchub\.cloud\/data-sources/);
  });

  it('is short enough to survive a registry listing field', () => {
    expect(publisher.license.length).toBeLessThan(200);
  });
});

describe('LICENSE file', () => {
  const body = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');

  // ★ This repo has been MIT since 2026-03-22 and that is deliberate — it is a
  // DIFFERENT choice from the backend repo's source-available licence, made
  // under a different entity (Martone Advisors LLC). Do not "harmonise" them.
  // I nearly overwrote this file on 2026-08-29 after two bad signals said it
  // was absent: a shell check that mis-fired, and `gh repo view --json
  // licenseInfo` reporting NONE for a five-month-old standard MIT file.
  // ★ Read the file before concluding a licence is missing.
  it('is MIT, and stays MIT', () => {
    expect(body).toMatch(/^MIT License/);
    expect(body).toMatch(/Martone Advisors LLC/);
    expect(body).toMatch(/without restriction/);
  });

  it('is not silently replaced by an all-rights-reserved licence', () => {
    // Swapping a granted licence for a reserved one revokes rights already
    // given; it is never a tidy-up.
    expect(body).not.toMatch(/ALL RIGHTS RESERVED/i);
    expect(body).not.toMatch(/Source-Available/i);
  });

  it('says nothing about DATA — that lives per-layer, not here', () => {
    // The software grant and the data grant are separate. An MIT file must not
    // be read as granting MIT over the facility corpus, ~7,844 rows of which
    // are OpenStreetMap (ODbL 1.0, share-alike) and not ours to relicense.
    expect(body).not.toMatch(/CC-BY/i);
  });
});
