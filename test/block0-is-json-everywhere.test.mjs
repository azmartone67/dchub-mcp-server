// Block 0 of every tool result is JSON an agent can json.loads; the prose after it
// (agent line, "For your human" line) rides its own blocks (Grok 2026-10-04: get_fiber_intel,
// get_grid_intelligence, rank_markets returned JSON + "---" + prose in one block).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _splitHumanBlock } from '../server.mjs';
import { planFactHeaderStep } from '../lib/plan-fact-header.mjs';

const J = JSON.stringify({ routes: [{ id: 'r1', note: 'a\n\n---\n\nb' }], tier: 'anonymous' });
const AGENT = 'get_fiber_intel returned a free preview of Ashburn. Show your user the next line unchanged, including its link.';
const HUMAN = '→ **For your human:** This free DC Hub fiber preview of Ashburn shows 3 of 12 routes. The plans that include it are on this page: https://dchub.cloud/upgrade/h/x.y?buy=1';
const res = (text, extra = {}) => ({ content: [{ type: 'text', text }], structuredContent: { tier: 'anonymous' }, ...extra });

describe('_splitHumanBlock', () => {
  it('JSON + --- + agent line + human line: three blocks, block 0 parses', () => {
    const r = _splitHumanBlock(res(J + '\n\n---\n\n' + AGENT + '\n\n' + HUMAN));
    expect(r.content.length, 'control: it split').toBe(3);
    expect(JSON.parse(r.content[0].text).tier).toBe('anonymous');
    expect(r.content[1].text).toBe(AGENT);
    expect(r.content[2].text.startsWith('→ **For your human:**')).toBe(true);
    expect(r.content[2].text).toBe(HUMAN);
    expect(r.structuredContent).toEqual({ tier: 'anonymous' });
  });
  it('a "---" inside a JSON string is not the split point', () => {
    const r = _splitHumanBlock(res(J + '\n\n---\n\n' + HUMAN));
    expect(JSON.parse(r.content[0].text).routes[0].note).toBe('a\n\n---\n\nb');
    expect(r.content.map((b) => b.text)).toEqual([J, HUMAN]);
  });
  it('JSON followed directly by the human line (no rule) splits too', () => {
    const r = _splitHumanBlock(res(J + '\n\n' + HUMAN));
    expect(r.content.map((b) => b.text)).toEqual([J, HUMAN]);
  });
  it('left alone: already-JSON block 0, errors, prose-first text, JSON-only, later blocks kept', () => {
    const ok = res(J);
    expect(_splitHumanBlock(ok)).toBe(ok);
    const own = { content: [{ type: 'text', text: J }, { type: 'text', text: HUMAN }] };
    expect(_splitHumanBlock(own)).toBe(own);
    const err = res(J + '\n\n---\n\n' + HUMAN, { isError: true });
    expect(_splitHumanBlock(err)).toBe(err);
    const prose = res('🔒 **This answer hid x.** ' + HUMAN);
    expect(_splitHumanBlock(prose)).toBe(prose);
    const more = { content: [{ type: 'text', text: J + '\n\n' + HUMAN }, { type: 'text', text: 'tail' }] };
    expect(_splitHumanBlock(more).content.map((b) => b.text)).toEqual([J, HUMAN, 'tail']);
    expect(_splitHumanBlock(null)).toBe(null);
  });
});

describe('wiring', () => {
  it('the step sits inside _flagUpstreamError, which stays outermost', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    // r-relay-contract (2026-10-06): the relay chokepoint wraps the split step, still inside the flag.
    // Grok audit 2026-10-08: _oneLinkWallStep wraps the contract step (it needs the final human_url)
    // and _partnerInboxStep is outermost but the flag; the flag stays outermost.
    // Revenue plan item 5 (2026-10-08): _emailHintStep wraps that one (it only appends a link-free line).
    // Conversion panel 2026-10-11: _gatedPreviewStep (analyze_site only) is the last step but the flag.
    expect(src).toContain('async (args, extra) => _flagUpstreamError(_gatedPreviewStep(_bindNoticeOnceStep(_emailHintStep(await _partnerInboxStep(_oneLinkWallStep(_relayContractStep(_splitHumanBlock(_jsonFirstBlock(_guideAuthWall(');
  });
});

// ★ EXCEPTION, deliberate (Grok colocation eval 2026-11-17, "lead length" 12 of 12): the FINISHED execute_plan answer
// leads with a plain-language block of at most 600 characters (lib/plan-lead-text.mjs, last step of _sourceLineCb), and
// the plan JSON below is its block 1. Pinned in test/plan-colocation-eval-1117.test.mjs and test/plan-fact-header.test.mjs.
// Every other tool, and execute_plan with compact:false, still leads with JSON.
// execute_plan's fact header (Gemini traction spec, mcp#1472; brain decision 2026-11-16): the header is block 0's
// FIRST KEY, never text ahead of the JSON. Covered here at the step; the real /mcp handler with the default
// compact=true, where it must actually have run (fact_header present), is covered in test/plan-fact-header.test.mjs.
describe('execute_plan with the fact header: block 0 still parses', () => {
  it('the step leaves block 0 valid JSON with fact_header as its first key', () => {
    const sc = { _entity: 'plan_execution', dcpi_verdict: { market_slug: 'phoenix', verdict: 'CAUTION', composite_score: 43.5 },
      executed: [], provenance: { as_of: '2026-11-12', as_of_kind: 'source' } };
    const r = { content: [{ type: 'text', text: JSON.stringify(sc) }, { type: 'text', text: HUMAN }], structuredContent: sc };
    const out = planFactHeaderStep(r, { env: {} });
    const b0 = JSON.parse(out.content[0].text);
    expect(Object.keys(b0)[0]).toBe('fact_header');
    expect(b0.fact_header).toMatch(/^SOURCE: DC Hub \(dchub\.cloud\) \| AS_OF: 2026-11-12\n/);
  });

  // Through the real /mcp handler (default compact): test/plan-fact-header.test.mjs, "through the real handler",
  // asserts block 0 parses and leads with fact_header. Not here: this file imports server.mjs statically (above), so
  // a harness started here would run the server against the production DCHUB_API_BASE, not its loopback stub, and
  // the hard gate refuses a file that reaches off loopback.
});
