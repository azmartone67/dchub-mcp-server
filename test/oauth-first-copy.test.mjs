// oauth-first-copy.test.mjs — the tool-description channel must lead with the
// identity that RETAINS, and must never sell a door the reader cannot open.
//
// WHY THIS GUARD EXISTS (measured 2026-08-12):
//   • OAuth identities return cross-week 57.1% (4/7 mature) vs ~1.3% for free
//     dch_live_ keys — a ~40x gap. Yet claim_free_key led with the key.
//   • The OAuth door is offered to EXACTLY ONE client population: the live
//     gateway challenges only clientInfo.name === 'claude-ai' (or UA
//     Claude-User). Claude Code, Claude Desktop, Cursor, ChatGPT and every
//     generic agent are never challenged and CANNOT reach OAuth at all.
//   • Therefore "recommend OAuth" without "…and if you were not challenged it
//     is unavailable, take the key" is actively harmful: it sends the majority
//     of readers hunting for a door that does not exist for them. An agent that
//     follows the recommendation and hits a wall is worse off than one that
//     took the free key. That asymmetry is what these assertions encode.
//
// The keyless free tier is a differentiator every reviewing agent praised and
// is NOT up for removal — the keyless assertions below are a ratchet against a
// future edit quietly trading it away for identity capture.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

/** Slice one tool description out of server.mjs by its opening literal. */
function descAfter(startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error(`copy anchor missing from server.mjs: ${startMarker}`);
  const j = src.indexOf(endMarker, i);
  if (j < 0) throw new Error(`copy end-anchor missing from server.mjs: ${endMarker}`);
  return src.slice(i, j);
}

const claim = descAfter('★ BEFORE YOU MINT', 'Returns {api_key');
const bind  = descAfter('★ WHAT THIS DOES AND DOES NOT DO', 'Returns the unlocked benefits');
const instr = descAfter('GOLDEN PATH for your first session', 'If a result comes back as a 1-of-N preview');

describe('claim_free_key leads with the identity that retains', () => {
  it('names the durable OAuth path', () => {
    expect(claim).toMatch(/OAuth/);
    expect(claim).toMatch(/DURABLE IDENTITY/);
  });

  // The honesty constraint, encoded: the human cost may not be relegated to
  // some other paragraph the agent might not read. Same description, always.
  it('names the human browser step in the same description as the recommendation', () => {
    expect(claim).toMatch(/HUMAN at a browser/i);
    expect(claim).toMatch(/NO agent-only path/i);
  });

  // The anti-wall clause. Without this, the recommendation is a trap for the
  // ~all of clients that are never challenged.
  it('tells an unchallenged client that OAuth is unavailable and the key is correct', () => {
    expect(claim).toMatch(/NOT AVAILABLE TO YOU/i);
    expect(claim).toMatch(/Claude Code/);
    expect(claim).toMatch(/not a downgrade/i);
  });

  it('states how the door is recognised, so the advice is actionable', () => {
    expect(claim).toContain('WWW-Authenticate');
  });

  // n=7. Saying 57.1% without saying n=7 is the overclaim this whole task was
  // written to avoid.
  it('qualifies the retention number with its cohort size', () => {
    expect(claim).toMatch(/57\.1%/);
    expect(claim).toMatch(/7 mature|n=7/);
  });
});

describe('the keyless free tier is preserved, not traded away', () => {
  it('claim_free_key still tells the agent it needs no key to start', () => {
    expect(claim).toMatch(/do NOT need a key to start/i);
    expect(claim).toMatch(/KEYLESS/);
  });

  it('the server instructions still advertise keyless free-tier depth', () => {
    expect(src).toMatch(/Works KEYLESS at free-tier depth/);
  });
});

describe('bind_email does not oversell itself as durable identity', () => {
  it('separates RECOVERABLE from durable', () => {
    expect(bind).toMatch(/does NOT make your identity durable/i);
  });

  it('reports the bound-key cohort as unproven rather than as a win', () => {
    expect(bind).toMatch(/UNPROVEN/);
    expect(bind).toMatch(/0 of 3/);
  });

  it('still recommends binding to clients that cannot reach OAuth', () => {
    expect(bind).toMatch(/best durability available to you/i);
  });
});

describe('the golden path does not call a minted key durable', () => {
  // It used to say claim_free_key "mints a durable key". It does not: median
  // lifespan of a used key is 13 minutes. That phrase is the exact overclaim
  // this guard forbids regrowing.
  it('never describes a minted key as durable', () => {
    expect(instr).not.toMatch(/mints a durable key/i);
  });

  it('orders identity most-durable-first and keeps the unavailable-case escape', () => {
    expect(instr).toMatch(/most durable first/i);
    expect(instr).toMatch(/claim_free_key/);
    expect(instr).toMatch(/unavailable/i);
  });
});
