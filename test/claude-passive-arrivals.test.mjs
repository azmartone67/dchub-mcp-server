// r-claude-passive-arrivals (2026-08-28) — the Claude ARRIVAL counter is passive.
//
// WHAT THIS LOCKS, and why it is a source test rather than a behavioral one.
// `_chBump` is not exported, but the property that matters here is not THAT it
// increments — it is WHERE. `claude_connector` has exactly one call site, inside
// the branch that sets WWW-Authenticate and returns 401, so it counts challenges
// WE ISSUE. When r-challenge-after-value narrowed the trigger on 2026-08-15 that
// series fell ~159/day to ~0 the next day BY DESIGN, and three separate passes
// read our own restraint as the Claude cohort disappearing.
//
// A counter placed inside the challenge branch cannot answer "did they arrive?".
// So the assertion below is structural: the new bump must live OUTSIDE any branch
// that issues a 401. A behavioral test of _chBump would pass either way and would
// have caught none of this.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

// A fixture that silently read empty would satisfy every "not inside" assertion.
it('fixture is real', () => {
  expect(SRC.length).toBeGreaterThan(100_000);
});

describe('claude_connector_seen — counts THEIR arrivals, not OUR challenges', () => {
  it('is on the closed kind whitelist, or every bump is silently dropped', () => {
    const m = SRC.match(/const _CH_KINDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(m, '_CH_KINDS not found').toBeTruthy();
    expect(m[1]).toContain("'claude_connector_seen'");
    expect(m[1]).toContain("'chatgpt_connector_seen'"); // sibling must survive
  });

  it('has exactly one call site', () => {
    const hits = SRC.match(/_chBump\('claude_connector_seen'/g) || [];
    expect(hits.length).toBe(1);
  });

  it('THE PROPERTY: its call site issues no 401 — passive, unlike claude_connector', () => {
    const idx = SRC.indexOf("_chBump('claude_connector_seen'");
    expect(idx).toBeGreaterThan(-1);
    // The enclosing block: from the nearest preceding `if (` to the bump.
    const before = SRC.slice(Math.max(0, idx - 900), idx);
    const block = before.slice(before.lastIndexOf('\n    if ('));
    expect(block, 'arrival bump sits inside a WWW-Authenticate branch')
      .not.toContain('WWW-Authenticate');
    expect(block, 'arrival bump sits inside a 401 branch').not.toContain('status(401)');
  });

  it('CONTRAST (locks the distinction): claude_connector IS inside the 401 branch', () => {
    const idx = SRC.indexOf("_chBump('claude_connector'");
    expect(idx).toBeGreaterThan(-1);
    const around = SRC.slice(idx, idx + 900);
    expect(around).toContain('status(401)');
  });

  it('shares the ChatGPT probe gates, so the two series stay comparable', () => {
    const idx = SRC.indexOf("_chBump('claude_connector_seen'");
    const block = SRC.slice(Math.max(0, idx - 900), idx);
    const cond = block.slice(block.lastIndexOf('\n    if ('));
    expect(cond).toContain("=== 'claude'");
    expect(cond).toContain('_challengeMethod');
    expect(cond).toContain("!req.headers['x-api-key']");
    expect(cond).toContain('!_workosAuthed');
    expect(cond).toContain('sessions.has(sessionId)');
  });
});
