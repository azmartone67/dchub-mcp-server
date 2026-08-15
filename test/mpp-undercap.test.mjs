/**
 * r-undercap-offer (2026-08-15) — the COMPACT under-cap pay offer.
 *
 * Context: the pre-wall offer shipped 07-27 (dfc3f42), was measured a NO-OP on
 * real traffic 07-28 (wrong code path), and after r-prewall-anon + the r-prewall
 * under-cap path landed, reachability RE-measured 0.4% on 07-31 — because
 * mppPrewallOffer fires only at remaining <= MPP_PREWALL_AT (default 1), a
 * per-tool moment most burst-and-leave agents never reach. The earlier under-cap
 * full answers carried only the _metered_trial HUMAN copy: no price, no _meta
 * recipe, nothing machine-payable.
 *
 * mppUndercapOffer is the compact, SYNC (no sidecar) machine-payable block that
 * rides the FIRST under-cap full answer per (session, tool). _undercapOfferDue
 * (server.mjs) is its schedule + exclusion guard.
 *
 * COUNTER CONTRACT: counted as `mpp_offer_undercap`, a DISTINCT status —
 * `mpp_offer_prewall` must keep meaning "at/near the LAST free answer" (the
 * issued-vs-challenged lesson: one counter per distinct event, never conflate).
 *
 * Pure-local: no network, no sidecar dialled, no prod.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
let mpp, srv, SRC, LINES;

beforeAll(async () => {
  // Rail ARMED so the offer paths are live; the sidecar address is never
  // dialled (mppUndercapOffer is deliberately sync — advertise-hint shape).
  process.env.MPP_ENABLED = '1';
  process.env.MPP_SIDECAR_URL = 'http://127.0.0.1:1';
  delete process.env.MPP_PREWALL_DISABLE;
  delete process.env.MPP_UNDERCAP_DISABLE;
  mpp = await import('../mpp-hook.mjs');
  srv = await import('../server.mjs');
  SRC = readFileSync(SERVER, 'utf8');
  LINES = SRC.split('\n');
});

// ── 1. The compact offer block itself ───────────────────────────────────

describe('mppUndercapOffer — compact machine-payable block', () => {
  it('carries price + the literal _meta recipe + ONE human line', () => {
    const o = mpp.mppUndercapOffer('analyze_site', 3);
    expect(o).toBeTruthy();
    expect(o.price_usd).toBe('0.50');
    expect(o.machine_payable).toBe(true);
    // the literal _meta keys an agent needs to pay in-turn
    expect(o.credential_meta_key).toBe(mpp.MPP_CRED_KEY);
    expect(o.how).toContain('_meta.mpp_pay=true');
    expect(o.how).toContain(mpp.MPP_CRED_KEY);
    // the human one-liner names the price
    expect(o.note).toContain('$0.50');
    expect(o.free_full_answers_remaining).toBe(3);
  });

  it('is marked PASSIVE with its OWN offer_type — never the pre_wall shape', () => {
    const o = mpp.mppUndercapOffer('analyze_site', 3);
    expect(o.passive).toBe(true);
    expect(o.offer_type).toBe('under_cap');
    expect(o.offer_type).not.toBe('pre_wall');
  });

  it('never exists for a non-payable tool', () => {
    expect(mpp.mppUndercapOffer('get_news', 3)).toBeNull();
  });

  it('never exists for any FREE_FULL tool (belt to the server-side guard)', () => {
    for (const name of srv.FREE_FULL_TOOLS) {
      expect(mpp.mppUndercapOffer(name, 3), `${name} is free-full`).toBeNull();
    }
  });

  it('honours BOTH kill switches (family + own)', () => {
    process.env.MPP_PREWALL_DISABLE = '1';
    expect(mpp.mppUndercapOffer('analyze_site', 3)).toBeNull();
    delete process.env.MPP_PREWALL_DISABLE;
    process.env.MPP_UNDERCAP_DISABLE = '1';
    expect(mpp.mppUndercapOffer('analyze_site', 3)).toBeNull();
    delete process.env.MPP_UNDERCAP_DISABLE;
  });

  it('is dark when the MPP rail is dark', () => {
    const prev = process.env.MPP_ENABLED;
    process.env.MPP_ENABLED = '';
    expect(mpp.mppUndercapOffer('analyze_site', 3)).toBeNull();
    process.env.MPP_ENABLED = prev;
  });
});

// ── 2. The schedule + exclusion guard ───────────────────────────────────

describe('_undercapOfferDue — first under-cap call per (session, tool), and only there', () => {
  const TT = { trial_taste: true };

  it('fires on the FIRST call for a (session, tool) and never again for it', () => {
    const sid = `sess-${Date.now()}-sched`;
    expect(srv._undercapOfferDue('analyze_site', sid, TT)).toBe(true);
    expect(srv._undercapOfferDue('analyze_site', sid, TT)).toBe(false);
    expect(srv._undercapOfferDue('analyze_site', sid, TT)).toBe(false);
  });

  it('a different tool in the same session gets its own first fire', () => {
    const sid = `sess-${Date.now()}-tool2`;
    expect(srv._undercapOfferDue('analyze_site', sid, TT)).toBe(true);
    expect(srv._undercapOfferDue('compare_sites', sid, TT)).toBe(true);
  });

  it('a different session gets its own first fire for the same tool', () => {
    expect(srv._undercapOfferDue('analyze_site', `sess-${Date.now()}-a`, TT)).toBe(true);
    expect(srv._undercapOfferDue('analyze_site', `sess-${Date.now()}-b`, TT)).toBe(true);
  });

  it('NEVER fires for a FREE_FULL tool — free-by-design data carries no pay offer', () => {
    expect(srv.FREE_FULL_TOOLS.size, 'FREE_FULL_TOOLS is empty — guard is vacuous')
      .toBeGreaterThan(0);
    for (const name of srv.FREE_FULL_TOOLS) {
      // fresh session key per tool so the once-marker cannot mask the exclusion
      expect(srv._undercapOfferDue(name, `sess-ff-${Date.now()}-${name}`, TT),
        `${name} is FREE_FULL and must never carry the under-cap pay offer`).toBe(false);
    }
  });

  it('NEVER fires on the Starter/Developer paid taste', () => {
    expect(srv._undercapOfferDue('get_grid_intelligence', `sess-${Date.now()}-pt`,
      { trial_taste: true, paid_taste: true })).toBe(false);
  });

  it('NEVER fires without trial_taste (paid/enterprise full answers)', () => {
    const sid = `sess-${Date.now()}-paid`;
    // the REAL gate a paid/enterprise key gets: allowed, no trial_taste
    const paidGate = srv.applyTierGate('analyze_site', {}, 'paid', true, false);
    expect(paidGate.trial_taste).toBeUndefined();
    expect(srv._undercapOfferDue('analyze_site', sid, paidGate)).toBe(false);
    const entGate = srv.applyTierGate('analyze_site', {}, 'enterprise', true, false);
    expect(srv._undercapOfferDue('analyze_site', sid, entGate)).toBe(false);
    expect(srv._undercapOfferDue('analyze_site', sid, null)).toBe(false);
    expect(srv._undercapOfferDue('analyze_site', sid, {})).toBe(false);
  });

  it('the Starter/Developer flagship gate is excluded via its OWN paid_taste flag', () => {
    const g = srv.applyTierGate('get_grid_intelligence', {}, 'starter', true, false);
    expect(g.trial_taste).toBe(true);
    expect(g.paid_taste).toBe(true);   // precondition: the real gate shape
    expect(srv._undercapOfferDue('get_grid_intelligence', `sess-${Date.now()}-sd`, g)).toBe(false);
  });
});

// ── 3. Counter distinctness (the 07-27 lesson: issued ≠ challenged) ─────

describe('mpp_offer_undercap — a DISTINCT counter, wired like the other mpp_* statuses', () => {
  it('has its own wire name, not mpp_offer_prewall and not any pay-intent status', () => {
    expect(mpp.MPP_FUNNEL_STATUS.OFFER_UNDERCAP).toBe('mpp_offer_undercap');
    expect(mpp.MPP_FUNNEL_STATUS.OFFER_UNDERCAP).not.toBe(mpp.MPP_FUNNEL_STATUS.OFFER_PREWALL);
    expect(mpp.MPP_FUNNEL_STATUS.OFFER_UNDERCAP).not.toBe(mpp.MPP_FUNNEL_STATUS.QUOTE_ISSUED);
  });

  it('carries a BASIS that names its event and fences off mpp_offer_prewall', () => {
    const b = mpp.MPP_FUNNEL_BASIS.mpp_offer_undercap;
    expect(b).toBeTruthy();
    expect(b).toMatch(/under-cap/i);
    expect(b).toMatch(/NOT mpp_offer_prewall/);
  });

  // source-level wiring: the stamp exists, exactly once, and only under the
  // schedule guard. Anchors ERROR when missing rather than passing vacuously.
  const soleLine = (re, label) => {
    const hits = LINES.map((t, i) => ({ n: i + 1, t }))
      .filter((r) => re.test(r.t) && !/^\s*(\/\/|\*)/.test(r.t));
    if (hits.length !== 1) {
      throw new Error(`ANCHOR ${label}: expected exactly 1 match for ${re}, found ${hits.length}`);
    }
    return hits[0].n;
  };
  const blockEnd = (openLine, label) => {
    let depth = 0;
    for (let i = openLine - 1; i < LINES.length; i += 1) {
      const code = LINES[i]
        .replace(/\/\/.*$/, '')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""');
      for (const ch of code) {
        if (ch === '{') depth += 1;
        else if (ch === '}') { depth -= 1; if (depth === 0) return i + 1; }
      }
      if (depth < 0) break;
    }
    throw new Error(`ANCHOR ${label}: block opened at line ${openLine} never closes`);
  };

  it('server.mjs stamps OFFER_UNDERCAP exactly once, INSIDE the schedule-guarded block', () => {
    const stamp = soleLine(/status\s*=\s*MPP_FUNNEL_STATUS\.OFFER_UNDERCAP/, 'OFFER_UNDERCAP stamp');
    const guardOpen = soleLine(/if\s*\(\s*_uc\s*&&\s*_undercapOfferDue\(/, 'if (_uc && _undercapOfferDue(');
    const guardClose = blockEnd(guardOpen, 'schedule guard block');
    expect(stamp).toBeGreaterThan(guardOpen);
    expect(stamp).toBeLessThan(guardClose);
  });

  it('the stamp is NOT the prewall stamp — the two counters cannot re-merge', () => {
    const prewallSites = LINES
      .map((t, i) => ({ n: i + 1, t }))
      .filter((r) => /status\s*=\s*MPP_FUNNEL_STATUS\.OFFER_PREWALL/.test(r.t))
      .map((r) => r.n);
    const undercap = soleLine(/status\s*=\s*MPP_FUNNEL_STATUS\.OFFER_UNDERCAP/, 'OFFER_UNDERCAP stamp');
    expect(prewallSites.length, 'no OFFER_PREWALL site found — guard is vacuous').toBeGreaterThan(0);
    expect(prewallSites).not.toContain(undercap);
  });
});
