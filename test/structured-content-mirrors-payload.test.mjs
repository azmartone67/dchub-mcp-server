// ── structuredContent must never hide the payload content[] is carrying ──────
//
// THE DEFECT, measured live 2026-09-02 against https://dchub.cloud/mcp.
// `search_facilities` shipped responses whose two halves DISAGREED:
//
//   content[0].text   → {"data":[…10 rows…],"success":true,"pagination":{…}}
//   structuredContent → {_bind,_entity,citation,identity,provenance,quota}
//
// Captured 7/7 times in a single suite run: full rows on one surface, ZERO on
// the other. No `error`, no `isError`, no `success:false`. A client that
// prefers structuredContent — Claude Desktop / Claude.ai, and any SDK client,
// because it is the well-formed machine surface — reads no facilities and
// cannot distinguish that from "nothing matched in Virginia".
//
// THE CAUSE. A decorator wanting to add ONE metadata key wrote
// `result.structuredContent ? {...} : {}`. For the ~40 tools whose handler puts
// the payload only in content[0].text, that `: {}` MINTS an sc the data was
// never in; every later decorator then stamps its own key onto that same empty
// object, and the envelope-only sc above is what ships. `_bind` was present in
// exactly the 7 broken responses and absent from all 6 healthy ones in the same
// run — 13/13 — which is what identified withBindHint as the fabricator.
//
// It is the SAME defect class as the 2026-06-21 next_session fix documented at
// the top of lib/result-shaping.mjs, reintroduced through a different decorator.
// That is why the repair is a SHARED helper (scForStamp) and why this file
// tests the INVARIANT rather than the one tool that exposed it: the next
// decorator someone adds is the one that matters.
//
// ★ WHY NOT A TRANSPORT TEST. Both arms need a real upstream payload to mirror,
// and the offline harness points DCHUB_API_BASE at an unroutable host — every
// handler returns an error, `withBindHint` bails at `result.isError`, and the
// defect cannot arise. So these drive the exported decorators directly with the
// EXACT shape captured off the wire. The production check is the live
// regression suite, which reads structuredContent and went red on this.
import { describe, it, expect } from 'vitest';
import { scForStamp, payloadObjFromContent } from '../lib/result-shaping.mjs';
import { withBindHint, withFreshness } from '../server.mjs';

// The live shape, reproduced: payload ONLY in content[0].text, no sc.
const liveShape = () => ({
  content: [{
    type: 'text',
    text: JSON.stringify({
      data: [{ id: 1, name: 'Ashburn DC', country: 'US' }, { id: 2, name: 'Reston DC', country: 'US' }],
      success: true,
      count: 2,
      pagination: { page: 1 },
    }),
  }],
});

// An unbound free caller — the cohort withBindHint fires for.
const unboundCaller = { tier: 'free', email: null, session_id: null };

describe('scForStamp — mirror or decline, never fabricate', () => {
  it('no structuredContent → mirrors the content[0] payload', () => {
    const sc = scForStamp(liveShape());
    expect(sc).not.toBeNull();
    expect(Array.isArray(sc.data)).toBe(true);
    expect(sc.data).toHaveLength(2);
    expect(sc.success).toBe(true);
  });

  it('handler-set structuredContent is authoritative and copied as-is', () => {
    const handlerSc = { data: [{ id: 9 }], iso: 'ERCOT' };
    const sc = scForStamp({ content: [{ type: 'text', text: '{"data":[{"id":1}]}' }], structuredContent: handlerSc });
    expect(sc).toEqual(handlerSc);
    expect(sc).not.toBe(handlerSc);   // a copy — callers mutate it
  });

  it('nothing safely mirrorable → null, so the caller leaves sc absent', () => {
    // A bare array and a prose block are both unmirrorable: MCP structuredContent
    // must be an object, and inventing one would hide content[].
    expect(scForStamp({ content: [{ type: 'text', text: '[1,2,3]' }] })).toBeNull();
    expect(scForStamp({ content: [{ type: 'text', text: 'Source: DC Hub' }] })).toBeNull();
    expect(scForStamp({ content: [] })).toBeNull();
    expect(scForStamp(null)).toBeNull();
    expect(scForStamp({})).toBeNull();
  });

  it('never returns an EMPTY object — that is the whole defect', () => {
    for (const r of [liveShape(), { content: [] }, { content: [{ type: 'text', text: 'prose' }] }, {}]) {
      const sc = scForStamp(r);
      expect(sc === null || Object.keys(sc).length > 0).toBe(true);
    }
  });
});

