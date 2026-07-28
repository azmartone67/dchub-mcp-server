/**
 * execute_plan executor invariants — the twelve traps found by LIVE batteries
 * on 2026-07-26 (v2.7.0 → v2.8.1).
 *
 * Every case below is a bug that actually shipped and was caught by running
 * real intents against production, not by reading code. They are pinned here
 * because the next harvester/planner edit is exactly when they come back.
 *
 * Pure functions + constant tables only — no network, no DB, no server boot.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  _execResolveArgs, _execHarvest, _execConstraintIso, _execConstraintSlug,
  _execConstraintIsoSet, _execCityHit, _EXEC_IS_RTO, _EXEC_TOOL_MINTS, _EXEC_ISO_ARG,
  _planQuery,
} from '../server.mjs';

describe('execute_plan invariants (live-battery regressions)', () => {
  // ── trap 4 (v2.7.4): whole-string placeholder matching ─────────────
  it('resolves placeholder kind from the LEADING token, not a whole-string scan', () => {
    // '<ISO serving the finalist market>' contains the word "market" and was
    // resolving as a SLUG — live: get_grid_intelligence called with
    // iso=ashburn-va.
    const minted = { slug: ['ashburn-va'], iso: ['PJM'] };
    const r = _execResolveArgs({ iso: '<ISO serving the finalist market>' }, minted, {}, false);
    expect(r.args.iso).toBe('PJM');
    expect(r.unresolved).toBeNull();
  });

  // ── trap 8 (v2.7.8): 'market' dropped from the FALLBACK scan ────────
  it("resolves '<the market named in the intent…>' as a slug", () => {
    // Leads with "the", so the leading-token check misses; the fallback must
    // still recognise it. Live: Dallas step 3 skipped for two revisions.
    const minted = { slug: ['dallas-tx'] };
    const r = _execResolveArgs({ market_slug: '<the market named in the intent, e.g. dallas>' },
      minted, {}, false);
    expect(r.args.market_slug).toBe('dallas-tx');
  });

  // ── trap 7 (v2.7.7): intent geography as an artifact producer ───────
  it('resolves an iso placeholder from the intent constraint when no step minted one', () => {
    // Atlanta KNEW its region yet skipped both grid steps because the
    // (correctly rejected) scoreboard mint left the pool empty.
    const minted = { __constraint_iso: 'PJM' };
    const r = _execResolveArgs({ iso: '<ISO serving the metro>' }, minted, {}, false);
    expect(r.args.iso).toBe('PJM');
  });

  it('does NOT inject a non-RTO region as an iso ARG', () => {
    // trap 9: SERC/WECC are reliability regions — injecting them made
    // get_interconnection_queue fail outright.
    const minted = { __constraint_iso: 'SERC' };
    const r = _execResolveArgs({ iso: '<ISO serving the metro>' }, minted, {}, false);
    expect(r.args.iso).toBeUndefined();
    expect(r.unresolved).toBe('iso');
  });

  it('classifies RTOs vs reliability regions', () => {
    for (const rto of ['ERCOT', 'pjm', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISO-NE']) {
      expect(_EXEC_IS_RTO(rto)).toBe(true);
    }
    for (const region of ['SERC', 'WECC', 'ONS', '', null, undefined]) {
      expect(_EXEC_IS_RTO(region)).toBe(false);
    }
  });

  // ── user context beats minted values ───────────────────────────────
  it('prefers a user-supplied value over a minted one', () => {
    const minted = { slug: ['dallas-tx'] };
    const r = _execResolveArgs({ market_slug: '<slug from step 1>' }, minted,
      { market_slug: 'phoenix-az' }, false);
    expect(r.args.market_slug).toBe('phoenix-az');
  });

  // ── fan-out ────────────────────────────────────────────────────────
  it('fans out over multiple mints only when the step expects it', () => {
    const minted = { slug: ['a-tx', 'b-tx', 'c-tx'] };
    const fan = _execResolveArgs({ market_slug: '<slug from step 1>' }, minted, {}, true);
    expect(fan.fanKey).toBe('market_slug');
    expect(fan.fanVals).toEqual(['a-tx', 'b-tx', 'c-tx']);
    const single = _execResolveArgs({ market_slug: '<slug from step 1>' }, minted, {}, false);
    expect(single.args.market_slug).toBe('a-tx');
    expect(single.fanKey).toBeNull();
  });

  // ── trap 5 (v2.7.4): echoed input args polluting the mint pool ──────
  it('never mints a non-ISO-shaped value as an iso', () => {
    // Grid tools echo their input args back, so a bad iso arg round-tripped
    // into the pool — live: 'ASHBURN-VA' minted as an iso.
    const minted = {};
    _execHarvest({ iso: 'ASHBURN-VA', region_iso: 'ERCOT' }, minted, 3);
    expect(minted.iso).toEqual(['ERCOT']);
  });

  it('harvests slugs and candidate ids from nested results', () => {
    const minted = {};
    _execHarvest({ data: { rows: [{ metro_slug: 'dallas-tx' }, { candidate_id: 'cand_abc123' }] } },
      minted, 3);
    expect(minted.slug).toContain('dallas-tx');
    expect(minted.candidate_id).toContain('cand_abc123');
  });

  it('caps mints per kind and stops at depth', () => {
    const minted = {};
    _execHarvest({ rows: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }] }, minted, 2);
    expect(minted.slug.length).toBeLessThanOrEqual(2);
    const deep = {};
    _execHarvest({ a: { b: { c: { d: { slug: 'too-deep' } } } } }, deep, 3);
    expect(deep.slug).toBeUndefined();
  });

  // ── trap 9 (v2.7.7/.8): geography detection ────────────────────────
  it('derives the intent constraint from context > signals > city map', () => {
    expect(_execConstraintIso('find 100 MW near Dallas', {}, null)).toBe('ERCOT');
    expect(_execConstraintIso('anything', { iso: 'pjm' }, null)).toBe('PJM');
    expect(_execConstraintIso('anything', {}, { iso: 'miso' })).toBe('MISO');
    expect(_execConstraintIso('no geography here', {}, null)).toBeNull();
    // non-RTO metros still yield a CONSTRAINT (used to reject bad mints)
    expect(_execConstraintIso('overlap in Atlanta', {}, null)).toBe('SERC');
  });

  // ── trap 13 (v2.9.2): comparison intents span MULTIPLE geographies ──
  it('collects every geography a comparison intent names', () => {
    // Live: the Mistral Org Agent ran "compare Phoenix vs Dallas" and C1
    // FAILED on a correct run, because the executor constrained to the first
    // match and rejected the other market's mints.
    expect(_execConstraintIsoSet('compare Phoenix vs Dallas for power cost', {}, null))
      .toEqual(['ERCOT', 'WECC']);
    expect(_execConstraintIsoSet('find 100 MW near Dallas', {}, null)).toEqual(['ERCOT']);
    expect(_execConstraintIsoSet('rank markets for a 200 MW AI campus', {}, null)).toEqual([]);
    // explicit user context still wins outright
    expect(_execConstraintIsoSet('compare Phoenix vs Dallas', { iso: 'pjm' }, null))
      .toEqual(['PJM']);
  });

  it('injects an iso arg ONLY when the intent named exactly one geography', () => {
    // You cannot inject two ISOs into one argument — ambiguity must not guess.
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toContain('constraintIsoSet.length === 1 ? constraintIsoSet[0] : null');
  });

  it('derives a market slug from the intent-named metro', () => {
    expect(_execConstraintSlug('find 100 MW near Dallas')).toBe('dallas-tx');
    expect(_execConstraintSlug('overlap in Atlanta')).toBe('atlanta-ga');
    expect(_execConstraintSlug('somewhere unnamed')).toBeNull();
  });

  // ── 2026-07-28: an ISO-only entry (exact ISO, no DCPI market to name) ──
  it('constrains central Illinois to MISO without inventing a market slug', () => {
    // Central Illinois is Ameren Illinois = MISO. Chicago/ComEd is PJM, so the
    // ISO is genuinely exact and worth injecting: it scopes region_iso/iso on
    // the retirement + queue reads.
    expect(_execConstraintIsoSet('site a 50 MW data center in central Illinois', {}, null))
      .toEqual(['MISO']);
    expect(_EXEC_IS_RTO('MISO')).toBe(true);          // ...so injection is allowed

    // But there is NO central-Illinois DCPI market (probed live: peoria,
    // decatur, champaign, rockford, quad-cities et al. all 404; `springfield`
    // is MASSACHUSETTS, `st-louis` is Missouri). Returning any of those would
    // make the step resolve to the wrong place — strictly worse than skipping.
    expect(_execConstraintSlug('site a 50 MW data center in central Illinois')).toBeNull();
    // never a slug-shaped undefined
    expect(_execConstraintSlug('central illinois')).not.toBeUndefined();

    // ...and a slug-less entry must not mask a later one that HAS a slug.
    expect(_execConstraintSlug('compare central Illinois against Dallas')).toBe('dallas-tx');
    // two geographies named → ambiguous → no single ISO to inject
    expect(_execConstraintIsoSet('compare central Illinois against Dallas', {}, null))
      .toEqual(['ERCOT', 'MISO']);
  });

  // ── 2026-07-28: the rest of Ameren Illinois, and the name collisions ──
  it('constrains the Ameren Illinois cities to MISO only when the STATE is named', () => {
    const iso = (t) => _execConstraintIsoSet(t, {}, null);
    for (const t of ['find 100 MW in Springfield, IL', 'a parcel near Peoria Illinois',
                     'site 40 MW in Decatur, Illinois', 'Quincy IL substation capacity',
                     'data center in Champaign', 'the Metro East across from St. Louis',
                     'power for a build in Edwardsville']) {
      expect(iso(t)).toEqual(['MISO']);
    }
    // Bloomington is the one safe BARE key — IL, IN (Duke Energy Indiana) and
    // MN are all MISO, so the constraint holds whichever is meant.
    expect(iso('find 50 MW near Bloomington')).toEqual(['MISO']);
  });

  it('refuses to constrain the same names OUTSIDE Illinois (the whole point)', () => {
    const iso = (t) => _execConstraintIsoSet(t, {}, null);
    // Every one of these is a real place in a DIFFERENT ISO, and injecting
    // MISO into them is the Dallas->CAISO failure class. Not injecting merely
    // leaves prior behavior — so the asymmetry decides it.
    expect(iso('a site in Springfield, MA')).toEqual([]);        // ISONE — and it
    expect(iso('what is the DCPI for springfield')).toEqual([]); // IS DC Hub's `springfield`
    expect(iso('find 100 MW in Peoria, AZ')).toEqual([]);        // WECC, Phoenix metro
    expect(iso('Decatur GA power availability')).toEqual([]);    // SERC, Atlanta metro
    // Quincy WA now has its own (correct) WECC entry, so the assertion here is
    // that the Ameren one never claims it — MISO must not appear.
    expect(iso('Quincy Washington data centers')).not.toContain('MISO');
    expect(iso('Urbana, OH interconnection')).toEqual([]);       // PJM
    // ...and 'normal' is deliberately absent: it is an ordinary English word.
    expect(iso('grid under normal operating conditions')).toEqual([]);
  });

  // ── 2026-07-28: second-tier markets, every slug probed live before adding ──
  it('second-tier entries carry a VERIFIED slug and the physical-grid ISO', () => {
    const slug = _execConstraintSlug;
    const iso = (t) => _execConstraintIsoSet(t, {}, null);
    expect(slug('find 200 MW near Seattle')).toBe('seattle-wa');
    expect(slug('a campus in Council Bluffs')).toBe('council-bluffs-ia');
    expect(slug('power availability in Cheyenne')).toBe('cheyenne-wy');
    expect(iso('find 100 MW in Omaha')).toEqual(['SPP']);
    expect(iso('a site in Minneapolis')).toEqual(['MISO']);
    expect(iso('data center in Denver')).toEqual(['WECC']);

    // Where DC Hub's market record and the physical grid disagree, this table
    // follows the GRID — the same call as kansas city, and for the same
    // reason: the value gets injected.
    // Charlotte is Duke Energy Carolinas, NOT an RTO member, though
    // charlotte-nc reports PJM. Declaring PJM would inject iso=PJM and return
    // PJM queue projects for a Duke grid.
    expect(iso('find 150 MW near Charlotte')).toEqual(['SERC']);
    expect(_EXEC_IS_RTO('SERC')).toBe(false);            // ...so nothing is injected
    // Nashville reports TVA (a balancing authority, not in the mint
    // whitelist); declared SERC, matching the atlanta/SOCO precedent.
    expect(iso('a build in Nashville')).toEqual(['SERC']);
  });

  it('second-tier name collisions are qualified, not guessed', () => {
    const iso = (t) => _execConstraintIsoSet(t, {}, null);
    expect(iso('a site in Portland, OR')).toEqual(['WECC']);
    expect(iso('a site in Portland, ME')).toEqual([]);        // ISONE — different RTO
    expect(iso('Quincy, WA data centers')).toEqual(['WECC']); // Grant County PUD
    expect(iso('Quincy, IL substation')).toEqual(['MISO']);   // Ameren — the mirror entry
    expect(iso('Mount Pleasant, WI')).toEqual(['MISO']);      // We Energies
    expect(iso('Mount Pleasant, SC')).toEqual([]);            // Charleston, SERC
    expect(iso('Mount Pleasant, TX')).toEqual([]);            // ERCOT
  });

  it('adding second-tier entries did not disturb the originals', () => {
    // _execConstraintSlug returns the FIRST slugged match and
    // _execConstraintIsoSet accumulates ALL of them, so new rows could have
    // changed either. Appending them keeps every pre-existing route intact.
    expect(_execConstraintSlug('find 100 MW near Dallas')).toBe('dallas-tx');
    expect(_execConstraintSlug('overlap in Atlanta')).toBe('atlanta-ga');
    expect(_execConstraintIso('overlap in Atlanta', {}, null)).toBe('SERC');
    expect(_execConstraintIsoSet('compare Phoenix vs Dallas for power cost', {}, null))
      .toEqual(['ERCOT', 'WECC']);
    expect(_execConstraintIsoSet('rank markets for a 200 MW AI campus', {}, null)).toEqual([]);
    // kansas city stays SPP on purpose (see the comment at the entry)
    expect(_execConstraintIsoSet('find 100 MW in Kansas City', {}, null)).toEqual(['SPP']);
  });

  it('_execCityHit: `re` overrides the substring default, bare keys still work', () => {
    expect(_execCityHit('dallas', { iso: 'ERCOT' }, 'find 100 mw near dallas')).toBe(true);
    expect(_execCityHit('dallas', { iso: 'ERCOT' }, 'find 100 mw near austin')).toBe(false);
    const qualified = { iso: 'MISO', re: /\bpeoria,?\s*(?:il\b|illinois)/i };
    expect(_execCityHit('peoria il', qualified, 'peoria, il')).toBe(true);
    expect(_execCityHit('peoria il', qualified, 'peoria, az')).toBe(false);
    // Once `re` is present the KEY is only a label — it is never substring-
    // tested. (Shown with a synthetic entry whose key and regex do not overlap;
    // for 'peoria il' the two happen to agree, so it cannot demonstrate this.)
    const labelOnly = { iso: 'MISO', re: /\bedwardsville\b/i };
    expect(_execCityHit('metro east', labelOnly, 'the metro east region')).toBe(false);
    expect(_execCityHit('metro east', labelOnly, 'a site in edwardsville')).toBe(true);
  });

  // ── trap 3 (v2.7.3): display names are not slugs ───────────────────
  it('keeps the ai_capacity_index mint contract wired', () => {
    // Index rows carry 'market': 'Ashburn VA' — the generic key harvester
    // cannot see them, so the per-tool contract is what makes the AI-campus
    // ranking path chain at all.
    expect(_EXEC_TOOL_MINTS.ai_capacity_index).toEqual({
      rowsKey: 'markets', field: 'market', kind: 'slug',
    });
  });

  it('keeps the iso-accepting tool map intact', () => {
    expect(_EXEC_ISO_ARG.get_retirement_headroom).toBe('region_iso');
    for (const t of ['get_grid_intelligence', 'get_interconnection_queue', 'get_refined_queue']) {
      expect(_EXEC_ISO_ARG[t]).toBe('iso');
    }
  });
});

describe('planner routing (classes must not steal each other)', () => {
  const cls = (q, ctx = {}) => _planQuery(q, ctx).intent_class;
  const tools = (q, ctx = {}) =>
    (_planQuery(q, ctx).recommended_sequence || []).map((s) => s.tool);

  // ── trap 11 (v2.8.0): cross-domain intents dropped half the question ──
  it('routes fiber+power intents to the cross-domain class', () => {
    expect(cls('where do fiber density and grid headroom overlap in Atlanta'))
      .toBe('fiber_power_pairing');
    // and the plan actually CONTAINS fiber tools — the original bug was a
    // fiber-less plan for a fiber question.
    expect(tools('where do fiber density and grid headroom overlap in Atlanta')
      .some((t) => /fiber/.test(t))).toBe(true);
  });

  it('leaves pure-fiber and pure-grid intents alone', () => {
    expect(cls('plan diverse fiber routes to a carrier hotel in Dallas')).toBe('fiber');
    expect(cls('how much power is available in ERCOT for a 200 MW site')).toBe('grid_headroom');
    expect(cls('rank markets for a 200 MW AI campus')).toBe('market_ranking');
  });

  // ── trap 12 (v2.8.1): parcel-level tool given a market ─────────────
  it('does not send a market to the parcel-level readiness tool', () => {
    // get_fiber_readiness requires lat/lon; the class's first live run passed
    // a market and the step failed.
    const seq = _planQuery('where do fiber density and grid headroom overlap in Atlanta', {})
      .recommended_sequence || [];
    const readiness = seq.find((s) => s.tool === 'get_fiber_readiness');
    if (readiness) {
      expect(readiness.args_hint).toHaveProperty('lat');
    } else {
      expect(seq.some((s) => s.tool === 'get_fiber_intel')).toBe(true);
    }
  });

  it('keeps the AI-campus branch leading with the deployability index', () => {
    // Deliberate r-planner-v4 decision (partner-panel rationale): the hand-off
    // was fixed, the lead was NOT swapped.
    expect(tools('rank markets for a 200 MW AI campus')[0]).toBe('ai_capacity_index');
  });
});
