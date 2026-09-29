// ★2026-09-29 — no Capacity Source INVENTORY in copy that is published or
// pasted statically.
//
// An AI-training probe quoted DC Hub back as saying the listings summary
// reported a count, a total MW and a market — dated two weeks earlier, from
// this repo. The registry paste line (scripts/ecosystem-sync.mjs pasteLine)
// appended "Live now: <count> live listings, <MW> MW across <markets>,
// updated <date>" to copy that is COPIED, not re-rendered: directory listings,
// curated-list PRs and the public "Ecosystem sync" issue. Every copy froze the
// inventory of the day it was pasted.
//
// Rule: static copy names the live source and states no number
// (https://dchub.cloud/listings · /api/v1/listings/summary · source_capacity).
// Live responses — the summary endpoint, /listings, source_capacity, the
// per-session instructions — keep their live numbers.
//
// The shape is capacityInventoryViolations (lib/capacity-source-summary.mjs),
// the twin of the backend's white_glove_propagation.capacity_inventory_violations.
// Every surface is driven with a LIVE summary: the leak only exists while
// listings are live, so a zero-state run passes whatever the emitter does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  CAPACITY_BLURB, CAPACITY_LIVE_POINTER, capacityInventoryViolations, capacityPasteClause,
  normalizeCapacitySummary,
} from '../lib/capacity-source-summary.mjs';
import { pasteLine, attachCapacity, renderIssue, planActions } from '../scripts/ecosystem-sync.mjs';

// Distinctive values, so a leak is found by substring as well as by shape.
const LIVE = {
  ok: true, program_status: 'live', live_count: 7, total_mw: 318.4,
  markets: [{ market: 'Zanzibar Metro', state: 'ZZ', country: 'US', count: 7, mw: 318.4,
    delivery_types: ['turnkey'] }],
  market_count: 1, delivery_types: { turnkey: 7 },
  latest_updated_at: '2031-01-02T09:00:00Z', generated_at: '2031-01-02T10:00:00Z',
};
const LEAKS = ['318.4', '7 live listings', '7 listings', 'Zanzibar', '2031-01-02'];
const SSOT = { tools: 92, deals: '1,600+', markets: '300+', version: '9.9.9', packs: ['grid'] };

describe('the shape rule, both directions', () => {
  for (const t of [
    'Capacity Source: 3 live listings, 57.5 MW across Examplefield, updated 2031-01-01.',
    'Live now: 1 live listing, 9 MW across Examplefield, updated 2031-01-01.',
    'Available now: 1 listing, 9 MW across Examplefield, last updated 2031-01-01.',
    'listings totalling 1,250.5 MW',
  ]) it(`catches: ${t}`, () => expect(capacityInventoryViolations(t)).not.toEqual([]));

  for (const t of [
    CAPACITY_BLURB, CAPACITY_LIVE_POINTER,
    'https://dchub.cloud/listings?min_kw=500&region=europe',
    'searchable by size in kW or MW and by location',
    'returns up to 5 listings that deliver the requirement alone',
    'Using DC Hub Capacity Source, list available capacity in Texas of at least 40 MW',
    'https://dchub.cloud/listings/examplefield-9-mw-colocation',
  ]) it(`passes: ${t}`, () => expect(capacityInventoryViolations(t)).toEqual([]));
});

describe('the registry paste line, while listings are live', () => {
  const live = { ok: true, status: 200, text: JSON.stringify(LIVE) };

  it('carries the live pointer and no inventory', () => {
    const line = pasteLine(attachCapacity({ ...SSOT }, live));
    expect(line).toContain(CAPACITY_LIVE_POINTER);   // control: the live branch fired
    expect(capacityInventoryViolations(line)).toEqual([]);
    for (const leak of LEAKS) expect(line, leak).not.toContain(leak);
  });

  it('the clause itself is count-free', () => {
    const clause = capacityPasteClause(normalizeCapacitySummary(LIVE));
    expect(clause).toBe(`${CAPACITY_BLURB} ${CAPACITY_LIVE_POINTER}`);
  });

  it('the public Ecosystem sync issue body carries no inventory', () => {
    const results = [{ key: 'mcp_so', kind: 'manual', label: 'mcp.so', url: 'https://mcp.so',
      verdict: { state: 'drift', reasons: ['behind'] }, fix: 'paste the line' }];
    const body = renderIssue({
      ssot: attachCapacity({ ...SSOT }, live), results, stuck: ['mcp_so'],
      plan: planActions({ healDrift: [], runs: null, openHealPrs: [], now: Date.parse('2031-01-03T00:00:00Z') }),
      generatedAt: 't', scope: 'full',
    });
    expect(body).toContain(CAPACITY_LIVE_POINTER);   // control: the paste line is in it
    expect(capacityInventoryViolations(body)).toEqual([]);
    for (const leak of LEAKS) expect(body, leak).not.toContain(leak);
  });
});

// Every tracked file that is not a test: registry manifests (server.json,
// mcp-server.json, smithery.yaml, toolspec.json), READMEs, canonical/ copy,
// integrations/packs, tool descriptions in server.mjs and lib/. Tests are
// excluded because they must hold inventory-shaped fixtures to prove the rule.
describe('committed copy', () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n')
    .filter((f) => f && !f.startsWith('test/') && !/(^|\/)package-lock\.json$/.test(f)
      && /\.(md|txt|json|ya?ml|mjs|js|html)$/.test(f));

  it('the scan sees the surfaces it exists to fence', () => {
    for (const f of ['README.md', 'server.json', 'mcp-server.json', 'smithery.yaml',
      'toolspec.json', 'canonical/listing-copy.json', 'server.mjs']) {
      expect(files, f).toContain(f);
    }
  });

  it('no tracked non-test file states a Capacity Source inventory', () => {
    const hits = [];
    for (const f of files) {
      let t;
      try { t = readFileSync(f, 'utf8'); } catch { continue; }
      for (const h of capacityInventoryViolations(t)) hits.push(`${f}: ${h}`);
    }
    expect(hits).toEqual([]);
  });
});
