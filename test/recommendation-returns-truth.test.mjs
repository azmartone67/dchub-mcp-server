// r-recommendation-returns-truth (2026-08-29). backend#3308 corrected the
// get_dchub_recommendation tools/list description, which had promised a return
// shape the route has never emitted:
//
//   top_markets[] · candidate_facilities[] · factor_breakdown{} ·
//   summary_text · citation_url
//
// It landed the correction in dchub-backend/worker.js and treated the manual
// Cloudflare paste as the moment agents would start reading the truth.
//
// ★MEASURED 2026-08-29, AFTER THAT PASTE WAS LIVE: they did not.
//
//   curl -sI https://dchub.cloud/grid/            -> 4.9.46-recommendation-returns-truth
//   curl -sI https://dchub.cloud/.well-known/...  -> 4.9.46-recommendation-returns-truth
//   grep -c candidate_facilities <deployed worker.js>  -> 0
//   POST https://dchub.cloud/mcp tools/list       -> ALL FIVE PHANTOM FIELDS
//   GET  https://dchub.cloud/.well-known/mcp.json -> ALL FIVE PHANTOM FIELDS
//
// worker.js:448 is why: `MCP_BACKEND` — the zone worker PROXIES /mcp and
// /.well-known/* upstream and only STAMPS its version header on the response.
// Its own inline tool list is a FALLBACK. The version literal says so out
// loud: `manifest-version-derived`.
//
// So the description an agent actually reads is registered HERE, in this
// repo, and nothing in this repo asserted on it. A version bump on the edge
// was standing in as proof that the agent-facing contract had changed.
// That is the same defect class the correction was written to fix: a claim
// published with nothing able to falsify it.
//
// ★VALIDATION LIMIT, STATED PLAINLY: this file reads the SOURCE literal, not a
// live response. It proves what this repo declares; it cannot prove what
// production serves — that needs an out-of-repo probe of POST /mcp. What it
// does close is the drift that caused the bug: server.mjs and mcp-server.json
// disagreeing, and either one quietly reacquiring the phantom contract.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(
  readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'),
);

const TOOL = 'get_dchub_recommendation';

// The five fields the route has never emitted. Named explicitly: an omission
// cannot be asserted against, only a named set can.
const PHANTOM = [
  'top_markets', 'candidate_facilities', 'factor_breakdown',
  'summary_text', 'citation_url',
];

// What the route DOES emit after backend#3308 — the miss-signal fields that
// let an agent tell a parsed answer from the generic blurb.
const REAL = ['matched_category', 'context_understood', 'next_tools'];

// Read the description out of the registration call rather than transcribing
// it — a copy here would drift from the live surface, which is the whole
// failure class this repo keeps hitting.
function descOf(tool) {
  const at = SRC.indexOf(`trackedTool(srv, '${tool}',`);
  if (at < 0) return null;
  const m = SRC.slice(at).match(
    /trackedTool\(srv, '[a-z_0-9]+',\s*\n?\s*'((?:[^'\\]|\\.)*)'/,
  );
  return m ? m[1] : null;
}

function manifestDescOf(tool) {
  const hit = (MANIFEST.tools || []).find((t) => t && t.name === tool);
  return hit ? hit.description : null;
}

describe('get_dchub_recommendation publishes a return shape that exists', () => {
  // Without this, a regex that returns null would make every assertion below
  // pass vacuously — the empty-parse-passes-all trap.
  it('parses a real description from both surfaces (guard against a vacuous pass)', () => {
    const a = descOf(TOOL);
    const b = manifestDescOf(TOOL);
    expect(a, 'server.mjs description did not parse').toBeTruthy();
    expect(b, 'mcp-server.json has no entry for the tool').toBeTruthy();
    expect(a.length, 'server.mjs description implausibly short — parse is wrong')
      .toBeGreaterThan(300);
    expect(b.length, 'manifest description implausibly short').toBeGreaterThan(300);
  });

  it('promises none of the five fields the route has never emitted', () => {
    for (const surface of [['server.mjs', descOf(TOOL)],
                           ['mcp-server.json', manifestDescOf(TOOL)]]) {
      const [where, d] = surface;
      for (const f of PHANTOM) {
        expect(d, `${where} still promises phantom field ${f}`).not.toContain(f);
      }
    }
  });

  it('names the miss-signal fields an agent needs to detect the generic blurb', () => {
    for (const surface of [['server.mjs', descOf(TOOL)],
                           ['mcp-server.json', manifestDescOf(TOOL)]]) {
      const [where, d] = surface;
      for (const f of REAL) {
        expect(d, `${where} never names ${f}`).toContain(f);
      }
    }
  });

  it('says free text does not parse, rather than demonstrating it as correct usage', () => {
    // The original Example line demoed the free-text form — the exact call that
    // silently returns a brochure — as the way to use the tool.
    const d = descOf(TOOL);
    expect(d).toContain('does NOT parse');
    expect(d.toLowerCase()).toContain('four literal categories');
  });

  // The two surfaces disagreeing is what let the phantom contract survive a
  // correction in a third place. Pin them equal.
  it('server.mjs and mcp-server.json serve the identical description', () => {
    expect(manifestDescOf(TOOL)).toBe(descOf(TOOL));
  });
});
