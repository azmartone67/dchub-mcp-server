// The `Returns:` contract an agent reads before it decides to call.
//
// get_dchub_recommendation advertised a return shape that has NEVER existed:
//   {top_markets[], candidate_facilities[], factor_breakdown{}, summary_text,
//    citation_url}
// The route emits none of them. It is the #5 paid-demand tool (244 calls / 95
// distinct free users in 30d) and every one of those agents read a contract the
// response could not satisfy.
//
// ★ WHY THIS FILE EXISTS. backend #3308 fixed that description in
//   `dchub-backend/worker.js` and its commit message asserted the fixed copy was
//   "the tools/list DESCRIPTION an agent reads". It is not. Measured 2026-08-29,
//   after the 4.9.46 Cloudflare paste went live on every route:
//     /mcp  ->  x-dc-hub-source: worker-mcp-passthrough, x-dc-hub-backend: railway
//   The worker PROXIES tools/list; it does not answer it. The live string came
//   from server.mjs here, byte-for-byte, and did not change. worker.js holds the
//   origin-down FALLBACK array only, which is invisible while the origin is up.
//
//   So the fix landed in a copy nothing reads, the version header went green,
//   and NOTHING in either repo could tell the difference. That is the defect
//   class this whole sweep is about: a claim published with no possible red
//   state. This file is the red state.
//
// Scoped deliberately to this one tool: another tool may legitimately return a
// field named `top_markets` one day. `per_factor_breakdown` (score_facility's
// Pro-locked section list) is a real field and must keep working, hence the
// negative lookbehind.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const TOOL = 'get_dchub_recommendation';

function descFromServerMjs() {
  const src = readFileSync(ROOT + 'server.mjs', 'utf8');
  const line = src.split('\n').find(l => l.includes(`trackedTool(srv, '${TOOL}'`));
  expect(line, `${TOOL} is not registered in server.mjs`).toBeTruthy();
  const m = line.match(new RegExp(`trackedTool\\(srv, '${TOOL}', '(.*)'\\s*,\\s*$`));
  expect(m, `could not parse the ${TOOL} description out of server.mjs`).toBeTruthy();
  return m[1];
}

function descFromManifest() {
  const j = JSON.parse(readFileSync(ROOT + 'mcp-server.json', 'utf8'));
  const t = (j.tools || []).find(t => t.name === TOOL);
  expect(t, `${TOOL} missing from mcp-server.json`).toBeTruthy();
  return t.description;
}

// Fields the route has never emitted. A ban, not a ratchet: if the route is ever
// built to return one of these, delete its entry in the SAME PR that ships it.
const PHANTOM = [
  { name: 'top_markets', re: /top_markets/ },
  { name: 'candidate_facilities', re: /candidate_facilities/ },
  { name: 'factor_breakdown', re: /(?<!per_)factor_breakdown/ },
  { name: 'summary_text', re: /summary_text/ },
  { name: 'citation_url', re: /citation_url/ },
];

// Measured live 2026-08-29 against /api/agents/recommend on BOTH paths.
const ALWAYS_RETURNED = ['recommendation', 'matched_category', 'context_understood',
                         'top_pocket', 'related_intel', 'available_categories'];
const MISS_PATH_ONLY  = ['is_generic_answer', 'answer_note', 'next_tools'];

describe(`${TOOL} Returns: contract`, () => {
  it('promises no field the route has never emitted', () => {
    for (const surface of [['server.mjs', descFromServerMjs()],
                           ['mcp-server.json', descFromManifest()]]) {
      const [where, desc] = surface;
      for (const p of PHANTOM) {
        expect(p.re.test(desc), `${where}: ${TOOL} still advertises phantom field ${p.name}`)
          .toBe(false);
      }
    }
  });

  it('names the fields the route actually always returns', () => {
    const desc = descFromServerMjs();
    for (const f of ALWAYS_RETURNED) {
      expect(desc.includes(f), `${TOOL} description omits always-returned field ${f}`).toBe(true);
    }
  });

  it('publishes the miss-path signal, so a generic answer is detectable', () => {
    const desc = descFromServerMjs();
    for (const f of MISS_PATH_ONLY) {
      expect(desc.includes(f), `${TOOL} description omits miss-path field ${f} — an agent ` +
        `cannot tell a generic blurb from an answer without it`).toBe(true);
    }
  });

  // The 08-29 failure was two copies disagreeing while one of them was invisible.
  it('server.mjs and mcp-server.json carry the SAME description', () => {
    expect(descFromManifest()).toBe(descFromServerMjs());
  });
});
