// ── The anon-seat fence ──────────────────────────────────────────────────────
//
// The anonymous seat is the first impression every arriving agent gets, and
// the 2026-08-07 audit found three flagship first-call surfaces lying to it:
//   1. keyless callers told `caller_tier: 'pro'` (the backend's tier — this
//      server's credentials — echoed to the agent), so the upgrade prompt
//      never fires: the agent concludes its human already pays;
//   2. the depth-tease's structuredContent excluded the very sections its own
//      message claimed to be showing (schema-aware clients read
//      structuredContent as THE result → zero data at first contact);
//   3. published counts drifting from canon on served strings.
//
// This file fences the CLASS, not the instances: (a) no envelope served to a
// keyless seat may claim a paid tier, enforced at the one chokepoint every
// return path crosses; (b) a tease envelope must carry the data its message
// names, in both channels; (c) every plus-suffixed entity count an agent can
// be served equals the canon-owned phrase.
//
// Canon comes from canonical/canon_phrases.json — the daily-refreshed
// snapshot of https://dchub.cloud/api/v1/canon/phrases (same source the
// smithery-canon-guard and instructions-canon-parity fences read), so this
// stays deterministic: no network, and a canon roll updates the expectation
// automatically.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { honestCallerTier } from '../lib/honest-tier.mjs';
import { trimForTrial, buildDepthTease } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const canon = JSON.parse(readFileSync(
  new URL('../canonical/canon_phrases.json', import.meta.url), 'utf8'));

// Every tier label that implies somebody paid (or registered) — none of these
// may ever describe a keyless seat.
const PAID_TIERS = ['pro', 'paid', 'enterprise', 'developer', 'starter', 'founding', 'team'];

