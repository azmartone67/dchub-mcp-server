/**
 * PASSIVE ARRIVAL COUNTER — challenges are OUR actions, arrivals are THEIRS.
 * (r-claude-arrivals, 2026-08-28)
 *
 * THE DEFECT THIS GUARDS. Every other counter in this family fires inside the
 * 401 branch, so `claude_connector` counts challenges we ISSUED. It was read
 * repeatedly as a measure of Claude connector traffic. It is not, and the two
 * numbers move independently:
 *
 *   - When r-challenge-after-value moved the challenge off `initialize`, the
 *     count fell ~99%. Nothing about arrivals changed; we asked less.
 *   - The count shrinks as the policy IMPROVES. Every caller served instead of
 *     401'd is a caller the challenge counter stops seeing, so "the fix worked"
 *     and "the cohort vanished" produce the same graph.
 *
 * `claude_connector_seen` exists to be immune to both. These assertions pin the
 * three properties that make it so — and each of them is a property a plausible
 * edit would remove:
 *
 *   1. OUTSIDE the 401 branch. Inside it, it is just a second challenge counter.
 *   2. NO hasSession bail. The ChatGPT block it is modelled on ends in
 *      `!(sessionId && sessions.has(sessionId))`. Correct there; fatal here —
 *      the Claude connector carries a session on every tools/call after the
 *      handshake, so a sessionless test counts handshakes and never a tool
 *      call. Same mistake r-challenge-identity already caught once in the
 *      challenge itself. It fails as a permanent, confident ZERO.
 *   3. NOT gated on _workosEnabled()/_challengeDisabled. A counter that
 *      switches off with the challenge cannot measure the challenge.
 *
 * Assertions run brace-depth containment over the real committed server.mjs,
 * because the bump is inline in the handler and a canon-only test would pass
 * while the wiring was wrong. Every containment check carries a vacuity guard
 * that ERRORS rather than passing when its anchor is missing.
 *
 * Pure-local: reads committed source and one exported pure function. No network.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
let SRC, LINES;

/** 1-indexed line number of the single code line matching `re`. Errors unless exactly one. */
function soleLine(re, label) {
  const hits = LINES.map((t, i) => ({ n: i + 1, t }))
    .filter((r) => re.test(r.t) && !/^\s*(\/\/|\*)/.test(r.t));
  if (hits.length !== 1) {
    throw new Error(`ANCHOR ${label}: expected exactly 1 match for ${re}, found ${hits.length}`
      + ' — the guard cannot check what it cannot find.');
  }
  return hits[0].n;
}

