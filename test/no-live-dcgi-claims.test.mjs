// Current-claim copy must match the CURRENT state of each withdrawn capability.
//
// ★★2026-08-31 — THIS FENCE INVERTED, and it took the prose down with it.
//
// The rule below used to be "the DCGI may be named, but never on a line that
// does not also say 'withdrawn'". Correct on 2026-08-22. The DCGI was restored
// 2026-08-30, and from that morning the fence was REQUIRING A FALSE CLAIM on
// eight files — it went green precisely because they were wrong, and it would
// have failed anyone who fixed them. A stale-withdrawal claim is not a smaller
// error than a stale-live one: it tells an agent reading tools/list not to call
// a tool that works, so the restored index is invisible to exactly the careful
// clients we built it for.
//
// THE LESSON, and why the shape below changed: A WITHDRAWAL IS A DATED EVENT,
// NOT A PERMANENT PROPERTY. The old rule hardcoded one event's verdict into a
// regex, so the next event could only be absorbed by rewriting the fence. The
// state now lives in CAPABILITY_STATE, one entry per claim, and the rules are
// derived from it — restoring or re-withdrawing something is a one-line edit
// with a date and a measurement, not a rewrite. Both directions are fenced:
// nothing may call a RESTORED capability withdrawn, and nothing may sell a
// STILL-WITHDRAWN one as available.
//
// WHY (2026-08-22): the DCGI composite was withdrawn 2026-08-08 and every tool
// description says so — but the copy registries and humans actually read did
// not: the LIVE Smithery description (our #1 channel, 72.7% of external calls)
// still advertised "the DCGI (Data Center Gas Index): per-state natural-gas
// suitability for siting"; REGISTRY-LISTINGS.md (the paste-ready source for
// every listing) carried it in 6 places; SKILL.md, integrations/README.md and
// the to-be-sent TeleGeography one-pager carried "DCPI/DCGI". The quantity
// healer keeps NUMBERS current; nothing kept a withdrawn CAPABILITY out.
//
// Rule: the word may appear — an agent asking for the DCGI must find the
// honest answer — but never on a line that does not also say "withdrawn".
// Lines marked canon:frozen are history and exempt (same convention as the
// quantity healer). server.mjs is covered by its own narrower assertion: the
// tool descriptions legitimately name the DCGI many times WITH the
// withdrawal; the one sales string that did not was why_dchub.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'scripts/smithery_description.txt',
  'smithery.yaml',
  'server.json',
  'canonical/github_description.txt',
  'REGISTRY-LISTINGS.md',
  'skills/dc-hub-data-center-intelligence/SKILL.md',
  'integrations/README.md',
  'TELEGEOGRAPHY-OUTREACH.md',
];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const liveLines = (txt) => txt.split('\n').filter((l) => !/canon:frozen/.test(l));

/**
 * THE STATE OF EVERY CAPABILITY THIS AUDIT WITHDREW. One entry per claim; the
 * rules below are derived from it, so a restore or a re-withdrawal is an edit
 * HERE and nowhere else.
 *
 * `restored_on: null` means still withdrawn. `verified` is how the current
 * state was MEASURED, not who asserted it — the previous version of this fence
 * rotted because nobody re-checked the premise, so an entry without a
 * measurement is an entry nobody has confirmed.
 */
const CAPABILITY_STATE = {
  'DCGI score': {
    names: /\bDCGI\b/,
    withdrawn_on: '2026-08-08',
    restored_on: '2026-08-30',
    verified: 'get_gas_index(state=TX) -> ok:true, dcgi 81.9, GAS-ADVANTAGED (2026-08-31T09:09Z)',
  },
  'gas-fired $/MWh': {
    names: /\$\/MWh|per[-\s]MWh|gas[-\s]to[-\s]grid/i,
    withdrawn_on: '2026-08-08',
    restored_on: null,
    verified: 'get_gas_economics(market=dallas) -> $/MMBtu layers only, no $/MWh field '
            + '(2026-08-31T09:10Z); get_gas_intelligence(TX).gas_to_grid_status.available === false',
  },
};

// "This thing is gone" — the vocabulary a stale withdrawal actually uses.
const CALLS_IT_GONE = /withdrawn|retired|no longer returns|not published|unavailable|pulled|suspended/i;

