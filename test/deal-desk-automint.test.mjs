/**
 * execute_plan mints the Deal Desk Brief — and it mints it from the FULL results.
 *
 * The brief endpoint has worked since 2026-09-10, and nothing reached it: a Pro
 * caller had to POST the envelope to /api/v1/deal-desk themselves, and no agent
 * does that unprompted.
 *
 * The reason this is worth more than "same data, nicer format" is the one thing
 * the planner has that the agent does not. `_execLoopbackCall` returns BOTH
 * shapes — `result` (slimmed to fit a context window) and `full` — and until
 * now `full` was used to harvest mints and then dropped on the floor. The brief
 * gets `full`, the agent keeps the slim one, and the reads already happened, so
 * the depth costs no extra quota.
 *
 * Pure functions. No network, no server boot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  _execEnrichEnvelope, _dealDeskEligible, _execMintDealDesk, _dealDeskMinted,
  _dealDeskHumanRelay, _dealDeskHumanLine, _DEAL_DESK_SKIP_TIERS,
  _DEAL_DESK_TIMEOUT_MS, _DEAL_DESK_MIN_BUDGET_MS, _execStepBudget,
  HUMAN_FIRST_MARKER,
} from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// The step shape a LIVE Texas run returns (2026-09-10). Two rows share step 2
// and two share step 3 — the planner fans one planned step across several
// targets and pushes every variant under the same number.
function liveRun() {
  const executed = [
    { step: 1, tool: 'site_selection_canvas', args: { region: 'TX' }, status: 'executed', result: { slim: 1 } },
    { step: 2, tool: 'get_market_dcpi_rank', args: { market_slug: 'midland-tx' }, status: 'executed', result: { slim: 2 } },
    { step: 2, tool: 'get_market_dcpi_rank', args: { market_slug: 'el-paso' }, status: 'executed', result: { slim: 3 } },
    { step: 3, tool: 'get_grid_intelligence', args: { iso: 'ERCOT' }, status: 'executed', result: { slim: 4 } },
    { step: 3, tool: 'get_grid_intelligence', args: { iso: 'WECC' }, status: 'executed', result: { slim: 5 }, retried_after_wave: true },
    { step: 4, tool: 'get_fiber_intel', status: 'not_run', note: 'time budget reached' },
  ];
  const fullByEntry = new Map();
  executed.forEach((e, i) => {
    if (e.status === 'executed') fullByEntry.set(e, { full: i + 1, marker: `deep-${e.step}-${i}` });
  });
  return { env: { _entity: 'plan_execution', executed }, fullByEntry };
}

describe('the full result reaches the brief', () => {
  it('gives every fan-out variant of one step its OWN full result', () => {
    const { env, fullByEntry } = liveRun();
    const { env: rich, swapped } = _execEnrichEnvelope(env, fullByEntry);
    expect(swapped).toBe(5);

    // ★ THE DEFECT THIS PINS. Two rows are `step: 2` and two are `step: 3`.
    // Anything keyed on the step number collapses each pair, and the brief
    // silently loses a market — the same defect the fan-out limit labels hit
    // (dchub-backend#4356). Read the markers back per ENTRY, not per step.
    const markers = rich.executed.map((e) => e.result && e.result.marker);
    expect(markers.slice(0, 5)).toEqual(
      ['deep-1-0', 'deep-2-1', 'deep-2-2', 'deep-3-3', 'deep-3-4']);
    expect(new Set(markers.slice(0, 5)).size).toBe(5);
  });

  it('enriches the intra-wave RETRY entry too', () => {
    const { env, fullByEntry } = liveRun();
    const { env: rich } = _execEnrichEnvelope(env, fullByEntry);
    const retried = rich.executed.find((e) => e.retried_after_wave);
    // The retry path pushes a SECOND time with the same shape; covering only
    // the wave path drops it from the brief while the envelope still shows it
    // as executed.
    expect(retried.result.marker).toBe('deep-3-4');
  });

  it('leaves entries that never ran exactly as they were', () => {
    const { env, fullByEntry } = liveRun();
    const { env: rich } = _execEnrichEnvelope(env, fullByEntry);
    const notRun = rich.executed[5];
    expect(notRun).toBe(env.executed[5]);        // same object, untouched
    expect(notRun.result).toBeUndefined();
  });

  it('does NOT mutate the envelope the agent gets — slim stays slim', () => {
    const { env, fullByEntry } = liveRun();
    const before = JSON.stringify(env);
    _execEnrichEnvelope(env, fullByEntry);
    expect(JSON.stringify(env)).toBe(before);
    expect(env.executed[1].result).toEqual({ slim: 2 });
  });

  it('returns null when nothing was captured, so the slim envelope is sent as-is', () => {
    const { env } = liveRun();
    expect(_execEnrichEnvelope(env, new Map())).toBeNull();
    expect(_execEnrichEnvelope(env, null)).toBeNull();
  });
});

describe('the tier check is a COST gate, not the correctness gate', () => {
  // Correctness lives on the backend and reads the caller's OWN key
  // (routes/tier_gate.py::_resolve_caller_tier). callAPI also forwards
  // X-Internal-Key, and that is provenance, not entitlement.
  it('skips the high-volume tiers that can only be told 402', () => {
    for (const tier of ['free', 'identified', 'starter', 'developer', 'trial', 'anonymous']) {
      expect(_dealDeskEligible({ api_key: 'k', tier })).toBe(false);
    }
  });

  it('attempts for the tiers the backend accepts', () => {
    for (const tier of ['pro', 'enterprise', 'founding', 'PRO', 'Enterprise']) {
      expect(_dealDeskEligible({ api_key: 'k', tier })).toBe(true);
    }
  });

  it('★ ATTEMPTS for a tier this server has never seen', () => {
    // A skip list, deliberately not an allowlist. An allowlist fails the other
    // way: a new paid tier would be silently retired from the deliverable, with
    // no error anywhere and nothing to notice. One wasted round-trip is the
    // cheaper mistake than a product that quietly stops shipping.
    expect(_dealDeskEligible({ api_key: 'k', tier: 'team' })).toBe(true);
    expect(_dealDeskEligible({ api_key: 'k', tier: 'some_tier_invented_in_2027' })).toBe(true);
    expect(_DEAL_DESK_SKIP_TIERS.has('pro')).toBe(false);
  });

  it('never attempts without a key — anonymous cannot be Pro', () => {
    expect(_dealDeskEligible({ tier: 'pro' })).toBe(false);
    expect(_dealDeskEligible(null)).toBe(false);
  });

  it('honours the kill switch', () => {
    const prev = process.env.DCHUB_DEAL_DESK_AUTOMINT;
    process.env.DCHUB_DEAL_DESK_AUTOMINT = '0';
    try { expect(_dealDeskEligible({ api_key: 'k', tier: 'pro' })).toBe(false); }
    finally {
      if (prev === undefined) delete process.env.DCHUB_DEAL_DESK_AUTOMINT;
      else process.env.DCHUB_DEAL_DESK_AUTOMINT = prev;
    }
  });
});

describe('a brief is never advertised unless it was minted', () => {
  it('returns null for a caller the cost gate skipped, without a round-trip', async () => {
    expect(await _execMintDealDesk({ executed: [] }, new Map(), { tier: 'free' })).toBeNull();
  });

  // ★ These two watch the WIRE, not the return value. `_execMintDealDesk`
  // returns null both when it declines to start and when it starts and fails,
  // so a `toBeNull()` assertion cannot tell the two apart — the first version
  // of the budget test below passed against a removed floor, because with no
  // network in the test env the call it should never have made failed anyway.
  // Counting fetches makes "did not start" observable; recording the argument
  // to AbortSignal.timeout makes "started with WHICH budget" observable.
  // Counts only the requests to the MINT path — the same handler also emits a
  // telemetry POST, and counting both makes "did not start the mint" read as
  // two calls whether the floor held or not. The timeout is read back off the
  // signal that rode with THAT request, so it cannot be confused with another
  // call site's.
  function onTheWire(fn) {
    const realFetch = globalThis.fetch;
    const realTimeout = AbortSignal.timeout;
    const mint = [];
    AbortSignal.timeout = (ms) => {
      const s = new AbortController().signal;
      try { Object.defineProperty(s, '__ms', { value: ms }); } catch (_e) {}
      return s;
    };
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('/api/v1/deal-desk')) {
        mint.push({ url: String(url), method: init && init.method,
                    timeout: init && init.signal && init.signal.__ms });
      }
      return new Response('{}', { status: 200 });
    };
    return Promise.resolve(fn()).finally(() => {
      globalThis.fetch = realFetch;
      AbortSignal.timeout = realTimeout;
    }).then(() => mint);
  }

  it('★ does not start a mint the plan has no budget left for', async () => {
    // #210, one call site over. DEADLINE_MS is a START gate — a run can legally
    // finish its steps at ~40s, and a fixed 8s tacked on after that lands at
    // 48s, past the edge's 45s route budget, where the WHOLE envelope is
    // discarded rather than one leg. Failing soft on the mint cannot rescue an
    // answer the edge already threw away, so the mint must never be STARTED.
    const pro = { api_key: 'k', tier: 'pro' };
    for (const left of [0, 1, 500, _DEAL_DESK_MIN_BUDGET_MS - 1]) {
      const mint = await onTheWire(async () => {
        expect(await _execMintDealDesk({ executed: [] }, new Map(), pro, left)).toBeNull();
      });
      expect(mint.length, `budget ${left}ms still POSTed to the mint`).toBe(0);
    }
  });

  it('★ hands the POST the budget it was given, not the constant', async () => {
    // Reaching for _DEAL_DESK_TIMEOUT_MS here re-opens the same hole: at 34s of
    // a 40s plan the clamp says 6000 and the constant says 8000, which is the
    // 2s that carries the request past the edge.
    const pro = { api_key: 'k', tier: 'pro' };
    const mint = await onTheWire(async () => {
      await _execMintDealDesk({ executed: [] }, new Map(), pro, 6000);
    });
    expect(mint.length).toBe(1);
    expect(mint[0].method).toBe('POST');
    expect(mint[0].timeout).toBe(6000);
    expect(mint[0].timeout).not.toBe(_DEAL_DESK_TIMEOUT_MS);
  });

  it('the floor sits above the slowest mint measured against production', () => {
    // 0.54s at 62KB, 0.81s at 433KB (2026-09-10). Below this there is no point
    // starting: the abort does not cancel the INSERT the backend already ran,
    // so a row lands that nobody is ever handed a URL for.
    expect(_DEAL_DESK_MIN_BUDGET_MS).toBeGreaterThan(810);
    expect(_DEAL_DESK_MIN_BUDGET_MS).toBeLessThan(_DEAL_DESK_TIMEOUT_MS);
  });

  it('derives its ceiling from what is LEFT, never from the constant', () => {
    // The same clamp every loopback step uses. At 39.9s of a 40s plan the mint
    // gets 100ms — which is under the floor, so it is skipped rather than run
    // into the edge.
    expect(_execStepBudget(39900, 40000, _DEAL_DESK_TIMEOUT_MS)).toBe(100);
    expect(_execStepBudget(1000, 40000, _DEAL_DESK_TIMEOUT_MS)).toBe(_DEAL_DESK_TIMEOUT_MS);
    expect(_execStepBudget(41000, 40000, _DEAL_DESK_TIMEOUT_MS)).toBe(0);
  });

  it('reads a real pdf_url as the ONLY proof a row landed', () => {
    expect(_dealDeskMinted({ ok: true, pdf_url: 'https://dchub.cloud/x.pdf' })).toBe(true);
  });

  it('rejects every shape that is not one', () => {
    // Each of these has been returned by this endpoint in production: the 402
    // gate, the store failures, and `_upstreamError`'s shape from callAPI.
    const notMinted = [
      { error: 'deal_desk_requires_pro', current_tier: 'FREE' },
      { error: 'store_write_failed' },
      { error: 'store_unavailable' },
      { error: 'API 502' },
      { ok: true },                       // said yes, handed back no link
      { ok: true, pdf_url: '' },
      { ok: 'true', pdf_url: 'https://dchub.cloud/x.pdf' },
      { pdf_url: 'https://dchub.cloud/x.pdf' },
      null, undefined, 'ok',
    ];
    for (const r of notMinted) expect(_dealDeskMinted(r)).toBe(false);
  });
});

describe('the wiring: every executed step that has a result records its full one', () => {
  // ★ The pure swap is tested above with a hand-built map. This asserts the map
  // is actually FILLED, at the wave path AND at the intra-wave retry, which
  // pushes a second time with the same shape.
  //
  // ★★ IT MATCHES THE GUARD, NOT JUST THE CALL. A first version of this test
  // counted `fullByEntry.set(` occurrences and passed happily against
  // `if (false) fullByEntry.set(entry, out.full)` — the call was still there,
  // and a scan that reads presence cannot see reachability. The pattern below
  // ties three identifiers together: the entry that was pushed, the loopback
  // result its `result:` came from, and the identifier the capture is GUARDED
  // on. A constant guard, a mismatched object, or a missing capture all break
  // the match.
  const body = SRC.slice(SRC.indexOf("trackedTool(srv, 'execute_plan',"),
                         SRC.indexOf("trackedTool(srv, 'search_facilities',"));
  const SITE = /const (\w+) = \{[\s\S]{0,900}?result: (\w+)\.result \};\s*\n\s*executed\.push\(\1\);(?:\s*\n\s*\/\/[^\n]*)*\s*\n\s*if \((\w+)\.full\) fullByEntry\.set\(\1, (\w+)\.full\);/g;

  it('captures full at every result-bearing push, guarded on that push’s OWN result', () => {
    const sites = [...body.matchAll(SITE)];
    // A floor: this scan must never pass by finding nothing to check.
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const [, entryId, outId, guardId, argId] of sites) {
      expect(guardId).toBe(outId);
      expect(argId).toBe(outId);
      expect(entryId).toBeTruthy();
    }
    // …and there is no OTHER push of a named entry that this pattern missed —
    // a third site added later fails here instead of silently skipping the brief.
    const namedPushes = [...body.matchAll(/executed\.push\((\w+)\);/g)];
    expect(namedPushes.length).toBe(sites.length);
    // …and no capture exists outside a matched site (e.g. one left behind by a
    // guard someone constant-folded).
    const captures = [...body.matchAll(/fullByEntry\.set\(/g)];
    expect(captures.length).toBe(sites.length);
  });

  it('leaves the result-less pushes alone', () => {
    // skipped_meta / not_run / skipped_unresolved push an inline literal and
    // have no full result to record; they must NOT be counted as a miss.
    const inline = [...body.matchAll(/executed\.push\(\{/g)];
    expect(inline.length).toBeGreaterThanOrEqual(3);
    for (const m of inline) {
      expect(body.slice(m.index, m.index + 400)).not.toContain('result: out');
    }
  });
});

describe('one human link, in both halves of the response', () => {
  // The defect this forecloses: a gated envelope carried /go/c/<token> in
  // content[].text and /upgrade/h/<sig> in structuredContent.for_your_human.url
  // (dchub-backend#4330), so the funnel measured one link and agents relayed
  // the other — and the canary (#4333) watched a third. Both builders below
  // take the SAME pdf_url and nothing else, so there is no second value to drift.
  const dd = { pdf_url: 'https://dchub.cloud/reports/deal-desk/dd-SENTINEL.pdf',
               brief_url: 'https://dchub.cloud/reports/deal-desk/dd-OTHER' };

  it('puts the SAME url in the structured block and the prose line', () => {
    const rel = _dealDeskHumanRelay(dd);
    const line = _dealDeskHumanLine(dd);
    expect(rel.url).toBe(dd.pdf_url);
    expect(rel.markdown).toContain(dd.pdf_url);
    expect(line).toContain(dd.pdf_url);
    // …and neither reaches for the OTHER url in the same object.
    expect(line).not.toContain(dd.brief_url);
    expect(rel.markdown).not.toContain(dd.brief_url);
  });

  it('tracks the pdf_url rather than hardcoding one', () => {
    const moved = { ...dd, pdf_url: 'https://dchub.cloud/reports/deal-desk/dd-MOVED.pdf' };
    expect(_dealDeskHumanRelay(moved).url).toBe(moved.pdf_url);
    expect(_dealDeskHumanLine(moved)).toContain('dd-MOVED');
    expect(_dealDeskHumanLine(moved)).not.toContain('dd-SENTINEL');
  });

  it('keeps for_your_human an OBJECT — the backend returns that name as a STRING', () => {
    // POST /api/v1/deal-desk answers with `for_your_human` as pre-composed
    // prose. Copying it through would make the one block a human consumer reads
    // polymorphic — the constraint_iso defect, in the worst possible field.
    const rel = _dealDeskHumanRelay(dd);
    expect(typeof rel).toBe('object');
    for (const k of ['message', 'url', 'render', 'markdown', '_agent_instruction']) {
      expect(typeof rel[k]).toBe('string');
    }
    expect(rel.render).toBe('verbatim_link_required');
  });

  it('carries the marker agents and partner docs match on', () => {
    expect(_dealDeskHumanLine(dd).startsWith(HUMAN_FIRST_MARKER)).toBe(true);
  });

  it('emits NOTHING when there is no pdf_url', () => {
    for (const bad of [null, undefined, {}, { pdf_url: '' }, { pdf_url: 42 }]) {
      expect(_dealDeskHumanRelay(bad)).toBeNull();
      expect(_dealDeskHumanLine(bad)).toBe('');
    }
  });
});