/** Strip comments and quoted text so their braces/parens never count. */
function codeOf(line) {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/**
 * Extent [open, close] of the BODY of an `if (...) { ... }` whose condition may
 * span lines and may itself contain object literals.
 *
 * ★A naive first-`{` brace walk is WRONG here and fails in the flattering
 * direction: the challenge condition contains `_claudeChallengeEligible({`, so
 * the first brace closes on `})) {` — several lines ABOVE the branch body. The
 * block would then look like it ends before its own contents, and a
 * containment test would report "not inside" for everything, passing whatever
 * it was handed. So: consume the condition by PAREN depth first, and only then
 * brace-walk from the `{` that actually opens the body.
 */
function conditionalBodyExtent(ifLine, label) {
  let paren = 0, started = false, i = ifLine - 1, bodyChar = -1;
  for (; i < LINES.length; i += 1) {
    const code = codeOf(LINES[i]);
    for (let c = 0; c < code.length; c += 1) {
      const ch = code[c];
      if (ch === '(') { paren += 1; started = true; }
      else if (ch === ')') {
        paren -= 1;
        if (started && paren === 0) { bodyChar = c + 1; break; }
      }
    }
    if (bodyChar >= 0) break;
  }
  if (bodyChar < 0) {
    throw new Error(`ANCHOR ${label}: condition starting at line ${ifLine} never closes`
      + ' — containment cannot be evaluated.');
  }
  let depth = 0, seenBrace = false;
  for (let j = i; j < LINES.length; j += 1) {
    const code = codeOf(LINES[j]).slice(j === i ? bodyChar : 0);
    for (const ch of code) {
      if (ch === '{') { depth += 1; seenBrace = true; }
      else if (ch === '}') {
        depth -= 1;
        if (seenBrace && depth === 0) return [ifLine, j + 1];
      }
    }
  }
  throw new Error(`ANCHOR ${label}: body opened after line ${ifLine} never closes`
    + ' — containment cannot be evaluated.');
}

beforeAll(() => {
  SRC = readFileSync(SERVER, 'utf8');
  LINES = SRC.split('\n');
});

// ── 1. CANON ────────────────────────────────────────────────────────────

describe('canon: the kind exists and the whitelist stays closed', () => {
  it('claude_connector_seen is a registered kind', () => {
    const kinds = /const _CH_KINDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(SRC);
    if (!kinds) throw new Error('ANCHOR _CH_KINDS: not found — cannot check the whitelist.');
    expect(kinds[1], 'the gateway emits a kind the whitelist would drop')
      .toMatch(/'claude_connector_seen'/);
  });

  it('the emit path still rejects anything not on the whitelist', () => {
    // The cardinality fence is the whole outage argument for an unauthenticated
    // counter: nothing client-supplied may ever become a Map key.
    const bump = SRC.slice(SRC.indexOf('function _chBump'));
    expect(bump.slice(0, 600), '_chBump no longer checks _CH_KINDS — client-controlled '
      + 'input can reach the Map key').toMatch(/_CH_KINDS\.has\(kind\)/);
  });
});

// ── 2. WIRING — the three properties that make it passive ───────────────

describe('wiring: it counts arrivals, not our own actions', () => {
  it('★ fires OUTSIDE the 401 challenge branch', () => {
    const seenLine = soleLine(/_chBump\('claude_connector_seen'/, 'passive bump');
    const challengeLine = soleLine(/_chBump\('claude_connector'/, 'challenge bump');
    // Walk out to the `if (` that opens the challenge branch, then take its extent.
    const ifLine = soleLine(
      /^\s*if \(_workosEnabled\(\) && !_challengeDisabled && _claudeChallengeEligible\(\{/,
      'challenge branch opening if');
    const [open, close] = conditionalBodyExtent(ifLine, 'challenge branch');

    expect(challengeLine >= open && challengeLine <= close,
      'sanity: the CHALLENGE bump should be inside the challenge branch — if this '
      + 'fails the anchors are wrong and the real assertion below proves nothing')
      .toBe(true);

    expect(seenLine >= open && seenLine <= close,
      `the passive bump (line ${seenLine}) is INSIDE the 401 branch (${open}-${close}). `
      + 'Then it counts challenges we issued, not callers we saw — which is the exact '
      + 'defect it was added to fix.').toBe(false);
  });

  it('★★ has NO hasSession bail — the trap that ships a permanent zero', () => {
    const seenLine = soleLine(/_chBump\('claude_connector_seen'/, 'passive bump');
    // The condition sits directly above the bump; scan back to its opening `if`.
    let open = seenLine;
    while (open > 1 && !/^\s*if \(/.test(LINES[open - 1])) open -= 1;
    if (open <= 1) throw new Error('ANCHOR passive condition: opening `if` not found.');
    const cond = LINES.slice(open - 1, seenLine - 1).join(' ');

    expect(cond, 'the passive counter bails on sessions. The Claude connector carries a '
      + 'session on EVERY tools/call after the handshake, so this counts handshakes and '
      + 'never a tool call — a confident, permanent zero on the series it exists to fill.')
      .not.toMatch(/sessions\.has\(/);

    // Vacuity: the condition must actually be the credential-scoped one.
    expect(cond, 'anchor drifted — this is not the passive condition')
      .toMatch(/x-api-key/);
  });

  it('★ is NOT gated on the challenge being enabled', () => {
    const seenLine = soleLine(/_chBump\('claude_connector_seen'/, 'passive bump');
    let open = seenLine;
    while (open > 1 && !/^\s*if \(/.test(LINES[open - 1])) open -= 1;
    const cond = LINES.slice(open - 1, seenLine - 1).join(' ');
    expect(cond, 'gating the arrival counter on _workosEnabled()/_challengeDisabled makes it '
      + 'go dark exactly when the challenge changes — the one moment it must keep counting')
      .not.toMatch(/_workosEnabled\(\)|_challengeDisabled/);
  });

  it('counts both challenge-eligible methods, not just one', () => {
    const seenLine = soleLine(/_chBump\('claude_connector_seen'/, 'passive bump');
    let open = seenLine;
    while (open > 1 && !/^\s*if \(/.test(LINES[open - 1])) open -= 1;
    const cond = LINES.slice(open - 1, seenLine - 1).join(' ');
    // _challengeMethod is initialize||tools/call. Pinning it here means a future
    // narrowing of the challenge cannot silently narrow the measurement too —
    // the mistake the ChatGPT instrument's own comment warns about.
    expect(cond, 'the passive counter no longer tracks _challengeMethod; if the challenge '
      + 'narrows, the denominator must NOT narrow with it').toMatch(/_challengeMethod/);
    expect(SRC, 'method argument dropped — every arrival would collapse into "other"')
      .toMatch(/_chBump\('claude_connector_seen', req\.body\?\.method\)/);
  });
});
