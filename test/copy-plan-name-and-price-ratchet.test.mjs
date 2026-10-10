// copy-plan-name-and-price-ratchet.test.mjs — Grok A2 (mcp half) guards (a) and (b).
//
// (a) Tool-output text and wall copy may name a paid plan only through the approved phrase
//     "DC Hub Developer or Pro". Every OTHER capitalised "Developer" / "Pro" / "Enterprise" inside
//     a string literal of server.mjs or lib/*.mjs is an offender: it is a plan the copy names
//     on its own, which is how one surface says "Developer" while the next says "Pro" and the
//     agent relays whichever it read last.
// (b) No hard-coded price literal ("$10", "$0.50", "$49") inside a string literal. A price an
//     agent reads back to a human must come from canon (lib/tier-canon.mjs PLAN_PRICE, a
//     `${...}` template part), not from a number typed into prose. A template `${...}` part is
//     not a literal, so canon-derived prices do not count.
//
// BOTH ARE RATCHETS, NOT ZERO-TOLERANCE. Measured on origin/main 2026-10-08 the repo already
// carries the offenders in BASELINE below. This PR changes no copy (owner: guards only), so
// the baseline is the measured present: a file may not gain an offender, and a file that loses
// more than SLACK of them must lower its baseline so the ratchet keeps its teeth. Lower the
// number in the same commit that removes the copy; never raise it to make a red run green.
//
// A file NOT listed has baseline 0: a new lib/ file that names a plan or a price fails here.
//
// Deterministic: reads committed source only, no network, writes nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { stringLiterals } from './helpers/js-literals.mjs';

const ROOT = new URL('../', import.meta.url);
// v14 (owner 2026-10-10): no plan name at all, so the once-approved phrase is an offender too. It is
// kept as a constant so the must-fail control below proves it now counts.
const APPROVED = 'DC Hub Developer or Pro';
const PLAN = /\b(Developer|Pro|Enterprise)\b/g;
const PRICE = /\$\d[\d,]*(?:\.\d+)?(?![\w$])/g;
const SLACK = 10;   // how far under its baseline a file may drift before the baseline must be lowered

export function planOffenders(src) {
  const hits = [];
  for (const { line, text } of stringLiterals(src)) {
    for (const m of text.matchAll(PLAN)) hits.push({ line, word: m[1], text: text.replace(/\s+/g, ' ').slice(Math.max(0, m.index - 30), m.index + 40) });
  }
  return hits;
}
export function priceOffenders(src) {
  const hits = [];
  for (const { line, text } of stringLiterals(src)) {
    for (const m of text.matchAll(PRICE)) hits.push({ line, word: m[0], text: text.replace(/\s+/g, ' ').slice(Math.max(0, m.index - 30), m.index + 40) });
  }
  return hits;
}

// Measured 2026-10-08 on origin/main. file → count.
// 2026-10-10 (v13, owner: no plan name in the Pro-only walls or the instructions line): server.mjs 148 -> 130.
// 2026-10-10 (v14, owner: no plan name and no price in any tool-facing text): server.mjs 130 -> 1
// (the one left is "Developer names come from ERCOTQueue", a project developer, not a plan), and
// every lib file -> 0. The approved phrase above is retired with it: nothing may name a plan now.
const PLAN_BASELINE = {
  'server.mjs': 1,
};
// 2026-10-09 (Grok A5): the "$10" credit-pack literals now read PACK_PRICE from lib/canon.mjs
// (64 -> 11 in server.mjs; 6 lib files -> 0). What remains is not the pack: the x402 per-call
// $0.50, "$35.6B"-style examples, the $0/$20 burner-tip range, and regex backrefs ($1).
// 2026-10-10 (v14): the MPP "$0.50" prose and its one-link detector literals went (11 -> 4); what is
// left is data examples ("$35.6B", "$9.2B") and the $0/$20 burner-tip range.
const PRICE_BASELINE = {
  'server.mjs': 4,
  'lib/chatgpt-directory.mjs': 1,
  'lib/facility-location.mjs': 1,
  'lib/free-decision-taste.mjs': 1,
  'lib/log-redact.mjs': 3,
  'lib/provenance-plain.mjs': 2,
  'lib/verification-counts.mjs': 1,
};

const FILES = ['server.mjs', 'oauth.mjs', 'mpp-hook.mjs',
  ...readdirSync(new URL('lib/', ROOT)).filter((f) => f.endsWith('.mjs')).map((f) => 'lib/' + f)].sort();
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

function ratchet(name, scan, baseline) {
  describe(name, () => {
    it('the scan is not vacuous: server.mjs yields thousands of literals and every baseline file exists', () => {
      expect(stringLiterals(read('server.mjs')).length).toBeGreaterThan(5000);
      for (const f of Object.keys(baseline)) expect(FILES, f + ' in baseline but not scanned').toContain(f);
    });
    for (const f of FILES) {
      it(f, () => {
        const hits = scan(read(f));
        const base = baseline[f] || 0;
        const where = hits.map((h) => `${f}:${h.line} «${h.text}»`);
        expect(hits.length, `${f} gained offenders over its baseline ${base}:\n  ` + where.slice(-8).join('\n  ')).toBeLessThanOrEqual(base);
        expect(hits.length, `${f} is ${base - hits.length} under its baseline ${base}: lower the baseline to ${hits.length}`).toBeGreaterThanOrEqual(base - SLACK);
      });
    }
  });
}

ratchet('(a) no plan name in a string literal (v14: not even "' + APPROVED + '")', planOffenders, PLAN_BASELINE);
ratchet('(b) no hard-coded price literal outside canon-derived template parts', priceOffenders, PRICE_BASELINE);

describe('must-fail controls: the scanners catch the forms that matter', () => {
  it('(a) flags a bare plan name, an enterprise mention and a name beside the approved phrase', () => {
    expect(planOffenders(`const a = 'Full depth needs Pro.';`)).toHaveLength(1);
    expect(planOffenders('const a = `Ask about Enterprise`;')).toHaveLength(1);
    expect(planOffenders(`const a = 'DC Hub Developer or Pro opens it; Developer also does.';`)).toHaveLength(3);
  });
  it('(a) v14: the once-approved phrase counts; lowercase identifiers, comments and regexes still pass', () => {
    expect(planOffenders(`const a = 'Full depth needs ${APPROVED}.';`)).toHaveLength(2);
    expect(planOffenders(`const a = 'Full depth needs a paid DC Hub plan.'; // Pro tier\nconst t = x === 'pro'; const r = /Pro|Developer/;`)).toEqual([]);
  });
  it('(b) flags typed prices, passes canon-derived template parts', () => {
    expect(priceOffenders(`const a = 'one-time $10 pack';`)).toHaveLength(1);
    expect(priceOffenders(`const a = "$0.50 per call";`)).toHaveLength(1);
    expect(priceOffenders('const a = `$${PLAN_PRICE.developer}/mo`;')).toEqual([]);
    expect(priceOffenders(`// costs $49\nconst r = /\\$10/;`)).toEqual([]);
  });
  it('the lexer survives a regex with a quote in it (a desync would hide every later literal)', () => {
    const src = `const r = /['"]/g;\nconst a = 'needs Pro';`;
    expect(planOffenders(src)).toHaveLength(1);
  });
});
