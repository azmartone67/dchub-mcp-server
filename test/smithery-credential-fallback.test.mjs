/**
 * GUARD — the Smithery lane must accept EITHER credential name.
 *
 * WHAT WAS MEASURED (2026-09-02)
 *   dchub-mcp-server  SMITHERY_API_KEY  (created 2026-06-21)
 *     -> PATCH api.smithery.ai/servers/azmartone67/dchub
 *        HTTP 403 "Missing required permission: servers:write"
 *        on 08-29, 08-31 and 09-01 (run 33519871704). Never worked.
 *   dchub-backend     SMITHERY_TOKEN    (created 2026-06-02)
 *     -> `smithery mcp publish` succeeded 2026-09-01 20:01Z, returning a
 *        deploymentId. That is PUT /servers/{ns}/{srv}/releases — a DIFFERENT
 *        endpoint from the metadata PATCH, so it does not by itself prove
 *        servers:write.
 *
 * The working credential lived in the OTHER REPO under a DIFFERENT NAME. For
 * days this lane read as "the key must be reissued" when the likelier fix was
 * "point at the one that already works". Accepting either name means neither
 * repo silently owns the only copy, and the owner has two ways to fix it.
 *
 * ★ The fallback is a HYPOTHESIS THIS WORKFLOW TESTS, not a claim. If
 * SMITHERY_TOKEN also lacks servers:write, the next run says so and names the
 * scope. What this guard fences is that all THREE env bindings stay in sync —
 * a partial edit would leave one job silently keyless while the others work,
 * which is the hardest version of this bug to see.
 *
 * MUST-FAIL — executed 2026-09-02, each mutation confirmed applied:
 *   baseline                                   exit=0
 *   M1 drop the fallback from ONE binding      exit=1
 *   M2 drop it from all three                  exit=1
 *   M3 remove the env bindings entirely        exit=1  (anti-vacuous)
 *   M4 reverse the fallback order              exit=1
 *   M5 remediation stops naming the credential exit=1
 *
 * ★ M4 MISSED on the first run. The order check also accepted
 * `b.includes('SMITHERY_API_KEY }}')`, which a REVERSED binding
 * (`SMITHERY_TOKEN || SMITHERY_API_KEY }}`) satisfies just as well — so the
 * mutation sailed through a check written specifically to catch it. Removed;
 * the order is now asserted strictly. A disjunct the mutation also satisfies
 * is not a weaker assertion, it is no assertion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF = join(ROOT, '.github/workflows/smithery-freshness.yml');
const src = readFileSync(WF, 'utf8');

describe('smithery-freshness credential binding', () => {
  it('binds SMITHERY_API_KEY in at least one job (anti-vacuous)', () => {
    // If the bindings are gone entirely, every "all of them have the fallback"
    // assertion below is vacuously true. Anchor on their existence first.
    const bindings = src.match(/^\s*SMITHERY_API_KEY:\s*\$\{\{.*$/gm) || [];
    expect(
      bindings.length,
      'no SMITHERY_API_KEY env binding found — if the lane was removed on '
        + 'purpose, delete this test in the SAME commit rather than letting it '
        + 'pass by finding nothing to check',
    ).toBeGreaterThan(0);
  });

  it('EVERY binding falls back to SMITHERY_TOKEN', () => {
    const bindings = src.match(/^\s*SMITHERY_API_KEY:\s*\$\{\{.*$/gm) || [];
    const missing = bindings.filter((b) => !/secrets\.SMITHERY_TOKEN/.test(b));
    expect(
      missing,
      'a binding takes only secrets.SMITHERY_API_KEY. A partial edit leaves one '
        + 'job silently keyless while its siblings work — the hardest version of '
        + 'this bug to see',
    ).toEqual([]);
    // Order matters: this repo's OWN key must win when both are present, so a
    // repo-local override is never silently ignored in favour of the sibling's.
    //
    // ★ Assert the order STRICTLY. The first draft of this check also allowed
    // `b.includes('SMITHERY_API_KEY }}')`, which a reversed binding
    // (`SMITHERY_TOKEN || SMITHERY_API_KEY }}`) satisfies too — so the reversal
    // mutation passed. A disjunct that the mutation also satisfies is not a
    // weaker assertion, it is no assertion.
    for (const b of bindings) {
      expect(
        b,
        'fallback order reversed — the sibling repo\'s credential would win '
          + 'over this repo\'s own',
      ).toMatch(/secrets\.SMITHERY_API_KEY\s*\|\|\s*secrets\.SMITHERY_TOKEN/);
    }
  });

  it('the 403 remediation names the credential that already works', () => {
    // The operator-facing message is the whole deliverable of a lane that
    // cannot fix itself. It must not say "generate a new key" without first
    // naming the cheaper option.
    expect(src).toMatch(/SMITHERY_TOKEN \(which publishes releases/);
  });
});
