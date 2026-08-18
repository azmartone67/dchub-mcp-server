// test/return-affordance-anon.test.mjs
//
// THE RETENTION AFFORDANCE WAS SCOPED TO THE COHORT THAT ALREADY RETURNS.
//
// `_NEXT_SESSION` says so in its own header: "Scoped exactly to withCitation's
// full-data gate (keyed/paid only)." But ~95% of real traffic is ANONYMOUS and
// returns out of the auto-mint cascade, which never reaches that gate — so the
// one block telling an agent HOW to come back was withheld from exactly the
// callers who don't.
//
// MEASURED LIVE 2026-08-17, fresh-session anonymous probes holding no key
// (search_facilities, get_grid_intelligence, rank_markets — all `taste:true`):
//   upsell markers    : _upgrade, upgrade_url, quota, starter_pack,
//                       agent_payment, for_your_human
//   retention markers : NONE
// Both DCHUB_RETENTION_PITCH_ENABLED=1 and DCHUB_RETURN_REWARD=1 were already
// set in production — this was never a switch, it was reachability.
//
// Retention: 5-8 returning agents/week for six consecutive weeks (canonical
// agent grain) while ~350 distinct agents passed through.
//
// This is the THIRD instance of this wrong-code-path shape in server.mjs:
// r-prewall-anon (07-28) and r-undercap-anon (08-15) both shipped into the keyed
// branch and were no-ops for real traffic until re-wired into this cascade.
// A source-structure test is the right guard: the failure mode is "the block
// exists but is unreachable from this branch", which no unit test of the block
// itself can see.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');

// ★ Comments are STRIPPED before asserting. Without this the pins are vacuous:
// the attach site carries an explanatory comment that itself contains the word
// `next_session`, so `toContain('next_session')` passed even with the actual
// code removed. Caught by mutation-testing the guard rather than trusting it.
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '');

// Collect every `structuredContent: _collapseEnvelope(...)` literal by walking
// balanced parens, then select the one CONTAINING a key unique to that branch.
//
// ★ An earlier version took the first envelope AFTER a `status = '...'` marker.
// That silently pointed both branch tests at the SAME (granted) envelope,
// because the granted envelope appears first in the file — so the walled attach
// could be deleted with every test still green. Mutation-testing caught it.
// Anchor on something INSIDE the envelope, never on file order.
function allEnvelopes() {
  const out = [];
  const NEEDLE = 'structuredContent: _collapseEnvelope(';
  for (let at = SRC.indexOf(NEEDLE); at !== -1; at = SRC.indexOf(NEEDLE, at + 1)) {
    let depth = 0;
    for (let i = SRC.indexOf('(', at); i < SRC.length; i++) {
      if (SRC[i] === '(') depth++;
      else if (SRC[i] === ')' && --depth === 0) { out.push(stripComments(SRC.slice(at, i + 1))); break; }
    }
  }
  return out;
}

function envelopeWith(uniqueKey) {
  const hits = allEnvelopes().filter((e) => e.includes(uniqueKey));
  expect(hits.length, `expected exactly ONE envelope containing ${uniqueKey}, got ${hits.length}`).toBe(1);
  return hits[0];
}

// Branch anchors, each unique to one envelope (asserted by envelopeWith).
const GRANTED = 'inline_full: true';        // anon auto-mint, under cap — full answer
const WALLED = 'preview_is_partial: true';  // anon auto-mint, over cap — depth withheld

describe('anonymous return affordance (r-return-anon)', () => {
  // ── THE PINS: both anon-cascade exits must carry the return path ──────────

  it('attaches next_session on the GRANTED anon branch (trial_taste_inline)', () => {
    const env = envelopeWith(GRANTED);
    expect(env).toContain('next_session');
    expect(env).toContain('_anonNextSessionDue');
  });

  it('attaches next_session on the WALLED anon branch (trial_used)', () => {
    // The walled caller needs it most: depth is withheld, so "come back when it
    // moved" is the only honest next step. Under cap=4 this branch carried 68 of
    // 86 real anon flagship calls; the cap is now 2, so its share is higher.
    const env = envelopeWith(WALLED);
    expect(env).toContain('next_session');
    expect(env).toContain('_anonNextSessionDue');
  });

  it('reuses the canonical _NEXT_SESSION object, not a second shape', () => {
    // Two shapes drift; the keyed path and the anon path must hand agents the
    // same contract.
    for (const anchor of [GRANTED, WALLED]) {
      expect(envelopeWith(anchor)).toMatch(/next_session:\s*_NEXT_SESSION/);
    }
  });

  // ── placement: it must survive the envelope collapse at TOP LEVEL ─────────

  it('next_session is neither moved under `upgrade` nor dropped', () => {
    // `for_your_human` was pulled back out of `upgrade` on 07-28 precisely
    // because burial beside 14 other URL-ish keys worked against it.
    const move = SRC.match(/const _ENV_MOVE = new Set\(\[([\s\S]*?)\]\)/);
    const drop = SRC.match(/const _ENV_DROP = new Set\(\[([\s\S]*?)\]\)/);
    expect(move, '_ENV_MOVE not found — collapse semantics changed').toBeTruthy();
    expect(drop, '_ENV_DROP not found — collapse semantics changed').toBeTruthy();
    expect(move[1]).not.toContain('next_session');
    expect(drop[1]).not.toContain('next_session');
  });

  // ── the gate ─────────────────────────────────────────────────────────────

  it('fires at most once per (session, tool) and is memory-bounded', () => {
    const fn = SRC.slice(SRC.indexOf('function _anonNextSessionDue'),
                         SRC.indexOf('function _anonNextSessionDue') + 700);
    expect(fn).toContain('${sessionKey}:${tool}');
    expect(fn).toMatch(/_nextSessionSeen\.has\(key\)/);
    expect(fn).toMatch(/_NEXT_SESSION_SEEN_CAP/); // unbounded-growth guard
  });

  it('is killable without a deploy', () => {
    expect(SRC).toContain('DCHUB_ANON_NEXT_SESSION_DISABLE');
  });

  it('never throws out of the gate', () => {
    // It sits on the success path of every anon call; a throw here costs the
    // answer. Same fail-soft posture as the offer blocks beside it.
    const fn = SRC.slice(SRC.indexOf('function _anonNextSessionDue'),
                         SRC.indexOf('function _anonNextSessionDue') + 700);
    expect(fn).toMatch(/catch \(_\) \{ return false; \}/);
  });

  // ── no prose ─────────────────────────────────────────────────────────────

  it('adds no prose line to either branch', () => {
    // "Louder reminders don't move it; mechanical discoverability of the
    // value-laden return path does." Also: this cascade's content[0].text is
    // JSON + appended prose and must never be reparsed.
    for (const anchor of [GRANTED, WALLED]) {
      const env = envelopeWith(anchor);
      const at = SRC.indexOf(env.slice(0, 60));
      const contentBlock = stripComments(SRC.slice(SRC.lastIndexOf('content: [', at), at));
      expect(contentBlock).not.toContain('next_session');
    }
  });
});