describe('withBindHint — THE REPRO: the hint must not cost the caller the data', () => {
  it('payload only in content[0] → sc carries the rows AND the hint', () => {
    const out = withBindHint(liveShape(), 'search_facilities', unboundCaller);
    const sc = out.structuredContent;
    expect(sc).toBeTruthy();
    expect(sc._bind).toBeTruthy();                       // the hint still lands
    expect(Array.isArray(sc.data)).toBe(true);           // ← was ABSENT: the bug
    expect(sc.data).toHaveLength(2);
    expect(sc.success).toBe(true);
    expect(sc.count).toBe(2);
  });

  it('the two halves agree — every content[0] payload key is in sc', () => {
    const out = withBindHint(liveShape(), 'search_facilities', unboundCaller);
    const fromContent = payloadObjFromContent(out.content);
    for (const k of Object.keys(fromContent)) {
      expect(Object.keys(out.structuredContent)).toContain(k);
    }
  });

  it('sc is never envelope-only when content[0] carries a payload', () => {
    // The exact assertion the live failure would have caught: an sc whose keys
    // are ALL metadata means the data is hidden.
    const out = withBindHint(liveShape(), 'search_facilities', unboundCaller);
    const META = new Set(['_bind', '_entity', 'citation', 'identity', 'provenance', 'quota', 'freshness', 'next_session', 'resume']);
    const dataKeys = Object.keys(out.structuredContent).filter((k) => !META.has(k));
    expect(dataKeys.length).toBeGreaterThan(0);
  });

  it('unmirrorable payload → hint SKIPPED rather than sc fabricated', () => {
    const bare = { content: [{ type: 'text', text: '[{"id":1}]' }] };   // bare array
    const out = withBindHint(bare, 'search_facilities', unboundCaller);
    expect(out.structuredContent).toBeUndefined();   // client falls back to content[]
    expect(out.content).toEqual(bare.content);       // data untouched
  });

  it('a handler that set full sc is unchanged apart from the hint', () => {
    const full = { content: [{ type: 'text', text: '{"data":[{"id":1}]}' }], structuredContent: { data: [{ id: 1 }], iso: 'ERCOT' } };
    const out = withBindHint(full, 'search_facilities', unboundCaller);
    expect(out.structuredContent.iso).toBe('ERCOT');
    expect(out.structuredContent.data).toEqual([{ id: 1 }]);
    expect(out.structuredContent._bind).toBeTruthy();
  });

  it('still a no-op where it always was — errors, bound callers, other tools', () => {
    expect(withBindHint({ ...liveShape(), isError: true }, 'search_facilities', unboundCaller).structuredContent).toBeUndefined();
    expect(withBindHint(liveShape(), 'search_facilities', { tier: 'paid' }).structuredContent).toBeUndefined();
    expect(withBindHint(liveShape(), 'get_news', unboundCaller).structuredContent).toBeUndefined();
  });
});

describe('withFreshness — the same fabrication, fixed the same way', () => {
  it('payload only in content[0] → sc carries the rows AND freshness', () => {
    const out = withFreshness(liveShape(), 'get_fiber_intel');
    expect(out.structuredContent).toBeTruthy();
    expect(out.structuredContent.freshness).toBeTruthy();
    expect(Array.isArray(out.structuredContent.data)).toBe(true);   // ← was ABSENT
    expect(out.structuredContent.data).toHaveLength(2);
  });

  it('unmirrorable payload → no fabricated sc (content-only, banner still added)', () => {
    const bare = { content: [{ type: 'text', text: '[1,2]' }] };
    const out = withFreshness(bare, 'get_fiber_intel');
    expect(out.structuredContent).toBeUndefined();
    expect(out.content.length).toBeGreaterThanOrEqual(1);
  });
});

describe('the invariant, stated once: sc never hides what content[] shows', () => {
  // Chain them the way the handler does (withBindHint runs first, at
  // server.mjs:11878) and assert the property survives composition — a
  // per-decorator test would not catch a pair that each behave and compose badly.
  it('composed decorators keep the payload on BOTH surfaces', () => {
    const chained = withFreshness(withBindHint(liveShape(), 'get_fiber_intel', unboundCaller), 'get_fiber_intel');
    const fromContent = payloadObjFromContent(chained.content);
    expect(fromContent.data).toHaveLength(2);
    for (const k of Object.keys(fromContent)) {
      expect(Object.keys(chained.structuredContent)).toContain(k);
    }
    expect(chained.structuredContent._bind).toBeTruthy();
    expect(chained.structuredContent.freshness).toBeTruthy();
  });
});