describe('prose copy matches the CURRENT state of each withdrawn capability', () => {
  // ── RESTORED capabilities: nothing may still call them gone.
  for (const [cap, st] of Object.entries(CAPABILITY_STATE)) {
    if (!st.restored_on) continue;
    for (const f of FILES) {
      it(`${f} does not still call the ${cap} withdrawn`, () => {
        const bad = liveLines(read(f)).filter(
          (l) => st.names.test(l) && CALLS_IT_GONE.test(l) && !/restored/i.test(l));
        expect(bad, `${f}: the ${cap} was restored ${st.restored_on} (${st.verified}), but this `
          + `line still calls it gone and never says it came back:\n${bad.join('\n')}`).toEqual([]);
      });
    }
  }

  // ── STILL-WITHDRAWN capabilities: the original rule, unchanged, for the half
  //    of the audit that is genuinely unfixed. Restoring one claim must not
  //    quietly un-withdraw its neighbour.
  for (const [cap, st] of Object.entries(CAPABILITY_STATE)) {
    if (st.restored_on) continue;
    for (const f of FILES) {
      it(`${f} does not sell the ${cap} as available`, () => {
        const bad = liveLines(read(f)).filter(
          (l) => st.names.test(l) && !CALLS_IT_GONE.test(l));
        expect(bad, `${f}: the ${cap} is still withdrawn (${st.withdrawn_on}; ${st.verified}) — `
          + `naming it without saying so sells a product we do not serve:\n${bad.join('\n')}`).toEqual([]);
      });
    }
  }

  // ★ THE RESTORE MUST NOT ERASE THE RECORD. A reader holding a pre-2026-08-08
  //   DCGI figure is holding a number from a different index; if every mention
  //   of the withdrawal is scrubbed on restore, nothing tells them that. At
  //   least one paste-ready listing has to carry both dates.
  it('the correction survives the restoration — both dates are on record', () => {
    const carriers = FILES.filter((f) => {
      const t = read(f);
      return /2026-08-08/.test(t) && /2026-08-30/.test(t);
    });
    expect(carriers.length,
      'no listing file carries BOTH the withdrawal and restoration dates. A restored index '
      + 'whose correction is scrubbed leaves every cached pre-08-08 figure looking current.'
    ).toBeGreaterThan(0);
  });

  // ★ SELF-CHECK: a state table nobody re-measures is how this fence rotted the
  //   first time. Every entry must carry evidence of when it was last checked.
  it('every capability records how its state was measured', () => {
    for (const [cap, st] of Object.entries(CAPABILITY_STATE)) {
      expect(st.verified, `${cap}: no measurement recorded — this fence enforces a claim `
        + 'nobody has confirmed, which is exactly how it inverted in August').toBeTruthy();
      expect(st.verified, `${cap}: the measurement names no date`).toMatch(/20\d\d-\d\d-\d\d/);
    }
  });
  // ★★2026-08-30 — THIS ASSERTION WAS VACUOUS AND HID THE DEFECT IT NAMED.
  //
  // It read:
  //     expect(read('server.mjs').includes('DCPI + DCGI indices')).toBe(false);
  //
  // Three independent reasons it could only ever pass:
  //   1. WRONG STRING. The shipped label is "Proprietary live indices
  //      (DCPI + DCGI)". The literal 'DCPI + DCGI indices' has never existed
  //      in any file, in any repo.
  //   2. WRONG FILE. why_dchub's sales copy is not in server.mjs; this repo
  //      registers the tool name and proxies the call.
  //   3. WRONG REPO. That copy is built in
  //      dchub-backend/routes/competitive_intel.py, which this test cannot see.
  //
  // So the header above ("the one sales string that did not was why_dchub")
  // diagnosed it correctly and then guarded nothing. The live server kept
  // serving "Two proprietary indices recomputed daily … the DC Hub Gas Index
  // (DCGI) scores gas access and cost by state" — with a proof URL and a
  // citation line — until 2026-08-30, when an outside AI auditing DC Hub
  // reported it from the public side. Eight days green over a live false claim.
  //
  // Real coverage now lives where the string does:
  // dchub-backend/tests/test_why_dchub_no_stale_capability.py, which asserts
  // over the EDGES objects rather than a source literal, so a reworded claim
  // cannot slip past it the way this one did.
  //
  // No replacement assertion is added here, deliberately. The line rule the
  // FILES loop above applies works on PROSE, where every line is a claim.
  // server.mjs is code: `get_gas_index: "Gas Index (DCGI)"` is a display name,
  // `_R('methodology', …, 'DCPI / DCGI methodology')` is a resource title whose
  // body states the withdrawal, and several hits are ordinary code comments.
  // Applying the line rule here flags all of them — a fence that cannot be made
  // green without mangling identifiers, which is how fences get deleted rather
  // than fixed. server.mjs's one substantive claim is already covered by the
  // methodology assertion directly below, and the sales copy that was actually
  // wrong is covered in the repo that generates it.
  // ★ 2026-08-30 — INVERTED, not deleted. This asserted that the methodology
  //   resource names the DCGI as WITHDRAWN. The index was restored once all
  //   three defective terms were repaired, so that assertion now demands a
  //   falsehood. It is NOT dropped: the live danger moved from "sells a
  //   withdrawn score" to "serves a restored score as if nothing happened",
  //   and a reader holding a pre-2026-08-08 figure has to be told the two are
  //   different indices. The fence now requires the CORRECTION, both dates.
  it('the methodology resource states the withdrawal AND the restoration', () => {
    const src = read('server.mjs');
    const i = src.indexOf("_R('methodology'");
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i, i + 3000);
    expect(block).toMatch(/DCGI/);
    expect(block, 'the withdrawal date must survive the restoration')
      .toMatch(/2026-08-08/);
    expect(block, 'a restored index must say so, and when')
      .toMatch(/restored\s+2026-08-30/i);
    expect(block, 'a reader holding a pre-withdrawal figure must be told the '
                + 'two are not comparable')
      .toMatch(/not comparable|corrections/i);
  });
});

describe('scripts/smithery_description.txt is the single origin the daily check compares', () => {
  const txt = read('scripts/smithery_description.txt');
  it('carries every canon quantity the healer owns (facilities/deals/markets/countries)', () => {
    const canon = JSON.parse(read('canonical/canon_phrases.json'));
    for (const k of ['facilities', 'deals', 'markets', 'countries']) expect(txt, k).toContain(canon[k]);
  });
  it('never states a tracked-feed COUNT (the deadman count moves; the sentence must not rot)', () => {
    expect(/\b\d+ tracked feeds\b/.test(txt)).toBe(false);
  });
  it('still leads with the liveness claim Smithery relevance-ranks on', () => {
    expect(txt).toMatch(/^DC Hub is the neutral, real-time data layer/);
    expect(txt).toContain('https://dchub.cloud/api/v1/ops/deadman');
  });
});
