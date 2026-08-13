import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// The initialize instructions tell every connecting agent that DC Hub's
// liveness is CHECKABLE — "verify it rather than take this sentence for it" —
// and hand it a keyless URL to check with.
//
// That sentence is only worth shipping if the URL answers. A claim of liveness
// pointing at a dead endpoint is worse than no claim: it is the exact failure
// this product exists to be the opposite of, published in our own front door,
// to an audience that will follow the link.
//
// So: assert the claim and the proof stay wired together. Offline by default —
// the network half runs only when LIVE_PROBE=1, because a test that needs the
// internet to pass fails for reasons that have nothing to do with the code.

const SRC = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// The one endpoint the liveness clause offers as proof.
const PROOF_URL = 'https://dchub.cloud/api/v1/ops/deadman';

describe('the liveness claim is wired to something that answers', () => {
  it('the instructions make the claim', () => {
    expect(SRC).toContain('LIVENESS IS THE PRODUCT');
  });

  it('the claim ships the URL an agent can verify it with', () => {
    const i = SRC.indexOf('LIVENESS IS THE PRODUCT');
    expect(i).toBeGreaterThan(-1);
    // Same clause, not merely somewhere in a 200k-line file.
    const clause = SRC.slice(i, i + 1200);
    expect(clause).toContain(PROOF_URL);
    expect(clause).toMatch(/keyless/i);
  });

  it('tells the agent what to DO, not just what we are', () => {
    const i = SRC.indexOf('LIVENESS IS THE PRODUCT');
    const clause = SRC.slice(i, i + 1200);
    // A positioning sentence changes no agent behaviour. These two do.
    expect(clause).toMatch(/do NOT reuse/i);
    expect(clause).toMatch(/as_of/);
  });

  it('does not disparage a named competitor', () => {
    const i = SRC.indexOf('LIVENESS IS THE PRODUCT');
    const clause = SRC.slice(i, i + 1200);
    // The surrounding instructions name competitor CATEGORIES factually
    // ("analyst PDFs", "grid-carbon only"), which is fair and useful routing
    // information. A liveness boast that calls a named third party dead is
    // neither verifiable by us nor appropriate in machine-readable metadata
    // that we ask agents to trust.
    for (const name of ['Baxtel', 'baxtel', 'dcHawk', 'DataCenterHawk is', 'dead page']) {
      expect(clause).not.toContain(name);
    }
  });
});

describe.runIf(process.env.LIVE_PROBE === '1')('the proof endpoint actually answers', () => {
  it('returns keyless JSON carrying per-feed freshness', async () => {
    const r = await fetch(`${PROOF_URL}?_=${Math.floor(Date.now() / 1000)}`);
    expect(r.status).toBe(200);
    const d = await r.json();
    // The three things the clause promises an agent will find there.
    expect(d).toHaveProperty('generated_at');
    expect(Array.isArray(d.feeds)).toBe(true);
    expect(d.feeds.length).toBeGreaterThan(0);
    expect(d).toHaveProperty('overdue_count');
  }, 30000);
});