const asEnvelope = (payload) => ({
  structuredContent: payload,
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

describe('anon-seat fence — caller_tier honesty at the chokepoint', () => {
  it('honestCallerTier wraps the registerTool callback, where every return path has merged', () => {
    // The 08-05 fix (#136) sat on the clean full-data return — but the tier
    // lie lives on the EARLY returns (anon trim, daily cap, gate.capped,
    // depth tease, paywall, monthly quota), which exit the handler before
    // that line. The correction must sit where all of them merge.
    expect(SRC).toMatch(/_honestCallerTier\(\s*_ensureStructured\(await _stamped\(args, extra\)\)/);
  });

  it('is not attached only on the clean inner return (the reachability bug, re-fenced)', () => {
    const cleanReturn = SRC.match(/withReturnNudge\(withCookbookHint\(withFrontDoorNudge\([^\n]*/);
    expect(cleanReturn).toBeTruthy();
    expect(cleanReturn[0]).not.toContain('_honestCallerTier');
  });

  it('no trimmed anonymous preview can claim a paid tier — any of them', () => {
    for (const lie of PAID_TIERS) {
      // The exact escape path: backend payload carries ITS caller's tier,
      // trimForTrial keeps non-metric strings, the preview returns early.
      const trimmed = trimForTrial({ rows: [{ name: 'x' }], total_mw: 1234, caller_tier: lie });
      const out = honestCallerTier(asEnvelope(trimmed), { tier: null }); // keyless seat
      expect(PAID_TIERS, `structuredContent still claims '${lie}' for a keyless seat`)
        .not.toContain(out.structuredContent.caller_tier);
      expect(PAID_TIERS, `content[0] still claims '${lie}' for a keyless seat`)
        .not.toContain(JSON.parse(out.content[0].text).caller_tier);
    }
  });

  it('a keyed FREE seat is corrected the same way (validated key ≠ paid)', () => {
    const trimmed = trimForTrial({ rows: [], caller_tier: 'pro' });
    const out = honestCallerTier(asEnvelope(trimmed), { tier: 'free', api_key: 'dch_live_fence' });
    expect(out.structuredContent.caller_tier).toBe('free');
  });

  it('never demotes a genuinely paid seat (the same lie pointing the other way)', () => {
    const out = honestCallerTier(asEnvelope({ rows: [], caller_tier: 'free' }), { tier: 'pro' });
    expect(out.structuredContent.caller_tier).toBe('pro');
  });
});

describe('anon-seat fence — the tease serves what its message names', () => {
  // get_iso_context's free preview: the backend pre-builds _free_preview
  // (headline + 1 news + named locked sections). The audit found the tease's
  // structuredContent carried only {tease, tool, upgrade} — "showing the
  // headline + top 3" alongside ZERO sections.
  const backendPayload = {
    ok: true, iso: 'ERCOT', name: 'ERCOT',
    sections: [{ id: 'grid' }, { id: 'dcpi' }, { id: 'queue' }, { id: 'news' }],
    _free_preview: {
      used_tokens: 800,
      sections: [{ id: 'headline', title: 'ERCOT headline', text: 'demand 72 GW, wind 21%', tokens: 120 }],
      locked_sections: ['dcpi_economics', 'queue_depth', 'deep_dive'],
    },
    _cite: 'https://dchub.cloud/iso/ercot',
  };

  it('structuredContent carries the teased sections, not just the upsell', async () => {
    const result = { content: [{ type: 'text', text: JSON.stringify(backendPayload) }] };
    const teased = await buildDepthTease('get_iso_context', result, { session_id: 'fence' }, 'anonymous');
    expect(teased).toBeTruthy();
    const sc = teased.structuredContent;
    expect(Array.isArray(sc.sections), 'structuredContent.sections missing — schema-aware clients get zero data').toBe(true);
    expect(sc.sections.length).toBeGreaterThan(0);
    expect(sc.sections[0].text).toContain('demand');
    expect(sc.locked_sections).toEqual(backendPayload._free_preview.locked_sections);
    // The upsell contract stays intact on top of the data:
    expect(sc.tease).toBe(true);
    expect(sc.upgrade).toBeTruthy();
    // And both channels agree (content[0] is what non-schema hosts render):
    const rendered = JSON.parse(teased.content[0].text);
    expect(rendered.sections?.length).toBe(sc.sections.length);
  });

  it('the tease structuredContent is built FROM the teased payload, not beside it', () => {
    expect(SRC).toMatch(/structuredContent:\s*\{\s*\.\.\.teased,\s*tease:\s*true/);
  });

  it('a teased envelope for a keyless seat never claims a paid tier', async () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ ...backendPayload, caller_tier: 'pro' }) }] };
    const teased = await buildDepthTease('get_iso_context', result, { session_id: 'fence' }, 'anonymous');
    const honest = honestCallerTier(teased, { tier: null });
    expect(PAID_TIERS).not.toContain(honest.structuredContent.caller_tier);
    expect(PAID_TIERS).not.toContain(JSON.parse(honest.content[0].text).caller_tier);
  });
});

describe('anon-seat fence — identity accumulates (claim_free_key is idempotent)', () => {
  it('a caller already holding a durable key is handed THAT key, before any mint', () => {
    const claimIdx = SRC.indexOf("trackedTool(srv, 'claim_free_key'");
    expect(claimIdx).toBeGreaterThan(-1);
    const seg = SRC.slice(claimIdx, claimIdx + 8000);
    expect(seg, 'keyed-caller short-circuit missing').toMatch(/already_keyed:\s*true/);
    expect(seg, 'trial keys must fall through (durable upgrade path)').toMatch(/startsWith\('dch_trial_'\)/);
    const mintAt = seg.indexOf("callAPIWrite('/api/v1/keys/claim'");
    expect(mintAt).toBeGreaterThan(-1);
    expect(seg.indexOf('already_keyed'), 'short-circuit must run BEFORE the mint')
      .toBeLessThan(mintAt);
  });
});

describe('anon-seat fence — published counts match canon', () => {
  // Scan SERVED strings only: drop comment lines, keep code. All known stale
  // numbers live in comments; a claim on a code line is (or feeds) an agent-
  // visible string. Plus-suffixed only — "compare up to 4 markets" is a
  // parameter doc, "300+ markets" is a canon claim.
  const code = SRC.split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

  const CLAIMS = [
    ['facilities', /([\d][\d,]*\+)\s+(?:data.center\s+)?facilit/gi],
    ['markets',    /([\d][\d,]*\+)\s+markets/gi],
    ['countries',  /([\d][\d,]*\+)\s+countries/gi],
    ['deals',      /([\d][\d,]*\+)\s+(?:tracked\s+)?deals/gi],
  ];

  for (const [key, re] of CLAIMS) {
    it(`every "+N ${key}" claim an agent can be served equals canon (${canon[key]})`, () => {
      expect(canon[key], `canon snapshot missing '${key}'`).toBeTruthy();
      const found = [...code.matchAll(re)].map((m) => m[1]);
      // Zero matches means the regex went stale, and a stale fence certifies
      // anything — fail loudly rather than silently passing forever.
      expect(found.length, `no ${key} claims found on code lines — fence regex stale?`).toBeGreaterThan(0);
      for (const v of found) {
        expect(v, `stale ${key} claim "${v}" served to agents (canon: ${canon[key]})`).toBe(canon[key]);
      }
    });
  }
});
