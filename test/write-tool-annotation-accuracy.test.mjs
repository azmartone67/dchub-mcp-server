// A tool that mutates state must not be advertised read-only.
//
// WHAT THIS PROTECTS: annotations are not documentation — Claude uses them to
// decide auto-permission, and the Anthropic Connectors Directory reviews them
// for accuracy. server.mjs already says so, in the WRITE_TOOLS comment, since
// 2026-06-20.
//
// It was wrong anyway. `standing_intent` was never added to WRITE_TOOLS, so
// tools/list advertised it readOnlyHint:true + idempotentHint:true. That tool
// registers a persistent watch, has a `delete` action, and makes the SERVER
// POST an HMAC-signed webhook to an HTTPS endpoint the CALLER supplies. Four
// hints, all four wrong, on the one tool that can make us call out to an
// address someone else chooses.
//
// Found from OUTSIDE: Glama's public listing scored it 1/5 on "does the
// description disclose side effects, auth requirements, rate limits, or
// destructive operations" while every other tool scored 4 or 5. Nothing in
// this repo was asking the question.
//
// ★ The old comment asserted "All are create/upsert/side-effect, none DELETE →
// destructiveHint:false". That was TRUE of the ten tools listed at the time and
// FALSE as a rule about writes, and encoding it as a rule is exactly how the
// eleventh arrived carrying a false hint. So the third test below derives the
// claim from each tool's own published description rather than from a category:
// if a tool tells agents it can delete, it must be annotated destructive.
import { describe, it, expect, beforeAll } from 'vitest';
import { _buildToolsListResult } from '../server.mjs';

let TOOLS;

beforeAll(async () => {
  const listed = await _buildToolsListResult(null);
  TOOLS = listed.tools;
});

const byName = (n) => TOOLS.find((t) => t.name === n);

describe('write-tool annotation accuracy', () => {
  it('the tools/list result is actually populated', () => {
    // A guard over an empty list passes vacuously. Assert we can see.
    expect(TOOLS.length).toBeGreaterThan(50);
    expect(byName('standing_intent')).toBeTruthy();
  });

  it('standing_intent is a destructive, open-world write', () => {
    const a = byName('standing_intent').annotations;
    expect(a.readOnlyHint).toBe(false);    // registers persistent state
    expect(a.idempotentHint).toBe(false);  // register creates a new intent
    expect(a.destructiveHint).toBe(true);  // action="delete" retires a watch
    expect(a.openWorldHint).toBe(true);    // POSTs to a caller-supplied URL
  });

  it('a tool that advertises a delete action is annotated destructive', () => {
    // Derived from the published description, not from a hand-kept list — the
    // failure mode this file exists for is a NEW tool nobody remembered to add.
    const DELETES = /\b(?:"|')?delete(?:"|')?\b|\bcancel(?:s|led)?\b|\bretire(?:s|d)?\b/i;
    const offenders = TOOLS
      .filter((t) => DELETES.test(t.description || ''))
      .filter((t) => t.annotations?.destructiveHint !== true)
      .map((t) => t.name);
    expect(offenders).toEqual([]);
  });

  it('nothing annotated read-only also claims to write', () => {
    // ★ Scoped to the FIRST SENTENCE, where a tool states what it does.
    // Scanning the whole description produced five false positives on a clean
    // tree — "The Register Data Centre" is a trade publication in get_news's
    // source list, and rank_sites / analyze_site / cluster_sites_by_latency all
    // refer to "the frozen mint", the candidate_id get_refined_queue issues.
    // A guard that cries wolf five times gets deleted rather than fixed, and
    // hand-excluding those names would make it a list of exceptions instead of
    // a rule. The first sentence is where the tool makes its own claim.
    //
    // Measured: this matches exactly claim_free_key, set_market_alert,
    // standing_intent and subscribe_digest — four genuine writes, all four
    // correctly annotated — and standing_intent's opening clause is
    // "register an intent once", so the case that motivated this file is
    // still caught if it is ever removed from WRITE_TOOLS again.
    const WRITES = /\bregisters?\b|\bcreates?\b|\bmints?\b|\bsubscribes?\b/i;
    const firstSentence = (d) => String(d || '').split(/(?<=[.!?])\s/, 1)[0];
    const offenders = TOOLS
      .filter((t) => t.annotations?.readOnlyHint === true)
      .filter((t) => WRITES.test(firstSentence(t.description)))
      .map((t) => t.name);
    expect(offenders).toEqual([]);
  });

  it('that write-word check can actually see a write', () => {
    // The tightening above narrows what the check reads, so prove it did not
    // narrow to nothing — a scope that matches no tool passes vacuously.
    const WRITES = /\bregisters?\b|\bcreates?\b|\bmints?\b|\bsubscribes?\b/i;
    const firstSentence = (d) => String(d || '').split(/(?<=[.!?])\s/, 1)[0];
    const writesInScope = TOOLS
      .filter((t) => WRITES.test(firstSentence(t.description)))
      .map((t) => t.name);
    expect(writesInScope).toContain('standing_intent');
    expect(writesInScope.length).toBeGreaterThanOrEqual(3);
  });

  it('read-only and destructive are never both true', () => {
    for (const t of TOOLS) {
      const a = t.annotations || {};
      if (a.readOnlyHint === true) expect(a.destructiveHint).not.toBe(true);
    }
  });
});
